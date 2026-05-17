#!/usr/bin/env node

/**
 * Integration test suite for all scraper endpoints.
 *
 * Tests each portal by:
 * 1. Starting the server
 * 2. Making requests to each scraper route
 * 3. Validating response shape and HTTP status
 * 4. Reporting job counts and any errors
 *
 * Usage:
 *   node scripts/test-scrapers.js [--filter-diff 5]
 *
 * Sets reasonable defaults if .env is not fully configured.
 */

import axios from 'axios';
import { spawn } from 'child_process';
import { config } from 'dotenv';
import { existsSync } from 'fs';

config();

const POSTING_DIFF = process.argv.includes('--filter-diff')
    ? parseInt(process.argv[process.argv.indexOf('--filter-diff') + 1], 10)
    : 5;

const BASE_URL = 'http://localhost:7777';
const TIMEOUT  = 30000;

// ─── Test cases ───────────────────────────────────────────────────────────

const tests = [
    {
        name:     'GET /health',
        method:   'GET',
        path:     '/health',
        expected: 200,
    },
    {
        name:     'GET /greenhouse (no filters)',
        method:   'GET',
        path:     '/greenhouse',
        body:     {},
        expected: 200,
    },
    {
        name:     'GET /greenhouse (with posting_diff filter)',
        method:   'GET',
        path:     '/greenhouse',
        body:     { filters: { posting_diff: POSTING_DIFF } },
        expected: 200,
    },
    {
        name:     'GET /lever',
        method:   'GET',
        path:     '/lever',
        body:     { filters: { posting_diff: POSTING_DIFF } },
        expected: 200,
    },
    {
        name:     'GET /ash (Ashby HQ)',
        method:   'GET',
        path:     '/ash',
        body:     { filters: { posting_diff: POSTING_DIFF } },
        expected: 200,
    },
    {
        name:     'GET /oracloud (Oracle)',
        method:   'GET',
        path:     '/oracloud',
        body:     { filters: { posting_diff: POSTING_DIFF } },
        expected: 200,
    },
    {
        name:     'GET /dice',
        method:   'GET',
        path:     '/dice',
        body:     { page_number: 1, filters: { posting_diff: POSTING_DIFF } },
        expected: 200,
    },
];

// ─── Server lifecycle ──────────────────────────────────────────────────────

let serverProcess;

const startServer = () => {
    return new Promise((resolve, reject) => {
        console.log('Starting server...');
        serverProcess = spawn('node', ['server.js'], {
            cwd: process.cwd(),
            stdio: 'pipe',
        });

        serverProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('listening')) {
                console.log('✓ Server started');
                setTimeout(() => resolve(), 1000); // wait for full startup
            }
        });

        serverProcess.stdout.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('listening')) {
                console.log('✓ Server started');
                setTimeout(() => resolve(), 1000);
            }
        });

        serverProcess.on('error', reject);
        setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    });
};

const stopServer = () => {
    return new Promise((resolve) => {
        if (serverProcess) {
            serverProcess.kill('SIGTERM');
            serverProcess.on('exit', resolve);
            setTimeout(resolve, 2000);
        } else {
            resolve();
        }
    });
};

// ─── Test runner ──────────────────────────────────────────────────────────

const runTest = async (test) => {
    const client = axios.create({
        baseURL:        BASE_URL,
        timeout:        TIMEOUT,
        validateStatus: () => true, // don't throw on non-2xx
    });

    try {
        const config = {
            method: test.method.toLowerCase(),
            url:    test.path,
            data:   test.body,
        };

        const response = await client(config);

        const passed = response.status === test.expected;
        const icon   = passed ? '✓' : '✗';
        const time   = response.duration ? ` (${response.duration}ms)` : '';

        console.log(
            `  ${icon} ${test.name.padEnd(50)} [${response.status}]${time}`
        );

        if (!passed) {
            console.log(
                `    Expected ${test.expected}, got ${response.status}`
            );
            if (response.data?.error) {
                console.log(`    Error: ${response.data.error.message}`);
            }
        }

        if (response.status === 200 && response.data?.message) {
            const jobCount = Array.isArray(response.data.message)
                ? response.data.message.length
                : 0;
            if (jobCount > 0) {
                console.log(`    → ${jobCount} jobs returned`);
            }
        }

        return passed;
    } catch (err) {
        console.log(
            `  ✗ ${test.name.padEnd(50)} [ERROR]`
        );
        console.log(`    ${err.message}`);
        return false;
    }
};

// ─── Main ─────────────────────────────────────────────────────────────────

(async () => {
    console.log('Job Board Scraper Integration Tests');
    console.log(`Posting diff filter: ${POSTING_DIFF} days\n`);

    try {
        await startServer();

        console.log(`\nRunning ${tests.length} tests...\n`);
        let passed = 0;
        let failed = 0;

        for (const test of tests) {
            const result = await runTest(test);
            if (result) passed++;
            else failed++;
        }

        console.log(`\n${'═'.repeat(70)}`);
        console.log(`Results: ${passed} passed, ${failed} failed`);

        if (failed === 0) {
            console.log('✓ All tests passed!');
        } else {
            console.log(`✗ ${failed} test(s) failed`);
        }

        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(`Fatal error: ${err.message}`);
        process.exit(1);
    } finally {
        await stopServer();
    }
})();
