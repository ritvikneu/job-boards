#!/usr/bin/env python3
# Integration test suite for all scraper endpoints.
# Starts the server, runs requests against each route, validates status.
#
#   python scripts/test_scrapers.py
#   python scripts/test_scrapers.py --filter-diff 5

import argparse
import subprocess
import sys
import time

import requests

BASE_URL = 'http://localhost:7777'
TIMEOUT  = 30

parser = argparse.ArgumentParser()
parser.add_argument('--filter-diff', type=int, default=5, dest='filter_diff')
args = parser.parse_args()

POSTING_DIFF = args.filter_diff

TESTS = [
    {
        'name':     'GET /health',
        'method':   'GET',
        'path':     '/health',
        'expected': 200,
    },
    {
        'name':     'GET /greenhouse (no filters)',
        'method':   'GET',
        'path':     '/greenhouse',
        'body':     {},
        'expected': 200,
    },
    {
        'name':     'GET /greenhouse (with posting_diff filter)',
        'method':   'GET',
        'path':     '/greenhouse',
        'body':     {'filters': {'posting_diff': POSTING_DIFF}},
        'expected': 200,
    },
    {
        'name':     'GET /lever',
        'method':   'GET',
        'path':     '/lever',
        'body':     {'filters': {'posting_diff': POSTING_DIFF}},
        'expected': 200,
    },
    {
        'name':     'GET /ash (Ashby HQ)',
        'method':   'GET',
        'path':     '/ash',
        'body':     {'filters': {'posting_diff': POSTING_DIFF}},
        'expected': 200,
    },
    {
        'name':     'GET /oracloud (Oracle)',
        'method':   'GET',
        'path':     '/oracloud',
        'body':     {'filters': {'posting_diff': POSTING_DIFF}},
        'expected': 200,
    },
    {
        'name':     'GET /dice',
        'method':   'GET',
        'path':     '/dice',
        'body':     {'page_number': 1, 'filters': {'posting_diff': POSTING_DIFF}},
        'expected': 200,
    },
]


def start_server():
    print('Starting server...')
    proc = subprocess.Popen(
        ['node', 'server.js'],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    deadline = time.time() + 10
    while time.time() < deadline:
        # Check both stdout and stderr for the "listening" signal
        import select
        ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.1)
        for stream in ready:
            line = stream.readline()
            if 'listening' in line.lower():
                print('Server started')
                time.sleep(1)
                return proc

        if proc.poll() is not None:
            out, err = proc.communicate()
            raise RuntimeError(f'Server exited early:\n{out}\n{err}')

    raise RuntimeError('Server startup timeout (10s)')


def stop_server(proc):
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


def run_test(test):
    method = test['method'].upper()
    url    = BASE_URL + test['path']
    body   = test.get('body')

    try:
        if method == 'GET':
            r = requests.get(url, json=body, timeout=TIMEOUT)
        else:
            r = requests.request(method, url, json=body, timeout=TIMEOUT)

        passed = r.status_code == test['expected']
        icon   = '✓' if passed else '✗'
        print(f"  {icon} {test['name']:<50} [{r.status_code}]")

        if not passed:
            print(f"    Expected {test['expected']}, got {r.status_code}")
            try:
                data = r.json()
                if data.get('error'):
                    print(f"    Error: {data['error'].get('message', data['error'])}")
            except Exception:
                pass

        if r.status_code == 200:
            try:
                data = r.json()
                jobs = data.get('message', [])
                if isinstance(jobs, list) and jobs:
                    print(f'    → {len(jobs)} jobs returned')
            except Exception:
                pass

        return passed
    except Exception as e:
        print(f"  ✗ {test['name']:<50} [ERROR]")
        print(f'    {e}')
        return False


print('Job Board Scraper Integration Tests')
print(f'Posting diff filter: {POSTING_DIFF} days\n')

proc   = None
passed = 0
failed = 0

try:
    proc = start_server()
    print(f'\nRunning {len(TESTS)} tests...\n')

    for test in TESTS:
        if run_test(test):
            passed += 1
        else:
            failed += 1

    print(f"\n{'═' * 70}")
    print(f'Results: {passed} passed, {failed} failed')
    if failed == 0:
        print('All tests passed!')
    else:
        print(f'{failed} test(s) failed')

except Exception as e:
    print(f'Fatal error: {e}', file=sys.stderr)
    failed = 1

finally:
    stop_server(proc)

sys.exit(1 if failed else 0)
