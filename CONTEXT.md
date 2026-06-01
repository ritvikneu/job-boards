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
| Scraping | axios + jsdom (shared keep-alive HTTP client) |
| Filtering | Custom `FilterJobs` class (word-boundary regex with module-level cache, Sets) |
| Deduplication / caching | better-sqlite3 (WAL mode, tuned PRAGMAs) |
| Message queue | RabbitMQ via amqplib (Workday only) |
| Concurrency control | p-limit |
| Input validation | Zod schema validation per route |
| Rate limiting | express-rate-limit (per-IP, tiered by route) |
| Security headers | helmet |
| Response compression | compression (gzip/deflate) |
| Logging | Winston structured JSON → daily-rotated files (14-day retention, sensitive data redaction) |
| Metrics | StatsD via hot-shots (DogStatsD-compatible UDP) |
| Output | ExcelJS (.xlsx) |
| Email | Nodemailer + Mailtrap |

**Port:** `7777`
**Entry point:** `server.js`
**Active git branch:** `cloudwatch`
**Package manager:** npm

---

## 2. Current Architecture

### High-level component map

```
HTTP API (Express)        Scrapers                Maintenance (out-of-band)
─────────────────         ─────────               ─────────────────────────
POST /cleanup             greenhouse-service      scripts/find-portal.js
GET  /greenhouse          lever-service           scripts/apply-cleanup.js
GET  /lever               ash-service             scripts/validate-companies.js
GET  /ash                 wday-rabbit             scripts/test-scrapers.js
GET  /workday             oraclecloud-service
GET  /oracloud            dice-service
GET  /dice                                        ↓ reads/writes
GET  /latest                                      app/companies/<portal>/*.{csv,json}
GET  /health
   ↓
shared: filtering-service, profile-service, sqlite-service, logger, metrics
```

### Directory layout

```
server.js                          ← process entry; calls initDb(), cleanOldJobs(30), then app.listen(7777)
app/
├── app.js                         ← Express setup: helmet, cors, compression, json(100kb limit),
│                                     request correlation ID, httpMetrics, routes, error handler
├── routes/
│   ├── index.js                   ← mounts jobsRouter at '/'
│   └── jobs-router.js             ← 8 route definitions; each scraper route wired with
│                                     scraperLimiter + validateSchema + controller
├── controllers/
│   └── jobs-controller.js         ← one handler per route; builds FilterJobs, calls service
├── services/
│   ├── filtering-service.js       ← FilterJobs, TitleChecker, LocationChecker
│   │                                 (module-level regex cache + env var cache)
│   ├── profile-service.js         ← resolveFilterConfig(): body.filters > body.profile > .env
│   ├── http-client.js             ← shared axios instance (keepAlive, maxSockets: 50, timeout: 15s)
│   ├── greenhouse-service.js      ← runGreenhouseScraper(filterJob)
│   ├── lever-service.js           ← runLeverScraper(filterJob)
│   ├── ash-service.js             ← runAshScraper(filterJob)
│   ├── wday-rabbit.js             ← runWorkdayScraper(file_name, filterJob)
│   ├── oraclecloud-service.js     ← runOracleCloudScraper(filterJob)
│   ├── dice-service.js            ← runDiceScraper(page_number, filterJob)
│   ├── cleanup-service.js         ← runCleanup({portals?}) — probes every company via official
│   │                                 JSON APIs; flags 403/404 slugs; writes stale CSV report
│   ├── file_creation-service.js   ← FileHandler: writeToExcel(), getLatestJobs() → email
│   ├── mail-service.js            ← Mailtrap transport + sendMail/sendMailAttachment
│   │                                 (path-traversal guard, EMAIL_RECIPIENT from env)
│   └── rabbitMQ-service.js        ← producer(), getNextMessages(), closeConnection()
├── database/
│   └── sqlite-service.js          ← initDb(), cleanOldJobs(), hasJob(), getJob(), getJobByJobId(),
│                                     upsertJob(), upsertJobs(), updateJobDate(),
│                                     updateJobPositionId(), getJobCount()
│                                     (PRAGMA tuning, 5 indexes, input validation guards)
├── middleware/
│   ├── rateLimiter.js             ← scraperLimiter (5/5min) + generalLimiter (30/15min)
│   ├── validate.js                ← Zod schemas: validateGreenhouse, validateWorkday,
│   │                                 validateDice, validateFilters
│   ├── logger.js                  ← createCustomLogger(name) → Winston (daily rotation,
│   │                                 14-day retention, gzip, sensitive data redaction)
│   └── metrics.js                 ← httpMetrics middleware, recordScrapeMetrics(), recordScrapeError()
├── companies/                     ← company list files per portal (flat)
│   ├── greenhouse.csv               ← one slug per line, e.g. "stripe"
│   ├── lever.csv
│   ├── ashby.csv
│   ├── workday.json                 ← [{ "name": "...", "link": "..." }]
│   └── oracloud.json                ← [{ "companyName", "url", "jobSearchUrl" }]
├── config/
│   └── profiles/                  ← named filter preset JSON files (e.g. swe-us.json)
├── data/
│   └── jobs.db                    ← SQLite database (created on first run)
└── templates/
    ├── blueprint-service.js       ← copy-paste template for a new portal scraper
    └── README.md                  ← pattern reference for adding portals

scripts/                           ← standalone maintenance utilities (not part of the server)
├── find-portal.js                 ← Given a slug list (from a stale-companies report or text
│                                     file), probe Greenhouse/Lever/Ashby JSON APIs to discover
│                                     which portal currently hosts each company. Output:
│                                     reports/portal-discovery-YYYY-MM-DD.csv
├── apply-cleanup.js               ← Mutates app/companies/<portal>/*.{csv,json}: removes
│                                     stale slugs (from stale-companies report) and optionally
│                                     appends re-homed slugs (from --rehome <discovery.csv>).
│                                     Dry-run by default; --apply to write.
├── test-scrapers.js               ← ad-hoc scraper smoke tests
└── validate-companies.js          ← lints company list files for malformed entries

reports/                           ← gitignored; cleanup + discovery output
.env.example                       ← documented template of all environment variables
logs/                              ← auto-created; per-service daily-rotated Winston log files
```

---

## 3. How It Works

### 3a. Request lifecycle

```
GET /greenhouse  (with optional JSON body)
      │
      ▼
app.js middleware chain:
  helmet() → cors(CORS_ORIGIN) → json(100kb) → compression() → requestId → httpMetrics
      │
      ▼
jobs-router.js: scraperLimiter → validateGreenhouse → getGreenhouse()
      │
      ▼
jobs-controller.js: getGreenhouse()
  │  resolveFilterConfig(body)          ← body.filters > body.profile > .env
  │  new FilterJobs(config)             ← builds TitleChecker + LocationChecker
  │
  ▼
greenhouse-service.js: runGreenhouseScraper(filterJob)
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

### 3e. Company-list maintenance pipeline

Each multi-tenant portal (everything except Dice) needs a list of company slugs/IDs in `app/companies/<portal>/`. Companies move ATSes, slugs change, boards go private — leaving stale entries that waste scrape time and produce noise. A three-step pipeline keeps these lists healthy:

```
POST /cleanup                  ← identify stale (cleanup-service.js)
  └─ probe every slug via the portal's official JSON API:
        greenhouse → boards-api.greenhouse.io/v1/boards/<slug>/jobs
        lever      → api.lever.co/v0/postings/<slug>
        ashby      → api.ashbyhq.com/posting-api/job-board/<slug>
        oracloud   → company.url (already an API endpoint)
        workday    → POST to company.link with {limit:1, offset:0, searchText:''}
  → reports/stale-companies-YYYY-MM-DD.csv
        category=stale (403/404 — safe to remove)
        category=unknown (5xx/timeout — inconclusive, re-run that portal alone)

node scripts/find-portal.js    ← re-home stale slugs to other portals
  └─ for each slug, probe greenhouse + ashby + lever via JSON APIs
        (skips the slug's original portal; first 2xx wins)
  → reports/portal-discovery-YYYY-MM-DD.csv
        slug,original_portal,found_in,found_url,status
        found_in='none' for slugs that didn't match anywhere

node scripts/apply-cleanup.js [--apply] [--rehome <discovery.csv>]
  └─ remove confirmed-stale (category=stale only) slugs from source files
  └─ optionally append re-homed slugs to the target portal's CSV (deduped)
  → mutates app/companies/<portal>/*.{csv,json}
        (dry-run by default; git diff is the audit trail)
```

**Why we probe APIs, not HTML.** Initial probes used the HTML board URLs (e.g. `jobs.lever.co/<slug>`) and produced wildly wrong results:
- `job-boards.greenhouse.io` returns **406** to every non-browser GET regardless of headers — turning thousands of live slugs into false-unknowns
- `jobs.ashbyhq.com` is an SPA shell that returns **200 for any slug** — producing false-positives in discovery
- `jobs.lever.co` returns **404 for live boards** — false-stales

All three portals' official JSON APIs return clean 200/404 signals, so cleanup-service.js and find-portal.js both standardize on those endpoints. (The live scrapers in `greenhouse-service.js`, `lever-service.js`, `ash-service.js` still hit HTML pages because they need the inline job data — that's a separate concern and not part of the cleanup probe path.)

**Single Workday file.** All Workday companies are consolidated in `workday.json` (merged from the previous `wday.json`, `wday1.json`, `wday2.json`); dedup by slug was applied during the merge.

### 3f. Filtering logic (`filtering-service.js`)

`FilterJobs` contains two inner classes:

**`TitleChecker`:**
- Accepts job if title contains any word from `jobTitlesSet` AND contains no word from `ignoreTitlesSet`
- Uses `\b` word-boundary regex: `"engineer"` matches `"Software Engineer"` but NOT `"reengineering"`
- Regexes compiled once and stored in a module-level `Map` cache (not recompiled per job)

**`LocationChecker`:**
- Accepts if location contains a word from `countriesSet`, `statesSet`, OR `statesAbbrSet`
- Same `\b` word-boundary regex with module-level cache
- Checks exact match first (fastest), then iterates sets

**`FilterJobs.matchesPostingDate(date)`:**
- `Math.ceil(|now - postedDate| / 86400000) <= postingDiff`
- `postingDiff` defaults to `POSTING_DIFF` env var or `10` days

**Environment variable caching:**
All env vars (`JOB_TITLES`, `IGNORE_TITLES`, `COUNTRIES`, `STATES`, `STATES_ABBR`) are parsed once at module load into module-level arrays. `FilterJobs` constructors read these cached arrays instead of re-parsing `process.env` on every request.

**`resolveFilterConfig(body)` in `profile-service.js`:**
1. Load `app/config/profiles/{body.profile}.json` if `body.profile` is set
2. Spread `body.filters` on top (inline overrides win)
3. Return config (empty object if neither provided — `FilterJobs` falls back to cached env arrays)

---

## 4. Setup & Run Instructions

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env
# IMPORTANT: Set EMAIL_RECIPIENT and MAILTRAP_TOKEN in .env

# 3. Start RabbitMQ (required only for Workday endpoint)
# Using Docker:
docker run -d --hostname rabbit --name rabbitmq -p 5672:5672 rabbitmq:3

# 4. Start the server
npm start          # runs: node server.js
# Server starts at port 7777
# SQLite DB is created automatically at app/data/jobs.db on first run
# cleanOldJobs(30) removes stale data on every startup

# 5. Test a scraper
curl -X GET http://localhost:7777/greenhouse \
  -H "Content-Type: application/json" \
  -d '{"filters": {"posting_diff": 5}}'

# 6. Test health
curl http://localhost:7777/health

# 7. Run tests
npm test           # runs: mocha --exit tests/test.js
```

**Required env vars (minimum to run any scraper):**
```env
# Email
EMAIL_RECIPIENT=your@email.com
MAILTRAP_TOKEN=your-mailtrap-token

# Filtering
JOB_TITLES=engineer,analyst,developer
IGNORE_TITLES=intern,manager,director,senior
COUNTRIES=united states
STATES=california,new york,texas,remote
STATES_ABBR=ca,ny,tx,remote,us
POSTING_DIFF=10

WORKDAY_OFFSET=200

# Infrastructure
RABBITMQ_URL=amqp://localhost    # required for /workday
HEALTH_CHECK=OK

# Optional
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=300000
RATE_LIMIT_MAX=5
```

**Log files** are written to `logs/` (created automatically). Each service logs to daily-rotated files:
- `logs/{name}_info-YYYY-MM-DD.log` — INFO and above
- `logs/{name}_error-YYYY-MM-DD.log` — ERROR only
- Files are gzip-archived and retained for 14 days
- Sensitive fields (`token`, `key`, `secret`, `password`) are redacted before writing

---

## 5. Database Schema & Key Data Models

**File:** `app/data/jobs.db` (SQLite, WAL mode)
**Initialized by:** `initDb()` in `app/database/sqlite-service.js` (called once at server start)

### PRAGMA tuning (set on every startup)

```sql
PRAGMA journal_mode = WAL;          -- concurrent reads don't block writes
PRAGMA cache_size = -32000;         -- 32 MB in-memory page cache
PRAGMA temp_store = MEMORY;         -- temp tables in RAM
PRAGMA mmap_size = 134217728;       -- 128 MB memory-mapped I/O
PRAGMA synchronous = NORMAL;        -- safe with WAL, faster than FULL
PRAGMA auto_vacuum = INCREMENTAL;   -- gradual page reclamation
```

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

CREATE INDEX IF NOT EXISTS idx_jobs_portal       ON jobs(portal);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at   ON jobs(scraped_at);
CREATE INDEX IF NOT EXISTS idx_jobs_job_id       ON jobs(job_id);          -- Workday fast-path lookup
CREATE INDEX IF NOT EXISTS idx_jobs_company_name ON jobs(company_name);    -- filter/display queries
CREATE INDEX IF NOT EXISTS idx_jobs_composite    ON jobs(portal, scraped_at); -- cache-expiry queries
```

### Data archival

`cleanOldJobs(daysToKeep = 30)` runs at every server startup:
- Deletes rows where `scraped_at < datetime('now', '-30 days')`
- Runs `PRAGMA incremental_vacuum` to reclaim freed pages
- Prevents unbounded table growth

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
| `initDb()` | `() → void` | Open DB, set PRAGMAs, create table + indexes, run migration |
| `cleanOldJobs()` | `(daysToKeep?) → void` | Delete old rows + incremental vacuum |
| `hasJob()` | `(job_link) → bool` | Boolean existence check (Ashby dedup) |
| `getJob()` | `(job_link) → row\|undefined` | Full row by primary key — fast-path lookup for all portals except Workday |
| `getJobByJobId()` | `(job_id) → row\|undefined` | Full row by `job_id` column — **Workday** fast-path lookup keyed by API URL |
| `upsertJob()` | `(job, portal) → void` | `INSERT OR IGNORE` single row (validates required fields) |
| `upsertJobs()` | `(jobs[], portal) → void` | Batch insert inside a single transaction (validates portal) |
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

### 6c. FilterJobs with regex cache (replaced v1 combinatorics)

**Problem:** The original `filtering-service.js` used `js-combinatorics` to generate word combinations from filter keywords, then checked each job title against O(2^n) combinations. Additionally, `new RegExp(...)` was compiled on every `containsWord()` invocation (per job, per keyword).
**Solution:** `filtering-service.js` uses `Set`-based O(1) lookups for exact matches, then falls back to `\b` word-boundary regex per keyword. A module-level `Map` caches compiled `RegExp` objects — compile once, reuse forever. Environment variables are also parsed once at module load instead of on every request.
**Impact:** ~40-60% faster filter evaluation at scale. No combinations needed. `\b` prevents substring false-positives.

### 6d. pLimit concurrency caps everywhere

**Problem:** All portals previously fired unlimited parallel requests (all companies simultaneously).
**Solution:** `pLimit(N)` wraps all company-level fetches:
- Greenhouse: `pLimit(50)` for listing pages + filter stage
- Lever: `pLimit(50)` for listing pages + individual date fetches
- Ashby: `pLimit(50)` for company scrapes + filter stage
- Workday consumer: `pLimit(20)` per batch of 150 messages
- Oracle Cloud: `pLimit(10)` (APIs are slow)
- Dice detail fetches: `pLimit(10)` for position-ID fetches

### 6e. SQLite PRAGMA tuning

**Problem:** Default SQLite settings use a 2 MB page cache, disk-based temp tables, and `synchronous = FULL`.
**Solution:** `initDb()` sets optimized PRAGMAs: 32 MB cache, memory-mapped I/O, temp tables in RAM, `synchronous = NORMAL` (safe with WAL), and incremental auto-vacuum.
**Impact:** Faster reads for cache-heavy workloads, faster writes for batch inserts.

### 6f. HTTP connection pooling

**Problem:** Each `axios.get()` call opened a new TCP+TLS connection. For portals hitting hundreds of companies on the same domain, this added significant handshake overhead.
**Solution:** `app/services/http-client.js` exports a shared axios instance with `keepAlive: true` (via `http.Agent` and `https.Agent`) and `maxSockets: 50`. TCP connections are reused across requests to the same host.
**Impact:** Significant latency reduction for multi-request portals (Greenhouse, Lever, Ashby).

### 6g. Data archival

**Problem:** The `jobs` table grows unbounded — old scraped jobs from months ago waste disk space and slow queries.
**Solution:** `cleanOldJobs(30)` runs at every server startup, deleting rows older than 30 days. `PRAGMA incremental_vacuum` reclaims freed pages gradually.
**Impact:** Prevents table bloat, keeps query performance consistent.

### 6h. Security hardening

**Problem:** Unrestricted CORS, no input validation, hardcoded email recipients, no rate limiting, no security headers.
**Solution:**

- **Rate limiting:** `app/middleware/rateLimiter.js` — scraper routes: 5 req/5 min per IP. General routes: 30 req/15 min.
- **Input validation:** `app/middleware/validate.js` — Zod schemas per route block path traversal, integer overflow, unknown fields. Returns 400 with details.
- **Security headers:** `helmet()` in `app/app.js` — sets `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, CSP.
- **CORS restriction:** `cors({ origin: CORS_ORIGIN })` — no more wildcard `*`.
- **Body size limit:** `express.json({ limit: '100kb' })` — prevents large-payload DoS.
- **Path traversal guard:** `mail-service.js` validates file paths are inside `app/data/`.
- **Email from env:** Recipient address via `EMAIL_RECIPIENT` env var (was hardcoded).
- **Log redaction:** Winston format redacts keys matching `token|key|secret|password`.
- **Request correlation ID:** `crypto.randomUUID()` attached to every request for tracing.

### 6i. Centralized error handler (`app.js`)

Added a 4-argument Express error handler after routes:
```js
app.use((err, req, res, _next) => {
    logger.error(`${req.method} ${req.path} — ${err.message}`, { reqId: req.id });
    res.status(err.status ?? 500).json({ error: { message, timestamp } });
});
```
All route handlers call `next(err)` instead of `res.status(500)` directly. `express-async-errors` eliminates the need for manual try/catch wrappers.

### 6j. Log rotation and redaction

**Problem:** Logs grew unbounded with no rotation or archival, and could potentially contain sensitive data (tokens, keys).
**Solution:** `winston-daily-rotate-file` with 14-day retention and gzip compression. A custom Winston format transform redacts values of keys matching `token|key|secret|password` before writing.

### 6k. Named filter profiles (`profile-service.js`)

`resolveFilterConfig(body)` allows callers to pass `{ "profile": "swe-us" }` to load a preset from `app/config/profiles/swe-us.json`, then optionally override individual fields with `body.filters`. This supports different filter configurations (e.g., different job titles or locations) without changing env vars.

### 6l. `updateJobDate` / `updateJobPositionId` backfill patterns

When Lever stores a job without `posting_date` (because it failed location/title), and later the same job passes with looser filters, the fast path now fetches the date and calls `updateJobDate(job_link, date)` to backfill. Same pattern for Dice's `position_id`. The `UPDATE` is guarded by `WHERE posting_date IS NULL` to avoid overwriting known-good values.

---

## 7. Known Issues / TODOs

| ID | Status | Description |
|---|---|---|
| Phase 5g | **Done** | Dead company CSV audit — implemented via `POST /cleanup` + `scripts/apply-cleanup.js`. See section 3e. |
| GH-slugs | **Done** | Replaced by the cleanup pipeline. `POST /cleanup` reports every 403/404 slug; `scripts/apply-cleanup.js --apply` removes them from CSVs. |
| Phase 6 | Pending | Unit tests — `tests/test.js` exists but content is not yet implemented. Plan: mocha + nock (HTTP mocking) + sinon (stubs). |
| Scheduling | Designed, not built | Recurring cleanup + scrape pipelines designed in [docs/scheduling.md](docs/scheduling.md). Cleanup via GitHub Actions (weekly PR), scrapers via systemd timer on EC2 (daily). |
| OracleCloud env | Missing | The Oracle Cloud service hardcodes `'oracloud'` as the file name. Should read from `process.env.FILE_ORA` for consistency. |
| RabbitMQ resilience | None | If `RABBITMQ_URL` is unset or RabbitMQ is down, the `/workday` endpoint crashes. There is no graceful degradation or fallback. |
| Dice API key | Hardcoded | `DICE_API_KEY = '1YAt0R9wBg4WfsF9VB2778F5CHLAPMVW3WAZcKd8'` is hardcoded in `dice-service.js:19`. Should be moved to `.env`. |
| http-client adoption | Partial | `app/services/http-client.js` is created but individual scrapers still import `axios` directly. Migrate each scraper to use the shared instance for full keep-alive benefit. |
| Scraper uses HTML | Pending | Greenhouse/Lever/Ashby live scrapers still hit HTML pages; consider migrating to the same JSON APIs that the cleanup probes use (more reliable, simpler parsing). |

---

## 8. Where to Start

If you are reading this cold, follow this order:

1. **`server.js`** — ~20 lines; understand startup sequence (`initDb()` → `cleanOldJobs(30)` → `listen(7777)`)
2. **`app/database/sqlite-service.js`** lines 12–28 — read the schema DDL and PRAGMAs to understand the data model and tuning
3. **`app/middleware/validate.js`** + **`rateLimiter.js`** — understand the security middleware chain
4. **`app/services/filtering-service.js`** — understand `FilterJobs`, `matchesTitle`, `matchesLocation`, `matchesPostingDate`; the regex cache and env var cache; all portals depend on this
5. **`app/services/greenhouse_v2-service.js`** — the cleanest portal service; read it top-to-bottom to understand `loadCompanies → scrapeAllCompanies → filterJobs → applyJobFilters` fast/slow path
6. **`app/services/wday-rabbit.js`** — the most complex service; producer-consumer architecture + stub pre-filter optimization
7. **`app/controllers/jobs-controller.js`** — see how `buildFilterJob(body)` + `resolveFilterConfig` wires the request body to the scraper
8. **`app/templates/blueprint-service.js`** — the copy-paste template if you need to add a new portal; all patterns are documented inline

**Key facts to keep in mind:**
- Every service exports one main function: `run{Portal}Scraper(...)`. The controller always calls that.
- `upsertJob(job, portal)` is `INSERT OR IGNORE` — calling it on a job that's already in the DB is safe and does nothing. It now also validates required fields before executing.
- SQLite `job_link` is the PRIMARY KEY for all portals **except Workday**, which uses `job_id` (the Workday API URL) as its fast-path key because `job_link` (the public URL) is only known after the detail fetch.
- `posting_date` being `NULL` in SQLite is a valid state — it means the job was stored after failing location or title, so the expensive date fetch was skipped. The backfill logic in the fast path handles this.
- Environment variables are parsed once at module load and cached as module-level arrays/Sets. Per-request overrides are handled by passing a fresh `new FilterJobs(resolveFilterConfig(body))` from the controller.
- All scraper routes pass through: `scraperLimiter` → `validateSchema` → controller handler.
