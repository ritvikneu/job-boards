#!/usr/bin/env python3
# Unified cleanup tool: probe company APIs for stale slugs, then (optionally)
# remove them from the company files and/or re-home them to a new portal.
#
#   python scripts/cleanup.py                                    # probe all portals, dry-run
#   python scripts/cleanup.py --portals ashby lever             # probe specific portals
#   python scripts/cleanup.py --apply                            # probe + remove stale
#   python scripts/cleanup.py --apply --rehome reports/portal-discovery-YYYY-MM-DD.csv
#   python scripts/cleanup.py --date 2026-05-31 --apply         # skip probe, use existing report
#
# Best run one portal at a time to avoid rate limits:
#   for p in greenhouse lever ashby; do
#     python scripts/cleanup.py --portals $p --apply
#   done
#
# Git is the audit trail — review `git diff app/companies/` after applying.

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime

import requests

# ─── Config ───────────────────────────────────────────────────────────────────

CONCURRENCY   = 50
TIMEOUT       = 15
REPORT_DIR    = 'reports'

PROBE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':     'application/json, text/html;q=0.9, */*;q=0.8',
}

STALE_STATUSES     = {403, 404}
TRANSIENT_STATUSES = {408, 429, 502, 503, 504}
CATEGORY_ORDER     = {'stale': 0, 'unknown_transient': 1, 'unknown_error': 2}

PORTALS = {
    'greenhouse': {
        'format':    'csv',
        'file':      'app/companies/greenhouse.csv',
        'build_url': lambda slug: f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs',
        'method':    'GET',
    },
    'lever': {
        'format':    'csv',
        'file':      'app/companies/lever.csv',
        'build_url': lambda slug: f'https://api.lever.co/v0/postings/{slug}',
        'method':    'GET',
    },
    'ashby': {
        'format':    'csv',
        'file':      'app/companies/ashby.csv',
        'build_url': lambda slug: f'https://api.ashbyhq.com/posting-api/job-board/{slug}',
        'method':    'GET',
    },
    'oracloud': {
        'format':     'json',
        'file':       'app/companies/oracloud.json',
        'slug_field': 'companyName',
        'url_field':  'url',
        'method':     'GET',
    },
    'workday': {
        'format':     'json',
        'file':       'app/companies/workday.json',
        'slug_field': 'name',
        'url_field':  'link',
        'method':     'POST',
        'body':       {'limit': 1, 'offset': 0, 'searchText': ''},
    },
}

# ─── Args ─────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--portals', nargs='+', choices=list(PORTALS), metavar='PORTAL')
parser.add_argument('--apply',   action='store_true')
parser.add_argument('--rehome',  default=None, metavar='PATH')
parser.add_argument('--date',    default=None, metavar='YYYY-MM-DD',
                    help='Skip probing and use an existing stale report')
args = parser.parse_args()

today       = date.today().isoformat()
report_path = f'{REPORT_DIR}/stale-companies-{args.date or today}.csv'

# ─── Probe phase ──────────────────────────────────────────────────────────────

def load_entries(portal, cfg):
    path = cfg['file']
    try:
        with open(path) as f:
            raw = f.read()
    except FileNotFoundError:
        print(f'[{portal}] file not found: {path}', file=sys.stderr)
        return []

    if cfg['format'] == 'csv':
        seen, out = set(), []
        for line in raw.splitlines():
            slug = line.lower().strip()
            if not slug or slug.startswith('#') or slug in seen:
                continue
            seen.add(slug)
            out.append({'slug': slug, 'url': cfg['build_url'](slug)})
        return out

    records = json.loads(raw)
    sf, uf  = cfg['slug_field'], cfg['url_field']
    return [
        {'slug': str(r[sf]).lower(), 'url': r[uf]}
        for r in records if r.get(sf) and r.get(uf)
    ]


def probe_entry(portal, cfg, entry):
    try:
        if cfg['method'] == 'POST':
            r = requests.post(entry['url'], json=cfg.get('body'), timeout=TIMEOUT, headers=PROBE_HEADERS)
        else:
            r = requests.get(entry['url'], timeout=TIMEOUT, headers=PROBE_HEADERS, allow_redirects=True)
        if r.status_code < 400:
            return None  # alive
        status = r.status_code
        category = 'stale' if status in STALE_STATUSES else 'unknown_error'
        return {'portal': portal, 'slug': entry['slug'], 'board_url': entry['url'],
                'category': category, 'status': status, 'reason': ''}
    except requests.Timeout:
        return {'portal': portal, 'slug': entry['slug'], 'board_url': entry['url'],
                'category': 'unknown_transient', 'status': 'timeout', 'reason': 'ETIMEDOUT'}
    except requests.ConnectionError as e:
        return {'portal': portal, 'slug': entry['slug'], 'board_url': entry['url'],
                'category': 'unknown_transient', 'status': 'conn_error', 'reason': str(e)[:60]}
    except Exception as e:
        return {'portal': portal, 'slug': entry['slug'], 'board_url': entry['url'],
                'category': 'unknown_error', 'status': 'error', 'reason': str(e)[:60]}


def csv_escape(v):
    s = str(v) if v is not None else ''
    return f'"{s.replace(chr(34), chr(34)*2)}"' if any(c in s for c in '",\n') else s


def write_report(rows, checked_at):
    os.makedirs(REPORT_DIR, exist_ok=True)
    path = f'{REPORT_DIR}/stale-companies-{checked_at[:10]}.csv'
    sorted_rows = sorted(rows, key=lambda r: (
        CATEGORY_ORDER.get(r['category'], 9), r['portal'], r['slug']
    ))
    lines = ['category,portal,slug,status,reason,board_url,checked_at']
    for r in sorted_rows:
        lines.append(','.join([
            r['category'], r['portal'], r['slug'],
            str(r['status']), csv_escape(r['reason']), r['board_url'], checked_at,
        ]))
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    return path


if not args.date:
    selected  = args.portals or list(PORTALS)
    checked_at = datetime.utcnow().isoformat()
    print(f'Probing portals: {", ".join(selected)}')

    all_rows  = []
    per_portal = {}

    for portal in selected:
        cfg     = PORTALS[portal]
        entries = load_entries(portal, cfg)
        print(f'  [{portal}] {len(entries)} entries loaded')

        rows = []
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futures = {pool.submit(probe_entry, portal, cfg, e): e for e in entries}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    rows.append(result)

        stale     = [r for r in rows if r['category'] == 'stale']
        transient = [r for r in rows if r['category'] == 'unknown_transient']
        errors    = [r for r in rows if r['category'] == 'unknown_error']
        per_portal[portal] = {'checked': len(entries), 'stale': len(stale),
                              'unknown_transient': len(transient), 'unknown_error': len(errors)}

        print(f'  [{portal}] {len(entries)} probed → {len(stale)} stale, '
              f'{len(transient)} unknown_transient, {len(errors)} unknown_error')
        if transient:
            print(f'  [{portal}] tip: re-run this portal alone for a clean read')

        all_rows.extend(rows)

    report_path = write_report(all_rows, checked_at)
    stale_total = sum(p['stale'] for p in per_portal.values())
    print(f'\nReport: {report_path}')
    print(f'Total:  {stale_total} stale, {len(all_rows) - stale_total} unknown')
else:
    if not os.path.exists(report_path):
        print(f'Report not found: {report_path}', file=sys.stderr)
        sys.exit(1)
    print(f'Using existing report: {report_path}')

# ─── Apply phase ──────────────────────────────────────────────────────────────

if not args.apply:
    print(f'\nDry-run. Pass --apply to mutate company files.')
    sys.exit(0)

# Parse stale slugs from report
stale_by_portal: dict[str, set] = {}
with open(report_path) as f:
    for line in f.readlines()[1:]:
        line = line.strip()
        if not line:
            continue
        fields = line.split(',')
        if len(fields) < 3:
            continue
        category, portal, slug = fields[0], fields[1], fields[2]
        if category != 'stale' or not portal or not slug:
            continue
        stale_by_portal.setdefault(portal, set()).add(slug.lower())

print(f'\n--- Apply (remove stale) ---')
total_removed = 0

for portal, stale_slugs in stale_by_portal.items():
    cfg = PORTALS.get(portal)
    if not cfg:
        print(f'  skipping unknown portal: {portal}')
        continue

    path = cfg['file']
    with open(path) as f:
        raw = f.read()

    if cfg['format'] == 'csv':
        lines   = raw.split('\n')
        kept    = [l for l in lines if l.strip().lower() not in stale_slugs]
        removed = len(lines) - len(kept)
        out     = '\n'.join(kept)
    else:
        sf      = cfg['slug_field']
        records = json.loads(raw)
        kept    = [r for r in records if str(r.get(sf, '')).lower() not in stale_slugs]
        removed = len(records) - len(kept)
        out     = json.dumps(kept, indent=2) + '\n'

    if removed == 0:
        continue

    total_removed += removed
    with open(path, 'w') as f:
        f.write(out)
    print(f'  {path}: {removed} removed')

print(f'Total removed: {total_removed}')

# ─── Rehome phase ─────────────────────────────────────────────────────────────

if not args.rehome:
    sys.exit(0)

if not os.path.exists(args.rehome):
    print(f'\nDiscovery report not found: {args.rehome}', file=sys.stderr)
    sys.exit(1)

print(f'\n--- Rehome ---')
add_by_portal: dict[str, set] = {}

with open(args.rehome) as f:
    for line in f.readlines()[1:]:
        line = line.strip()
        if not line:
            continue
        fields = line.split(',')
        if len(fields) < 3:
            continue
        slug, _, found_in = fields[0], fields[1], fields[2]
        if not slug or not found_in or found_in == 'none':
            continue
        add_by_portal.setdefault(found_in, set()).add(slug.lower())

total_added = 0

for portal, slugs in add_by_portal.items():
    cfg = PORTALS.get(portal)
    if not cfg or cfg['format'] != 'csv':
        print(f'  skipping {portal} (no CSV target)')
        continue

    path = cfg['file']
    raw  = open(path).read() if os.path.exists(path) else ''
    existing = {l.strip().lower() for l in raw.splitlines() if l.strip()}
    to_add   = sorted(s for s in slugs if s not in existing)

    if not to_add:
        continue

    sep = '' if raw.endswith('\n') else '\n'
    with open(path, 'a') as f:
        f.write(sep + '\n'.join(to_add) + '\n')

    total_added += len(to_add)
    print(f'  {path}: +{len(to_add)}')

print(f'Total added: {total_added}')
