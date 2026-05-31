#!/usr/bin/env python3
# Validates all company files across all portals.
# For each company slug/link, makes a HEAD/GET request and reports:
#   ALIVE  (2xx), DEAD (404/403), UNKNOWN (5xx/timeout/error)
#
#   python scripts/validate_companies.py            # all portals
#   python scripts/validate_companies.py ashby      # single portal

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

TIMEOUT     = 5
CONCURRENCY = 20
COMPANIES   = os.path.join('app', 'companies')

PORTALS = {
    'greenhouse': {
        'file':    'greenhouse.csv',
        'builder': lambda slug: f'https://job-boards.greenhouse.io/{slug}',
    },
    'lever': {
        'file':    'lever.csv',
        'builder': lambda slug: f'https://jobs.lever.co/{slug}',
    },
    'ashby': {
        'file':    'ashby.csv',
        'builder': lambda slug: f'https://jobs.ashbyhq.com/{slug}',
    },
    'workday': {
        'file':    'workday.json',
        'type':    'json',
        'builder': lambda entry: entry.get('link'),
    },
    'oracloud': {
        'file':    'oracloud.json',
        'type':    'json',
        'builder': lambda entry: entry.get('jobSearchUrl'),
    },
}


def load_companies(portal):
    cfg      = PORTALS[portal]
    file_path = os.path.join(COMPANIES, cfg['file'])
    with open(file_path) as f:
        content = f.read()
    if cfg.get('type') == 'json':
        return json.loads(content)
    return [l.lower().strip() for l in content.splitlines() if l.strip() and not l.startswith('#')]


def validate_url(url):
    try:
        r = requests.head(url, timeout=TIMEOUT, allow_redirects=True)
        if r.status_code == 405:
            r = requests.get(url, timeout=TIMEOUT, allow_redirects=True)
        return r.status_code, r.status_code < 400
    except requests.RequestException as e:
        return 0, False


def validate_portal(portal):
    companies = load_companies(portal)
    if not companies:
        print(f'\n{portal.upper()}: no companies to validate')
        return []

    print(f'\nValidating {portal} ({len(companies)} companies)...')
    builder = PORTALS[portal]['builder']

    def check(company):
        slug = company if isinstance(company, str) else company.get('name') or company.get('slug', '')
        url  = builder(company)
        if not url:
            return {'slug': slug, 'url': url, 'status': 0, 'alive': False}
        status, alive = validate_url(url)
        return {'slug': slug, 'url': url, 'status': status, 'alive': alive}

    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(check, c): c for c in companies}
        for future in as_completed(futures):
            results.append(future.result())
    return results


def report(portal, results):
    alive   = [r for r in results if r['alive']]
    dead    = [r for r in results if not r['alive'] and r['status'] == 404]
    other   = [r for r in results if not r['alive'] and r['status'] != 404]

    print(f"\n{'═' * 80}")
    print(f"{portal.upper()}")
    print(f"{'═' * 80}")
    print(f"Total: {len(results)} | Alive: {len(alive)} | Dead (404): {len(dead)} | Other errors: {len(other)}")

    if dead:
        print('\nDEAD COMPANIES (should remove from CSV):')
        for r in dead:
            print(f"  {r['status']}  {r['slug']}")

    if other:
        print('\nUNKNOWN STATUS (check manually):')
        for r in other[:10]:
            print(f"  {r['status'] or 'ERR'}  {r['slug']}")
        if len(other) > 10:
            print(f'  ... and {len(other) - 10} more')

    if len(alive) == len(results):
        print('\nAll companies alive!')


args        = sys.argv[1:]
portal_arg  = args[0] if args else None
to_validate = [portal_arg] if portal_arg else list(PORTALS.keys())

print('Job Board Company Validator')
print('Checking which companies are still active...')

for portal in to_validate:
    if portal not in PORTALS:
        print(f'Unknown portal: {portal}')
        continue
    results = validate_portal(portal)
    if results:
        report(portal, results)

print(f"\n{'═' * 80}")
print('Validation complete!')
