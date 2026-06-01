import { loadCompanies } from './utils.js';
import axios from 'axios';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJob, upsertJob } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler      = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

// Greenhouse's official JSON API. Returns the full board for any slug in a
// single call (no pagination), works for both legacy embed and modern boards,
// and exposes `updated_at` (catches resurfacing jobs — the HTML board only
// exposes `published_at`, which is creation-only).
export const GH_API_BASE_URL = 'https://boards-api.greenhouse.io/v1/boards/';

const CONCURRENCY_LIMIT  = 50;
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS     = 10000;
const MAX_RETRIES        = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 2: Scrape Listing Pages ─────────────────────────────────────────────

/**
 * Fetches a single company's Greenhouse board via the JSON API and maps each
 * posting to our internal schema. Single GET — no pagination.
 *
 * 404 → warn (stale slug, board removed). 403 → warn (private board).
 * 429/other → retry up to MAX_RETRIES, then error + StatsD error counter.
 */
const fetchJobsForCompany = async (company, retriesLeft, logger) => {
    try {
        const response = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });
        const jobs     = response.data?.jobs ?? [];

        const mapped = jobs
            .filter((j) => j.absolute_url)
            .map((j) => ({
                job_id:       String(j.id ?? ''),
                job_title:    j.title ?? '',
                // updated_at reflects refresh time, so re-promoted listings show as fresh.
                posting_date: j.updated_at
                    ? new Date(j.updated_at).toISOString().split('T')[0]
                    : null,
                location:     j.location?.name ?? '',
                company_name: company.name,
                job_link:     j.absolute_url,
            }));

        if (mapped.length > 0) {
            logger.debug(`${company.name}: ${mapped.length} postings found`);
        }
        return mapped;

    } catch (err) {
        const status = err.response?.status;

        if (status === 404) {
            logger.warn(`Company not found on Greenhouse (404) — slug may be stale: ${company.name}`);
            return [];
        }
        if (status === 403) {
            logger.warn(`Access denied (403) for ${company.name} — board may be private`);
            return [];
        }

        if (retriesLeft > 0) {
            const reason = status === 429 ? 'rate limited (429)' : err.message;
            logger.warn(`Retrying ${company.name} (${retriesLeft} left) — ${reason}`);
            await delay(RETRY_DELAY_MS);
            return fetchJobsForCompany(company, retriesLeft - 1, logger);
        }

        logger.error(`Listing fetch failed for ${company.name}: ${err.message}`);
        recordScrapeError('greenhouse');
        return [];
    }
};

/**
 * Fans out API fetches across all companies concurrently. pLimit caps
 * simultaneous requests so we stay below the API's rate-limit thresholds.
 */
const scrapeAllCompanies = async (companies, logger) => {
    const startTime = Date.now();
    logger.info(`Starting concurrent scrape for ${companies.length} companies (limit: ${CONCURRENCY_LIMIT})`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        companies.map((company) => limit(() => fetchJobsForCompany(company, MAX_RETRIES, logger)))
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
 * Runs a single job through the filter pipeline with the standard fast/slow
 * path. The API returns posting_date inline, so there is no N+1 fetch
 * anywhere in this scraper.
 */
const applyJobFilters = async (job, logger, filterJob, portal) => {
    if (!job?.job_link) return null;

    try {
        const cached = getJob(job.job_link);

        if (cached) {
            if (!filterJob.matchesLocation(cached.location))         return null;
            if (!filterJob.matchesTitle(cached.job_title))           return null;
            if (!cached.posting_date)                                return null;
            if (!filterJob.matchesPostingDate(cached.posting_date))  return null;
            return cached;
        }

        // Store first so future runs use the fast path regardless of filter outcome.
        upsertJob(job, portal);

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

const filterJobs = async (jobs, logger, filterJob, portal) => {
    const startTime = Date.now();
    logger.info(`Filtering ${jobs.length} jobs by location, title, and date rules`);

    const limit   = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        jobs.map((job) => limit(() => applyJobFilters(job, logger, filterJob, portal)))
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
 * Entry point for the Greenhouse scraper. Reads slugs from app/companies/greenhouse.csv and hits
 * the official JSON API for each board.
 */
export const runGreenhouseScraper = async (filterJob = defaultFilterJob) => {
    const fileName = 'greenhouse';
    const portal   = 'greenhouse';

    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Greenhouse Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies   = loadCompanies(fileName, (slug) => `${GH_API_BASE_URL}${slug}/jobs`, logger);
        const scrapedJobs = await scrapeAllCompanies(companies, logger);

        const filteredJobs = await filterJobs(scrapedJobs, logger, filterJob, portal);

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
