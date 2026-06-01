# Job Dashboard — Design Spec

**Date:** 2026-05-31
**Status:** Approved

---

## Purpose

A lightweight browser dashboard for daily triage of scraped job data stored in SQLite. Primary workflow: open each morning, scan new jobs, mark each one with a pipeline status, click through to apply.

---

## Architecture

Three additions to the existing Express/SQLite project. No new frameworks or build steps.

### 1. SQLite — `user_status` column

Add `user_status TEXT NOT NULL DEFAULT 'new'` to the `jobs` table via the existing migration pattern in `sqlite-service.js`.

Valid values: `new` | `interested` | `applied` | `saved` | `rejected`

All existing rows default to `'new'` on migration.

### 2. Backend — two new endpoints

**`GET /jobs`**

Returns all jobs active within the last 30 days as a flat JSON array. No pagination — client handles filtering and sorting in memory. The 30-day window matches `cleanOldJobs` so the payload is bounded.

Query:

```sql
SELECT * FROM jobs
WHERE COALESCE(last_seen_at, scraped_at) >= datetime('now', '-30 days')
ORDER BY scraped_at DESC
```

Uses `COALESCE(last_seen_at, scraped_at)` because `scraped_at` is frozen at first-insert — actively-scraped jobs update `last_seen_at` via `touchJob`. This matches the `cleanOldJobs` window exactly.

Response: array of objects with shape:

```json
{
  "job_link": "https://...",
  "job_title": "Software Engineer",
  "company_name": "Stripe",
  "location": "San Francisco, CA",
  "posting_date": "2026-05-31",
  "portal": "ashby",
  "scraped_at": "2026-05-31T05:22:29",
  "user_status": "new"
}
```

**`PATCH /jobs/status`**

Updates a single job's `user_status`. Body: `{ "job_link": "...", "status": "interested" }`. Validates that `status` is one of the five allowed values. Returns `{ ok: true }`.

Both routes use the existing `generalLimiter`.

### 3. Frontend — static files served from Express

`app.use(express.static('front-end'))` added to `app/app.js` (already on port 7777).

```text
front-end/
  index.html   — app shell: top bar, filter toolbar, table skeleton
  app.js       — data fetching, client-side filter/sort, status updates, rendering
  style.css    — all styles
```

---

## UI Layout

Full-width table (GitHub Issues style). No sidebar.

### Top bar (dark)

- Brand: "Job Board"
- Stats: `{n} new` (count of rows where `user_status = 'new'`), `{total} total`
- Last scraped: max `last_seen_at` across the loaded dataset

### Filter toolbar

- Search box — filters `job_title` and `company_name` client-side (debounced 200ms)
- Portal pills — `All` | `Ashby` | `Greenhouse` | `Lever` | `Oracle` | `Dice` | `Workday`
- Status pills — `New` | `Interested` | `Applied` | `Saved` | `Rejected` | `All`
- Sort dropdown — `Newest first` | `Oldest first` | `Company A–Z`

All filtering and sorting runs against `window.__jobs` in memory — no extra network calls.

### Table columns

| Column | Notes |
| --- | --- |
| Status | Clickable badge — cycles `new → interested → applied → saved → rejected → new`; fires `PATCH /jobs/status` |
| Title | Link — opens `job_link` in new tab |
| Company | Plain text |
| Location | Plain text |
| Portal | Colour-coded badge per portal |
| Posted | `posting_date`; shows "Today" when date matches current date |

Rows with `user_status = 'new'` get a blue left border (3px) so they stand out during triage.

### Behaviour

- Page loads → `GET /jobs` → store in `window.__jobs` → render
- Filter/sort changes → re-filter `window.__jobs` in memory → re-render table (no network call)
- Status badge click → optimistic UI update → `PATCH /jobs/status` → on error, revert badge
- Title click → `window.open(job_link, '_blank')`

---

## Files Changed

| File | Change |
| --- | --- |
| `app/database/sqlite-service.js` | Add `user_status` migration, `queryJobs()`, `updateJobStatus()` |
| `app/controllers/jobs-controller.js` | Add `getJobsView()`, `updateJobStatus()` handlers |
| `app/routes/jobs-router.js` | Add `GET /jobs`, `PATCH /jobs/status` routes |
| `app/app.js` | Add `express.static('front-end')` |
| `front-end/index.html` | Replace placeholder with full app shell |
| `front-end/app.js` | New — all client logic |
| `front-end/style.css` | New — all styles |

---

## Out of Scope

- Authentication / access control (local tool, no auth needed)
- Mobile layout
- Bulk status update
- Export to CSV/Excel from the UI (existing Excel output from scrapers is unchanged)
- Real-time updates (manual refresh or on page load)
