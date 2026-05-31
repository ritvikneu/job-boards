import axios from 'axios';
// jsdom is required: the human-facing Position ID (recruiter reference code) is not exposed by the Dice JSON search API — it only appears in the detail-page HTML at aside.legalInfo li[data-testid="legalInfo-referenceCode"]. The listing's `id`/`jobId` are internal UUIDs, not the Position Id.
import jsdom from 'jsdom';
const { JSDOM } = jsdom;
import pLimit from 'p-limit';
import { config } from 'dotenv';
config();

import { FilterJobs } from './filtering-service.js';
import { FileHandler } from './file_creation-service.js';
import { getJob, upsertJob, updateJobPositionId } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler      = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ────────────────────────────────────────────────────────────────

const DICE_API_KEY             = process.env.DICE_API_KEY;
const DICE_BASE_URL            = 'https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search';
const MAX_POSITION_CONCURRENCY = 10;    // pLimit for position-ID detail fetches
const REQUEST_TIMEOUT_MS       = 15000;

const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Step 1: Fetch Dice Listing ───────────────────────────────────────────────

/**
 * Fetches one page of Dice job listings via the search API.
 *
 * The API is pre-filtered by the query params:
 *   - postedDate: ONE  → only today's postings
 *   - employmentType: FULLTIME
 *   - employerType: Direct Hire
 *   - q: 'software'   → keyword match
 *
 * @param {number} page
 * @param {Logger} logger
 * @returns {object[]} raw job objects from Dice API
 */
const fetchDiceJobs = async (page, logger) => {
    const url = new URL(DICE_BASE_URL);
    const params = {
        page,
        pageSize:                 1000,
        facets:                   ['employmentType', 'postedDate', 'workFromHomeAvailability', 'workplaceTypes', 'employerType', 'easyApply', 'isRemote', 'willingToSponsor'],
        'filters.employmentType': 'FULLTIME',
        'filters.employerType':   'Direct Hire',
        'filters.postedDate':     'ONE',
        q:                        'software',
    };

    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, v));
        } else {
            url.searchParams.set(key, value);
        }
    });

    try {
        const response = await axios.get(url.toString(), {
            headers: { 'x-api-key': DICE_API_KEY },
            timeout: REQUEST_TIMEOUT_MS,
        });
        return response.data?.data ?? [];
    } catch (err) {
        logger.error(`Dice listing fetch failed (page ${page}): ${err.message}`);
        recordScrapeError('dice');
        return [];
    }
};

// ─── Step 2: Scrape Position ID ───────────────────────────────────────────────

/**
 * Fetches the position/reference ID for a single Dice job by scraping its
 * detail page HTML. Returns null on failure (non-fatal).
 *
 * This is the expensive per-job HTTP GET. It is skipped on the fast path when
 * the job is already cached in SQLite with a non-null position_id.
 *
 * @param {string} job_link
 * @param {Logger} logger
 * @returns {string|null}
 */
const fetchPositionId = async (job_link, logger) => {
    try {
        const response = await axios.get(job_link, { timeout: REQUEST_TIMEOUT_MS });
        const dom      = new JSDOM(response.data);
        const aside    = dom.window.document.querySelector('aside.legalInfo');
        if (!aside) return null;
        const el = aside.querySelector('li[data-testid="legalInfo-referenceCode"]');
        if (!el) return null;
        return el.textContent.trim().replace('Position Id:', '').trim() || null;
    } catch (err) {
        logger.warn(`Could not fetch position ID for ${job_link}: ${err.message}`);
        return null;
    }
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Entry point for the Dice scraper pipeline.
 *
 * Orchestrates four stages:
 *   1. Fetch: pull up to 1000 job listings from the Dice search API
 *      (already pre-filtered to today's full-time direct-hire software jobs)
 *   2. Pre-filter: apply matchesLocation, matchesTitle, matchesPostingDate
 *      in memory — zero HTTP calls
 *   3. Resolve position_id for each passing job via fast or slow path:
 *      - Fast path: job_link in SQLite → return cached row (skip HTML scrape)
 *        If cached position_id is NULL, re-fetches and backfills via updateJobPositionId
 *      - Slow path: new job → fetchPositionId → upsertJob → add to output
 *   4. Write surviving jobs to Excel
 *
 * pLimit(MAX_POSITION_CONCURRENCY) caps concurrent position-ID fetches so we
 * don't hammer Dice's detail page servers with 500+ simultaneous requests.
 *
 * @param {number}     page      - Dice API page number (passed from controller)
 * @param {FilterJobs} filterJob - per-request filter config
 * @returns {object[]} final filtered job array
 */
export const runDiceScraper = async (page = 1, filterJob = defaultFilterJob) => {
    const logger    = createCustomLogger('dice');
    const startTime = Date.now();
    logger.info(`=== Dice Scraper Started | page=${page} | ${new Date().toISOString()} ===`);

    try {
        // Step 1: Fetch listing
        const rawJobs = await fetchDiceJobs(page, logger);
        logger.info(`Listing fetched: ${rawJobs.length} jobs (page ${page})`);

        // Step 2: Map to canonical shape
        const jobs = rawJobs.map((job) => ({
            job_id:       job.id ?? null,
            job_title:    job.title ?? '',
            job_link:     job.detailsPageUrl ?? '',
            location:     job.jobLocation?.displayName ?? '',
            posting_date: job.postedDate
                ? new Date(job.postedDate).toISOString().split('T')[0]
                : null,
            company_name: job.companyName ?? '',
        }));

        // Step 3: In-memory pre-filter (location + title + date — no HTTP)
        const preFiltered = jobs.filter((job) => {
            if (!filterJob.matchesLocation(job.location))        return false;
            if (!filterJob.matchesTitle(job.job_title))          return false;
            if (!filterJob.matchesPostingDate(job.posting_date)) return false;
            return true;
        });
        logger.info(
            `Pre-filter: ${jobs.length} → ${preFiltered.length} passed ` +
            `(${jobs.length - preFiltered.length} rejected by location/title/date)`
        );

        // Step 4: Resolve position_id — fast path (SQLite) or slow path (HTML scrape)
        const positionLimit = pLimit(MAX_POSITION_CONCURRENCY);
        const seen          = new Set();
        const filteredJobs  = [];

        await Promise.all(preFiltered.map((job) =>
            positionLimit(async () => {
                if (!job.job_link || seen.has(job.job_link)) return;
                seen.add(job.job_link);

                // ── Fast path: previously scraped, use cached data ──────────
                const cached = getJob(job.job_link);
                if (cached) {
                    let { position_id } = cached;
                    // Backfill if cached but position_id was never fetched
                    if (!position_id) {
                        position_id = await fetchPositionId(job.job_link, logger);
                        if (position_id) updateJobPositionId(job.job_link, position_id);
                    }
                    filteredJobs.push({ ...cached, position_id });
                    return;
                }

                // ── Slow path: new job — scrape detail page, then persist ───
                const position_id = await fetchPositionId(job.job_link, logger);
                upsertJob({ ...job, position_id }, 'dice');
                filteredJobs.push({ ...job, position_id });
            })
        ));

        // Sort by posting_date descending (consistent with other services)
        filteredJobs.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

        recordScrapeMetrics('dice', {
            durationMs:   Date.now() - startTime,
            jobsScraped:  rawJobs.length,
            jobsFiltered: filteredJobs.length,
        });

        if (filteredJobs.length > 0) {
            fileHandler.writeToExcel(filteredJobs, `dice${page}`);
            logger.info(`Excel file created with ${filteredJobs.length} jobs`);
        } else {
            logger.info('No jobs passed filtering — skipping file creation');
        }

        logger.info(`=== Dice Scraper Finished in ${formatElapsed(startTime)}s ===`);
        return filteredJobs;

    } catch (err) {
        logger.error(`Fatal error in runDiceScraper: ${err.message}`);
        throw err;
    }
};

// Backward-compatible alias
export const filterDiceJobs = runDiceScraper;
