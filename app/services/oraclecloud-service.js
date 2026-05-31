import { readFileSync } from 'fs';
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

const CONCURRENCY_LIMIT  = 10;    // small company list — modest parallelism
const REQUEST_TIMEOUT_MS = 20000; // Oracle Cloud APIs can be slow to respond
const RETRY_DELAY_MS     = 10000;
const MAX_RETRIES        = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 1: Load Companies ───────────────────────────────────────────────────

/**
 * Reads the Oracle Cloud company config JSON and returns an array of
 * { companyName, url, jobSearchUrl } entries ready for scraping.
 *
 * The JSON schema is:
 *   [{ "companyName": "...", "url": "...", "jobSearchUrl": "..." }, ...]
 *
 * @param {string} fileName - base name of the JSON file (e.g. 'oracloud')
 * @param {Logger} logger
 * @returns {{ companyName: string, url: string, jobSearchUrl: string }[]}
 */
const loadCompanies = (fileName, logger) => {
    const filePath = `app/companies/${fileName}.json`;
    logger.info(`Loading companies from: ${filePath}`);

    try {
        const companies = JSON.parse(readFileSync(filePath, 'utf8'));
        logger.info(`Companies loaded: ${companies.length}`);
        return companies;
    } catch (error) {
        logger.error(`Failed to load companies JSON: ${error.message}`);
        throw error;
    }
};

// ─── Step 2: Scrape Company APIs ──────────────────────────────────────────────

/**
 * Fetches all job postings for a single Oracle Cloud company via their
 * hosted REST API and maps them to our internal job schema.
 *
 * Oracle Cloud exposes a JSON endpoint for each company that returns a
 * requisition list under data.items[0].requisitionList. Each requisition
 * contains Title, Id, PrimaryLocation, PrimaryLocationCountry, PostedDate.
 *
 * Transient failures are retried up to MAX_RETRIES times.
 *
 * @param {object} company     - { companyName, url, jobSearchUrl }
 * @param {number} retriesLeft
 * @param {Logger} logger
 * @returns {object[]}         - mapped job objects, or [] on any failure
 */
const fetchJobsForCompany = async (company, retriesLeft, logger) => {
    try {
        const response     = await axios.get(company.url, { timeout: REQUEST_TIMEOUT_MS });
        const requisitions = response.data?.items?.[0]?.requisitionList;

        if (!requisitions) {
            logger.warn(`No requisition list found for ${company.companyName}`);
            return [];
        }

        const jobs = requisitions.map((req) => ({
            job_id:       String(req.Id ?? ''),
            job_title:    req.Title ?? '',
            location:     req.PrimaryLocation ?? '',
            country:      req.PrimaryLocationCountry ?? '',
            posting_date: req.PostedDate
                ? new Date(req.PostedDate).toISOString().split('T')[0]
                : null,
            company_name: company.companyName,
            job_link:     `${company.jobSearchUrl}${req.Id}`,
        }));

        logger.debug(`${company.companyName}: ${jobs.length} postings found`);
        return jobs;

    } catch (err) {
        if (retriesLeft > 0) {
            const status = err.response?.status;
            const reason = status ? `HTTP ${status}` : err.message;
            logger.warn(`Retrying ${company.companyName} (${retriesLeft} left) — ${reason}`);
            await delay(RETRY_DELAY_MS);
            return fetchJobsForCompany(company, retriesLeft - 1, logger);
        }

        logger.error(`Fetch failed for ${company.companyName}: ${err.message}`);
        recordScrapeError('oracloud');
        return [];
    }
};

/**
 * Fans out API fetches across all companies concurrently.
 * pLimit keeps requests bounded even as the company list grows.
 *
 * @param {object[]} companies
 * @param {Logger}   logger
 * @returns {object[]} flat array of all job objects from all companies
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
 * Runs a single job through the full filter pipeline, with two execution paths:
 *
 * FAST PATH (job already in SQLite from a previous run):
 *   - Use cached title, location, and posting_date — zero HTTP calls.
 *   - Apply all three filters against cached data and return.
 *
 * SLOW PATH (new job, not yet in SQLite):
 *   - Store the job immediately (date is available from the API response).
 *   - Apply location, title, and date filters in order.
 *
 * Location filter uses job.location (PrimaryLocation city/state string) so
 * it respects whatever location rules are configured in filterJob, rather
 * than the previous hardcoded country === 'united states' check.
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
        upsertJob(job, 'oracloud');

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
 * Entry point for the Oracle Cloud scraper pipeline.
 *
 * Orchestrates three stages in sequence:
 *   1. Load company configs from JSON
 *   2. Fetch each company's Oracle Cloud job API (concurrently)
 *   3. Filter by location, title, and date
 *   4. Write surviving jobs to an Excel file
 *
 * Key design notes:
 *   - filterJob is now passed in per-request rather than using a stale
 *     module-level singleton — inline filters and named profiles work correctly.
 *   - SQLite writes happen inside applyJobFilters so ALL jobs are persisted
 *     for fast-path reuse on subsequent runs.
 *   - Location filter uses the configurable matchesLocation rule rather than
 *     the previous hardcoded country === 'united states' check.
 *   - All output goes through the structured logger — no console.log.
 *   - StatsD metrics are emitted for dashboards.
 *
 * @param {FilterJobs} filterJob - per-request config; defaults to env-based singleton
 * @returns {object[]} final filtered job array
 */
export const runOracleCloudScraper = async (filterJob = defaultFilterJob) => {
    const fileName  = 'oracloud';
    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Oracle Cloud Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies = loadCompanies(fileName, logger);

        const scrapedJobs = await scrapeAllCompanies(companies, logger);

        // SQLite writes happen inside filterJobs → applyJobFilters.
        // All scraped jobs (pass or fail) are stored for fast-path reuse.
        const filteredJobs = await filterJobs(scrapedJobs, logger, filterJob);

        recordScrapeMetrics('oracloud', {
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

        logger.info(`=== Oracle Cloud Scraper Finished in ${formatElapsed(startTime)}s ===`);

        return filteredJobs;

    } catch (error) {
        logger.error(`Fatal error in runOracleCloudScraper: ${error.message}`);
        throw error;
    }
};
