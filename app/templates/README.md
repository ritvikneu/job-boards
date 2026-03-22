# Job Portal Service Blueprint

`blueprint-service.js` is the canonical template for adding a new job portal scraper to this project. Every production service (`greenhouse_v2`, `lever`, `ash2`, `wday-rabbit`, `oraclecloud`, `dice`) follows the exact same architecture defined here.

---

## Architecture

Every portal service has **five stages**:

```
loadCompanies
    │
    ▼
fetchJobsForCompany  ──(pLimit)──► one per company, parallel
    │
    ▼
mapJob               ──────────► normalise to canonical shape
    │
    ▼
applyJobFilters      ──────────► SQLite fast/slow path + FilterJobs
    │
    ▼
writeToExcel         ──────────► only if filteredJobs.length > 0
```

---

## Filtering Criteria

All filter rules are driven by `.env` (or per-request body overrides). The `FilterJobs` class from `filtering-service-v2.js` exposes three checks:

| Method | Env var(s) | What it checks |
|---|---|---|
| `matchesLocation(location)` | `COUNTRIES`, `STATES`, `STATES_ABBR` | Word-boundary keyword match in the location string |
| `matchesTitle(title)` | `JOB_TITLES`, `IGNORE_TITLES` | Title contains an accepted keyword AND no ignored keyword |
| `matchesPostingDate(date)` | `POSTING_DIFF` | ISO date is within the last N days |

**Cheapest-first order in `applyJobFilters`:**
1. `matchesLocation` — instant string scan
2. `matchesTitle` — instant string scan
3. `matchesPostingDate` — date arithmetic
4. Detail HTTP fetch (if posting_date is only available after a second request) — **only if steps 1–2 pass**

---

## SQLite Fast / Slow Path

| Run | Path | Behaviour |
|---|---|---|
| First run — new job | **Slow** | Store job unconditionally → apply filters → return if passing |
| Any run — seen job | **Fast** | `getJob(job_link)` returns cached row → re-filter in memory, zero HTTP |
| Fast path, NULL date | **Backfill** | Re-fetch date once, write via `updateJobDate()`, then filter |

This means: on the **first run** every job is stored. On every **subsequent run** the consumer stage makes zero HTTP calls for previously-seen jobs.

---

## Canonical Job Shape

All portal services normalise their raw stubs to this shape before storing or filtering:

```js
{
    job_id:       string | null,   // portal's internal ID (fast-path key for Workday)
    job_title:    string,          // plain-text title fed to matchesTitle()
    job_link:     string,          // public URL — PRIMARY KEY in SQLite
    location:     string,          // location string fed to matchesLocation()
    posting_date: string | null,   // ISO "YYYY-MM-DD" or null
    company_name: string,          // display name
}
```

---

## How to Add a New Portal

1. **Copy** `blueprint-service.js` → `app/services/<portal>-service.js`
2. **Set** `PORTAL_NAME`, `BASE_URL`, and `MAX_CONCURRENCY`
3. **Implement** `loadCompanies` — CSV or JSON loader
4. **Implement** `fetchJobsForCompany` — API call or jsdom scrape with 429 retry
5. **Fill in** `mapJob` — map portal fields to the canonical shape
6. **Decide** on date availability:
   - Date in stub → remove `fetchJobDetails` call from `applyJobFilters`
   - Date requires detail fetch → uncomment and implement `fetchJobDetails`
7. **Rename** `runPortalScraper` → `run<PortalName>Scraper`
8. **Add route** in `app/routes/jobs-router.js`
9. **Add controller** in `app/controllers/jobs-controller.js`
10. **Add companies file** in `app/companies/<portal>/`

---

## Scraping Patterns Quick Reference

### REST API (JSON response)
```js
const res = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });
return res.data?.jobs ?? [];
```

### Paginated POST API (Workday style)
```js
const stubs = [];
let offset  = 0;
while (true) {
    const res  = await axios.post(company.link, { offset, limit: 20 });
    const page = res.data?.jobPostings ?? [];
    stubs.push(...page);
    if (page.length < 20) break;
    offset += 20;
}
return stubs;
```

### Web Scraping — embedded JSON (Greenhouse style)
```js
import { JSDOM } from 'jsdom';
const res  = await axios.get(company.link, { timeout: REQUEST_TIMEOUT_MS });
const dom  = new JSDOM(res.data);
const el   = dom.window.document.querySelector('script#__NEXT_DATA__');
const json = JSON.parse(el.textContent);
return json.props.pageProps.jobs ?? [];
```

### Date Format Conversions
```js
// ISO timestamp (Greenhouse / Lever)
new Date(raw.updated_at).toISOString().split('T')[0]

// Unix milliseconds (Dice)
new Date(raw.postedDate).toISOString().split('T')[0]

// Already ISO date (Workday / Oracle Cloud)
raw.startDate   // "2026-03-10" — use as-is

// Relative string (Workday listing stubs)
// use parsePostedOn() from wday-rabbit.js
```
