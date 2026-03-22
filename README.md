# Job Boards Scraper

Node.js/Express API that aggregates software job listings from multiple company job boards, filters them by location, title, and recency, and writes results to Excel.

---

## Stack

| Layer | Technology |
|---|---|
| HTTP server | Express 4 |
| Scraping | axios + jsdom |
| Filtering | Custom `FilterJobs` (v2) with word-boundary matching |
| Deduplication / caching | better-sqlite3 (WAL mode) |
| Queue | RabbitMQ via amqplib (Workday only) |
| Concurrency | p-limit |
| Logging | Winston structured JSON |
| Metrics | StatsD via hot-shots |
| Output | ExcelJS (.xlsx) |
| Email | Nodemailer + Mailtrap |

---

## Project Structure

```
app/
├── app.js                        Express setup (cors, json, routes)
├── controllers/
│   └── jobs-controller.js        Route handlers — builds FilterJobs, calls services
├── routes/
│   └── jobs-router.js            Route definitions
├── services/
│   ├── filtering-service-v2.js   FilterJobs: matchesLocation / matchesTitle / matchesPostingDate
│   ├── profile-service.js        Named filter profile resolution
│   ├── greenhouse_v2-service.js  Greenhouse Standard scraper
│   ├── lever-service.js          Lever scraper
│   ├── ash2-service.js           Ashby HQ scraper
│   ├── wday-rabbit.js            Workday scraper (RabbitMQ producer-consumer)
│   ├── oraclecloud-service.js    Oracle Cloud scraper
│   ├── dice-service.js           Dice.com scraper
│   ├── file_creation-service.js  Excel writer + email sender (getLatestJobs)
│   ├── mail-service.js           Nodemailer transport
│   └── rabbitMQ-service.js       RabbitMQ connection helpers
├── database/
│   └── sqlite-service.js         SQLite schema, read/write helpers, fast-path cache
├── middleware/
│   ├── logger.js                 createCustomLogger(name) → Winston instance
│   └── metrics.js                recordScrapeMetrics / recordScrapeError → StatsD
├── companies/                    Company lists per portal
│   ├── greenhouse/
│   ├── lever/
│   ├── ashby/
│   ├── workday/
│   └── oracle/
└── templates/
    ├── blueprint-service.js      Copy-paste template for a new portal scraper
    └── README.md                 How to use the template + pattern reference
```

---

## API Routes

All routes accept `GET` with a JSON body.

| Route | Service | Body params |
|---|---|---|
| `GET /greenhouse` | `greenhouse_v2-service` | `embed` (bool), filter overrides |
| `GET /lever` | `lever-service` | filter overrides |
| `GET /ash` | `ash2-service` | filter overrides |
| `GET /workday` | `wday-rabbit` | `file_name` (string), filter overrides |
| `GET /dice` | `dice-service` | `page_number` (int), filter overrides |
| `GET /oracloud` | `oraclecloud-service` | filter overrides |
| `GET /latest` | `file_creation-service` | — (sends email with latest results) |
| `GET /health` | — | — (returns `HEALTH_CHECK` env var) |

### Filter override body
Every scraper endpoint accepts optional filter overrides in the request body:

```json
{
    "profile": "swe",
    "filters": {
        "job_titles":    ["engineer", "analyst"],
        "ignore_titles": ["intern", "manager"],
        "countries":     ["united states"],
        "states":        ["california", "new york", "remote"],
        "states_abbr":   ["ca", "ny", "tx"],
        "posting_diff":  10
    }
}
```

Resolution order: `body.filters` → `body.profile` (named profile from `app/profiles/`) → `.env` defaults.

---

## Environment Variables

### Filtering (required)

| Variable | Example | Description |
|---|---|---|
| `JOB_TITLES` | `engineer,analyst,developer` | Comma-separated title keywords (must include one) |
| `IGNORE_TITLES` | `intern,manager,director` | Comma-separated title keywords (disqualifies job) |
| `COUNTRIES` | `united states,canada` | Country keywords for location matching |
| `STATES` | `california,new york,remote` | Full state names for location matching |
| `STATES_ABBR` | `ca,ny,tx,remote` | State abbreviations for location matching |
| `POSTING_DIFF` | `10` | Max job age in days |

### Company file names

| Variable | Default | Description |
|---|---|---|
| `FILE_GH` | — | Greenhouse standard company file (no extension) |
| `FILE_EMBED` | — | Greenhouse embed company file |
| `FILE_LEVER` | — | Lever company file |
| `FILE_ASH` | — | Ashby company file |
| `FILE_WDAY` | `wday1` | Workday company file (wday1 or wday2) |
| `WORKDAY_OFFSET` | `200` | Max jobs scraped per Workday company |

### Infrastructure

| Variable | Description |
|---|---|
| `RABBITMQ_URL` | RabbitMQ connection string (required for Workday) |
| `STATSD_HOST` | StatsD server host |
| `STATSD_PORT` | StatsD server port |
| `HEALTH_CHECK` | String returned by `GET /health` |
| `SMTP_HOST` | Mail server host |
| `SMTP_PORT` | Mail server port |

---

## Getting Started

```bash
# Install dependencies
pnpm install

# Copy and fill in environment variables
cp .env.example .env

# Start the server (port 7777)
pnpm start

# Run tests
pnpm test
```

---

## Performance Design

### SQLite fast / slow path (all portals)
Every job is stored to SQLite on first encounter. Subsequent runs return the cached row immediately — zero HTTP calls per previously-seen job.

### Workday stub pre-filter
Before queueing individual job-detail fetches, the producer applies `matchesTitle` and `matchesLocation` against the listing stubs (which already contain `title`, `locationsText`, `postedOn`). This eliminates ~85–90 % of the ~15 000 stubs before the expensive consumer stage, cutting first-run time from ~28 min to ~3–4 min.

### Concurrency
`pLimit` caps parallel requests per service. Typical values: 50 (listing pages), 10–20 (detail fetches). Workday consumer uses `pLimit(20)` per batch of 150 messages.

---

## Adding a New Portal

See [`app/templates/blueprint-service.js`](app/templates/blueprint-service.js) and its [`README`](app/templates/README.md) for the step-by-step guide and all scraping patterns.
