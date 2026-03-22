import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJob, upsertJob } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler     = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

const GH_STANDARD_BASE_URL = 'https://job-boards.greenhouse.io/';
const GH_EMBED_BASE_URL    = 'https://boards.greenhouse.io/embed/job_board?for=';
const GH_STANDARD_ROUTE    = 'routes/$url_token';
const GH_EMBED_ROUTE       = 'routes/embed.job_board';

const CONCURRENCY_LIMIT  = 50;    // max parallel company scrapes
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS     = 10000;
const MAX_RETRIES        = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 1: Load Companies ───────────────────────────────────────────────────

/**
 * Reads a Greenhouse company slugs CSV, deduplicates entries, and returns an
 * array of { name, link } objects ready for scraping.
 *
 * Lines starting with '#' are treated as comments and skipped.
 *
 * @param {string} fileName - base name of the CSV (e.g. 'gh-io' or 'gh-embed')
 * @param {string} baseUrl  - Greenhouse board base URL for this mode
 * @param {Logger} logger
 * @returns {{ name: string, link: string }[]}
 */
const loadCompanies = (fileName, baseUrl, logger) => {
    const csvFilePath = `app/companies/greenhouse/${fileName}.csv`;
    logger.info(`Loading companies from: ${csvFilePath}`);

    try {
        const rows = readFileSync(csvFilePath, 'utf8')
            .split('\n')
            .map((row) => row.toLowerCase().trim())
            .filter((row) => row.length > 0 && !row.startsWith('#'));

        const companies = [...new Set(rows)].map((name) => ({
            name,
            link: `${baseUrl}${name}`,
        }));

        logger.info(`Companies loaded: ${companies.length}`);
        return companies;
    } catch (error) {
        logger.error(`Failed to load companies CSV: ${error.message}`);
        throw error;
    }
};

// ─── Step 2: Scrape Listing Pages ─────────────────────────────────────────────

/**
 * Parses the window.__remixContext script tag from a Greenhouse page and
 * returns the jobPosts object ({ total_pages, data }) for the given route key.
 *
 * Greenhouse inlines all job data as JSON inside a <script> tag rather than
 * via a separate API, so we find and parse that script block.
 *
 * Returns null if the expected data structure is absent or malformed.
 *
 * @param {string} html     - raw HTML from the Greenhouse board page
 * @param {string} routeKey - e.g. 'routes/$url_token' or 'routes/embed.job_board'
 * @returns {{ total_pages: number, data: object[] } | null}
 */
const extractJobsFromPage = (html, routeKey) => {
    const dom      = new jsdom.JSDOM(html);
    const document = dom.window.document;

    const scriptEl = Array.from(document.querySelectorAll('script')).find(
        (s) => s.textContent.includes('window.__remixContext')
    );
    if (!scriptEl) return null;

    const match = scriptEl.textContent.match(/window\.__remixContext\s*=\s*({[\s\S]*?});/);
    if (!match) return null;

    try {
        const remixContext = JSON.parse(match[1]);
        return remixContext?.state?.loaderData?.[routeKey]?.jobPosts ?? null;
    } catch {
        return null;
    }
};

/**
 * Fetches all pages of a single company's Greenhouse job board and returns
 * all job postings mapped to our schema. Retries on transient failures.
 *
 * Greenhouse paginates via ?page=N. We read total_pages from page 1 and
 * fetch subsequent pages sequentially within the company to avoid duplicates.
 *
 * 404 → warn (stale slug, board removed). 403 → warn (private board).
 * 429/other → retry up to MAX_RETRIES, then error + StatsD error counter.
 *
 * @param {object} company     - { name, link }
 * @param {string} routeKey    - remix route key for this board mode
 * @param {number} retriesLeft
 * @param {Logger} logger
 * @returns {object[]}         - mapped job objects, or [] on any failure
 */
const fetchJobsForCompany = async (company, routeKey, retriesLeft, logger) => {
    const allJobs = [];

    try {
        let totalPages = 1;

        for (let page = 1; page <= totalPages; page++) {
            const url      = page === 1 ? company.link : `${company.link}?page=${page}`;
            const response = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });

            const jobPosts = extractJobsFromPage(response.data, routeKey);

            if (!jobPosts) {
                logger.warn(`No job data in page for ${company.name} (page ${page})`);
                break;
            }

            // Read pagination info from first page only
            if (page === 1) {
                totalPages = jobPosts.total_pages ?? 1;
            }

            for (const job of jobPosts.data ?? []) {
                if (!job.absolute_url) continue;  // skip postings without a link

                allJobs.push({
                    job_id:       String(job.id ?? ''),
                    job_title:    job.title ?? '',
                    posting_date: job.published_at
                        ? new Date(job.published_at).toISOString().split('T')[0]
                        : null,
                    location:     job.location ?? '',
                    company_name: company.name,
                    job_link:     job.absolute_url,
                });
            }
        }

        if (allJobs.length > 0) {
            logger.debug(`${company.name}: ${allJobs.length} postings found`);
        }

        return allJobs;

    } catch (err) {
        const status = err.response?.status;

        // 404 = board removed or slug is stale — warn, do not retry
        if (status === 404) {
            logger.warn(`Company not found on Greenhouse (404) — slug may be stale: ${company.name}`);
            return [];
        }

        // 403 = board is private or access restricted — warn, do not retry
        if (status === 403) {
            logger.warn(`Access denied (403) for ${company.name} — board may be private`);
            return [];
        }

        if (retriesLeft > 0) {
            const reason = status === 429 ? 'rate limited (429)' : err.message;
            logger.warn(`Retrying ${company.name} (${retriesLeft} left) — ${reason}`);
            await delay(RETRY_DELAY_MS);
            return fetchJobsForCompany(company, routeKey, retriesLeft - 1, logger);
        }

        logger.error(`Listing fetch failed for ${company.name}: ${err.message}`);
        recordScrapeError('greenhouse');
        return [];
    }
};

/**
 * Fans out listing page scraping across all companies concurrently.
 * pLimit caps simultaneous requests to CONCURRENCY_LIMIT to avoid
 * overwhelming Greenhouse servers or triggering aggressive rate limiting.
 *
 * @param {object[]} companies
 * @param {string}   routeKey
 * @param {Logger}   logger
 * @returns {object[]} flat array of all job objects from all companies
 */
const scrapeAllCompanies = async (companies, routeKey, logger) => {
    const startTime = Date.now();
    logger.info(`Starting concurrent scrape for ${companies.length} companies (limit: ${CONCURRENCY_LIMIT})`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        companies.map((company) => limit(() => fetchJobsForCompany(company, routeKey, MAX_RETRIES, logger)))
    );

    const allJobs           = results.flat();
    const companiesWithJobs = results.filter((r) => r.length > 0).length;

    logger.info(
        `Scrape complete in ${formatElapsed(startTime)}s — ` +
        `${allJobs.length} jobs from ${companiesWithJobs}/${companies.length} companies`
    );

    return allJobs;
};

// ─── Step 3: Filter Jobs ──────────────────────────────────────────────────────

/**
 * Runs a single job through the full filter pipeline, with two execution paths:
 *
 * FAST PATH (job already in SQLite from a previous run):
 *   - Use cached title, location, and posting_date — zero HTTP calls.
 *   - Apply all three filters against cached data and return.
 *
 * SLOW PATH (new job, not yet in SQLite):
 *   - Store the job immediately (date is available from the scrape response,
 *     unlike Lever which needs a separate per-job HTTP fetch).
 *   - Apply location, title, and date filters in order.
 *
 * Greenhouse provides posting_date directly in the board page response,
 * so there is no N+1 HTTP fetch at any point in the pipeline.
 *
 * @param {object}     job
 * @param {Logger}     logger
 * @param {FilterJobs} filterJob
 * @returns {object|null} job if it passes all filters, null otherwise
 */
const applyJobFilters = async (job, logger, filterJob) => {
    if (!job?.job_link) return null;

    try {
        // ── Fast path: job was seen on a previous run ──────────────────────────
        const cached = getJob(job.job_link);

        if (cached) {
            if (!filterJob.matchesLocation(cached.location))         return null;
            if (!filterJob.matchesTitle(cached.job_title))           return null;
            if (!cached.posting_date)                                return null;
            if (!filterJob.matchesPostingDate(cached.posting_date))  return null;
            return cached;
        }

        // ── Slow path: new job not yet in the database ──────────────────────────
        // Store first so future runs use the fast path regardless of filter outcome.
        upsertJob(job, 'greenhouse');

        if (!filterJob.matchesLocation(job.location))        return null;
        if (!filterJob.matchesTitle(job.job_title))          return null;
        if (!job.posting_date)                               return null;
        if (!filterJob.matchesPostingDate(job.posting_date)) return null;

        return job;

    } catch (error) {
        logger.error(`Filter error for job [${job.job_link}]: ${error.message}`);
        return null;
    }
};

/**
 * Applies the full filter pipeline to all scraped jobs concurrently,
 * then sorts survivors by posting date descending (newest first).
 *
 * SQLite writes happen inside applyJobFilters so ALL jobs are persisted,
 * not just the ones that pass filtering.
 */
const filterJobs = async (jobs, logger, filterJob) => {
    const startTime = Date.now();
    logger.info(`Filtering ${jobs.length} jobs by location, title, and date rules`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        jobs.map((job) => limit(() => applyJobFilters(job, logger, filterJob)))
    );

    const validJobs = results
        .filter(Boolean)
        .sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

    logger.info(
        `Filtering complete in ${formatElapsed(startTime)}s — ` +
        `${validJobs.length} passed, ${jobs.length - validJobs.length} rejected`
    );

    return validJobs;
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Entry point for the Greenhouse scraper pipeline.
 *
 * Supports both standard (job-boards.greenhouse.io) and embed
 * (boards.greenhouse.io/embed) modes via the embed flag.
 *
 * Orchestrates three stages in sequence:
 *   1. Load company slugs from CSV
 *   2. Scrape each company's Greenhouse job board (all pages, concurrently)
 *   3. Filter by location, title, and date
 *   4. Write surviving jobs to an Excel file
 *
 * Key design notes:
 *   - SQLite writes happen inside applyJobFilters so ALL scraped jobs are
 *     persisted — not just the filtered ones. Subsequent runs use the fast
 *     path (cached data, zero HTTP) for any job seen before.
 *   - Greenhouse provides posting_date in the board page response, so there
 *     is no per-job HTTP fetch at any point (unlike Lever).
 *   - pLimit(50) caps concurrent requests — previously unlimited (all 2000+
 *     companies fired simultaneously).
 *   - 404/403 responses are logged as warnings, not errors.
 *   - StatsD metrics are emitted for dashboards.
 *
 * @param {boolean}    embed     - true for embed board mode, false for standard
 * @param {FilterJobs} filterJob - per-request config; defaults to env-based singleton
 * @returns {object[]} final filtered job array
 */
export const runGreenhouseScraper = async (embed = false, filterJob = defaultFilterJob) => {
    const fileName = embed ? process.env.FILE_EMBED : process.env.FILE_GH;
    const baseUrl  = embed ? GH_EMBED_BASE_URL    : GH_STANDARD_BASE_URL;
    const routeKey = embed ? GH_EMBED_ROUTE       : GH_STANDARD_ROUTE;
    const portal   = embed ? 'greenhouse-embed'   : 'greenhouse';

    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Greenhouse Scraper Started (${embed ? 'embed' : 'standard'}) | ${new Date().toISOString()} ===`);

    try {
        const companies = loadCompanies(fileName, baseUrl, logger);

        const scrapedJobs = await scrapeAllCompanies(companies, routeKey, logger);

        // SQLite writes happen inside filterJobs → applyJobFilters.
        // All scraped jobs (pass or fail) are stored for fast-path reuse.
        const filteredJobs = await filterJobs(scrapedJobs, logger, filterJob);

        recordScrapeMetrics(portal, {
            durationMs:     Date.now() - startTime,
            companiesTotal: companies.length,
            jobsScraped:    scrapedJobs.length,
            jobsFiltered:   filteredJobs.length,
        });

        if (filteredJobs.length > 0) {
            fileHandler.writeToExcel(filteredJobs, fileName);
            logger.info(`Excel file created with ${filteredJobs.length} jobs`);
        } else {
            logger.info('No jobs passed filtering — skipping file creation');
        }

        logger.info(`=== Greenhouse Scraper Finished in ${formatElapsed(startTime)}s ===`);

        return filteredJobs;

    } catch (error) {
        logger.error(`Fatal error in runGreenhouseScraper: ${error.message}`);
        throw error;
    }
};
