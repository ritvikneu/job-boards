#!/usr/bin/env python3
# Removes confirmed-stale slugs (category=stale) from app/companies/*, and
# optionally appends re-homed slugs from a portal-discovery report.
# Dry-run by default. Pass --apply to actually mutate files.
#
#   python scripts/apply_cleanup.py                                              # today's stale report, dry-run
#   python scripts/apply_cleanup.py --apply                                      # remove stale
#   python scripts/apply_cleanup.py --apply --rehome reports/portal-discovery-YYYY-MM-DD.csv
#   python scripts/apply_cleanup.py --date 2026-05-17
#
# Git is the audit trail — review `git diff` after applying.

import argparse
import json
import os
import sys
from datetime import date

PORTAL_DIRS = {
    'greenhouse': {'file': 'app/companies/greenhouse.csv', 'format': 'csv'},
    'lever':      {'file': 'app/companies/lever.csv',      'format': 'csv'},
    'ashby':      {'file': 'app/companies/ashby.csv',      'format': 'csv'},
    'oracloud':   {'file': 'app/companies/oracloud.json',  'format': 'json', 'slug_field': 'companyName'},
    'workday':    {'file': 'app/companies/workday.json',   'format': 'json', 'slug_field': 'name'},
}

parser = argparse.ArgumentParser()
parser.add_argument('--apply',  action='store_true')
parser.add_argument('--date',   default=date.today().isoformat())
parser.add_argument('--rehome', default=None)
args = parser.parse_args()

report_path = f'reports/stale-companies-{args.date}.csv'
if not os.path.exists(report_path):
    print(f'Report not found: {report_path}', file=sys.stderr)
    sys.exit(1)

# Parse report → {portal: set(slug)} (stale only)
stale_by_portal = {}
with open(report_path) as f:
    for line in f.readlines()[1:]:
        line = line.strip()
        if not line:
            continue
        fields = line.split(',')
        if len(fields) < 3:
            print(f'Skipping malformed stale row: {line}', file=sys.stderr)
            continue
        category, portal, slug = fields[0], fields[1], fields[2]
        if category != 'stale' or not portal or not slug:
            continue
        stale_by_portal.setdefault(portal, set()).add(slug.lower())

total_removed = 0
summary = []

for portal, stale_slugs in stale_by_portal.items():
    cfg = PORTAL_DIRS.get(portal)
    if not cfg:
        print(f'Skipping unknown portal: {portal}', file=sys.stderr)
        continue

    path = cfg['file']
    with open(path) as f:
        raw = f.read()

    if cfg['format'] == 'csv':
        all_lines = raw.split('\n')
        kept    = [l for l in all_lines if l.strip().lower() not in stale_slugs]
        removed = len(all_lines) - len(kept)
    else:
        all_entries = json.loads(raw)
        field = cfg['slug_field']
        kept    = [r for r in all_entries if str(r.get(field, '')).lower() not in stale_slugs]
        removed = len(all_entries) - len(kept)

    if removed == 0:
        continue

    total_removed += removed
    summary.append(f'  {path}: {removed} removed')

    if args.apply:
        if cfg['format'] == 'csv':
            out = '\n'.join(kept)
        else:
            out = json.dumps(kept, indent=2) + '\n'
        with open(path, 'w') as f:
            f.write(out)

print(f'Stale report: {report_path}')
print(f'Mode:         {"APPLY (files written)" if args.apply else "dry-run"}')
if not summary:
    print('No matching slugs found in source files.')
else:
    print('\n'.join(summary))
    suffix = '' if args.apply else ' (would be)'
    print(f'Total removed: {total_removed}{suffix}.')

# ── Re-home phase ──────────────────────────────────────────────────────────────
if args.rehome:
    if not os.path.exists(args.rehome):
        print(f'\nDiscovery report not found: {args.rehome}', file=sys.stderr)
        sys.exit(1)

    # discovery columns: slug,original_portal,found_in,found_url,status
    add_by_portal = {}
    with open(args.rehome) as f:
        for line in f.readlines()[1:]:
            line = line.strip()
            if not line:
                continue
            fields = line.split(',')
            if len(fields) < 3:
                print(f'Skipping malformed rehome row: {line}', file=sys.stderr)
                continue
            slug, _, found_in = fields[0], fields[1], fields[2]
            if not slug or not found_in or found_in == 'none':
                continue
            add_by_portal.setdefault(found_in, set()).add(slug.lower())

    print('\n--- Re-home ---')
    print(f'Discovery report: {args.rehome}')

    total_added = 0
    add_summary = []

    for portal, slugs in add_by_portal.items():
        cfg = PORTAL_DIRS.get(portal)
        if not cfg or cfg['format'] != 'csv':
            print(f'Skipping re-home for {portal} (no CSV target)', file=sys.stderr)
            continue

        path = cfg['file']
        raw  = open(path).read() if os.path.exists(path) else ''
        existing = {l.strip().lower() for l in raw.split('\n') if l.strip()}

        to_add = sorted(s for s in slugs if s not in existing)
        if not to_add:
            continue

        total_added += len(to_add)
        add_summary.append(f'  {path}: +{len(to_add)}')

        if args.apply:
            sep = '' if raw.endswith('\n') else '\n'
            with open(path, 'a') as f:
                f.write(sep + '\n'.join(to_add) + '\n')

    if not add_summary:
        print('No new slugs to add (all already present in target CSVs).')
    else:
        print('\n'.join(add_summary))
        suffix = '' if args.apply else ' (would be)'
        print(f'Total added: {total_added}{suffix}.')

if not args.apply and (total_removed > 0 or args.rehome):
    print('\nRun again with --apply to write changes.')
