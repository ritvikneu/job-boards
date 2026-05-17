# Scripts Directory

Utility scripts for testing, validation, and maintenance.

## `validate-companies.js`

Validates all company CSV/JSON files by testing if each company's job board page is still active (200) or dead (404).

**Usage:**
```bash
# Validate all portals
node scripts/validate-companies.js

# Validate one portal
node scripts/validate-companies.js greenhouse
node scripts/validate-companies.js lever
node scripts/validate-companies.js ashby
node scripts/validate-companies.js workday
node scripts/validate-companies.js oracloud
```

**Output:**
```
GREENHOUSE — Greenhouse job board
════════════════════════════════════════════════════════════════════════════════
Total: 150 | Alive: 145 | Dead (404): 5 | Other errors: 0

⚠️  DEAD COMPANIES (should remove from CSV):
  404  stripe
  404  figma
  ...
```

**Why:** Over time, companies move domains, restructure their careers pages, or stop using job boards. This identifies which company slugs return 404 so you can remove them from the CSV files.

---

## `test-scrapers.js`

Integration test suite for all scraper endpoints. Starts the server and validates:
- ✓ All endpoints respond with correct HTTP status
- ✓ Health check works without auth
- ✓ Missing/invalid API key returns 401
- ✓ Each scraper returns valid job data

**Usage:**
```bash
# Run with defaults (reads API_KEY from .env)
node scripts/test-scrapers.js

# Use a custom API key
node scripts/test-scrapers.js --api-key your-key-here

# Use a stricter posting_diff filter
node scripts/test-scrapers.js --filter-diff 3
```

**Output:**
```
✓ GET /health [200]
✓ GET /greenhouse (no filters) [200]
  → 42 jobs returned
✓ GET /greenhouse (with posting_diff filter) [200]
  → 18 jobs returned
✓ GET /lever [200]
  → 12 jobs returned
...

Results: 9 passed, 0 failed
✓ All tests passed!
```

---

## When to Run

| Scenario | Script | Frequency |
|----------|--------|-----------|
| New company signup or company restructures | `validate-companies.js` | Monthly or after seeing 404 errors |
| Pre-deployment validation | `test-scrapers.js` | Before each release |
| Scheduled maintenance | `validate-companies.js` | Quarterly audit |
| Troubleshooting a scraper | `test-scrapers.js` | On-demand |
