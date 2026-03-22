# PROJECT CONTEXT

> Intended audience: a fresh AI or developer picking this up with no prior context.
> All file paths are relative to the project root.

---

## 1. Project Overview

**What it does:** A Node.js/Express HTTP API that scrapes job listings from six company job boards (Greenhouse, Lever, Ashby HQ, Workday, Oracle Cloud, Dice), filters the results by location, title keywords, and recency, deduplicates using a local SQLite cache, and writes passing jobs to `.xlsx` files. A `/latest` endpoint emails the most recent output file.

**Why it exists:** To aggregate job listings across many employers in one automated run, rather than manually checking each portal.

**Tech stack:**
| Concern | Tool |
|---|---|
| HTTP server | Express 4 (ESM, `"type": "module"`) |
| Scraping | axios + jsdom |
| Filtering | Custom `FilterJobs` class (word-boundary regex, Sets) |
| Deduplication / caching | better-sqlite3 (WAL mode) |
| Message queue | RabbitMQ via amqplib (Workday only) |
| Concurrency control | p-limit |
| Logging | Winston structured JSON → files |
| Metrics | StatsD via hot-shots (DogStatsD-compatible UDP) |
| Output | ExcelJS (.xlsx) |
| Email | Nodemailer + Mailtrap |

**Port:** `7777`
**Entry point:** `server.js`
**Active git branch:** `cloudwatch`
**Package manager:** pnpm

---

## 2. Current Architecture

### Directory layout

```
server.js                          ← process entry; calls initDb() then app.listen(7777)
app/
├── app.js                         ← Express setup: cors, json, httpMetrics, routes, error handler
├── routes/
│   ├── index.js                   ← mounts jobsRouter at '/'
│   └── jobs-router.js             ← 8 route definitions (GET only)
├── controllers/
│   └── jobs-controller.js         ← one handler per route; builds FilterJobs, calls service
├── services/
│   ├── filtering-service-v2.js    ← FilterJobs, TitleChecker, LocationChecker
│   ├── profile-service.js         ← resolveFilterConfig(): body.filters > body.profile > .env
│   ├── greenhouse_v2-service.js   ← runGreenhouseScraper(embed, filterJob)
│   ├── lever-service.js           ← runLeverScraper(filterJob)
│   ├── ash2-service.js            ← runAshScraper(filterJob)
│   ├── wday-rabbit.js             ← runWorkdayScraper(file_name, filterJob)
│   ├── oraclecloud-service.js     ← runOracleCloudScraper(filterJob)
│   ├── dice-service.js            ← runDiceScraper(page_number, filterJob)
│   ├── file_creation-service.js   ← FileHandler: writeToExcel(), getLatestJobs() → email
│   ├── mail-service.js            ← Nodemailer transport + sendMail/sendMailAttachment
│   └── rabbitMQ-service.js        ← producer(), getNextMessages(), closeConnection()
├── database/
│   └── sqlite-service.js          ← initDb(), hasJob(), getJob(), getJobByJobId(),
│                                     upsertJob(), upsertJobs(), updateJobDate(),
│                                     updateJobPositionId(), getJobCount()
├── middleware/
│   ├── logger.js                  ← createCustomLogger(name) → Winston instance
│   └── metrics.js                 ← httpMetrics middleware, recordScrapeMetrics(), recordScrapeError()
├── companies/                     ← company list files per portal
│   ├── greenhouse/                  ← *.csv  (one slug per line, e.g. "stripe")
│   ├── lever/                       ← *.csv
│   ├── ashbyhq/                     ← *.csv
│   ├── workday/                     ← *.json  [{ "name": "...", "link": "..." }]
│   └── oracloud/                    ← *.json  [{ "companyName", "url", "jobSearchUrl" }]
├── config/
│   └── profiles/                  ← named filter preset JSON files (e.g. swe-us.json)
├── data/
│   └── jobs.db                    ← SQLite database (created on first run)
└── templates/
    ├── blueprint-service.js       ← copy-paste template for a new portal scraper
    └── README.md                  ← pattern reference for adding portals

logs/                              ← auto-created; per-service Winston log files
```

---

## 3. How It Works

### 3a. Request lifecycle

```
GET /greenhouse  (with optional JSON body)
      │
      ▼
jobs-controller.js: getGreenhouse()
  │  resolveFilterConfig(body)          ← body.filters > body.profile > .env
  │  new FilterJobs(config)             ← builds TitleChecker + LocationChecker
  │
  ▼
greenhouse_v2-service.js: runGreenhouseScraper(embed, filterJob)
  │
  ├─ loadCompanies()         reads CSV → [{ name, link }]
  ├─ scrapeAllCompanies()    pLimit(50) parallel company scrapes
  │     └─ fetchJobsForCompany()  axios.get → extractJobsFromPage(html, routeKey)
  │                               parses window.__remixContext JSON, paginates ?page=N
  ├─ filterJobs()            pLimit(50) per-job filter pipeline
  │     └─ applyJobFilters() FAST PATH: getJob(job_link) → filter cached data
  │                          SLOW PATH: upsertJob() → location → title → date check
  ├─ recordScrapeMetrics()   StatsD gauges/timings
  └─ fileHandler.writeToExcel()  ExcelJS .xlsx output
      │
      ▼
response.json({ message: filteredJobs })
```

### 3b. The fast/slow path pattern (ALL portals)

Every portal service uses an identical two-path pattern inside `applyJobFilters`:

**SLOW PATH (first time a job is seen):**
1. Apply `matchesLocation(job.location)` — instant string scan
2. Apply `matchesTitle(job.job_title)` — instant string scan
3. (For Lever only) Fetch posting_date via `fetchPostingDate(job_link)` — HTTP GET, only if steps 1+2 pass
4. `upsertJob(job, portal)` — store to SQLite via `INSERT OR IGNORE`
5. Apply `matchesPostingDate(posting_date)`

**FAST PATH (job seen on any previous run):**
1. `getJob(job_link)` returns the full cached row
2. Re-apply all three filter checks against cached data — **zero HTTP calls**
3. Backfill: if `cached.posting_date IS NULL` and job now passes location+title, call detail fetch + `updateJobDate()`

The key insight: **all jobs are stored to SQLite regardless of whether they pass filters**, so the next run uses cached data for every previously-seen job. On first runs all jobs go slow path. On subsequent runs everything is fast path.

### 3c. Per-portal mechanics

| Portal | Company source | Job data source | Date available in stub? | Detail fetch needed? |
|---|---|---|---|---|
| **Greenhouse** | CSV slug → `job-boards.greenhouse.io/{slug}` | `window.__remixContext` JSON inline in HTML | Yes (`published_at`) | No |
| **Lever** | CSV slug → `jobs.lever.co/{slug}` | HTML `.posting` divs (`.posting-title`, `.sort-by-location`) | **No** | Yes — `<script type="application/ld+json">` → `datePosted` |
| **Ashby** | CSV slug → `jobs.ashbyhq.com/{slug}` | `window.__appData` JSON inline in HTML | Yes (`updatedAt`) | No |
| **Workday** | JSON `{ name, link }` | Workday POST API → stub → RabbitMQ queue → per-job GET | Approximately (string "Posted 5 Days Ago") | Yes — individual job GET, skipped via `getJobByJobId` fast path |
| **Oracle Cloud** | JSON `{ companyName, url, jobSearchUrl }` | REST API GET (`jobSearchUrl`) | Yes | No |
| **Dice** | None — calls Dice Search API directly | `job-search-api.svc.dhigroupinc.com` GET | Yes (`postedDate`) | Yes — detail page for `position_id` only |

### 3d. Workday producer-consumer pipeline (most complex)

```
runWorkdayScraper()
  │
  ├─ loadCompanies()     reads JSON from app/companies/workday/{file_name}.json
  │
  ├─ runProducer()
  │   ├─ workdayFetch()  POST with { limit: 20, offset, searchText: '' }
  │   │                  paginate until < 20 results or WORKDAY_OFFSET reached
  │   ├─ STUB PRE-FILTER ← matchesTitle + matchesLocation + parsePostedOn()
  │   │                  drops ~85-90% of stubs before any job-detail GETs
  │   └─ producer()      pushes surviving job API URLs to RabbitMQ queue (shuffled)
  │
  ├─ runConsumers()
  │   └─ consumerWorker() × Math.min(ceil(queued/1500)+1, 10) workers
  │       ├─ getNextMessages(BATCH_SIZE=150)
  │       └─ per message:
  │           FAST: getJobByJobId(url) → use cached SQLite row, zero HTTP
  │           SLOW: workdayJobFetch(url) → persist via upsertJob(data, 'workday')
  │                 job_id = API URL (the fast-path lookup key)
  │
  └─ filterJobs()  in-memory final pass (data already complete from consumer stage)
```

`parsePostedOn()` converts Workday's relative strings:
- `"Posted Today"` → today's ISO date
- `"Posted Yesterday"` → yesterday
- `"Posted 5 Days Ago"` → 5 days ago
- `"Posted 30+ Days Ago"` → 30 days ago (conservative lower bound)
- Unknown format → `null` (fail-open — stub is NOT rejected)

### 3e. Filtering logic (`filtering-service-v2.js`)

`FilterJobs` contains two inner classes:

**`TitleChecker`:**
- Accepts job if title contains any word from `jobTitlesSet` AND contains no word from `ignoreTitlesSet`
- Uses `\b` word-boundary regex: `"engineer" `matches `"Software Engineer"` but NOT `"reengineering"`

**`LocationChecker`:**
- Accepts if location contains a word from `countriesSet`, `statesSet`, OR `statesAbbrSet`
- Same `\b` word-boundary regex
- Checks exact match first (fastest), then iterates sets

**`FilterJobs.matchesPostingDate(date)`:**
- `Math.ceil(|now - postedDate| / 86400000) <= postingDiff`
- `postingDiff` defaults to `POSTING_DIFF` env var or `10` days

**`resolveFilterConfig(body)` in `profile-service.js`:**
1. Load `app/config/profiles/{body.profile}.json` if `body.profile` is set
2. Spread `body.filters` on top (inline overrides win)
3. Return config (empty object if neither provided — `FilterJobs` falls back to `.env`)

---

## 4. Setup & Run Instructions

```bash
# 1. Install dependencies
pnpm install

# 2. Set environment variables
# Copy .env.example if it exists, or create .env manually (see Section 5 for all vars)
touch .env

# 3. Start RabbitMQ (required only for Workday endpoint)
# Using Docker:
docker run -d --hostname rabbit --name rabbitmq -p 5672:5672 rabbitmq:3

# 4. Start the server
pnpm start         # runs: node server.js
# Server starts at port 7777
# SQLite DB is created automatically at app/data/jobs.db on first run

# 5. Test a scraper (example)
curl -X GET http://localhost:7777/greenhouse \
  -H "Content-Type: application/json" \
  -d '{"filters": {"posting_diff": 5}}'

# 6. Run tests
pnpm test          # runs: mocha --exit tests/test.js
```

**Required env vars (minimum to run any scraper):**
```env
JOB_TITLES=engineer,analyst,developer
IGNORE_TITLES=intern,manager,director,senior
COUNTRIES=united states
STATES=california,new york,texas,remote
STATES_ABBR=ca,ny,tx,remote,us
POSTING_DIFF=10

FILE_GH=gh-io           # Greenhouse standard CSV base name
FILE_EMBED=gh-embed     # Greenhouse embed CSV base name
FILE_LEVER=lever        # Lever CSV base name
FILE_ASH=ash            # Ashby CSV base name
WORKDAY_OFFSET=200      # max jobs per Workday company (default: 200)

RABBITMQ_URL=amqp://localhost  # required for /workday

HEALTH_CHECK=OK
```

**Log files** are written to `logs/` (created automatically). Each service logs to:
- `logs/{file_name}_info.log` — INFO and above
- `logs/{file_name}_error.log` — ERROR only

---

## 5. Database Schema & Key Data Models

**File:** `app/data/jobs.db` (SQLite, WAL mode)
**Initialized by:** `initDb()` in `app/database/sqlite-service.js` (called once at server start)

### `jobs` table

```sql
CREATE TABLE IF NOT EXISTS jobs (
    job_link     TEXT PRIMARY KEY,    -- public URL to posting; dedup key for most portals
    job_id       TEXT,                -- portal's internal ID; Workday uses API URL here
    job_title    TEXT NOT NULL,
    company_name TEXT NOT NULL,
    location     TEXT,                -- human-readable location string
    posting_date TEXT,                -- ISO "YYYY-MM-DD" or NULL if not yet fetched
    position_id  TEXT,                -- Dice-specific reference ID
    portal       TEXT NOT NULL,       -- 'greenhouse','lever','ashby','workday','oracloud','dice'
    scraped_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_portal     ON jobs(portal);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at);
CREATE INDEX IF NOT EXISTS idx_jobs_job_id     ON jobs(job_id);    -- Workday fast-path lookup
```

### Migration (runs on every startup)

```js
// Adds position_id column if the DB was created before it existed
const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
if (!cols.includes('position_id')) {
    db.exec('ALTER TABLE jobs ADD COLUMN position_id TEXT');
}
```

### Key SQLite API (`sqlite-service.js`)

| Function | Signature | Purpose |
|---|---|---|
| `initDb()` | `() → void` | Open DB, enable WAL, create table + indexes, run migration |
| `hasJob()` | `(job_link) → bool` | Boolean existence check (Ashby dedup) |
| `getJob()` | `(job_link) → row\|undefined` | Full row by primary key — fast-path lookup for all portals except Workday |
| `getJobByJobId()` | `(job_id) → row\|undefined` | Full row by `job_id` column — **Workday** fast-path lookup keyed by API URL |
| `upsertJob()` | `(job, portal) → void` | `INSERT OR IGNORE` single row — used per-job during filter pipeline |
| `upsertJobs()` | `(jobs[], portal) → void` | Batch insert inside a single transaction (O(n) vs O(n×500ms) row-by-row) |
| `updateJobDate()` | `(job_link, date) → void` | Backfill `posting_date` where NULL — Lever backfill path |
| `updateJobPositionId()` | `(job_link, id) → void` | Backfill `position_id` where NULL — Dice backfill path |
| `getJobCount()` | `(portal) → number` | Count rows for a portal — used in logging |

### Canonical job record shape (in-memory, passed between functions)

```js
{
    job_id:       string | null,   // portal's internal ID (Workday: API URL)
    job_title:    string,          // plain-text title
    job_link:     string,          // PRIMARY KEY — unique public URL
    location:     string,          // e.g. "Austin, TX, United States"
    posting_date: string | null,   // "YYYY-MM-DD" or null
    company_name: string,
    // Dice only:
    position_id:  string | null,
}
```

---

## 6. Key Decisions & Optimizations Made

### 6a. SQLite fast/slow path (all portals)

**Problem:** On repeated scraper runs, every previously-seen job would re-fetch from the portal.
**Solution:** `upsertJob()` stores ALL scraped jobs on first encounter (even those that fail filters). Subsequent runs call `getJob(job_link)` or `getJobByJobId(url)` at the top of `applyJobFilters`. If a row exists, it returns cached data and applies filter checks in memory — zero HTTP calls.
**Impact:** Subsequent runs are near-instant for any previously-seen job.

### 6b. Workday stub-level pre-filter

**Problem:** Workday's producer would queue ~15,000 job API URLs for the consumer to GET individually — even international jobs that would fail location/title filters. First-run time was ~28 minutes.
**Solution:** The Workday listing API returns lightweight stubs that already contain `title`, `locationsText`, and `postedOn`. `runProducer()` now applies `matchesTitle`, `matchesLocation`, and `parsePostedOn()` → `matchesPostingDate` directly on stub data — no extra HTTP calls.
**Impact:** Eliminates ~85–90% of stubs before queueing, reducing consumer GETs from ~15,000 to ~1,500–2,000. First-run time dropped to ~3–4 minutes.

### 6c. FilterJobs v2 (replaced v1)

**Problem:** The original `filtering-service.js` used `js-combinatorics` to generate word combinations from filter keywords, then checked each job title against O(2^n) combinations. Expensive and incorrect (word order matters).
**Solution:** `filtering-service-v2.js` uses `Set`-based O(1) lookups for exact matches, then falls back to `\b` word-boundary regex per keyword. No combinations needed.
**Accuracy improvement:** `\b` prevents substring false-positives (e.g., `"engineer"` no longer matches `"reengineering"`).

### 6d. pLimit concurrency caps everywhere

**Problem:** All portals previously fired unlimited parallel requests (all companies simultaneously).
**Solution:** `pLimit(N)` wraps all company-level fetches:
- Greenhouse: `pLimit(50)` for listing pages + filter stage
- Lever: `pLimit(50)` for listing pages + individual date fetches
- Ashby: `pLimit(50)` for company scrapes + filter stage
- Workday consumer: `pLimit(20)` per batch of 150 messages
- Oracle Cloud: `pLimit(10)` (APIs are slow)
- Dice detail fetches: `pLimit(10)` for position-ID fetches

### 6e. Dead code removal (Phase 7)

Removed 10 source files and 10 npm packages that were no longer imported by any active code:

**Files removed:** `ash-service.js`, `handshake-service.js`, `filtering-service.js` (v1), `statsD.js`, `dynamo-service.js`, `db-sequelize.js`, `db-test.js`, `wday-opt.js`, `templates/job-portal-blueprint.js`, `templates/portal-config.js`

**Packages removed:** `@aws-sdk/client-dynamodb`, `@aws-sdk/client-lambda`, `@aws-sdk/client-s3`, `@aws-sdk/lib-dynamodb`, `bottleneck`, `sequelize`, `mongoose`, `pg`, `pg-hstore`, `js-combinatorics`, `fs`

### 6f. Centralized error handler (`app.js`)

Added a 4-argument Express error handler after routes:
```js
app.use((err, req, res, _next) => {
    logger.error(`${req.method} ${req.path} — ${err.message}`);
    res.status(err.status ?? 500).json({ error: { message, timestamp } });
});
```
All route handlers call `next(err)` instead of `res.status(500)` directly.

### 6g. metrics.js replaces statsD.js

The old `statsD.js` was a pass-through stub. `metrics.js` implements:
- `httpMetrics` Express middleware (timing + request counter per route)
- `recordScrapeMetrics(portal, counts)` with portal tag
- `recordScrapeError(portal)` error counter
- Silent on `ECONNREFUSED` — app continues even if no StatsD agent is running

### 6h. Named filter profiles (`profile-service.js`)

`resolveFilterConfig(body)` allows callers to pass `{ "profile": "swe-us" }` to load a preset from `app/config/profiles/swe-us.json`, then optionally override individual fields with `body.filters`. This supports different filter configurations (e.g., different job titles or locations) without changing env vars.

### 6i. `updateJobDate` / `updateJobPositionId` backfill patterns

When Lever stores a job without `posting_date` (because it failed location/title), and later the same job passes with looser filters, the fast path now fetches the date and calls `updateJobDate(job_link, date)` to backfill. Same pattern for Dice's `position_id`. The `UPDATE` is guarded by `WHERE posting_date IS NULL` to avoid overwriting known-good values.

---

## 7. Known Issues / TODOs

| ID | Status | Description |
|---|---|---|
| Phase 5g | Pending | Dead company CSV audit — some slugs in CSV files return 404 (company moved away from the portal). Needs a real scrape run to identify which slugs are dead. |
| GH-slugs | Pending | After running Greenhouse, log warnings for every 404/403 company and remove those slugs from the CSV files. |
| Phase 6 | Pending | Unit tests — `tests/test.js` exists but content is not yet implemented. Plan: mocha + nock (HTTP mocking) + sinon (stubs). |
| OracleCloud env | Missing | The Oracle Cloud service hardcodes `'oracloud'` as the file name. Should read from `process.env.FILE_ORA` for consistency. |
| `.env.example` | Missing | No example env file exists in the repo — new developers must infer all required variables from the code. |
| RabbitMQ resilience | None | If `RABBITMQ_URL` is unset or RabbitMQ is down, the `/workday` endpoint crashes. There is no graceful degradation or fallback. |
| Dice API key | Hardcoded | `DICE_API_KEY = '1YAt0R9wBg4WfsF9VB2778F5CHLAPMVW3WAZcKd8'` is hardcoded in `dice-service.js:19`. Should be moved to `.env`. |
| Log directory | Auto-created | `logs/` is not created by the app — Winston will throw on first log write if it doesn't exist. Add `fs.mkdirSync('logs', { recursive: true })` in `server.js` or logger init. |

---

## 8. Where to Start

If you are reading this cold, follow this order:

1. **`server.js`** — 18 lines; understand startup sequence (`initDb()` then `listen(7777)`)
2. **`app/database/sqlite-service.js`** lines 12–28 — read the schema DDL to understand the data model
3. **`app/services/filtering-service-v2.js`** — understand `FilterJobs`, `matchesTitle`, `matchesLocation`, `matchesPostingDate`; all portals depend on this
4. **`app/services/greenhouse_v2-service.js`** — the cleanest portal service; read it top-to-bottom to understand `loadCompanies → scrapeAllCompanies → filterJobs → applyJobFilters` fast/slow path
5. **`app/services/wday-rabbit.js`** — the most complex service; producer-consumer architecture + stub pre-filter optimization
6. **`app/controllers/jobs-controller.js`** — see how `buildFilterJob(body)` + `resolveFilterConfig` wires the request body to the scraper
7. **`app/templates/blueprint-service.js`** — the copy-paste template if you need to add a new portal; all patterns are documented inline

**Key facts to keep in mind:**
- Every service exports one main function: `run{Portal}Scraper(...)`. The controller always calls that.
- `upsertJob(job, portal)` is `INSERT OR IGNORE` — calling it on a job that's already in the DB is safe and does nothing.
- SQLite `job_link` is the PRIMARY KEY for all portals **except Workday**, which uses `job_id` (the Workday API URL) as its fast-path key because `job_link` (the public URL) is only known after the detail fetch.
- `posting_date` being `NULL` in SQLite is a valid state — it means the job was stored after failing location or title, so the expensive date fetch was skipped. The backfill logic in the fast path handles this.
- The `FilterJobs` singleton (`const defaultFilterJob = new FilterJobs()`) is module-level and reads `.env` once at import time. Per-request overrides are handled by passing a fresh `new FilterJobs(resolveFilterConfig(body))` from the controller.
