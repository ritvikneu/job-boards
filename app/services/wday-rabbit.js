import { readFileSync } from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

import { FileHandler } from './file_creation-service.js';
import { FilterJobs } from './filtering-service.js';
import { getJobByJobId, upsertJob, touchJob } from '../database/sqlite-service.js';
import { producer, getNextMessages, closeConnection } from './rabbitMQ-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler      = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKDAY_OFFSET           = parseInt(process.env.WORKDAY_OFFSET) || 200;
const BATCH_SIZE               = 150;   // messages pulled per consumer iteration
const MAX_CONSUMER_CONCURRENCY = 20;    // pLimit within each consumer batch
const REQUEST_TIMEOUT_MS       = 15000;
const LISTING_RETRY_DELAY_MS   = 10000;
const MAX_LISTING_RETRIES      = 3;
const JOB_RETRY_BASE_DELAY_MS  = 20000; // exponential base for per-job 429 backoff

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

/**
 * Converts a Workday "Posted X Days Ago" stub string to an approximate ISO date.
 * Returns null for unrecognised formats — fail-open means the stub is NOT rejected.
 *
 * Recognised patterns:
 *   "Posted Today"         → today
 *   "Posted Yesterday"     → yesterday
 *   "Posted 5 Days Ago"    → 5 days ago
 *   "Posted 30+ Days Ago"  → exactly 30 days ago (conservative lower bound)
 *
 * @param {string} postedOn
 * @returns {string|null} ISO date string (YYYY-MM-DD) or null
 */
const parsePostedOn = (postedOn) => {
    if (!postedOn || typeof postedOn !== 'string') return null;
    const lower = postedOn.toLowerCase().trim();

    if (lower.includes('today')) return new Date().toISOString().split('T')[0];

    if (lower.includes('yesterday')) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }

    // Matches "Posted 5 Days Ago" and "Posted 30+ Days Ago"
    const match = lower.match(/posted\s+(\d+)\+?\s+days?\s+ago/);
    if (match) {
        const d = new Date();
        d.setDate(d.getDate() - parseInt(match[1], 10));
        return d.toISOString().split('T')[0];
    }

    return null; // unknown format — let the stub through
};

// ─── Step 1: Load Companies ───────────────────────────────────────────────────

/**
 * Reads a Workday company config JSON and returns deduplicated
 * { name, link } entries ready for scraping.
 *
 * JSON schema: [{ "name": "...", "link": "..." }, ...]
 *
 * @param {string} fileName
 * @param {Logger} logger
 * @returns {{ name: string, link: string }[]}
 */
const loadCompanies = (fileName, logger) => {
    const filePath = `app/companies/${fileName}.json`;
    logger.info(`Loading companies from: ${filePath}`);

    try {
        const raw  = JSON.parse(readFileSync(filePath, 'utf8'));
        const seen = new Set();

        // Normalise name to lowercase on load. Mixed-case entries (e.g.
        // "Discover", "NordStorm") were producing 422s from the Workday API,
        // which is sensitive to slug casing in some contract paths.
        const companies = raw.reduce((acc, company) => {
            const name = company.name ? String(company.name).toLowerCase() : null;
            if (name && !seen.has(name)) {
                seen.add(name);
                acc.push({ name, link: company.link });
            }
            return acc;
        }, []);

        logger.info(`Companies loaded: ${companies.length}`);
        return companies;
    } catch (error) {
        logger.error(`Failed to load companies JSON: ${error.message}`);
        throw error;
    }
};

// ─── Step 2: Workday API Helpers ──────────────────────────────────────────────

/**
 * Fetches one page of job listing stubs from a company's Workday board API.
 *
 * Workday exposes a POST endpoint that accepts { limit, offset, searchText }
 * and returns a jobPostings array. Each stub contains externalPath (used to
 * build the individual job detail URL) but not full job details.
 *
 * @param {string} url         - company's Workday board API endpoint
 * @param {number} offset      - pagination offset
 * @param {string} companyName
 * @param {Logger} logger
 * @param {number} retriesLeft
 * @returns {object[]} job stubs with externalPath, companyName, baseURL attached
 */
const workdayFetch = async (url, offset, companyName, logger, retriesLeft = MAX_LISTING_RETRIES) => {
    try {
        const response = await axios.post(url, {
            limit:      20,
            offset,
            searchText: '',
        }, { timeout: REQUEST_TIMEOUT_MS });

        const jobs = response.data?.jobPostings ?? [];
        jobs.forEach((job) => {
            job.companyName = companyName;
            job.baseURL     = url;
        });

        return jobs;

    } catch (err) {
        if (err.response?.status === 429 && retriesLeft > 0) {
            logger.warn(`Rate limited (listing) for ${companyName}. Retrying (${retriesLeft} left)...`);
            await delay(LISTING_RETRY_DELAY_MS);
            return workdayFetch(url, offset, companyName, logger, retriesLeft - 1);
        }

        logger.error(`Listing fetch failed for ${companyName}: ${err.message}`);
        recordScrapeError('workday');
        return [];
    }
};

/**
 * Fetches the full detail record for a single Workday job via its API URL.
 *
 * This is the expensive per-job HTTP GET that dominates the scraper's runtime.
 * It is skipped entirely on subsequent runs when the API URL (stored as job_id)
 * is already cached in SQLite — see consumerWorker fast path.
 *
 * @param {string} url         - individual job API endpoint
 * @param {Logger} logger
 * @param {number} retriesLeft
 * @returns {object|null}      - jobPostingInfo object or null on failure
 */
const workdayJobFetch = async (url, logger, retriesLeft = MAX_LISTING_RETRIES) => {
    try {
        const response = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });
        return response.data?.jobPostingInfo ?? null;

    } catch (err) {
        if (err.response?.status === 429 && retriesLeft > 0) {
            const wait = Math.pow(2, MAX_LISTING_RETRIES - retriesLeft) * JOB_RETRY_BASE_DELAY_MS;
            logger.warn(`Rate limited (job detail): waiting ${wait / 1000}s (${retriesLeft} left) — ${url}`);
            await delay(wait);
            return workdayJobFetch(url, logger, retriesLeft - 1);
        }

        logger.error(`Job detail fetch failed: ${url} — ${err.message}`);
        recordScrapeError('workday');
        return null;
    }
};

// ─── Step 3: Producer ─────────────────────────────────────────────────────────

/**
 * Fetches all company listing pages, applies stub-level pre-filters, and pushes
 * only the surviving job API URLs into a RabbitMQ queue for consumers to process.
 *
 * Each company's listing is paginated: we POST with increasing offsets until
 * we receive fewer than 20 results (last page) or reach WORKDAY_OFFSET.
 *
 * ── Stub-level pre-filter (the first-run performance fix) ────────────────────
 * The Workday listing API returns lightweight stubs that already contain:
 *   - title       → clean job title string
 *   - locationsText → human-readable location (e.g. "New York, NY, USA")
 *   - postedOn    → relative date string (e.g. "Posted 30+ Days Ago")
 *
 * We apply matchesTitle, matchesLocation, and an approximate date check
 * directly on stub data — zero extra HTTP calls. Any stub that clearly fails
 * (wrong country, wrong title, too old) is dropped before being queued.
 *
 * On a typical run this eliminates 85–90 % of stubs (international jobs,
 * unrelated titles), reducing consumer HTTP GETs from ~15 000 to ~1 500–2 000
 * and cutting first-run time proportionally.
 *
 * Fail-open policy: if a field is absent or its format is unrecognised, the
 * stub is NOT rejected — uncertainty is always resolved in favour of queueing.
 *
 * Job URLs are shuffled before queueing so each consumer handles a mix of
 * companies, reducing per-company rate-limit pressure.
 *
 * @param {object[]}   companies
 * @param {string}     qname     - unique queue name for this run
 * @param {FilterJobs} filterJob - filter config for stub pre-filtering
 * @param {Logger}     logger
 * @returns {number} number of job URLs queued
 */
const runProducer = async (companies, qname, filterJob, logger) => {
    const startTime = Date.now();
    logger.info(`Producer started for ${companies.length} companies`);

    const fetchListingsForCompany = async (company) => {
        let offset = 0;
        const stubs = [];

        while (offset < WORKDAY_OFFSET) {
            const page = await workdayFetch(company.link, offset, company.name, logger);
            stubs.push(...page);
            if (page.length < 20) break; // last page reached
            offset += 20;
        }

        return stubs;
    };

    const allStubs = (await Promise.all(companies.map(fetchListingsForCompany))).flat();
    logger.info(`Listing scrape complete: ${allStubs.length} job stubs found`);

    // ── Stub-level pre-filter ─────────────────────────────────────────────────
    // Drops stubs that clearly fail title/location/date rules using data already
    // present in the listing response — no individual job HTTP GETs needed.
    // Fail-open: missing or unparseable fields never cause a rejection.
    const passedStubs = allStubs.filter((stub) => {
        if (stub.title        && !filterJob.matchesTitle(stub.title))               return false;
        if (stub.locationsText && !filterJob.matchesLocation(stub.locationsText))   return false;
        const approxDate = parsePostedOn(stub.postedOn);
        if (approxDate        && !filterJob.matchesPostingDate(approxDate))         return false;
        return true;
    });

    const rejectedCount = allStubs.length - passedStubs.length;
    logger.info(
        `Stub pre-filter: ${allStubs.length} stubs → ` +
        `${passedStubs.length} queued, ${rejectedCount} rejected (title/location/date)`
    );

    // Build per-job API URLs and shuffle for even consumer distribution
    const jobUrls = passedStubs.map((job) => ({
        url:         job.baseURL.slice(0, -5) + job.externalPath,
        companyName: job.companyName,
    }));
    // Fisher-Yates shuffle for unbiased random distribution
    for (let i = jobUrls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [jobUrls[i], jobUrls[j]] = [jobUrls[j], jobUrls[i]];
    }

    await producer(jobUrls, qname);
    logger.info(`Producer finished in ${formatElapsed(startTime)}s — queued ${jobUrls.length} jobs`);

    return jobUrls.length;
};

// ─── Step 4: Consumer ─────────────────────────────────────────────────────────

/**
 * Single consumer worker. Pulls BATCH_SIZE messages at a time from the queue
 * and resolves each to a full job record.
 *
 * FAST PATH — job API URL already stored as job_id in SQLite:
 *   Returns the cached row immediately with zero HTTP calls. On first run all
 *   jobs go through the slow path and get persisted. On subsequent runs every
 *   previously-seen job hits this path, turning a 25+ minute consumer stage
 *   into near-instant execution.
 *
 * SLOW PATH — new job, not yet in SQLite:
 *   Calls workdayJobFetch to retrieve full details, persists the result to
 *   SQLite keyed by the API URL (job_id), then adds to the output set.
 *
 * pLimit(MAX_CONSUMER_CONCURRENCY) caps concurrent in-flight fetches within
 * each batch — previously all 150 messages fired simultaneously, increasing
 * the risk of Workday rate-limiting.
 *
 * @param {number}   workerId
 * @param {string}   qname
 * @param {object[]} processedJobs - shared output array (mutated in place)
 * @param {Set}      seenLinks     - cross-worker dedup set keyed by externalUrl
 * @param {Logger}   logger
 */
const consumerWorker = async (workerId, qname, processedJobs, seenLinks, logger) => {
    logger.info(`Consumer ${workerId} started`);

    const fetchLimit    = pLimit(MAX_CONSUMER_CONCURRENCY);
    let emptyQueueCount = 0;

    while (emptyQueueCount < 2) {
        try {
            const messages = await getNextMessages(BATCH_SIZE, qname);

            if (messages.length === 0) {
                emptyQueueCount++;
                logger.info(`Consumer ${workerId} — empty queue (attempt ${emptyQueueCount})`);
                await delay(2000);
                continue;
            }

            emptyQueueCount = 0;

            const results = await Promise.all(
                messages.map((message) =>
                    fetchLimit(async () => {
                        const { url, companyName } = message.content;

                        // ── Fast path: previously fetched, use SQLite data ──────────
                        const cached = getJobByJobId(url);
                        if (cached) return { cached, jobData: null, message, companyName };

                        // ── Slow path: new job, fetch from Workday ──────────────────
                        const jobData = await workdayJobFetch(url, logger);
                        return { cached: null, jobData, message, companyName };
                    })
                )
            );

            results.forEach(({ cached, jobData, message, companyName }) => {
                if (cached) {
                    // Fast path: zero HTTP calls — return stored data as-is
                    touchJob(cached.job_link);
                    if (!seenLinks.has(cached.job_link)) {
                        seenLinks.add(cached.job_link);
                        processedJobs.push(cached);
                    }
                } else if (jobData) {
                    // Slow path: build record, persist so future runs hit fast path
                    const data = {
                        job_id:       message.content.url,   // API URL — key for fast-path lookup
                        job_title:    jobData.title ?? '',
                        job_link:     jobData.externalUrl ?? '',
                        location:     jobData.jobRequisitionLocation?.country?.descriptor
                                        ?? jobData.country?.descriptor
                                        ?? '',
                        posting_date: jobData.startDate ?? null,
                        company_name: companyName,
                    };

                    upsertJob(data, 'workday');

                    if (data.job_link && !seenLinks.has(data.job_link)) {
                        seenLinks.add(data.job_link);
                        processedJobs.push(data);
                    }
                }

                message.ack();
            });

        } catch (err) {
            logger.error(`Consumer ${workerId} error: ${err.message}`);
            await delay(7000);
        }
    }

    logger.info(`Consumer ${workerId} finished`);
};

/**
 * Starts multiple consumer workers in parallel and waits for all to drain
 * the queue. Consumer count scales with queue depth (1 per 1500 jobs),
 * capped at 10.
 *
 * @param {number} queuedCount - total jobs sent to queue by the producer
 * @param {string} qname
 * @param {Logger} logger
 * @returns {object[]} all processed job records
 */
const runConsumers = async (queuedCount, qname, logger) => {
    const startTime     = Date.now();
    const consumerCount = Math.min(Math.ceil(queuedCount / 1500) + 1, 10);
    logger.info(`Starting ${consumerCount} consumers for ${queuedCount} queued jobs`);

    const processedJobs = [];
    const seenLinks     = new Set();

    const workers = Array.from(
        { length: consumerCount },
        (_, i) => consumerWorker(i + 1, qname, processedJobs, seenLinks, logger)
    );
    await Promise.all(workers);

    logger.info(
        `Consumers finished in ${formatElapsed(startTime)}s — ` +
        `${processedJobs.length} unique jobs processed`
    );

    return processedJobs;
};

/**
 * Orchestrates the full RabbitMQ producer-consumer pipeline for one run.
 * Creates a unique queue name per invocation to prevent cross-run message
 * leakage, then closes the connection on completion.
 *
 * filterJob is forwarded to runProducer so stub-level pre-filtering uses the
 * same title/location/date rules that will be applied in the final filterJobs
 * step — ensuring nothing valid is dropped early.
 */
const runProducerConsumer = async (companies, fileName, filterJob, logger) => {
    const qname = fileName + Date.now(); // unique per run

    try {
        const queuedCount = await runProducer(companies, qname, filterJob, logger);
        const jobs        = await runConsumers(queuedCount, qname, logger);
        await closeConnection(qname);
        return jobs;
    } catch (err) {
        logger.error(`Producer-consumer pipeline failed: ${err.message}`);
        throw err;
    }
};

// ─── Step 5: Filter Jobs ──────────────────────────────────────────────────────

/**
 * Applies location, title, and date filters to all consumed jobs in memory.
 *
 * No additional HTTP calls are needed here — all job data (posting_date,
 * location, job_title) is already present from the producer-consumer stage,
 * whether it came from a fresh Workday fetch or from the SQLite cache.
 *
 * @param {object[]}   jobs
 * @param {Logger}     logger
 * @param {FilterJobs} filterJob
 * @returns {object[]} filtered and sorted jobs
 */
const filterJobs = (jobs, logger, filterJob) => {
    const startTime = Date.now();
    logger.info(`Filtering ${jobs.length} jobs by location, title, and date rules`);

    const validJobs = jobs
        .filter((job) => filterJob.matchesLocation(job.location))
        .filter((job) => filterJob.matchesPostingDate(job.posting_date))
        .filter((job) => filterJob.matchesTitle(job.job_title))
        .sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

    logger.info(
        `Filtering complete in ${formatElapsed(startTime)}s — ` +
        `${validJobs.length} passed, ${jobs.length - validJobs.length} rejected`
    );

    return validJobs;
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Entry point for the Workday scraper pipeline.
 *
 * Orchestrates five stages in sequence:
 *   1. Load company configs from JSON
 *   2. Producer: scrape listing pages → stub pre-filter → queue surviving job URLs
 *   3. Consumer: resolve each queued URL to a full job record
 *      - Fast path: API URL in SQLite (job_id) → return cached, skip HTTP call
 *      - Slow path: fetch from Workday, persist to SQLite for next run
 *   4. Filter: apply location, title, date rules in memory (final pass)
 *   5. Write surviving jobs to Excel
 *
 * Key design notes:
 *   - Stub-level pre-filter (step 2) is the first-run performance fix.
 *     Workday listing stubs contain title, locationsText, and postedOn.
 *     Applying matchesTitle/matchesLocation/matchesPostingDate on stub data
 *     (zero extra HTTP calls) eliminates 85–90 % of stubs before queueing,
 *     reducing first-run consumer GETs from ~15 000 to ~1 500–2 000.
 *   - The SQLite fast path (step 3) is the subsequent-run performance lever.
 *     On runs after the first, every previously-seen job skips workdayJobFetch
 *     entirely — reducing the consumer stage to near-instant.
 *   - pLimit(MAX_CONSUMER_CONCURRENCY) caps concurrent fetches per consumer
 *     batch — previously all 150 fired at once, increasing 429 risk.
 *   - Consumer count scales dynamically with queue depth, capped at 10.
 *   - All output goes through the structured logger — no console.log.
 *   - StatsD metrics are emitted for dashboards.
 *
 * @param {string}     file_name - company list base file name (from controller)
 * @param {FilterJobs} filterJob - per-request config; defaults to env-based singleton
 * @returns {object[]} final filtered job array
 */
export const runWorkdayScraper = async (file_name, filterJob = defaultFilterJob) => {
    const fileName  = file_name || 'workday';
    const logger    = createCustomLogger(fileName);
    const startTime = Date.now();

    logger.info(`=== Workday Scraper Started | ${new Date().toISOString()} ===`);

    try {
        const companies = loadCompanies(fileName, logger);

        const scrapedJobs = await runProducerConsumer(companies, fileName, filterJob, logger);

        const filteredJobs = filterJobs(scrapedJobs, logger, filterJob);

        recordScrapeMetrics('workday', {
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

        logger.info(`=== Workday Scraper Finished in ${formatElapsed(startTime)}s ===`);

        return filteredJobs;

    } catch (err) {
        logger.error(`Fatal error in runWorkdayScraper: ${err.message}`);
        throw err;
    }
};

// Backward-compatible alias — controller updated separately
export const filterWorkDayJobs = runWorkdayScraper;
