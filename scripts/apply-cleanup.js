#!/usr/bin/env node
// Removes confirmed-stale slugs (category=stale) from app/companies/*.
// Dry-run by default. Pass --apply to actually mutate files.
//
//   node scripts/apply-cleanup.js                       # today's report, dry-run
//   node scripts/apply-cleanup.js --apply               # today's report, write
//   node scripts/apply-cleanup.js --date 2026-05-17     # specific report, dry-run
//
// Git is the audit trail — review `git diff` after applying.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const PORTAL_DIRS = {
    greenhouse: { dir: 'app/companies/greenhouse', format: 'csv' },
    lever:      { dir: 'app/companies/lever',      format: 'csv' },
    ashby:      { dir: 'app/companies/ashbyhq',    format: 'csv' },
    oracloud:   { dir: 'app/companies/oracloud',   format: 'json', slugField: 'companyName' },
    workday:    { dir: 'app/companies/workday',    format: 'json', slugField: 'name' },
};

const args  = process.argv.slice(2);
const apply = args.includes('--apply');
const date  = (args[args.indexOf('--date') + 1] && args.includes('--date'))
    ? args[args.indexOf('--date') + 1]
    : new Date().toISOString().slice(0, 10);

const reportPath = `reports/stale-companies-${date}.csv`;
if (!existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
}

// Parse report → { [portal]: Set<slug> } (stale only, never unknown).
const staleByPortal = {};
const lines = readFileSync(reportPath, 'utf8').split('\n').slice(1);
for (const line of lines) {
    if (!line.trim()) continue;
    const [category, portal, slug] = line.split(',');
    if (category !== 'stale') continue;
    (staleByPortal[portal] ??= new Set()).add(slug.toLowerCase());
}

const sourceFiles = (dir, format) => readdirSync(dir)
    .filter((f) => f.endsWith(`.${format}`) && !f.includes('test') && !f.endsWith('.bak'));

let totalRemoved = 0;
const summary    = [];

for (const [portal, staleSlugs] of Object.entries(staleByPortal)) {
    const cfg = PORTAL_DIRS[portal];
    if (!cfg) { console.warn(`Skipping unknown portal: ${portal}`); continue; }

    for (const file of sourceFiles(cfg.dir, cfg.format)) {
        const path = `${cfg.dir}/${file}`;
        const raw  = readFileSync(path, 'utf8');

        let kept, removed;
        if (cfg.format === 'csv') {
            const all = raw.split('\n');
            removed   = all.filter((l) => staleSlugs.has(l.trim().toLowerCase())).length;
            kept      = all.filter((l) => !staleSlugs.has(l.trim().toLowerCase()));
        } else {
            const all  = JSON.parse(raw);
            const next = all.filter((r) => !staleSlugs.has(String(r?.[cfg.slugField] ?? '').toLowerCase()));
            removed    = all.length - next.length;
            kept       = next;
        }

        if (removed === 0) continue;

        totalRemoved += removed;
        summary.push(`  ${portal}/${file}: ${removed} removed`);

        if (apply) {
            const out = cfg.format === 'csv' ? kept.join('\n') : JSON.stringify(kept, null, 2) + '\n';
            writeFileSync(path, out);
        }
    }
}

console.log(`Report: ${reportPath}`);
console.log(`Mode:   ${apply ? 'APPLY (files written)' : 'dry-run'}`);
if (summary.length === 0) {
    console.log('No matching slugs found in source files.');
} else {
    console.log(summary.join('\n'));
    console.log(`Total: ${totalRemoved} entries ${apply ? 'removed' : 'would be removed'}.`);
}
if (!apply && totalRemoved > 0) console.log('\nRun again with --apply to write changes.');
