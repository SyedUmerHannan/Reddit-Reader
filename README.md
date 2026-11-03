# Reddit Reader

A static, browser-based explorer for publicly archived Reddit posts and comments.

## Run locally

Open the folder with a static HTTP server (ES modules require HTTP in most browsers):

```bash
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080`. No build step or API key is required.

## Deploy with GitHub Pages

1. Place project files at the **root** of the repository branch used for Pages.
2. GitHub → **Settings → Pages** → Deploy from a branch → `main` → `/ (root)`.
3. Open the Pages URL GitHub provides.

The app is pure static HTML/CSS/JS (ES modules) and does not require a backend.

## Data source

Client queries Arctic Shift public archive endpoints:

- `https://arctic-shift.photon-reddit.com/api/posts/search?author=<username>&limit=100&sort=desc`
- `https://arctic-shift.photon-reddit.com/api/comments/search?author=<username>&limit=100&sort=desc`

Pagination uses the provider’s `before` parameter with the oldest `created_utc` from the previous page (descending sort). Timestamp-based pagination can skip items that share the exact same second if a page boundary falls inside a dense second; the app stops when a page is empty, contains only duplicates, or fails to advance the cursor.

The service may be unavailable, rate-limited, or incomplete. This app cannot retrieve never-archived or private content. It is not affiliated with Reddit.

## Features

- Username, `u/username`, `@username`, and Reddit profile URL input with strict validation
- Independent post and comment streams (separate cursors, exhaustion, errors, and retry)
- Deduplication, type tabs, text filter, sort, and load-older / retry control
- Safe rendering: archive fields are `textContent` only (no `innerHTML` of API data)
- Outbound “Open on Reddit” links only when a direct item/permalink can be built and passes an HTTPS Reddit host allowlist (no profile-URL fallback labeled as a thread link)
- JSON and CSV export of the current filtered/sorted view (formula-injection guarded CSV)
- Explicit empty vs failure messaging

## Development

### Requirements

- Node.js **≥ 18** (built-in test runner)

### Tests

```bash
npm test
```

Coverage includes username validation, link allowlisting, API response shapes, stream pagination state, export/CSV safety, and a lightweight DOM-mock check that XSS payloads stay in `textContent`.

### Project layout

```
Reddit-Reader/
├── index.html
├── styles.css
├── app.js              # UI, fetch, streams, export triggers
├── core.js             # Pure validation, streams, export builders
├── package.json
├── README.md
├── LICENSE-NOTICE.txt
├── tests/
│   └── core.test.js
└── .github/
    └── workflows/
        └── tests.yml
```

## Security notes

- Archive content is never inserted via `innerHTML` / `outerHTML` / `insertAdjacentHTML`.
- Usernames are validated before API use.
- Only HTTPS links to an explicit Reddit host allowlist become clickable.
- CSV cells that start with `=`, `+`, `-`, or `@` are prefixed so spreadsheets do not treat them as formulas.
- Errors are shown without stack traces; diagnostics go to the console.

## Limitations

- Arctic Shift has no guaranteed uptime; CORS and rate limits are provider-side.
- Browser `fetch` does not set a custom User-Agent (the live API probe from this environment used one when required).
- Timestamp cursors are the only supported pagination mechanism; same-second collisions may drop edge records.
- Rendering security tests use a minimal DOM mock in Node (no full browser automation in CI).
