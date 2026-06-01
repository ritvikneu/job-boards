#!/usr/bin/env python3
# Given a list of slugs (or company names), probe Greenhouse, Ashby, and Lever
# to find which portal currently hosts that company.
#
#   python scripts/find_portal.py                                   # today's stale report
#   python scripts/find_portal.py --report reports/foo.csv          # specific report
#   python scripts/find_portal.py --from-file companies.txt         # bare slug list
#   python scripts/find_portal.py --from-names names.txt            # company names → slug candidates
#   python scripts/find_portal.py --from-file slugs.txt --apply     # also append to portal CSVs
#
# Output: reports/portal-discovery-YYYY-MM-DD.csv
#   slug,original_portal,found_in,found_url,status
#
# --from-names output: reports/name-discovery-YYYY-MM-DD.csv
#   name,slug,found_in,found_url,status

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from urllib.parse import quote

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

COMPANIES_DIR = 'app/companies'
PORTAL_CSV = {
    'greenhouse': f'{COMPANIES_DIR}/greenhouse.csv',
    'ashby':      f'{COMPANIES_DIR}/ashby.csv',
    'lever':      f'{COMPANIES_DIR}/lever.csv',
}

parser = argparse.ArgumentParser()
parser.add_argument('--report',     default=None)
parser.add_argument('--from-file',  default=None, dest='from_file')
parser.add_argument('--from-names', default=None, dest='from_names', metavar='FILE',
                    help='File of company names; generates slug candidates and probes all portals')
parser.add_argument('--apply',      action='store_true',
                    help='Append discovered slugs to the matching portal CSV files')
args = parser.parse_args()

today = date.today().isoformat()


# ─── Names mode ───────────────────────────────────────────────────────────────

def slug_candidates(name):
    n = name.strip()
    lo = n.lower()
    seen, out = set(), []
    for s in [lo, lo.replace(' ', ''), lo.replace(' ', '-'), quote(lo), quote(n)]:
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def probe_name(name):
    for slug in slug_candidates(name):
        for probe in PROBES:
            url = probe['url'](slug)
            try:
                r = requests.get(url, timeout=TIMEOUT, headers=PROBE_HEADERS, allow_redirects=True)
                if 200 <= r.status_code < 300:
                    return {'name': name, 'slug': slug, 'found_in': probe['portal'],
                            'found_url': url, 'status': r.status_code}
            except Exception:
                pass
    return {'name': name, 'slug': '', 'found_in': 'none', 'found_url': '', 'status': ''}


if args.from_names:
    if not os.path.exists(args.from_names):
        print(f'File not found: {args.from_names}', file=sys.stderr)
        sys.exit(1)
    names, seen = [], set()
    with open(args.from_names) as f:
        for line in f:
            name = line.strip()
            if not name or name in seen:
                continue
            seen.add(name)
            names.append(name)

    print(f'Probing {len(names)} company names across {len(PROBES)} portals (concurrency {CONCURRENCY})...')
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(probe_name, n): n for n in names}
        for future in as_completed(futures):
            results.append(future.result())

    os.makedirs(REPORT_DIR, exist_ok=True)
    out_path = f'{REPORT_DIR}/name-discovery-{today}.csv'
    lines = ['name,slug,found_in,found_url,status']
    for r in results:
        lines.append(f"{r['name']},{r['slug']},{r['found_in']},{r['found_url']},{r['status']}")
    with open(out_path, 'w') as f:
        f.write('\n'.join(lines) + '\n')

    hits      = [r for r in results if r['found_in'] != 'none']
    by_portal = {}
    for r in hits:
        by_portal[r['found_in']] = by_portal.get(r['found_in'], 0) + 1
    pct = (len(hits) / len(results) * 100) if results else 0
    print(f'Wrote {out_path}')
    print(f'Hits: {len(hits)} of {len(results)} ({pct:.1f}%)')
    for portal, n in by_portal.items():
        print(f'  {portal}: {n}')

    if args.apply:
        for portal, csv_path in PORTAL_CSV.items():
            to_add = [r['slug'] for r in hits if r['found_in'] == portal]
            if not to_add:
                continue
            existing = set()
            if os.path.exists(csv_path):
                with open(csv_path) as f:
                    existing = {line.strip().lower() for line in f if line.strip()}
            new_slugs = [s for s in to_add if s.lower() not in existing]
            if not new_slugs:
                print(f'  {portal}: all {len(to_add)} already present in {csv_path}')
                continue
            with open(csv_path, 'a') as f:
                for slug in new_slugs:
                    f.write(slug + '\n')
            skipped = len(to_add) - len(new_slugs)
            msg = f'  {portal}: appended {len(new_slugs)} to {csv_path}'
            if skipped:
                msg += f' ({skipped} already present, skipped)'
            print(msg)
    else:
        print('Tip: re-run with --apply to append hits to the portal CSV files')

    sys.exit(0)


# ─── Slug mode (default) ──────────────────────────────────────────────────────

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

hits      = [r for r in results if r['found_in'] != 'none']
by_portal = {}
for r in hits:
    by_portal[r['found_in']] = by_portal.get(r['found_in'], 0) + 1

pct = (len(hits) / len(results) * 100) if results else 0
print(f'Wrote {out_path}')
print(f'Hits: {len(hits)} of {len(results)} ({pct:.1f}%)')
for portal, n in by_portal.items():
    print(f'  {portal}: {n}')

if args.apply:
    for portal, csv_path in PORTAL_CSV.items():
        to_add = [r['slug'] for r in hits if r['found_in'] == portal]
        if not to_add:
            continue
        existing = set()
        if os.path.exists(csv_path):
            with open(csv_path) as f:
                existing = {line.strip().lower() for line in f if line.strip()}
        new_slugs = [s for s in to_add if s.lower() not in existing]
        if not new_slugs:
            print(f'  {portal}: all {len(to_add)} already present in {csv_path}')
            continue
        with open(csv_path, 'a') as f:
            for slug in new_slugs:
                f.write(slug + '\n')
        skipped = len(to_add) - len(new_slugs)
        msg = f'  {portal}: appended {len(new_slugs)} to {csv_path}'
        if skipped:
            msg += f' ({skipped} already present, skipped)'
        print(msg)
else:
    print('Tip: re-run with --apply to append hits to the portal CSV files')
