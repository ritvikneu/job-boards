#!/usr/bin/env node
// Removes confirmed-stale slugs (category=stale) from app/companies/*, and
// optionally appends re-homed slugs from a portal-discovery report.
// Dry-run by default. Pass --apply to actually mutate files.
//
//   node scripts/apply-cleanup.js                                              # today's stale report, dry-run
//   node scripts/apply-cleanup.js --apply                                      # remove stale
//   node scripts/apply-cleanup.js --apply --rehome reports/portal-discovery-YYYY-MM-DD.csv
//   node scripts/apply-cleanup.js --date 2026-05-17
//
// Git is the audit trail — review `git diff` after applying.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const PORTAL_DIRS = {
    greenhouse: { dir: 'app/companies/greenhouse', format: 'csv', addFile: 'gh-io.csv' },
    lever:      { dir: 'app/companies/lever',      format: 'csv', addFile: 'lever.csv' },
    ashby:      { dir: 'app/companies/ashbyhq',    format: 'csv', addFile: 'ash.csv' },
    oracloud:   { dir: 'app/companies/oracloud',   format: 'json', slugField: 'companyName' },
    workday:    { dir: 'app/companies/workday',    format: 'json', slugField: 'name' },
};

const argv = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const args       = process.argv.slice(2);
const apply      = args.includes('--apply');
const date       = argv('--date') || new Date().toISOString().slice(0, 10);
const rehomePath = argv('--rehome');

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
    const fields = line.split(',');
    if (fields.length < 3) {
        console.warn(`Skipping malformed stale row: ${line}`);
        continue;
    }
    const [category, portal, slug] = fields;
    if (category !== 'stale' || !portal || !slug) continue;
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

console.log(`Stale report: ${reportPath}`);
console.log(`Mode:         ${apply ? 'APPLY (files written)' : 'dry-run'}`);
if (summary.length === 0) {
    console.log('No matching slugs found in source files.');
} else {
    console.log(summary.join('\n'));
    console.log(`Total removed: ${totalRemoved} ${apply ? '' : '(would be)'}.`);
}

// ─── Re-home phase ────────────────────────────────────────────────────────────
if (rehomePath) {
    if (!existsSync(rehomePath)) {
        console.error(`\nDiscovery report not found: ${rehomePath}`);
        process.exit(1);
    }

    // discovery columns: slug,original_portal,found_in,found_url,status
    const addByPortal = {};
    const lines = readFileSync(rehomePath, 'utf8').split('\n').slice(1);
    for (const line of lines) {
        if (!line.trim()) continue;
        const fields = line.split(',');
        if (fields.length < 3) {
            console.warn(`Skipping malformed rehome row: ${line}`);
            continue;
        }
        const [slug, , found_in] = fields;
        if (!slug || !found_in || found_in === 'none') continue;
        (addByPortal[found_in] ??= new Set()).add(slug.toLowerCase());
    }

    console.log('\n--- Re-home ---');
    console.log(`Discovery report: ${rehomePath}`);

    let totalAdded = 0;
    const addSummary = [];

    for (const [portal, slugs] of Object.entries(addByPortal)) {
        const cfg = PORTAL_DIRS[portal];
        if (!cfg || cfg.format !== 'csv' || !cfg.addFile) {
            console.warn(`Skipping re-home for ${portal} (no CSV target)`);
            continue;
        }
        const path = `${cfg.dir}/${cfg.addFile}`;
        const raw  = existsSync(path) ? readFileSync(path, 'utf8') : '';
        const existing = new Set(raw.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));

        const toAdd = [...slugs].filter((s) => !existing.has(s)).sort();
        if (toAdd.length === 0) continue;

        totalAdded += toAdd.length;
        addSummary.push(`  ${portal}/${cfg.addFile}: +${toAdd.length}`);

        if (apply) {
            const sep = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
            writeFileSync(path, raw + sep + toAdd.join('\n') + '\n');
        }
    }

    if (addSummary.length === 0) {
        console.log('No new slugs to add (all already present in target CSVs).');
    } else {
        console.log(addSummary.join('\n'));
        console.log(`Total added: ${totalAdded} ${apply ? '' : '(would be)'}.`);
    }
}

if (!apply && (totalRemoved > 0 || rehomePath)) {
    console.log('\nRun again with --apply to write changes.');
}
