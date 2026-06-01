# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # node server.js — starts on port 7777
npm test             # mocha --exit tests/test.js
```

Test a scraper:
```bash
curl -X GET http://localhost:7777/greenhouse \
  -H "Content-Type: application/json" \
  -d '{"filters": {"posting_diff": 5}}'
```

RabbitMQ is required only for `/workday`:
```bash
docker run -d --hostname rabbit --name rabbitmq -p 5672:5672 rabbitmq:3
```

## Architecture

**Full architecture and design decisions are documented in `CONTEXT.md`.** Read it first when working on anything non-trivial.

### Request flow

Every scraper request goes through this exact chain:
```
scraperLimiter → validateSchema → controller → service → response
```

Controllers live in `app/controllers/jobs-controller.js`. Each calls `resolveFilterConfig(body)` (from `profile-service.js`) to build filter config, then `new FilterJobs(config)`, then passes the filter instance to the service.

### Adding a new portal

Copy `app/templates/blueprint-service.js` — all patterns (fast/slow path, `applyJobFilters`, `upsertJob`, `recordScrapeMetrics`) are documented inline. Then wire it: add a route in `jobs-router.js`, a handler in `jobs-controller.js`, and a company list in `app/companies/`.

### The fast/slow path (all portals)

All portals implement the same dedup pattern in `applyJobFilters`:
- **First encounter (slow):** apply location + title filters → `upsertJob()` (stores the job regardless of filter outcome) → fetch date if needed
- **Subsequent runs (fast):** `getJob(job_link)` hits SQLite → re-run all filters against cached data, zero HTTP calls

Workday is the exception: it uses `getJobByJobId(apiUrl)` instead of `getJob(job_link)` because the public URL is only known after the expensive detail fetch.

### Filter config resolution priority

`body.filters` inline > `body.profile` preset (from `app/config/profiles/*.json`) > `.env` vars

Env vars (`JOB_TITLES`, `IGNORE_TITLES`, `COUNTRIES`, `STATES`, `STATES_ABBR`) are parsed once at module load in `filtering-service.js`, not per request.

### Key env vars

```env
EMAIL_RECIPIENT=          # required — /latest endpoint
MAILTRAP_TOKEN=           # required — email delivery
JOB_TITLES=              # comma-separated title keywords
IGNORE_TITLES=           # comma-separated title exclusions
COUNTRIES=               # comma-separated country names
STATES=                  # comma-separated state names
STATES_ABBR=             # comma-separated state abbreviations
POSTING_DIFF=10          # max days since posting
RABBITMQ_URL=amqp://localhost  # required for /workday only
HEALTH_CHECK=OK          # returned by /health
```

See `.env.example` for the full list.

### Cleanup, re-homing, and CSV maintenance

Two tools keep the per-portal company lists healthy. Neither auto-mutates source files unless run with `--apply`.

**`scripts/cleanup.py`** — probes every company across Greenhouse, Lever, Ashby, Oracle Cloud, and Workday using each portal's **official JSON API** (e.g. `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com`). HTML URLs are unreliable (Greenhouse 406s every GET, Ashby SPA returns 200 for any slug, Lever HTML 404s live boards), so we always go through the APIs. Output: `reports/stale-companies-YYYY-MM-DD.csv` with a `category` column — `stale` (404/403, safe to remove) or `unknown` (5xx/timeout/network error). With `--apply`, also removes stale slugs from company files in the same run. Run one portal at a time to avoid rate limits.

```bash
python scripts/cleanup.py --portals ashby               # probe only (dry-run)
python scripts/cleanup.py --portals ashby --apply       # probe + remove stale
python scripts/cleanup.py --date 2026-05-31 --apply     # skip probe, apply from existing report
python scripts/cleanup.py --apply --rehome reports/portal-discovery-YYYY-MM-DD.csv
```

**`scripts/find_portal.py`** — for each slug in a stale report (or a plain text file), probes Greenhouse + Ashby + Lever via their JSON APIs to see if the company has moved. Skips the slug's original portal. Output: `reports/portal-discovery-YYYY-MM-DD.csv` mapping `slug → found_in` (or `none`). Pass `--apply` to immediately append discovered slugs to the matching portal CSV in `app/companies/` (deduped).

```bash
python scripts/find_portal.py                                # uses today's stale-companies report
python scripts/find_portal.py --report path/to.csv           # specific report
python scripts/find_portal.py --from-file slugs.txt          # bare slug list, one per line
python scripts/find_portal.py --from-file slugs.txt --apply  # also append hits to portal CSVs
```

**End-to-end workflow:**

```bash
# 1. Probe + remove stale (per-portal for clean reports)
for p in greenhouse lever ashby; do
  python scripts/cleanup.py --portals $p --apply
done

# 2. Discover where stale slugs live now (--apply writes directly to portal CSVs)
python scripts/find_portal.py --apply

# 3. Re-home: add slugs found on new portals (if not using find_portal.py --apply above)
python scripts/cleanup.py --date $(date +%F) --apply --rehome reports/portal-discovery-$(date +%F).csv

# 4. Review and commit
git diff app/companies/
```

## Known Issues

- `DICE_API_KEY` is hardcoded in `dice-service.js:19` — should move to `.env`
- Individual scrapers still import `axios` directly instead of using the shared `http-client.js` instance
- No graceful degradation if RabbitMQ is down for `/workday`


# plugins
plugins:
  - andrej-karpathy-skills
