/**
 * blueprint-service.js — Copy-paste template for a new job portal scraper.
 *
 * HOW TO USE
 * ──────────
 * 1. Copy this file to app/services/<portal-name>-service.js
 * 2. Search for every "TODO" comment and fill it in
 * 3. Set PORTAL_NAME, BASE_URL, and MAX_CONCURRENCY constants
 * 4. Add a route in app/routes/jobs-router.js
 * 5. Add a controller handler in app/controllers/jobs-controller.js
 * 6. Add the company list at app/companies/<portal-name>/
 *
 * ARCHITECTURE (identical across all portal services)
 * ────────────────────────────────────────────────────
 *   1. loadCompanies     — reads company slugs/URLs from CSV or JSON
 *   2. fetchJobsForCompany — calls portal API / scrapes HTML, returns raw stubs
 *   3. mapJob             — normalises one raw stub to the canonical job shape
 *   4. applyJobFilters    — SQLite fast/slow path + FilterJobs checks
 *   5. runPortalScraper   — orchestrator: load → fetch → filter → write Excel
 */

import { readFileSync } from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';
import { config } from 'dotenv';
config();

import { FilterJobs } from './filtering-service-v2.js';
import { FileHandler } from './file_creation-service.js';
import { getJob, upsertJob, updateJobDate } from '../database/sqlite-service.js';
import { createCustomLogger } from '../middleware/logger.js';
import { recordScrapeMetrics, recordScrapeError } from '../middleware/metrics.js';

const fileHandler      = new FileHandler();
const defaultFilterJob = new FilterJobs();

// ─── Constants ─────────────────────────────────────────────────────────────────
// TODO: fill these in for your portal.

const PORTAL_NAME        = 'my_portal';               // matches portal column in SQLite + StatsD tag
const BASE_URL           = 'https://api.my-portal.com'; // portal API root
const MAX_CONCURRENCY    = 50;                          // pLimit for company-level fetches
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES        = 3;
const RETRY_DELAY_MS     = 5000;                        // wait between 429 retries

const delay         = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatElapsed = (startMs) => ((Date.now() - startMs) / 1000).toFixed(2);

// ─── Filtering Criteria Reference ──────────────────────────────────────────────
// All filter rules come from .env (or per-request body overrides).
// The FilterJobs constructor reads the following env vars by default:
//
//   JOB_TITLES    — comma-separated keywords a title MUST contain (e.g. "engineer,analyst")
//   IGNORE_TITLES — comma-separated keywords that disqualify a title (e.g. "intern,manager")
//   COUNTRIES     — comma-separated countries to match in location (e.g. "united states,canada")
//   STATES        — comma-separated full state names (e.g. "california,new york,remote")
//   STATES_ABBR   — comma-separated state abbreviations (e.g. "ca,ny,tx")
//   POSTING_DIFF  — maximum age in days (e.g. "10" means only jobs posted in the last 10 days)
//
// All three checks are performed in applyJobFilters below:
//   filterJob.matchesLocation(location)    → country / state / abbreviation keyword match
//   filterJob.matchesTitle(title)          → accepted keyword present AND no ignored keyword
//   filterJob.matchesPostingDate(date)     → within POSTING_DIFF days of today

// ─── Step 1: Load Companies ────────────────────────────────────────────────────

/**
 * Returns the list of companies to scrape for this portal.
 *
 * CSV example (Greenhouse / Ashby style — one company name per row):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  import { parse } from 'csv-parse/sync';                        │
 * │  const raw = readFileSync(                                      │
 * │      `app/companies/${PORTAL_NAME}/companies.csv`, 'utf8');     │
 * │  return parse(raw, { columns: true, skip_empty_lines: true })   │
 * │      .map((r) => ({                                             │
 * │          name: r.name,                                          │
 * │          link: `${BASE_URL}/${r.slug}/jobs`,                    │
 * │      }));                                                       │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * JSON example (Workday / Oracle Cloud style — pre-built URL per company):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  const raw = JSON.parse(readFileSync(                           │
 * │      `app/companies/${PORTAL_NAME}/companies.json`, 'utf8'));   │
 * │  return raw.map((c) => ({ name: c.name, link: c.link }));      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * @param {Logger} logger
 * @returns {{ name: string, link: string }[]}
 */
const loadCompanies = (logger) => {
    // TODO: replace with real CSV or JSON loader
    logger.info('Loading companies (mock — replace with real loader)');
    return [
        { name: 'Acme Corp',  link: `${BASE_URL}/acme/jobs`   },
        { name: 'Globex Inc', link: `${BASE_URL}/globex/jobs`  },
        { name: 'Initech',    link: `${BASE_URL}/initech/jobs` },
    ];
};

// ─── Step 2: Fetch Raw Job Stubs ───────────────────────────────────────────────

/**
 * Fetches raw job stubs for a single company from the portal's API or HTML.
 * Returns an empty array on unrecoverable failure (non-fatal per company).
 *
 * REST API (JSON response) example:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  const res = await axios.get(company.link, {                    │
 * │      timeout: REQUEST_TIMEOUT_MS,                               │
 * │  });                                                            │
 * │  return res.data?.jobs ?? [];                                   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Paginated API example (Workday / Oracle Cloud style):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  const stubs = [];                                              │
 * │  let offset  = 0;                                               │
 * │  while (true) {                                                 │
 * │      const res = await axios.post(company.link, { offset, limit: 20 }); │
 * │      const page = res.data?.jobPostings ?? [];                  │
 * │      stubs.push(...page);                                       │
 * │      if (page.length < 20) break;                               │
 * │      offset += 20;                                              │
 * │  }                                                              │
 * │  return stubs;                                                  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Web scraping (jsdom) example:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  import { JSDOM } from 'jsdom';                                 │
 * │  const res  = await axios.get(company.link, { timeout: ... }); │
 * │  const dom  = new JSDOM(res.data);                              │
 * │  const el   = dom.window.document                               │
 * │                   .querySelector('script#__NEXT_DATA__');       │
 * │  const json = JSON.parse(el.textContent);                       │
 * │  return json.props.pageProps.jobs ?? [];                        │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * @param {{ name: string, link: string }} company
 * @param {Logger} logger
 * @param {number} retriesLeft
 * @returns {object[]} raw stubs (portal-specific shape)
 */
const fetchJobsForCompany = async (company, logger, retriesLeft = MAX_RETRIES) => {
    try {
        // TODO: replace with real API call or scrape
        logger.debug(`Fetching jobs for ${company.name} (mock)`);
        return [
            {
                id:         'mock-001',
                title:      'Software Engineer',
                jobUrl:     `${company.link}/mock-001`,
                location:   'Austin, TX, United States',
                postedDate: new Date().toISOString().split('T')[0],
            },
        ];
    } catch (err) {
        if (err.response?.status === 429 && retriesLeft > 0) {
            logger.warn(`Rate limited for ${company.name} — retrying (${retriesLeft} left)`);
            await delay(RETRY_DELAY_MS);
            return fetchJobsForCompany(company, logger, retriesLeft - 1);
        }
        if (err.response?.status === 404 || err.response?.status === 403) {
            logger.warn(`${company.name} returned ${err.response.status} — skipping`);
            return [];
        }
        logger.error(`Fetch failed for ${company.name}: ${err.message}`);
        recordScrapeError(PORTAL_NAME);
        return [];
    }
};

// ─── Step 3: Normalise to Canonical Shape ─────────────────────────────────────

/**
 * Maps one raw portal stub to the standard job record shape used by SQLite,
 * FilterJobs, and FileHandler.writeToExcel across ALL portal services.
 *
 * Standard canonical fields:
 *   job_id       — portal's internal ID (stored in SQLite job_id column;
 *                  used as fast-path key for portals like Workday where
 *                  job_link is only known after a detail fetch)
 *   job_title    — plain-text job title
 *   job_link     — full public URL to the posting (must be unique per job)
 *   location     — human-readable location string fed to matchesLocation()
 *                  (e.g. "Austin, TX, United States" or "Remote, USA")
 *   posting_date — ISO "YYYY-MM-DD" string, or null if not yet available
 *   company_name — display name of the company
 *
 * Location string advice:
 *   matchesLocation() checks for country keywords, full state names, and
 *   state abbreviations using word-boundary regex. Feed the most descriptive
 *   location string the portal provides — "New York, NY, United States" is
 *   better than just "NY" because it passes both state and country checks.
 *   If a portal returns an array of locations, join them: locations.join(', ')
 *
 * Date format advice:
 *   Always convert to ISO "YYYY-MM-DD" before storing. Workday returns
 *   "YYYY-MM-DD" natively. Greenhouse/Lever return ISO timestamps — strip
 *   the time portion: new Date(raw.updated_at).toISOString().split('T')[0]
 *   Ashby returns updatedAt timestamps; Dice returns Unix ms — use new Date(ms).
 *   If date is unavailable at stub stage, pass null and backfill later
 *   via updateJobDate() once a detail fetch provides it.
 *
 * @param {object}                        raw     - raw stub from fetchJobsForCompany
 * @param {{ name: string, link: string }} company
 * @returns {{ job_id, job_title, job_link, location, posting_date, company_name }}
 */
const mapJob = (raw, company) => ({
    job_id:       raw.id         ?? null,   // TODO: portal's ID field
    job_title:    raw.title      ?? '',      // TODO: portal's title field
    job_link:     raw.jobUrl     ?? '',      // TODO: portal's public posting URL
    location:     raw.location   ?? '',      // TODO: portal's location string
    posting_date: raw.postedDate ?? null,    // TODO: portal's date (ISO YYYY-MM-DD or null)
    company_name: company.name,
});

// ─── Step 4: Filter with SQLite Fast / Slow Path ──────────────────────────────

/**
 * Applies location, title, and date filters to one job using the standard
 * fast/slow SQLite path pattern shared by all portal services.
 *
 * FAST PATH (job already seen on a previous run):
 *   getJob(job_link) returns the cached row immediately.
 *   We re-apply all three filter checks against cached data — no HTTP calls.
 *   If the cached posting_date is NULL (stored after failing location/title
 *   on a previous run), we now need the date: call fetchJobDetails() and
 *   backfill via updateJobDate().
 *
 * SLOW PATH (new job, not yet in SQLite):
 *   We ALWAYS store the job first via upsertJob(), regardless of whether it
 *   passes filters. This ensures every subsequent run hits the fast path.
 *   Filter checks are applied cheapest-first:
 *     1. matchesLocation  — string keyword check, instant
 *     2. matchesTitle     — string keyword check, instant
 *     3. matchesPostingDate — date arithmetic, instant
 *   If posting_date is not in the stub, fetchJobDetails() is called ONLY
 *   after location + title pass — avoids the expensive HTTP call for rejects.
 *
 * @param {object}     job
 * @param {FilterJobs} filterJob
 * @param {Logger}     logger
 * @returns {object|null} job record if it passes all filters, otherwise null
 */
const applyJobFilters = async (job, filterJob, logger) => {
    if (!job?.job_link) return null;

    try {
        // ── Fast path ─────────────────────────────────────────────────────────
        const cached = getJob(job.job_link);
        if (cached) {
            if (!filterJob.matchesLocation(cached.location))        return null;
            if (!filterJob.matchesTitle(cached.job_title))          return null;
            let { posting_date } = cached;
            // Backfill null date (stored on a previous run before date was available)
            if (!posting_date) {
                // TODO: uncomment and implement if your portal needs a detail fetch for dates
                // posting_date = await fetchJobDetails(job.job_link, logger);
                // if (posting_date) updateJobDate(job.job_link, posting_date);
            }
            if (!posting_date)                               return null;
            if (!filterJob.matchesPostingDate(posting_date)) return null;
            return { ...cached, posting_date };
        }

        // ── Slow path ─────────────────────────────────────────────────────────
        // Reject on cheap checks first to avoid unnecessary detail HTTP fetches.
        if (!filterJob.matchesLocation(job.location)) {
            upsertJob({ ...job, posting_date: null }, PORTAL_NAME);
            return null;
        }
        if (!filterJob.matchesTitle(job.job_title)) {
            upsertJob({ ...job, posting_date: null }, PORTAL_NAME);
            return null;
        }

        // TODO: if posting_date is already in the stub, use it directly.
        // If it requires a separate HTTP GET (like Lever), implement fetchJobDetails()
        // and call it here — only for jobs that already passed location + title.
        let posting_date = job.posting_date ?? null;
        // posting_date = await fetchJobDetails(job.job_link, logger); // uncomment if needed

        upsertJob({ ...job, posting_date }, PORTAL_NAME);
        if (!posting_date)                               return null;
        if (!filterJob.matchesPostingDate(posting_date)) return null;
        return { ...job, posting_date };

    } catch (err) {
        logger.error(`Filter error for ${job.job_link}: ${err.message}`);
        return null;
    }
};

// ─── Optional: Detail Fetch ────────────────────────────────────────────────────

/**
 * TODO: uncomment and implement this if your portal requires a second HTTP
 * request per job to retrieve the posting_date (e.g. Lever).
 *
 * Pattern:
 *   - Only call this after location + title pass to avoid N+1 for rejects.
 *   - Store the result via updateJobDate() so subsequent fast-path runs
 *     don't need to re-fetch.
 *   - Return null on failure (non-fatal — job will be excluded from output).
 *
 * Example:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  const fetchJobDetails = async (job_link, logger) => {          │
 * │      try {                                                      │
 * │          const res = await axios.get(job_link,                  │
 * │              { timeout: REQUEST_TIMEOUT_MS });                  │
 * │          return res.data?.posting?.createdAt                    │
 * │              ? new Date(res.data.posting.createdAt)             │
 * │                  .toISOString().split('T')[0]                   │
 * │              : null;                                            │
 * │      } catch (err) {                                            │
 * │          logger.warn(`Detail fetch failed: ${err.message}`);    │
 * │          return null;                                           │
 * │      }                                                          │
 * │  };                                                             │
 * └─────────────────────────────────────────────────────────────────┘
 */

// ─── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Entry point for the portal scraper pipeline.
 *
 * Stages:
 *   1. Load companies from CSV / JSON file
 *   2. Fetch raw job stubs for each company in parallel (pLimit)
 *   3. Normalise stubs to canonical shape via mapJob
 *   4. Filter each job through SQLite fast/slow path + FilterJobs
 *   5. Sort by posting_date descending
 *   6. Emit StatsD metrics
 *   7. Write passing jobs to Excel
 *
 * TODO: rename this export to run<PortalName>Scraper.
 *
 * @param {FilterJobs} filterJob - per-request filter config; defaults to .env singleton
 * @returns {object[]} final filtered job array
 */
export const runPortalScraper = async (filterJob = defaultFilterJob) => {
    const logger    = createCustomLogger(PORTAL_NAME);
    const startTime = Date.now();
    logger.info(`=== ${PORTAL_NAME} Scraper Started | ${new Date().toISOString()} ===`);

    try {
        // Step 1: Load companies
        const companies = loadCompanies(logger);
        logger.info(`Companies loaded: ${companies.length}`);

        // Step 2: Fetch all job stubs (parallel, rate-limited)
        const fetchLimit = pLimit(MAX_CONCURRENCY);
        const allJobs    = (await Promise.all(
            companies.map((company) =>
                fetchLimit(async () => {
                    const stubs = await fetchJobsForCompany(company, logger);
                    return stubs.map((raw) => mapJob(raw, company));
                })
            )
        )).flat();
        logger.info(`Stubs collected: ${allJobs.length} jobs from ${companies.length} companies`);

        // Step 3: Filter — fast path (cached) or slow path (fetch + store)
        const results      = await Promise.all(
            allJobs.map((job) => applyJobFilters(job, filterJob, logger))
        );
        const filteredJobs = results
            .filter(Boolean)
            .sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

        logger.info(
            `Filtering complete: ${filteredJobs.length} passed, ` +
            `${allJobs.length - filteredJobs.length} rejected`
        );

        // Step 4: Emit metrics
        recordScrapeMetrics(PORTAL_NAME, {
            durationMs:     Date.now() - startTime,
            companiesTotal: companies.length,
            jobsScraped:    allJobs.length,
            jobsFiltered:   filteredJobs.length,
        });

        // Step 5: Write Excel output
        if (filteredJobs.length > 0) {
            fileHandler.writeToExcel(filteredJobs, PORTAL_NAME);
            logger.info(`Excel file created with ${filteredJobs.length} jobs`);
        } else {
            logger.info('No jobs passed filtering — skipping file creation');
        }

        logger.info(`=== ${PORTAL_NAME} Scraper Finished in ${formatElapsed(startTime)}s ===`);
        return filteredJobs;

    } catch (err) {
        logger.error(`Fatal error in runPortalScraper: ${err.message}`);
        throw err;
    }
};
