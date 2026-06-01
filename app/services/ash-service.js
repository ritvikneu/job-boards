import { loadCompanies } from './utils.js';
import axios from 'axios';
import jsdom from 'jsdom';
import { config } from 'dotenv';
import pLimit from 'p-limit';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJob, upsertJob, touchJob } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

const ASHBY_BASE_URL = 'https://jobs.ashbyhq.com/';
const CONCURRENCY_LIMIT = 50;   // max parallel HTTP requests / filter evaluations
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 10000;   // wait 10s before retrying a failed/rate-limited request
const MAX_RETRIES = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 2: Scrape Jobs ──────────────────────────────────────────────────────

/**
 * Fetches a single company's Ashby job board page and returns all job
 * postings mapped to our schema (unfiltered). Retries on failure or
 * rate-limiting (429) up to MAX_RETRIES times.
 *
 * Filtering (date, location, title) and SQLite writes happen later in
 * applyJobFilters so all postings are available for the fast/slow path.
 *
 * @param {object} company     - { name, link }
 * @param {number} retriesLeft
 * @param {Logger} logger
 * @returns {object[]}         - mapped job objects, or [] on any failure
 */
const scrapeJobsForCompany = async (company, retriesLeft, logger) => {
    try {
        const response = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });

        if (response.status !== 200) {
            logger.warn(`Non-200 response for ${company.name} [${response.status}] — ${company.link}`);
            return [];
        }

        const jobPostings = extractJobPostingsFromHtml(response.data);

        if (!jobPostings) {
            // The page loaded but didn't contain the expected __appData structure.
            // This can happen if Ashby changes their frontend or the board is empty.
            logger.warn(`No job postings found in page data for: ${company.name}`);
            return [];
        }

        const jobs = mapPostings(jobPostings, company);
        logger.debug(`${company.name}: ${jobs.length} postings found`);
        return jobs;

    } catch (err) {
        if (retriesLeft > 0) {
            const reason = err.response?.status === 429 ? 'rate limited (429)' : err.message;
            logger.warn(`Retrying ${company.name} (${retriesLeft} left) — ${reason}`);
            await delay(RETRY_DELAY_MS);
            return scrapeJobsForCompany(company, retriesLeft - 1, logger);
        }

        logger.error(`Scrape failed for ${company.name} [${company.link}]: ${err.message}`);
        recordScrapeError('ashby');
        return [];
    }
};

/**
 * Parses raw HTML from an Ashby job board page and extracts the job postings
 * array embedded in the page's `window.__appData` script tag.
 *
 * Ashby inlines all job data as JSON in the HTML rather than via a separate API,
 * so we parse the DOM to find and extract that script block.
 *
 * Returns null if the expected data structure is absent or malformed.
 */
const extractJobPostingsFromHtml = (html) => {
    const marker = 'window.__appData = ';
    const start = html.indexOf(marker);
    if (start === -1) return null;

    // Walk forward from the opening brace, counting brackets
    // to find the exact closing brace of the JSON object
    let depth = 0;
    let jsonStart = -1;

    for (let i = start + marker.length; i < html.length; i++) {
        if (html[i] === '{') {
            if (jsonStart === -1) jsonStart = i;
            depth++;
        } else if (html[i] === '}') {
            depth--;
            if (depth === 0) {
                try {
                    const appData = JSON.parse(html.slice(jsonStart, i + 1));
                    return appData?.jobBoard?.jobPostings ?? null;
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
};

/**
 * Maps raw Ashby job postings to our internal job schema.
 *
 * This is a pure mapping step — no filtering, no I/O. Postings without a
 * jobId are skipped because they can't be reliably deduplicated by job_link.
 * All other postings are returned regardless of date, location, or title so
 * that applyJobFilters can store and evaluate them via the fast/slow path.
 *
 * @param {object[]} jobPostings - raw postings from window.__appData
 * @param {object}   company     - { name, link }
 * @returns {object[]}
 */
const mapPostings = (jobPostings, company) => {
    return jobPostings
        .filter((posting) => posting.jobId)  // jobId required for deduplication
        .map((posting) => ({
            job_id:       posting.jobId,
            job_title:    posting.title,
            posting_date: posting.updatedAt
                ? new Date(posting.updatedAt).toISOString().split('T')[0]
                : null,
            location:     posting.locationName ?? '',
            company_name: company.name,
            job_link:     `${company.link}/${posting.id}`,
        }));
};

/**
 * Fans out scraping across all companies concurrently and collects results.
 * pLimit caps simultaneous requests to avoid overwhelming the target or
 * triggering aggressive rate limiting.
 *
 * @param {object[]} companies
 * @param {Logger}   logger
 * @returns {object[]} flat array of all mapped job objects from all companies
 */
const scrapeAllCompanies = async (companies, logger) => {
    const startTime = Date.now();
    logger.info(`Starting concurrent scrape for ${companies.length} companies (limit: ${CONCURRENCY_LIMIT})`);

    const limit = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        companies.map((company) => limit(() => scrapeJobsForCompany(company, MAX_RETRIES, logger)))
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
 * Runs a single job through the full filter pipeline, with two execution paths:
 *
 * FAST PATH (job already in SQLite from a previous run):
 *   - Use cached title, location, and posting_date — no HTTP calls needed.
 *   - Apply all three filters against cached data and return.
 *   - Note: unlike Lever, Ashby always stores posting_date (it comes from the
 *     API response), so a NULL cached date means the posting had no updatedAt.
 *
 * SLOW PATH (new job, not yet in SQLite):
 *   - Store the job immediately (with date from API) so future runs take the
 *     fast path regardless of whether this job passes all filters.
 *   - Apply location, title, and date filters in order and return or null.
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
            touchJob(job.job_link);
            if (!filterJob.matchesLocation(cached.location))         return null;
            if (!filterJob.matchesTitle(cached.job_title))           return null;
            if (!cached.posting_date)                                return null;
            if (!filterJob.matchesPostingDate(cached.posting_date))  return null;
            return cached;
        }

        // ── Slow path: new job not yet in the database ──────────────────────────
        // Only store jobs that pass title + location — posting date is a result
        // filter only, not a storage gate.
        if (!filterJob.matchesLocation(job.location))        return null;
        if (!filterJob.matchesTitle(job.job_title))          return null;

        upsertJob(job, 'ashby');

        if (!job.posting_date)                               return null;
        if (!filterJob.matchesPostingDate(job.posting_date)) return null;

        return job;

    } catch (error) {
        logger.error(`Filter error for job [${job.job_link}]: ${error.message}`);
        return null;
    }
};

/**
 * Applies location, title, and date filters to all scraped jobs concurrently.
 * SQLite writes happen inside applyJobFilters so ALL jobs are persisted,
 * not just the ones that pass. Survivors are sorted by posting date descending.
 */
const filterJobs = async (jobs, logger, filterJob) => {
    const startTime = Date.now();
    logger.info(`Filtering ${jobs.length} jobs by location, title, and date rules`);

    const limit = pLimit(CONCURRENCY_LIMIT);
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
 * Entry point for the AshbyHQ scraper pipeline.
 *
 * Orchestrates three stages in sequence:
 *   1. Load company slugs from CSV
 *   2. Scrape each company's job board (all postings, unfiltered)
 *   3. Filter by location, title, and date
 *   4. Write surviving jobs to an Excel file
 *
 * Key design notes:
 *   - SQLite writes happen inside applyJobFilters (not here) so ALL scraped
 *     jobs are persisted — not just the filtered ones. Subsequent runs use
 *     the fast path (cached data, zero HTTP calls per job) for any job seen
 *     before, regardless of whether it passed filters last time.
 *   - Unlike Lever, Ashby provides posting_date directly in the API response,
 *     so there is no per-job HTTP fetch at any point in the pipeline.
 *   - All output goes through the structured logger — no console.log.
 *   - StatsD metrics are emitted so dashboards show volume and yield per run.
 *
 * @param {FilterJobs} filterJob - per-request config; defaults to env-based singleton
 * @returns {object[]} final filtered job array
 */
export const runAshScraper = async (filterJob = defaultFilterJob) => {
    const fileName = 'ashby';
    const logger = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== AshbyHQ Job Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies = loadCompanies(fileName, (slug) => `${ASHBY_BASE_URL}${slug}`, logger);

        const scrapedJobs = await scrapeAllCompanies(companies, logger);

        // SQLite writes happen inside filterJobs → applyJobFilters.
        // All scraped jobs (pass or fail) are stored for fast-path reuse.
        const filteredJobs = await filterJobs(scrapedJobs, logger, filterJob);

        recordScrapeMetrics('ashby', {
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

        logger.info(`=== AshbyHQ Scraper Finished in ${formatElapsed(startTime)}s ===`);

        return filteredJobs;

    } catch (error) {
        logger.error(`Fatal error in runAshScraper: ${error.message}`);
        throw error;
    }
};