# Filter Profiles

Named filter profiles live here as JSON files. Any profile can be referenced by name in a request body.

## Profile Schema

```json
{
  "job_titles":   ["string"],   // titles to ACCEPT  (substring word-boundary match)
  "ignore_titles":["string"],   // titles to REJECT  (takes priority over job_titles)
  "countries":    ["string"],   // country names / keywords to match in location
  "states":       ["string"],   // US state names to match in location
  "states_abbr":  ["string"],   // US state abbreviations to match in location
  "posting_diff": number        // max age of posting in days
}
```

Any key omitted from a profile falls back to the value in `.env`.

## Available Profiles

| Profile | Use case | posting_diff |
|---|---|---|
| `new-grad` | Entry-level SWE roles, US | 7 days |
| `swe-us` | All levels of SWE + DevOps, US | 14 days |
| `remote-only` | Remote positions across disciplines | 7 days |
| `internship` | Internship / co-op roles, US | 14 days |
| `senior-ic` | Senior / Staff / Principal IC roles, US | 14 days |
| `example` | Full template showing all fields | 7 days |

## Request Body Examples

### Ashby (`GET /ash`)

```json
// Env defaults (no body needed)
{}

// Named profile
{ "profile": "new-grad" }

// Named profile + override posting window for this request only
{ "profile": "swe-us", "filters": { "posting_diff": 3 } }

// Fully inline (no profile file needed)
{
  "filters": {
    "job_titles": ["software engineer", "backend engineer"],
    "ignore_titles": ["senior", "staff"],
    "countries": ["usa", "remote"],
    "states": ["california", "new york"],
    "states_abbr": ["ca", "ny"],
    "posting_diff": 7
  }
}
```

### Greenhouse (`GET /greenhouse`)

```json
// Named profile
{ "profile": "swe-us" }

// Inline override — tighten to 3-day window
{ "profile": "swe-us", "filters": { "posting_diff": 3 } }
```

### Lever (`GET /lever`)

```json
// Named profile
{ "profile": "new-grad" }

// Remote internships only
{ "profile": "internship", "filters": { "countries": ["remote"] } }

// Inline
{
  "filters": {
    "job_titles": ["software engineer"],
    "countries": ["usa", "remote"],
    "posting_diff": 5
  }
}
```

### Workday (`GET /workday`)

```json
// Profile only
{ "profile": "swe-us" }

// Profile + tighter date window
{ "profile": "new-grad", "filters": { "posting_diff": 3 } }

// Inline filters
{
  "filters": {
    "job_titles": ["software engineer"],
    "countries": ["usa"],
    "posting_diff": 7
  }
}
```

### Dice (`GET /dice`)

```json
// page_number controls which results page to fetch
{ "page_number": 1, "profile": "swe-us" }

// Page 2 with a tighter filter
{ "page_number": 2, "profile": "new-grad", "filters": { "posting_diff": 1 } }

// Inline
{
  "page_number": 1,
  "filters": {
    "job_titles": ["software engineer", "swe"],
    "posting_diff": 3
  }
}
```

### Oracle Cloud (`GET /oracloud`)

```json
// Named profile
{ "profile": "swe-us" }

// Inline
{
  "filters": {
    "job_titles": ["software engineer"],
    "countries": ["usa", "remote"],
    "posting_diff": 7
  }
}
```
