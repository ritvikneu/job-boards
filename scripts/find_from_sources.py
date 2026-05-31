#!/usr/bin/env python3
# Discovery scraper. Pulls company+ATS pairs from public sources and writes a
# candidates CSV. Pipe its output through find_portal.py to confirm each slug.
#
#   python scripts/find_from_sources.py                       # both sources
#   python scripts/find_from_sources.py --source simplifyjobs # GH lists only
#   python scripts/find_from_sources.py --source yc           # YC OSS dump only
#
# Output: reports/discovery-candidates-YYYY-MM-DD.csv
#   slug,inferred_portal,source_url,source

import argparse
import os
import re
import sys
from datetime import date

import requests

REPORT_DIR = 'reports'
TIMEOUT    = 30

UA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

SIMPLIFY_REPOS = [
    'Summer2026-Internships',
    'Summer2025-Internships',
    'New-Grad-Positions',
]
YC_API_URL = 'https://yc-oss.github.io/api/companies/all.json'

SKIP_WORDS = {'jobs', 'embed', 'job_board', 'posting-api', 'v1', 'boards', 'careers'}

ATS_PATTERNS = [
    ('greenhouse', re.compile(r'(?:job-)?boards(?:-api)?\.greenhouse\.io/(?:v1/boards/|embed/job_board\?for=)?([a-z0-9][a-z0-9_-]*)', re.IGNORECASE)),
    ('lever',      re.compile(r'(?:api|jobs)\.lever\.co/(?:v0/postings/)?([a-z0-9][a-z0-9_-]*)',                                       re.IGNORECASE)),
    ('ashby',      re.compile(r'(?:api|jobs)\.ashbyhq\.com/(?:posting-api/job-board/)?([a-z0-9][a-z0-9_-]*)',                          re.IGNORECASE)),
    ('workable',   re.compile(r'apply\.workable\.com/([a-z0-9][a-z0-9_-]*)',                                                           re.IGNORECASE)),
]

parser = argparse.ArgumentParser()
parser.add_argument('--source', default='both', choices=['simplifyjobs', 'yc', 'both'])
args = parser.parse_args()


def fetch_text(url):
    r = requests.get(url, timeout=TIMEOUT, headers=UA_HEADERS)
    r.raise_for_status()
    return r.text


def fetch_json(url):
    r = requests.get(url, timeout=TIMEOUT, headers=UA_HEADERS)
    r.raise_for_status()
    return r.json()


def extract_from_text(text, source_url):
    hits = []
    for portal, pattern in ATS_PATTERNS:
        for m in pattern.finditer(text):
            slug = m.group(1).lower()
            if slug in SKIP_WORDS:
                continue
            hits.append({'slug': slug, 'inferred_portal': portal, 'source_url': source_url})
    return hits


def discover_simplify():
    all_hits = []
    for repo in SIMPLIFY_REPOS:
        url = f'https://raw.githubusercontent.com/SimplifyJobs/{repo}/dev/README.md'
        try:
            md   = fetch_text(url)
            hits = [{**h, 'source': 'simplifyjobs'} for h in extract_from_text(md, url)]
            all_hits.extend(hits)
            print(f'  {repo}: {len(hits)} ATS URLs extracted')
        except Exception as e:
            print(f'  {repo}: failed — {e}', file=sys.stderr)
    return all_hits


def discover_yc():
    try:
        companies = fetch_json(YC_API_URL)
        hiring    = [c for c in companies if c.get('slug') and c.get('isHiring')]
        print(f'  yc-oss: {len(hiring)} hiring companies (of {len(companies)} total)')
        return [
            {
                'slug':            c['slug'].lower(),
                'inferred_portal': 'unknown',
                'source_url':      c.get('url', YC_API_URL),
                'source':          'yc',
            }
            for c in hiring
        ]
    except Exception as e:
        print(f'  yc: failed — {e}', file=sys.stderr)
        return []


print(f'Discovering from: {args.source}')

rows = []
if args.source in ('simplifyjobs', 'both'):
    print('SimplifyJobs:')
    rows.extend(discover_simplify())
if args.source in ('yc', 'both'):
    print('YC OSS:')
    rows.extend(discover_yc())

# Dedup by (slug, inferred_portal)
seen, unique = set(), []
for r in rows:
    key = f"{r['slug']}|{r['inferred_portal']}"
    if key in seen:
        continue
    seen.add(key)
    unique.append(r)

os.makedirs(REPORT_DIR, exist_ok=True)
today    = date.today().isoformat()
out_path = f'{REPORT_DIR}/discovery-candidates-{today}.csv'

sorted_rows = sorted(unique, key=lambda r: (r['source'], r['inferred_portal'], r['slug']))
lines = ['slug,inferred_portal,source_url,source']
for r in sorted_rows:
    lines.append(f"{r['slug']},{r['inferred_portal']},{r['source_url']},{r['source']}")

with open(out_path, 'w') as f:
    f.write('\n'.join(lines) + '\n')

by_source = {}
by_portal = {}
for r in unique:
    by_source[r['source']] = by_source.get(r['source'], 0) + 1
    by_portal[r['inferred_portal']] = by_portal.get(r['inferred_portal'], 0) + 1

print(f'\nWrote {out_path}')
print(f'Total candidates: {len(unique)}')
print(f'  by source: {by_source}')
print(f'  by inferred portal: {by_portal}')
