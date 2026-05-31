# Scheduling Design

> Status: **design only**, not implemented. This document captures the
> proposed architecture for two automated pipelines that the project will
> need once active development settles. No `.github/workflows/*.yml`, no
> systemd units, no orchestration scripts exist yet.

## Context

Two recurring jobs would close the gap between "manual scraper" and
"hands-off daily digest":

1. **Cleanup pipeline** — keep `app/companies/<portal>/*.{csv,json}` healthy.
   Today: requires manually running `POST /cleanup`, `find-portal.js`, and
   `apply-cleanup.js`. Stale entries (currently ~5-10% of the lists) drift in
   between manual runs.
2. **Scrape pipeline** — run all scrapers and email the consolidated `.xlsx`
   daily so new postings reach the user within hours of being published.
   Today: scrapers run only when someone hits the endpoints manually, so
   "first wave of applicants" is unrealised.

Each pipeline runs in a different place for good reason — see Architecture.

## Architecture

| Pipeline | Runtime | Cadence | Auth/access surface |
| --- | --- | --- | --- |
| Cleanup | GitHub Actions (Ubuntu runner) | Weekly | None — script reads CSV/JSON, hits public APIs, writes back to repo via PR |
| Scrapers | systemd timer on EC2 (where the app already runs) | Daily | `curl localhost:7777/...` — no public exposure, no auth |

**Why different runtimes?**

- The cleanup pipeline's *output* is a commit (mutates `app/companies/`).
  GitHub Actions has commit + PR access for free. Running it from EC2 would
  require pushing credentials to the box and `git`-managing the working tree.
- The scrape pipeline needs the server already running (it hits
  `localhost:7777/<portal>` which loads SQLite, emits StatsD metrics, writes
  the .xlsx). Exposing those endpoints publicly so GH Actions could reach
  them would add attack surface for no benefit. EC2 already has the server,
  the DB, and the .xlsx output directory; a cron-equivalent there is the
  obvious fit.

Both pipelines share the existing tooling — `cleanup-service.js`,
`scripts/find-portal.js`, `scripts/apply-cleanup.js`, the live scraper
endpoints. Neither requires new server code; the pipelines are orchestration
on top of what already exists.

## Cleanup pipeline (GitHub Actions, weekly)

**Sketch:** `.github/workflows/cleanup.yml`

```yaml
name: Weekly company-list cleanup
on:
  schedule: [{ cron: '0 8 * * 1' }]   # Mondays 08:00 UTC
  workflow_dispatch:                  # manual trigger button
jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: node scripts/run-cleanup-pipeline.js
        env:
          # cleanup-service uses these for logger/output paths; no secrets
          # required since the probes hit public APIs
          NODE_ENV: ci
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: cleanup/auto-${{ github.run_number }}
          title: "chore(cleanup): weekly company-list maintenance"
          commit-message: |
            Weekly automated cleanup
            
            - Removed stale slugs (greenhouse/lever/ashby/oracloud/workday)
            - Re-homed slugs that moved to other portals
            
            See run summary for counts.
          body: |
            Automated weekly run of the cleanup + re-home pipeline.
            
            **Stale removed:** see job summary
            **Re-homed:** see job summary
            
            Review the diff in `app/companies/` and merge if it looks right.
            Revert with `git checkout app/companies/` on the branch if not.
```

**New orchestrator (~50 lines):** `scripts/run-cleanup-pipeline.js`

Imports `runCleanup()` from `app/services/cleanup-service.js` (skip the HTTP
boundary), runs it sequentially per portal, writes per-portal stale reports,
concatenates into the canonical `stale-companies-<date>.csv`, shells out to
`scripts/find-portal.js`, then to `scripts/apply-cleanup.js --apply --rehome`.
At the end, sets GitHub Actions outputs (`removed`, `added`) for the PR body.

### Why PR, not direct commit to main

The pipeline touches source-of-truth files. A bad probe day (mass false-stales
from an API hiccup) could nuke hundreds of slugs. PRs gate this behind a
human review without blocking the automation.

### Failure handling

- Workflow fails → GitHub emails the repo's notification recipient (default).
- Workflow succeeds with no diff (nothing stale that week) → script writes
  empty PR body, `peter-evans/create-pull-request@v6` skips PR creation
  automatically.
- API rate-limit blip mid-run → `cleanup-service.js` already reports
  `unknown` rows; the orchestrator should refuse to apply if
  `unknown > <threshold>%` to prevent acting on incomplete data.

### Permissions

The default `GITHUB_TOKEN` granted to the workflow has `contents: write` +
`pull-requests: write`. No external PAT, no Anthropic/OpenAI/etc. keys
needed. Cleanup probes hit only public ATS APIs.

---

## Scrape pipeline (systemd timer on EC2)

**Sketch:** two unit files dropped into the EC2 box.

```
# /etc/systemd/system/job-boards-scrape.service
[Unit]
Description=Run all scrapers + email daily digest
After=job-boards.service network-online.target
Requires=job-boards.service

[Service]
Type=oneshot
User=jobboards
WorkingDirectory=/opt/job-boards
ExecStart=/opt/job-boards/deploy/scrape-daily.sh
StandardOutput=journal
StandardError=journal
```

```
# /etc/systemd/system/job-boards-scrape.timer
[Unit]
Description=Daily job-boards scrape (06:00 server time)

[Timer]
OnCalendar=*-*-* 06:00:00
Persistent=true        # run on boot if last fire was missed
RandomizedDelaySec=15m # spread load away from exactly-on-the-hour ATS rate limits

[Install]
WantedBy=timers.target
```

```bash
#!/bin/bash
# /opt/job-boards/deploy/scrape-daily.sh
set -euo pipefail
BASE=http://localhost:7777
LOG=/var/log/job-boards/scrape-$(date +%F).log

curl_portal() {
  local portal=$1
  echo "=== $portal ===" >> "$LOG"
  if curl -fsS --max-time 1800 -X GET "$BASE/$portal" \
       -H "Content-Type: application/json" -d '{}' >> "$LOG" 2>&1; then
    echo "  OK" >> "$LOG"
  else
    echo "  FAILED (curl exit $?)" >> "$LOG"
  fi
}

for p in greenhouse lever ash oracloud dice; do curl_portal "$p"; done
# Workday last — it's the longest-running and uses RabbitMQ
curl_portal workday

# Email the consolidated xlsx
curl -fsS "$BASE/latest" >> "$LOG" 2>&1 || echo "  /latest FAILED" >> "$LOG"
```

### Enable

```
sudo cp deploy/job-boards-scrape.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now job-boards-scrape.timer

# Verify
systemctl list-timers job-boards-scrape.timer
journalctl -u job-boards-scrape.service -n 50
```

### Failure handling

- systemd logs everything to journal → CloudWatch agent already on the box
  (see `IAC-Terraform/userdata.sh`) ships the journal to CloudWatch Logs.
- Add a CloudWatch Logs metric filter on `FAILED` lines + an SNS alarm if
  failure visibility matters.
- Per-portal failures don't block other portals (each `curl` is independent
  with `set -euo pipefail` deliberately omitted for the loop body — the
  helper function captures failures inline).

### Cadence

Daily at 06:00 server time + 0–15 min randomised jitter (`RandomizedDelaySec`).
"Be in the first wave" works fine at daily granularity for most ATSes;
twice-daily (e.g. 06:00 + 18:00) is a trivial change if needed.

### What doesn't get scheduled

`POST /cleanup` — that's handled by the GitHub Actions pipeline (above).
Mixing them would create write contention on `app/companies/` files.

---

## Open questions

1. **Cleanup PR review SLA** — if a PR sits unreviewed for weeks, the next
   weekly run opens a second PR with overlapping changes. Options:
   (a) auto-merge after 7d if no review, (b) close stale PRs before opening
   new ones, (c) accept the noise and let humans decide.
2. **Scrape failure pager** — should a failed scrape page the operator, or
   silently retry next day? Probably the latter for now; reconsider once
   missed-day rate is measurable.
3. **Re-home unknowns** — current pipeline acts only on `category=stale`.
   If `unknown` rate stays low (post API migration it's near zero) this is
   fine; if it climbs again we'd need the orchestrator to either re-run or
   abort.

## Rollout phases

1. **Phase 1 — Cleanup pipeline.** Lower risk (output is a reviewable PR).
   Ship first, observe a few weekly runs, tune thresholds.
2. **Phase 2 — Scrape pipeline.** Higher risk (writes to live DB + sends
   email). Ship once the cleanup pipeline has proven the orchestrator
   patterns and CloudWatch visibility.
3. **Phase 3 — Cross-pipeline coordination.** Cleanup PR merged Monday →
   that day's scrape uses the new lists. Verify no race condition.
