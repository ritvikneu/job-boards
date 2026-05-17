# Job Board Scraper

Scrapes six job boards simultaneously and emails you a spreadsheet of new postings — so you can apply the moment a role goes live. Research consistently shows that the first wave of applicants (within the first 24–48 hours) has the highest interview conversion rate; this tool puts you in that wave automatically.

**Supported portals:** Greenhouse · Lever · Ashby HQ · Workday · Oracle Cloud · Dice

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set EMAIL_RECIPIENT, MAILTRAP_TOKEN, and your filter keywords

# 3. Start the server
pnpm start
# → Server listening at http://localhost:7777
```

> **First run:** SQLite is created automatically at `app/data/jobs.db`. Jobs older than 30 days are pruned on every startup.

---

## Endpoints

All scraper endpoints accept an optional JSON body to override filters inline.

| Method | Route | Body params | What it does |
|--------|-------|-------------|--------------|
| GET | `/greenhouse` | `embed`, `profile`, `filters` | Scrape Greenhouse job boards |
| GET | `/lever` | `profile`, `filters` | Scrape Lever job boards |
| GET | `/workday` | `file_name`, `profile`, `filters` | Scrape Workday (requires RabbitMQ) |
| GET | `/dice` | `page_number`, `profile`, `filters` | Scrape Dice.com |
| GET | `/oracloud` | `profile`, `filters` | Scrape Oracle Cloud |
| GET | `/ash` | `profile`, `filters` | Scrape Ashby HQ |
| GET | `/latest` | — | Email today's Excel file to `EMAIL_RECIPIENT` |
| GET | `/health` | — | Returns `HEALTH_CHECK` env value |

**Example:**
```bash
curl -X GET http://localhost:7777/greenhouse \
  -H "Content-Type: application/json" \
  -d '{"filters": {"posting_diff": 3, "job_titles": ["engineer", "developer"]}}'
```

---

## Filter Configuration

Filters determine which jobs make it into your spreadsheet. Three levels of priority:

```
body.filters (inline)  >  body.profile (preset file)  >  .env vars (defaults)
```

### Environment variable defaults

```env
JOB_TITLES="engineer,developer,analyst"      # accept jobs containing these words
IGNORE_TITLES="intern,manager,director"       # reject jobs containing these words
COUNTRIES="united states,remote"             # accepted country names
STATES="california,new york,texas,remote"    # accepted state names
STATES_ABBR="ca,ny,tx"                       # accepted state abbreviations
POSTING_DIFF=10                              # only jobs posted within N days
```

Matching uses word-boundary rules — `"engineer"` matches `"Software Engineer"` but not `"reengineering"`.

### Inline override (per-request)

```bash
curl ... -d '{"filters": {"posting_diff": 1, "states": ["remote"]}}'
```

### Named profiles

Save a preset to `app/config/profiles/swe-remote.json`:
```json
{
  "job_titles": ["engineer", "developer"],
  "states": ["remote"],
  "posting_diff": 2
}
```

Then reference it:
```bash
curl ... -d '{"profile": "swe-remote"}'
```

---

## Getting Notified

After running any scraper, the results are written to `app/data/Jobs_<date>.xlsx` with one tab per portal. Call `/latest` to have the file emailed to you:

```bash
curl http://localhost:7777/latest
```

Configure the email destination in `.env`:
```env
EMAIL_RECIPIENT=you@example.com
MAILTRAP_TOKEN=your-mailtrap-token   # from https://mailtrap.io
```

---

## Workday Setup

The `/workday` endpoint uses RabbitMQ to distribute job-detail fetches across parallel workers. Start RabbitMQ before calling it:

```bash
docker run -d --hostname rabbit --name rabbitmq \
  -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

Or with Docker Compose:
```bash
docker compose up -d
```

Set in `.env`:
```env
RABBITMQ_URL=amqp://localhost
WORKDAY_OFFSET=200   # max job stubs to fetch per company
```

---

## Adding a New Portal

Copy `app/templates/blueprint-service.js` — all patterns (fast/slow SQLite cache path, filter pipeline, metrics, Excel output) are documented inline. Wire it in `app/routes/jobs-router.js` and `app/controllers/jobs-controller.js`.

---

## Architecture

For a detailed walkthrough of the request lifecycle, fast/slow cache path, Workday producer-consumer pipeline, filtering internals, and SQLite schema, see [CONTEXT.md](./CONTEXT.md).

---

## Running Tests

```bash
pnpm test
```

Uses Mocha + Supertest. Test file: `tests/test.js`.
