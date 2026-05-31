#!/usr/bin/env python3
# Given a list of slugs, probe Greenhouse, Ashby, and Lever to find which
# portal currently hosts that company.
#
#   python scripts/find_portal.py                                # today's stale report
#   python scripts/find_portal.py --report reports/foo.csv      # specific report
#   python scripts/find_portal.py --from-file companies.txt     # bare slug list
#
# Output: reports/portal-discovery-YYYY-MM-DD.csv
#   slug,original_portal,found_in,found_url,status

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import requests

CONCURRENCY    = 25
TIMEOUT        = 15
REPORT_DIR     = 'reports'

PROBE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':     'application/json, text/html;q=0.9, */*;q=0.8',
}

PROBES = [
    {'portal': 'greenhouse', 'url': lambda s: f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs'},
    {'portal': 'ashby',      'url': lambda s: f'https://api.ashbyhq.com/posting-api/job-board/{s}'},
    {'portal': 'lever',      'url': lambda s: f'https://api.lever.co/v0/postings/{s}'},
]

parser = argparse.ArgumentParser()
parser.add_argument('--report',    default=None)
parser.add_argument('--from-file', default=None, dest='from_file')
args = parser.parse_args()

today = date.today().isoformat()

inputs = []
if args.from_file:
    if not os.path.exists(args.from_file):
        print(f'File not found: {args.from_file}', file=sys.stderr)
        sys.exit(1)
    seen = set()
    with open(args.from_file) as f:
        for line in f:
            slug = line.strip().lower()
            if not slug or slug in seen:
                continue
            seen.add(slug)
            inputs.append({'slug': slug, 'original_portal': ''})
else:
    report_path = args.report or f'{REPORT_DIR}/stale-companies-{today}.csv'
    if not os.path.exists(report_path):
        print(f'Report not found: {report_path}', file=sys.stderr)
        print('Tip: pass --report <path> or --from-file <path>', file=sys.stderr)
        sys.exit(1)
    seen = set()
    with open(report_path) as f:
        for line in f.readlines()[1:]:
            line = line.strip()
            if not line:
                continue
            fields = line.split(',')
            portal = fields[1] if len(fields) > 1 else ''
            slug   = fields[2].lower() if len(fields) > 2 else ''
            if not slug or slug in seen:
                continue
            seen.add(slug)
            inputs.append({'slug': slug, 'original_portal': portal})

if not inputs:
    print('No slugs to probe.', file=sys.stderr)
    sys.exit(1)

print(f'Probing {len(inputs)} slugs across {len(PROBES)} URL patterns (concurrency {CONCURRENCY})...')


def probe_slug(entry):
    for probe in PROBES:
        if probe['portal'] == entry['original_portal']:
            continue
        url = probe['url'](entry['slug'])
        try:
            r = requests.get(url, timeout=TIMEOUT, headers=PROBE_HEADERS, allow_redirects=True)
            if 200 <= r.status_code < 300:
                return {**entry, 'found_in': probe['portal'], 'found_url': url, 'status': r.status_code}
        except Exception:
            pass
    return {**entry, 'found_in': 'none', 'found_url': '', 'status': ''}


results = []
with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(probe_slug, e): e for e in inputs}
    for future in as_completed(futures):
        results.append(future.result())

os.makedirs(REPORT_DIR, exist_ok=True)
out_path = f'{REPORT_DIR}/portal-discovery-{today}.csv'
lines = ['slug,original_portal,found_in,found_url,status']
for r in results:
    lines.append(f"{r['slug']},{r['original_portal']},{r['found_in']},{r['found_url']},{r['status']}")

with open(out_path, 'w') as f:
    f.write('\n'.join(lines) + '\n')

hits     = [r for r in results if r['found_in'] != 'none']
by_portal = {}
for r in hits:
    by_portal[r['found_in']] = by_portal.get(r['found_in'], 0) + 1

pct = (len(hits) / len(results) * 100) if results else 0
print(f'Wrote {out_path}')
print(f'Hits: {len(hits)} of {len(results)} ({pct:.1f}%)')
for portal, n in by_portal.items():
    print(f'  {portal}: {n}')
