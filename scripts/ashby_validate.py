#!/usr/bin/env python3
# Validates companies from ashby-validate.csv against the Ashby API.
# Tries multiple slug variants per company name; first 2xx wins.
# Dry-run by default. Pass --apply to append confirmed slugs to ashby.csv.
#
#   python scripts/ashby_validate.py          # dry-run
#   python scripts/ashby_validate.py --apply  # write to ashby.csv

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote

import requests

CONCURRENCY = 15
TIMEOUT     = 10
API_BASE    = 'https://api.ashbyhq.com/posting-api/job-board'

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()


def slug_candidates(name):
    n  = name.strip()
    lo = n.lower()
    seen, out = set(), []
    for s in [lo, lo.replace(' ', ''), lo.replace(' ', '-'), quote(lo), quote(n)]:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def probe(slug):
    try:
        r = requests.get(
            f'{API_BASE}/{slug}',
            timeout=TIMEOUT,
            headers={'Accept': 'application/json'},
            allow_redirects=True,
        )
        return r.status_code if r.status_code < 500 else 0
    except Exception:
        return 0


validate_path = 'app/companies/ashby-validate.csv'
ashby_path    = 'app/companies/ashby.csv'

names = list(dict.fromkeys(
    line.rstrip(',').strip()
    for line in open(validate_path).read().splitlines()
    if line.strip().rstrip(',')
))

with open(ashby_path) as f:
    existing_raw = f.read()
existing = {l.strip().lower() for l in existing_raw.splitlines() if l.strip()}

print(f'Validating {len(names)} companies against Ashby API (concurrency {CONCURRENCY})...')


def find_slug(name):
    for slug in slug_candidates(name):
        status = probe(slug)
        if 200 <= status < 300:
            stored = quote(slug) if ' ' in slug else slug
            return {'name': name, 'slug': stored, 'found': True}
    return {'name': name, 'slug': None, 'found': False}


results = []
with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(find_slug, name): name for name in names}
    for future in as_completed(futures):
        results.append(future.result())

found     = [r for r in results if r['found']]
not_found = [r for r in results if not r['found']]
new_slugs = [r for r in found if r['slug'].lower() not in existing]
already   = [r for r in found if r['slug'].lower() in existing]

print(f'\nResults: {len(found)} confirmed on Ashby, {len(not_found)} not found')
print(f'Already in ashby.csv: {len(already)}')
print(f'New to add: {len(new_slugs)}')

if new_slugs:
    print('\nNew confirmed Ashby companies:')
    for r in new_slugs:
        print(f"  {r['name']} → {r['slug']}")

if not_found:
    print('\nNot found on Ashby (may use different slug or portal):')
    for r in not_found:
        print(f"  {r['name']}")

if args.apply and new_slugs:
    to_add = sorted(r['slug'] for r in new_slugs)
    sep = '' if existing_raw.endswith('\n') else '\n'
    with open(ashby_path, 'a') as f:
        f.write(sep + '\n'.join(to_add) + '\n')
    print(f'\nWrote {len(new_slugs)} new slugs to {ashby_path}')
elif new_slugs:
    print(f'\nRun with --apply to write changes to {ashby_path}')
