import { loadCompanies } from './utils.js';
import axios from 'axios';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJob, upsertJob, touchJob } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler      = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

// Lever's official JSON API. Returns every posting for a board in a single
// call with `createdAt` inline — eliminates the per-job HTML date fetch that
// dominated runtime in the old HTML scraper.
const LEVER_API_BASE_URL = 'https://api.lever.co/v0/postings/';

// 30 (vs 50 for Greenhouse) — Lever boards are more prone to slow responses
// per company; smaller concurrency reduces the chance a stuck host blocks the
// pool for the duration of the slowest tenant.
const CONCURRENCY_LIMIT  = 30;
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS     = 10000;
// Jitter prevents the second retry wave from hitting api.lever.co in lockstep
// when a transient blip rejects many companies at once.
const RETRY_JITTER_MS    = 5000;
const MAX_RETRIES        = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);
const jitteredDelay = () => RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS);

// ─── Step 1: Load Companies ───────────────────────────────────────────────────


// ─── Step 2: Scrape Postings ──────────────────────────────────────────────────

/**
 * Maps Lever API postings to our internal job schema.
 *
 * `createdAt` is the posting's creation timestamp in epoch ms. Lever does not
 * expose an `updatedAt` field on the public API, so resurfacing is not
 * detectable — same behavior as the old HTML scraper's `datePosted`.
 */
const mapApiPostings = (postings, company) =>
    postings
        .filter((p) => p?.hostedUrl)
        .map((p) => ({
            job_id:       String(p.id ?? ''),
            job_title:    p.text ?? '',
            posting_date: p.createdAt
                ? new Date(p.createdAt).toISOString().split('T')[0]
                : null,
            location:     p.categories?.location ?? '',
            company_name: company.name,
            job_link:     p.hostedUrl,
        }));

/**
 * Fetches a single company's Lever board via the JSON API. Single GET, all
 * postings returned inline with their creation dates — no per-job follow-up
 * fetches.
 *
 * 404 → warn (stale slug). 429/other → retry up to MAX_RETRIES.
 */
const fetchJobsForCompany = async (company, retriesLeft, logger) => {
    try {
        const response = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });
        const jobs     = mapApiPostings(response.data ?? [], company);
        logger.debug(`${company.name}: ${jobs.length} postings found`);
        return jobs;

    } catch (err) {
        const status = err.response?.status;
        const code   = err.code;

        if (status === 404) {
            logger.warn(`Company not found on Lever (404) — slug may be stale: ${company.name}`);
            return [];
        }

        if (retriesLeft > 0) {
            // Classify the cause so logs make the retry distribution legible.
            let reason;
            if (status === 429)                                          reason = 'rate limited (429)';
            else if (status >= 500)                                      reason = `upstream ${status}`;
            else if (code === 'ECONNABORTED' || code === 'ETIMEDOUT')    reason = `timeout (${REQUEST_TIMEOUT_MS}ms)`;
            else if (code === 'ECONNRESET')                              reason = 'connection reset';
            else                                                         reason = err.message;

            const wait = jitteredDelay();
            logger.warn(`Retrying ${company.name} in ${wait}ms (${retriesLeft} left) — ${reason}`);
            await delay(wait);
            return fetchJobsForCompany(company, retriesLeft - 1, logger);
        }

        logger.error(`Listing fetch failed for ${company.name} [${company.link}]: ${err.message}`);
        recordScrapeError('lever');
        return [];
    }
};

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
 * Standard fast/slow filter pipeline. Since the API returns posting_date
 * inline, there is no date-backfill path — the slow path just upserts and
 * applies filters in order.
 */
const applyJobFilters = async (job, logger, filterJob) => {
    if (!job?.job_link) return null;

    try {
        const cached = getJob(job.job_link);

        if (cached) {
            touchJob(job.job_link);
            if (!filterJob.matchesLocation(cached.location))         return null;
            if (!filterJob.matchesTitle(cached.job_title))           return null;
            if (!cached.posting_date)                                return null;
            if (!filterJob.matchesPostingDate(cached.posting_date))  return null;
            return cached;
        }

        // Store only after title + location pass — posting date is a result gate only.
        if (!filterJob.matchesLocation(job.location))        return null;
        if (!filterJob.matchesTitle(job.job_title))          return null;

        upsertJob(job, 'lever');

        if (!job.posting_date)                               return null;
        if (!filterJob.matchesPostingDate(job.posting_date)) return null;

        return job;

    } catch (error) {
        logger.error(`Filter error for job [${job.job_link}]: ${error.message}`);
        return null;
    }
};

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

export const runLeverScraper = async (filterJob = defaultFilterJob) => {
    const fileName  = 'lever';
    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Lever Job Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies   = loadCompanies(fileName, (slug) => `${LEVER_API_BASE_URL}${slug}`, logger);
        const scrapedJobs = await scrapeAllCompanies(companies, logger);

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
