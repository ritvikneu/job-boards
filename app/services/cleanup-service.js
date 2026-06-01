import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';

import { createCustomLogger } from '../middleware/logger.js';

const CONCURRENCY_LIMIT  = 50;
const REQUEST_TIMEOUT_MS = 15000;
const REPORT_DIR         = 'reports';
const STALE_STATUSES     = new Set([403, 404]);
// Transient errors are inconclusive but expected (rate limit / network blip);
// hard errors (5xx, parse failures, unknown statuses) likely indicate a real
// upstream problem and deserve investigation rather than silent retry.
const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);
const TRANSIENT_ERR_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);
const CATEGORY_ORDER     = { stale: 0, unknown_transient: 1, unknown_error: 2 };

// Probe headers. We prefer each portal's public JSON API over its HTML page:
//   - Greenhouse HTML 406s every non-browser GET.
//   - Ashby HTML is an SPA shell that returns 200 even for nonexistent slugs.
//   - Lever HTML returns 404 even for live boards.
// The APIs below give authoritative 200/404 for every portal.
const PROBE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':     'application/json, text/html;q=0.9, */*;q=0.8',
};

// Per-portal config. URLs are the public JSON APIs so 200/404 is reliable.
// (The live scrapers may still hit HTML URLs — that's a separate concern.)
const PORTALS = {
    greenhouse: {
        format: 'csv-slug',
        boards: [
            { fileName: 'greenhouse', baseUrl: 'https://boards-api.greenhouse.io/v1/boards/', urlSuffix: '/jobs' },
        ],
        method: 'GET',
    },
    lever: {
        format: 'csv-slug',
        boards: [{ fileName: 'lever', baseUrl: 'https://api.lever.co/v0/postings/' }],
        method: 'GET',
    },
    ashby: {
        format: 'csv-slug',
        boards: [{ fileName: 'ashby', baseUrl: 'https://api.ashbyhq.com/posting-api/job-board/' }],
        method: 'GET',
    },
    oracloud: {
        format: 'json-records',
        slugField: 'companyName',
        urlField:  'url',
        boards: [{ fileName: 'oracloud' }],
        method: 'GET',
    },
    workday: {
        format: 'json-records',
        slugField: 'name',
        urlField:  'link',
        boards: [{ fileName: 'workday' }],
        method: 'POST',
        body:   { limit: 1, offset: 0, searchText: '' },
    },
};

const loadBoard = (portal, cfg, board, logger) => {
    const ext  = cfg.format === 'json-records' ? 'json' : 'csv';
    const path = `app/companies/${board.fileName}.${ext}`;

    try {
        const raw = readFileSync(path, 'utf8');

        if (cfg.format === 'csv-slug') {
            const slugs = [...new Set(
                raw.split('\n')
                    .map((row) => row.toLowerCase().trim())
                    .filter((row) => row.length > 0 && !row.startsWith('#'))
            )];
            return slugs.map((slug) => ({ slug, url: `${board.baseUrl}${slug}${board.urlSuffix ?? ''}` }));
        }

        // json-records
        const records = JSON.parse(raw);
        return records
            .filter((r) => r?.[cfg.slugField] && r?.[cfg.urlField])
            .map((r) => ({ slug: String(r[cfg.slugField]).toLowerCase(), url: r[cfg.urlField] }));

    } catch (err) {
        logger.error(`[${portal}/${board.fileName}] failed to load: ${err.message}`);
        return [];
    }
};

// Four outcomes:
//   null                                  → confirmed OK (2xx/3xx)
//   { category: 'stale',             ... } → confirmed dead (403/404)
//   { category: 'unknown_transient', ... } → retry-worthy (429/5xx/timeout)
//   { category: 'unknown_error',     ... } → investigate (parse fail / unexpected)
const probe = async (portal, cfg, entry) => {
    try {
        if (cfg.method === 'POST') {
            await axios.post(entry.url, cfg.body, { timeout: REQUEST_TIMEOUT_MS, headers: PROBE_HEADERS });
        } else {
            await axios.get(entry.url, { timeout: REQUEST_TIMEOUT_MS, headers: PROBE_HEADERS });
        }
        return null;
    } catch (err) {
        const status = err.response?.status;
        const code   = err.code;
        const base   = { portal, slug: entry.slug, board_url: entry.url };

        if (STALE_STATUSES.has(status)) {
            return { ...base, category: 'stale', status, reason: '' };
        }
        const isTransient = TRANSIENT_STATUSES.has(status) || TRANSIENT_ERR_CODES.has(code);
        return {
            ...base,
            category: isTransient ? 'unknown_transient' : 'unknown_error',
            status:   status ?? code ?? 'error',
            reason:   code || err.message || 'request failed',
        };
    }
};

const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const writeReport = (rows, checkedAt) => {
    mkdirSync(REPORT_DIR, { recursive: true });
    const date = checkedAt.slice(0, 10);
    const path = `${REPORT_DIR}/stale-companies-${date}.csv`;

    // stale rows come first, then unknown — easy to grep / act on.
    const sorted = [...rows].sort((a, b) =>
        (CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]) ||
        a.portal.localeCompare(b.portal) ||
        a.slug.localeCompare(b.slug)
    );

    const lines = ['category,portal,slug,status,reason,board_url,checked_at'];
    for (const r of sorted) {
        lines.push([
            r.category, r.portal, r.slug, r.status,
            csvEscape(r.reason), r.board_url, checkedAt,
        ].join(','));
    }
    writeFileSync(path, lines.join('\n') + '\n');

    return path;
};

/**
 * Probe every known company across all (or selected) portals.
 *
 * Each probe has three possible outcomes recorded in the report:
 *   - stale   → 403 (private) or 404 (slug removed)
 *   - unknown → 429 / 5xx / timeout / network error; result is inconclusive
 *               and the slug should be re-checked with a single-portal run
 *   - ok      → not recorded
 *
 * Best run one portal at a time (`{"portals":["greenhouse"]}`). Running all
 * portals at once is more likely to trip per-host rate limits and produce
 * `unknown` rows.
 *
 * Nothing is auto-removed; the report is for manual CSV/JSON edits.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.portals] - subset of portal keys to run; defaults to all
 * @returns {{ checked: number, stale: object[], unknown: object[], report_path: string, per_portal: object }}
 */
export const runCleanup = async ({ portals } = {}) => {
    const logger    = createCustomLogger('cleanup');
    const limit     = pLimit(CONCURRENCY_LIMIT);
    const checkedAt = new Date().toISOString();

    const selected = portals?.length
        ? portals.filter((p) => PORTALS[p])
        : Object.keys(PORTALS);

    logger.info(`=== Cleanup probe started | ${checkedAt} | portals: ${selected.join(', ')} ===`);

    const stale      = [];
    const unknown    = [];
    const per_portal = {};
    let checked = 0;

    for (const portal of selected) {
        const cfg = PORTALS[portal];

        // Dedup by slug across board entries.
        const seen    = new Set();
        const entries = cfg.boards
            .flatMap((b) => loadBoard(portal, cfg, b, logger))
            .filter((e) => (seen.has(e.slug) ? false : (seen.add(e.slug), true)));

        checked += entries.length;

        const results = await Promise.all(
            entries.map((e) => limit(() => probe(portal, cfg, e)))
        );

        const portalStale     = results.filter((r) => r?.category === 'stale');
        const portalTransient = results.filter((r) => r?.category === 'unknown_transient');
        const portalErrors    = results.filter((r) => r?.category === 'unknown_error');
        const portalUnknown   = [...portalTransient, ...portalErrors];

        stale.push(...portalStale);
        unknown.push(...portalUnknown);
        per_portal[portal] = {
            checked:           entries.length,
            stale:             portalStale.length,
            unknown_transient: portalTransient.length,
            unknown_error:     portalErrors.length,
        };

        logger.info(`[${portal}] ${entries.length} probed, ${portalStale.length} stale, ${portalTransient.length} unknown_transient, ${portalErrors.length} unknown_error`);
        if (portalTransient.length > 0) {
            logger.warn(`[${portal}] ${portalTransient.length} probes inconclusive (likely rate-limited) — re-run this portal alone for a clean read: POST /cleanup {"portals":["${portal}"]}`);
        }
        if (portalErrors.length > 0) {
            logger.error(`[${portal}] ${portalErrors.length} probes hit hard errors — investigate the report for non-transient failures`);
        }
    }

    const report_path = writeReport([...stale, ...unknown], checkedAt);
    logger.info(`Report written: ${report_path} (${stale.length} stale, ${unknown.length} unknown of ${checked} checked)`);

    return { checked, stale, unknown, report_path, per_portal };
};
