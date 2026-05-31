#!/usr/bin/env node
// Given a list of slugs, probe Greenhouse, Ashby, and Lever to find which
// portal currently hosts that company. Useful for:
//   - re-homing stale entries from a cleanup report (e.g. Supabase → Ashby)
//   - vetting candidate slugs from any external source
//
//   node scripts/find-portal.js                                # today's stale report
//   node scripts/find-portal.js --report reports/foo.csv      # specific report
//   node scripts/find-portal.js --from-file companies.txt     # bare slug list
//
// Output: reports/portal-discovery-YYYY-MM-DD.csv
//   slug,original_portal,found_in,found_url,status
// found_in = 'none' means we couldn't match the slug anywhere.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';

const CONCURRENCY_LIMIT  = 25;
const REQUEST_TIMEOUT_MS = 15000;
const REPORT_DIR         = 'reports';

const PROBE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':     'application/json, text/html;q=0.9, */*;q=0.8',
};

// In probe order — first 2xx wins. Skips the slug's original portal.
// All three probes use the portal's official JSON API because the HTML
// URLs are unreliable: Greenhouse 406s every GET, Ashby SPA shell returns
// 200 for any slug, Lever returns 404 even for live boards.
const PROBES = [
    { portal: 'greenhouse', url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs` },
    { portal: 'ashby',      url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}` },
    { portal: 'lever',      url: (s) => `https://api.lever.co/v0/postings/${s}` },
];

const args = process.argv.slice(2);
const argv = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const today    = new Date().toISOString().slice(0, 10);
const fromFile = argv('--from-file');
const reportPath = fromFile
    ? null
    : (argv('--report') || `${REPORT_DIR}/stale-companies-${today}.csv`);

// Build deduped input: [{slug, original_portal}]
let inputs = [];
if (fromFile) {
    if (!existsSync(fromFile)) {
        console.error(`File not found: ${fromFile}`);
        process.exit(1);
    }
    const seen = new Set();
    for (const line of readFileSync(fromFile, 'utf8').split('\n')) {
        const slug = line.trim().toLowerCase();
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        inputs.push({ slug, original_portal: '' });
    }
} else {
    if (!existsSync(reportPath)) {
        console.error(`Report not found: ${reportPath}`);
        console.error(`Tip: pass --report <path> or --from-file <path>`);
        process.exit(1);
    }
    const seen = new Set();
    for (const line of readFileSync(reportPath, 'utf8').split('\n').slice(1)) {
        if (!line.trim()) continue;
        // category,portal,slug,status,reason,board_url,checked_at
        const [, portal, slug] = line.split(',');
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        inputs.push({ slug: slug.toLowerCase(), original_portal: portal || '' });
    }
}

if (inputs.length === 0) {
    console.error('No slugs to probe.');
    process.exit(1);
}

console.log(`Probing ${inputs.length} slugs across ${PROBES.length} URL patterns (concurrency ${CONCURRENCY_LIMIT})...`);

const probeUrl = async (url) => {
    try {
        const res = await axios.get(url, {
            timeout:        REQUEST_TIMEOUT_MS,
            headers:        PROBE_HEADERS,
            maxRedirects:   3,
            validateStatus: (s) => s < 500,
        });
        return res.status;
    } catch (err) {
        return err.response?.status ?? 0;
    }
};

const limit   = pLimit(CONCURRENCY_LIMIT);
const results = await Promise.all(inputs.map((entry) => limit(async () => {
    // Sequential per slug — short-circuits on first hit, saves requests.
    for (const probe of PROBES) {
        if (probe.portal === entry.original_portal) continue;
        const url    = probe.url(entry.slug);
        const status = await probeUrl(url);
        if (status >= 200 && status < 300) {
            return { ...entry, found_in: probe.portal, found_url: url, status };
        }
    }
    return { ...entry, found_in: 'none', found_url: '', status: '' };
})));

mkdirSync(REPORT_DIR, { recursive: true });
const outPath = `${REPORT_DIR}/portal-discovery-${today}.csv`;
const lines   = ['slug,original_portal,found_in,found_url,status'];
for (const r of results) {
    lines.push([r.slug, r.original_portal, r.found_in, r.found_url, r.status].join(','));
}
writeFileSync(outPath, lines.join('\n') + '\n');

const hits      = results.filter((r) => r.found_in !== 'none');
const byPortal  = hits.reduce((acc, r) => { acc[r.found_in] = (acc[r.found_in] || 0) + 1; return acc; }, {});

console.log(`Wrote ${outPath}`);
console.log(`Hits: ${hits.length} of ${results.length} (${((hits.length / results.length) * 100).toFixed(1)}%)`);
for (const [p, n] of Object.entries(byPortal)) console.log(`  ${p}: ${n}`);
