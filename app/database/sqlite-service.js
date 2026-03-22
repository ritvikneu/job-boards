import Database from 'better-sqlite3';
import path from 'path';
import { createCustomLogger } from '../middleware/logger.js';

const DB_PATH = path.join(process.cwd(), 'app', 'data', 'jobs.db');
const logger = createCustomLogger('sqlite');

let db;

// ─── Schema ───────────────────────────────────────────────────────────────────

const INIT_SQL = `
    CREATE TABLE IF NOT EXISTS jobs (
        job_link     TEXT PRIMARY KEY,
        job_id       TEXT,
        job_title    TEXT NOT NULL,
        company_name TEXT NOT NULL,
        location     TEXT,
        posting_date TEXT,
        position_id  TEXT,
        portal       TEXT NOT NULL,
        scraped_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_portal     ON jobs(portal);
    CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_job_id     ON jobs(job_id);
`;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialises the SQLite database and creates the jobs table if it doesn't
 * exist. Must be called once at server startup before any service uses hasJob
 * or upsertJob.
 *
 * WAL (Write-Ahead Logging) is enabled so concurrent reads don't block writes
 * — important when multiple portal scrapers run in parallel.
 */
export const initDb = () => {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(INIT_SQL);

    // Migration: add position_id column for existing DBs created before this column existed
    const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
    if (!cols.includes('position_id')) {
        db.exec('ALTER TABLE jobs ADD COLUMN position_id TEXT');
        logger.info('Migration: added position_id column to jobs table');
    }

    logger.info(`SQLite initialised — ${DB_PATH}`);
};

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if a job with the given link is already stored.
 *
 * Used as a cheap existence check before falling back to getJob when only a
 * boolean is needed (e.g. Ashby dedup which doesn't need the full row).
 */
export const hasJob = (job_link) => {
    const row = db.prepare('SELECT 1 FROM jobs WHERE job_link = ?').get(job_link);
    return !!row;
};

/**
 * Returns the full stored row for a job link, or undefined if not found.
 *
 * Used by services that need to re-filter a previously scraped job using its
 * cached data (title, location, posting_date) without re-fetching the page.
 * The "fast path" in applyJobFilters relies on this.
 *
 * @param {string} job_link
 * @returns {{ job_link, job_id, job_title, company_name, location, posting_date, portal, scraped_at } | undefined}
 */
export const getJob = (job_link) => {
    return db.prepare('SELECT * FROM jobs WHERE job_link = ?').get(job_link);
};

/**
 * Returns the full stored row for a job looked up by job_id, or undefined.
 *
 * Used by the Workday consumer as a fast path: before making an individual
 * job-detail HTTP request, we check whether the Workday API URL (stored as
 * job_id) was already fetched on a previous run. If found, we return the
 * cached row and skip the HTTP call entirely.
 *
 * The idx_jobs_job_id index makes this O(log n) even with millions of rows.
 *
 * @param {string} job_id - the value stored in the job_id column (for Workday: API endpoint URL)
 * @returns {object|undefined}
 */
export const getJobByJobId = (job_id) => {
    return db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(job_id);
};

/**
 * Returns the number of stored jobs for a portal.
 * Useful for logging and StatsD metrics.
 */
export const getJobCount = (portal) => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE portal = ?').get(portal);
    return row.count;
};

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Inserts a single job, silently ignoring duplicates (INSERT OR IGNORE).
 *
 * Unlike upsertJobs (batch), this is used when jobs should be stored
 * immediately during per-job processing (e.g. Lever's filter pipeline),
 * regardless of whether the job passed all filters.
 *
 * Expected shape:
 *   { job_link, job_id, job_title, company_name, location, posting_date }
 * Portal is passed separately to match the upsertJobs convention.
 *
 * @param {object} job
 * @param {string} portal - e.g. 'lever', 'ashby', 'greenhouse'
 */
export const upsertJob = (job, portal) => {
    db.prepare(`
        INSERT OR IGNORE INTO jobs
            (job_link, job_id, job_title, company_name, location, posting_date, position_id, portal)
        VALUES
            (@job_link, @job_id, @job_title, @company_name, @location, @posting_date, @position_id, @portal)
    `).run({ portal, position_id: null, ...job });
};

/**
 * Updates the posting_date for a job that was previously stored without one.
 *
 * This happens in the Lever fast path when a job was stored on a previous run
 * after failing the location or title filter (so posting_date was never fetched),
 * but on a subsequent run with looser filters, we now need the date.
 *
 * Only updates if the row currently has a NULL posting_date to avoid
 * accidentally overwriting a known-good date.
 *
 * @param {string} job_link
 * @param {string} posting_date - ISO date string ("YYYY-MM-DD")
 */
export const updateJobDate = (job_link, posting_date) => {
    db.prepare(`
        UPDATE jobs SET posting_date = ? WHERE job_link = ? AND posting_date IS NULL
    `).run(posting_date, job_link);
};

/**
 * Updates the position_id for a job that was previously stored without one.
 *
 * Used by the Dice fast path when a cached row has position_id = NULL —
 * this happens if the job was stored before the position_id column was added,
 * or if the previous fetchPositionId call failed. Only fires when NULL to
 * avoid overwriting a known-good value.
 *
 * @param {string} job_link
 * @param {string} position_id
 */
export const updateJobPositionId = (job_link, position_id) => {
    db.prepare(`
        UPDATE jobs SET position_id = ? WHERE job_link = ? AND position_id IS NULL
    `).run(position_id, job_link);
};

/**
 * Batch-inserts an array of jobs inside a single transaction.
 *
 * A transaction makes bulk inserts orders of magnitude faster:
 * inserting 500 rows takes ~1ms in a transaction vs ~500ms row-by-row.
 * Duplicates are silently skipped via INSERT OR IGNORE.
 */
export const upsertJobs = (jobs, portal) => {
    if (!jobs.length) return;

    const insert = db.prepare(`
        INSERT OR IGNORE INTO jobs
            (job_link, job_id, job_title, company_name, location, posting_date, position_id, portal)
        VALUES
            (@job_link, @job_id, @job_title, @company_name, @location, @posting_date, @position_id, @portal)
    `);

    const insertMany = db.transaction((rows) => {
        for (const row of rows) {
            insert.run({ portal, position_id: null, ...row });
        }
    });

    insertMany(jobs);
    logger.info(`[${portal}] upserted ${jobs.length} jobs into SQLite`);
};
