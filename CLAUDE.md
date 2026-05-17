# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install dependencies
pnpm start            # node server.js — starts on port 7777
pnpm test             # mocha --exit tests/test.js
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
FILE_GH=gh-io            # CSV filename stem for Greenhouse
FILE_LEVER=lever         # CSV filename stem for Lever
FILE_ASH=ash             # CSV filename stem for Ashby
HEALTH_CHECK=OK          # returned by /health
```

See `.env.example` for the full list.

### Cleanup endpoint

`POST /cleanup` probes every company across Greenhouse, Lever, Ashby, Oracle Cloud, and Workday to find slugs returning 403 (private) or 404 (stale). Output goes to `reports/stale-companies-YYYY-MM-DD.csv` with a `category` column: `stale` (definite — safe to remove) or `unknown` (probe was rate-limited or errored — inconclusive).

**Run one portal at a time** for accurate results — running all portals at once tends to trip per-host rate limits on large lists (Greenhouse gh-io has ~2,500 slugs) and produces many `unknown` rows. If `per_portal.<name>.unknown > 0` in the response, re-run that portal alone: `POST /cleanup` with `{"portals":["greenhouse"]}`.

Nothing is auto-removed; review the report and edit `app/companies/<portal>/*.csv` or `*.json` manually.

## Known Issues

- `DICE_API_KEY` is hardcoded in `dice-service.js:19` — should move to `.env`
- Individual scrapers still import `axios` directly instead of using the shared `http-client.js` instance
- No graceful degradation if RabbitMQ is down for `/workday`
- Oracle Cloud service should read `FILE_ORA` from env instead of hardcoding `'oracloud'`


# plugins
plugins:
  - andrej-karpathy-skills
