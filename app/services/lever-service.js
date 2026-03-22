import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJob, updateJobDate, upsertJob } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVER_BASE_URL    = 'https://jobs.lever.co/';
const CONCURRENCY_LIMIT = 50;    // max parallel requests for both listing pages and date fetches
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS    = 10000; // wait 10s before retrying a failed/rate-limited request
const MAX_RETRIES       = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 1: Load Companies ───────────────────────────────────────────────────

/**
 * Reads the Lever company slugs CSV, deduplicates entries, and returns an array
 * of { name, link } objects ready for scraping.
 *
 * The CSV has one slug per line (e.g. "stripe", "openai").
 * Lines starting with '#' are treated as comments and skipped.
 * Slugs are lowercased and trimmed; duplicates are silently dropped.
 */
const loadCompanies = (fileName, logger) => {
    const csvFilePath = `app/companies/lever/${fileName}.csv`;
    logger.info(`Loading companies from: ${csvFilePath}`);

    try {
        const rows = readFileSync(csvFilePath, 'utf8')
            .split('\n')
            .map((row) => row.toLowerCase().trim())
            .filter((row) => row.length > 0 && !row.startsWith('#'));

        const companies = [...new Set(rows)].map((name) => ({
            name,
            link: `${LEVER_BASE_URL}${name}`,
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
 * Parses the HTML of a Lever company job board listing page and extracts all
 * visible job postings.
 *
 * Lever renders each posting as a <div class="posting"> containing:
 *   - .posting-title[href]   → absolute job URL
 *   - .posting-title h5      → job title text
 *   - .sort-by-location      → location text
 *
 * Postings without a valid href or title are skipped defensively to avoid
 * null reference errors on non-standard page layouts.
 *
 * @param {string} html        - raw HTML from the Lever listing page
 * @param {object} company     - { name, link }
 * @returns {object[]}         - array of job objects (no posting_date yet)
 */
const parseJobsFromListingHtml = (html, company) => {
    const dom = new jsdom.JSDOM(html);
    const document = dom.window.document;
    const postingEls = document.querySelectorAll('.posting');

    const jobs = [];

    for (const el of postingEls) {
        const titleEl    = el.querySelector('.posting-title');
        const locationEl = el.querySelector('.sort-by-location');

        // Guard against non-standard layouts that may omit expected elements
        if (!titleEl || !titleEl.getAttribute('href')) continue;

        const job_link = titleEl.getAttribute('href');
        const titleH5  = titleEl.querySelector('h5');
        if (!titleH5) continue;

        jobs.push({
            job_id:       job_link.split('/')[4] ?? '',
            job_title:    titleH5.textContent.trim(),
            job_link,
            location:     locationEl?.textContent.trim() ?? '',
            company_name: company.name,
        });
    }

    return jobs;
};

/**
 * Fetches a single company's Lever job board listing page and returns all
 * job postings found on it. Retries on transient failures up to MAX_RETRIES.
 *
 * 404 responses are expected for companies that have migrated away from Lever
 * or whose slug is stale — these are logged as warnings, not errors.
 *
 * @param {object} company     - { name, link }
 * @param {number} retriesLeft - decremented on each retry attempt
 * @param {Logger} logger
 * @returns {object[]}         - parsed job objects, or [] on any failure
 */
const fetchJobsForCompany = async (company, retriesLeft, logger) => {
    try {
        const response = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });

        const jobs = parseJobsFromListingHtml(response.data, company);
        logger.debug(`${company.name}: ${jobs.length} postings found on listing page`);
        return jobs;

    } catch (err) {
        const status = err.response?.status;

        // 404 = company not on Lever or slug is stale — warn, do not retry
        if (status === 404) {
            logger.warn(`Company not found on Lever (404) — slug may be stale: ${company.name}`);
            return [];
        }

        if (retriesLeft > 0) {
            const reason = status === 429 ? 'rate limited (429)' : err.message;
            logger.warn(`Retrying ${company.name} (${retriesLeft} left) — ${reason}`);
            await delay(RETRY_DELAY_MS);
            return fetchJobsForCompany(company, retriesLeft - 1, logger);
        }

        logger.error(`Listing fetch failed for ${company.name} [${company.link}]: ${err.message}`);
        recordScrapeError('lever');
        return [];
    }
};

/**
 * Fans out listing page scraping across all companies concurrently.
 * pLimit caps simultaneous requests to avoid overwhelming Lever's servers.
 *
 * @param {object[]} companies
 * @param {Logger}   logger
 * @returns {object[]} flat array of all jobs from all companies (no dates yet)
 */
const scrapeAllCompanies = async (companies, logger) => {
    const startTime = Date.now();
    logger.info(`Starting concurrent scrape for ${companies.length} companies (limit: ${CONCURRENCY_LIMIT})`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        companies.map((company) => limit(() => fetchJobsForCompany(company, MAX_RETRIES, logger)))
    );

    const allJobs = results.flat();
    const companiesWithJobs = results.filter((r) => r.length > 0).length;

    logger.info(
        `Scrape complete in ${formatElapsed(startTime)}s — ` +
        `${allJobs.length} jobs from ${companiesWithJobs}/${companies.length} companies`
    );

    return allJobs;
};

// ─── Step 3: Filter Jobs ──────────────────────────────────────────────────────

/**
 * Fetches the posting date for a single job by scraping the individual job
 * page's structured data script tag.
 *
 * Lever embeds a <script type="application/ld+json"> block on every job page
 * that follows the schema.org JobPosting spec and includes a "datePosted" field.
 *
 * This fetch only happens for jobs that have already passed the location, title,
 * and SQLite dedup checks — minimising the number of individual page requests.
 *
 * Returns null if the page is unreachable or the date field is absent.
 *
 * @param {string} job_link - full URL to the individual Lever job page
 * @returns {string|null}   - ISO date string ("YYYY-MM-DD") or null
 */
const fetchPostingDate = async (job_link) => {
    try {
        const response = await axios.get(job_link, { timeout: REQUEST_TIMEOUT_MS });
        const dom      = new jsdom.JSDOM(response.data);
        const scriptEl = dom.window.document.querySelector('script[type="application/ld+json"]');

        if (!scriptEl) return null;

        const parsed = JSON.parse(scriptEl.textContent);
        return parsed.datePosted ?? null;
    } catch {
        return null;
    }
};

/**
 * Runs a single job through the full filter pipeline, with two execution paths:
 *
 * FAST PATH (job already in SQLite from a previous run):
 *   - Use cached title, location, and posting_date — no HTTP calls needed.
 *   - If posting_date was NULL (job was stored after failing title/location on a
 *     prior run with stricter filters), fetch it now and cache it for next time.
 *   - Apply all three filters against cached data and return.
 *
 * SLOW PATH (new job, not yet in SQLite):
 *   - Apply location and title filters in-memory (cheapest checks first).
 *   - Store the job in SQLite regardless of filter outcome so future runs can
 *     use the fast path. posting_date is stored if fetched, or NULL if the job
 *     was rejected before we needed to fetch it.
 *   - Fetch posting_date only if location + title both pass (avoids HTTP calls
 *     for jobs that would be rejected on cheaper checks anyway).
 *   - Apply date filter and return.
 *
 * This design means each job URL is fetched from Lever at most once ever.
 * On the first run, all jobs go through the slow path. On subsequent runs,
 * every job seen before hits the fast path with zero HTTP calls.
 *
 * @param {object}     job       - scraped job without posting_date
 * @param {Logger}     logger
 * @param {FilterJobs} filterJob
 * @returns {object|null} job enriched with posting_date, or null if filtered out
 */
const applyJobFilters = async (job, logger, filterJob) => {
    if (!job?.job_link) return null;

    try {
        // ── Fast path: job was seen on a previous run ──────────────────────────
        const cached = getJob(job.job_link);

        if (cached) {
            // Re-filter using cached data — no HTTP calls
            if (!filterJob.matchesLocation(cached.location))  return null;
            if (!filterJob.matchesTitle(cached.job_title))    return null;

            let { posting_date } = cached;

            if (!posting_date) {
                // Job was stored without a date (failed cheaper filters last time).
                // Now that it passes location + title, fetch the date and cache it.
                posting_date = await fetchPostingDate(job.job_link);
                if (posting_date) updateJobDate(job.job_link, posting_date);
            }

            if (!posting_date)                               return null;
            if (!filterJob.matchesPostingDate(posting_date)) return null;

            return { ...cached, posting_date };
        }

        // ── Slow path: new job not yet in the database ──────────────────────────

        // Step 1 — location filter (no I/O). Store and exit if rejected.
        if (!filterJob.matchesLocation(job.location)) {
            upsertJob({ ...job, posting_date: null }, 'lever');
            return null;
        }

        // Step 2 — title filter (no I/O). Store and exit if rejected.
        if (!filterJob.matchesTitle(job.job_title)) {
            upsertJob({ ...job, posting_date: null }, 'lever');
            return null;
        }

        // Step 3 — fetch posting date from the individual job page's LD+JSON.
        // Happens only after location + title pass to minimise HTTP calls.
        const posting_date = await fetchPostingDate(job.job_link);

        // Store to SQLite now (with date if we got one, NULL otherwise) so this
        // job is handled by the fast path on every subsequent run.
        upsertJob({ ...job, posting_date: posting_date ?? null }, 'lever');

        if (!posting_date)                               return null;

        // Step 4 — date filter
        if (!filterJob.matchesPostingDate(posting_date)) return null;

        return { ...job, posting_date };

    } catch (error) {
        logger.error(`Filter error for job [${job.job_link}]: ${error.message}`);
        return null;
    }
};

/**
 * Applies the full filter pipeline to all scraped jobs concurrently,
 * then sorts survivors by posting date descending (newest first).
 *
 * pLimit keeps individual job page fetches (inside applyJobFilters) bounded
 * so we don't flood Lever with hundreds of simultaneous requests.
 *
 * @param {object[]}   jobs
 * @param {Logger}     logger
 * @param {FilterJobs} filterJob
 * @returns {object[]} filtered and sorted jobs with posting_date populated
 */
const filterJobs = async (jobs, logger, filterJob) => {
    const startTime = Date.now();
    logger.info(`Filtering ${jobs.length} jobs by location, title, and date rules`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(jobs.map((job) => limit(() => applyJobFilters(job, logger, filterJob))));

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
 * Entry point for the Lever scraper pipeline.
 *
 * Orchestrates three stages in sequence:
 *   1. Load company slugs from CSV
 *   2. Scrape each company's Lever job board listing page (concurrently)
 *   3. Filter by location, title, date (with per-job date fetch via LD+JSON)
 *   4. Write passing jobs to the Excel output file
 *
 * Key design notes:
 *   - SQLite writes happen inside applyJobFilters (not here) so ALL scraped
 *     jobs are persisted — not just the filtered ones. This means subsequent
 *     runs skip the expensive individual job page HTTP fetch entirely for any
 *     job seen before (the "fast path" in applyJobFilters).
 *   - Listing page scraping and individual job date fetches both run at
 *     CONCURRENCY_LIMIT (50) — 10× higher than the previous limit of 5.
 *   - Date fetches only happen for jobs passing location + title, so we
 *     minimise HTTP calls even on first-run slow-path jobs.
 *   - All output goes through the structured logger — no console.log.
 *   - StatsD metrics are emitted so dashboards show volume and yield per run.
 *
 * @param {FilterJobs} filterJob - per-request config; defaults to env-based singleton
 * @returns {object[]} final filtered job array
 */
export const runLeverScraper = async (filterJob = defaultFilterJob) => {
    const fileName  = process.env.FILE_LEVER;
    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Lever Job Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies = loadCompanies(fileName, logger);

        const scrapedJobs = await scrapeAllCompanies(companies, logger);

        // SQLite writes happen inside filterJobs → applyJobFilters.
        // All scraped jobs (pass or fail) are stored for fast-path reuse.
        const filteredJobs = await filterJobs(scrapedJobs, logger, filterJob);

        recordScrapeMetrics('lever', {
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

        logger.info(`=== Lever Scraper Finished in ${formatElapsed(startTime)}s ===`);

        return filteredJobs;

    } catch (error) {
        logger.error(`Fatal error in runLeverScraper: ${error.message}`);
        throw error;
    }
};
