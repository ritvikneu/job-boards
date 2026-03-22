import StatsD from 'hot-shots';

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * UDP StatsD client (DogStatsD-compatible).
 *
 * Silent by design — if no StatsD/Datadog agent is listening on the configured
 * host:port the metrics are simply dropped and no error surfaces in the app.
 *
 * Configure via environment variables:
 *   STATSD_HOST  (default: localhost)
 *   STATSD_PORT  (default: 8125)
 *   NODE_ENV     (tagged on every metric, default: development)
 */
const client = new StatsD({
    host: process.env.STATSD_HOST || 'localhost',
    port: parseInt(process.env.STATSD_PORT || '8125', 10),
    prefix: 'job_boards.',
    globalTags: { env: process.env.NODE_ENV || 'development' },
    errorHandler: () => {}, // swallow ECONNREFUSED when no agent is running
});

// ─── HTTP Middleware ───────────────────────────────────────────────────────────

/**
 * Express middleware that records timing + request count for every HTTP call.
 *
 * Metrics emitted (after prefix: "job_boards."):
 *   http.request_duration_ms  (timing)    — wall-clock ms per request
 *   http.requests_total       (counter)   — +1 per request
 *
 * Tags on both metrics:
 *   route   — normalised Express route pattern (e.g. "/ash") or raw path
 *   method  — HTTP verb (GET, POST, …)
 *   status  — HTTP status code as string (e.g. "200", "500")
 *
 * Usage (app.js):
 *   import { httpMetrics } from './middleware/metrics.js';
 *   app.use(httpMetrics);
 */
export const httpMetrics = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const tags = {
            route:  req.route?.path ?? req.path,
            method: req.method,
            status: String(res.statusCode),
        };

        client.timing('http.request_duration_ms', Date.now() - start, tags);
        client.increment('http.requests_total', 1, tags);
    });

    next();
};

// ─── Scrape Metrics ───────────────────────────────────────────────────────────

/**
 * Records the outcome of a completed scrape run.
 *
 * Metrics emitted (after prefix: "job_boards."):
 *   scrape.duration_ms      (timing)  — total wall-clock time for the run
 *   scrape.companies_total  (gauge)   — number of companies attempted
 *   scrape.jobs_scraped     (gauge)   — jobs that passed the date filter
 *   scrape.jobs_filtered    (gauge)   — jobs that passed ALL filters (final count)
 *
 * All metrics are tagged with { portal } so you can split by portal in dashboards.
 *
 * @param {string} portal          - e.g. 'ashby', 'lever', 'greenhouse'
 * @param {object} counts
 * @param {number} counts.durationMs      - total run time in milliseconds
 * @param {number} counts.companiesTotal  - companies attempted
 * @param {number} counts.jobsScraped     - jobs after date filter
 * @param {number} counts.jobsFiltered    - jobs after all filters
 */
export const recordScrapeMetrics = (portal, { durationMs, companiesTotal, jobsScraped, jobsFiltered }) => {
    const tags = { portal };

    client.timing('scrape.duration_ms',     durationMs,      tags);
    client.gauge('scrape.companies_total',  companiesTotal,  tags);
    client.gauge('scrape.jobs_scraped',     jobsScraped,     tags);
    client.gauge('scrape.jobs_filtered',    jobsFiltered,    tags);
};

/**
 * Increments the error counter for a portal.
 * Call this once per company that fails all retries.
 *
 * Metric emitted: scrape.errors (counter), tagged { portal }.
 *
 * @param {string} portal - portal where the error occurred
 */
export const recordScrapeError = (portal) => {
    client.increment('scrape.errors', 1, { portal });
};
