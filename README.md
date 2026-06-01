# Job Board Scraper

Scrapes six job boards simultaneously and emails you a spreadsheet of new postings — so you can apply the moment a role goes live. Research consistently shows that the first wave of applicants (within the first 24–48 hours) has the highest interview conversion rate; this tool puts you in that wave automatically.

**Supported portals:** Greenhouse · Lever · Ashby HQ · Workday · Oracle Cloud · Dice

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set EMAIL_RECIPIENT, MAILTRAP_TOKEN, and your filter keywords

# 3. Start the server
npm start
# → Server listening at http://localhost:7777
```

> **First run:** SQLite is created automatically at `app/data/jobs.db`. Jobs older than 30 days are pruned on every startup.

---

## Endpoints

All scraper endpoints accept an optional JSON body to override filters inline.

| Method | Route | Body params | What it does |
|--------|-------|-------------|--------------|
| GET | `/greenhouse` | `profile`, `filters` | Scrape Greenhouse job boards |
| GET | `/lever` | `profile`, `filters` | Scrape Lever job boards |
| GET | `/workday` | `file_name`, `profile`, `filters` | Scrape Workday (requires RabbitMQ) |
| GET | `/dice` | `page_number`, `profile`, `filters` | Scrape Dice.com |
| GET | `/oracloud` | `profile`, `filters` | Scrape Oracle Cloud |
| GET | `/ash` | `profile`, `filters` | Scrape Ashby HQ |
| POST | `/cleanup` | `portals` (optional) | Probe every company; flag 403/404 slugs into a report |
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

## Maintaining the Company Lists

Each portal except Dice is multi-tenant and requires a list of company slugs/IDs in `app/companies/<portal>/`. Companies regularly move ATSes or shut down their boards, leaving 404s in the lists. The project ships three tools to keep these lists clean:

| Tool | What it does |
|---|---|
| `python scripts/cleanup.py` | Probes every company via each portal's JSON API. Writes `reports/stale-companies-<date>.csv` with `stale` (404/403) and `unknown` (5xx/timeout) rows. Pass `--apply` to also remove stale slugs from company files. |
| `python scripts/find_portal.py` | For each slug, probes other portals to see where the company moved (e.g. Greenhouse → Ashby). Writes `reports/portal-discovery-<date>.csv`. Pass `--apply` to append hits directly to the matching portal CSV. Pass `--from-names FILE` to start from company names instead of slugs. |

**End-to-end workflow:**
```bash
# 1. Probe + remove stale (per-portal for clean reports)
for p in greenhouse lever ashby; do
  python scripts/cleanup.py --portals $p --apply
done

# 2. Discover re-home matches and write directly to portal CSVs
python scripts/find_portal.py --apply

# 3. Review the diff and commit
git diff app/companies/
```

See [CLAUDE.md](./CLAUDE.md) for the full end-to-end flow including per-portal runs and combining reports.

---

## Adding a New Portal

Copy `app/templates/blueprint-service.js` — all patterns (fast/slow SQLite cache path, filter pipeline, metrics, Excel output) are documented inline. Wire it in `app/routes/jobs-router.js` and `app/controllers/jobs-controller.js`.

---

## Architecture

For a detailed walkthrough of the request lifecycle, fast/slow cache path, Workday producer-consumer pipeline, filtering internals, and SQLite schema, see [CONTEXT.md](./CONTEXT.md).

---

## Running Tests

```bash
npm test
```

Uses Mocha + Supertest. Test file: `tests/test.js`.
