#!/usr/bin/env node

/**
 * Validates all company files across all portals.
 * For each company slug/link, makes a HEAD/GET request and reports:
 * - ✓ ALIVE: 200-299 (valid company page)
 * - ✗ DEAD: 404/403 (company removed or no longer lists jobs)
 * - ? UNKNOWN: 5xx, timeout, network error
 *
 * Usage:
 *   node scripts/validate-companies.js [portal]  # validate all or one portal
 *
 * Portals: greenhouse, lever, ashby, workday, oracloud, dice
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import pLimit from 'p-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const COMPANIES = path.join(ROOT, 'app', 'companies');

const TIMEOUT_MS = 5000;
const CONCURRENCY = 20;

// ─── Portal config ────────────────────────────────────────────────────────

const portals = {
    greenhouse: {
        file:    'greenhouse/greenhouse.csv',
        builder: (slug) => `https://job-boards.greenhouse.io/${slug}`,
        desc:    'Greenhouse job board',
    },
    lever: {
        file:    'lever/lever.csv',
        builder: (slug) => `https://jobs.lever.co/${slug}`,
        desc:    'Lever job board',
    },
    ashby: {
        file:    'ashbyhq/ashby.csv',
        builder: (slug) => `https://jobs.ashbyhq.com/${slug}`,
        desc:    'Ashby job board',
    },
    workday: {
        file:    'workday/wday1.json',
        builder: (entry) => entry.link,
        type:    'json',
        desc:    'Workday job board',
    },
    oracloud: {
        file:    'oracloud/oracloud.json',
        builder: (entry) => entry.jobSearchUrl,
        type:    'json',
        desc:    'Oracle Cloud jobs',
    },
    dice: {
        file:    null,
        builder: null,
        type:    'api',
        desc:    'Dice.com (API-based, no company file)',
    },
};

// ─── Loader ──────────────────────────────────────────────────────────────

const loadCompanies = (portal) => {
    if (!portals[portal].file) return [];

    const filePath = path.join(COMPANIES, portals[portal].file);
    const content  = readFileSync(filePath, 'utf8');

    if (portals[portal].type === 'json') {
        return JSON.parse(content);
    }

    // CSV: split by newline, lowercase, filter blanks and comments
    return content
        .split('\n')
        .map(line => line.toLowerCase().trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
};

// ─── Validator ────────────────────────────────────────────────────────────

const validateUrl = async (url) => {
    try {
        const response = await axios.head(url, { timeout: TIMEOUT_MS, maxRedirects: 5 });
        return { status: response.status, alive: response.status < 400 };
    } catch (err) {
        if (err.response?.status === 405) {
            // HEAD not allowed; try GET
            try {
                const response = await axios.get(url, { timeout: TIMEOUT_MS, maxRedirects: 5 });
                return { status: response.status, alive: response.status < 400 };
            } catch {
                return { status: err.response?.status ?? 0, alive: false };
            }
        }
        return { status: err.response?.status ?? 0, alive: false, error: err.message };
    }
};

// ─── Reporter ─────────────────────────────────────────────────────────────

const reportResults = (portal, results) => {
    const alive = results.filter(r => r.alive);
    const dead  = results.filter(r => !r.alive && r.status === 404);
    const other = results.filter(r => !r.alive && r.status !== 404);

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`${portal.toUpperCase()} — ${portals[portal].desc}`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`Total: ${results.length} | Alive: ${alive.length} | Dead (404): ${dead.length} | Other errors: ${other.length}`);

    if (dead.length > 0) {
        console.log(`\n⚠️  DEAD COMPANIES (should remove from CSV):`);
        dead.forEach(r => {
            console.log(`  ${r.status}  ${r.slug}`);
        });
    }

    if (other.length > 0) {
        console.log(`\n❓ UNKNOWN STATUS (check manually):`);
        other.slice(0, 10).forEach(r => {
            console.log(`  ${r.status || 'ERR'}  ${r.slug}  ${r.error || ''}`);
        });
        if (other.length > 10) console.log(`  ... and ${other.length - 10} more`);
    }

    if (alive.length === results.length) {
        console.log(`\n✓ All companies alive!`);
    }
};

// ─── Main ─────────────────────────────────────────────────────────────────

const validatePortal = async (portal) => {
    const companies = loadCompanies(portal);
    if (!companies.length) {
        console.log(`\n${portal.toUpperCase()}: no companies to validate`);
        return [];
    }

    console.log(`\n🔍 Validating ${portal} (${companies.length} companies)...`);

    const limit   = pLimit(CONCURRENCY);
    const results = await Promise.all(
        companies.map(company =>
            limit(async () => {
                const slug = typeof company === 'string' ? company : (company.name || company.slug);
                const url  = portals[portal].builder(company);

                if (!url) return { slug, status: 0, alive: false, error: 'No URL' };

                const result = await validateUrl(url);
                return { slug, url, ...result };
            })
        )
    );

    return results;
};

// ─── CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portalArg = args[0];

(async () => {
    console.log('Job Board Company Validator');
    console.log('Checking which companies are still active...\n');

    const toValidate = portalArg ? [portalArg] : Object.keys(portals);

    for (const portal of toValidate) {
        if (!portals[portal]) {
            console.log(`❌ Unknown portal: ${portal}`);
            continue;
        }

        if (portals[portal].type === 'api') {
            console.log(`\n${portal.toUpperCase()} — uses API-based scraping (no company file)`);
            continue;
        }

        const results = await validatePortal(portal);
        if (results.length > 0) {
            reportResults(portal, results);
        }
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log('Validation complete!');
})();
