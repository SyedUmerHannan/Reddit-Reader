# Reddit Reader

A static, browser-based explorer for publicly archived Reddit posts and comments.

## Run locally
Open `index.html` in a modern browser, or serve the folder with any static HTTP server. No build step or API key is required.

## Deploy with GitHub Pages
1. Add the files in this folder to the root of `SyedUmerHannan/Reddit-Reader`.
2. In GitHub, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Open the Pages URL GitHub provides.

## Data source
The client queries Arctic Shift's public archive endpoints:
- `/api/posts/search?author=<username>&limit=100`
- `/api/comments/search?author=<username>&limit=100`

The service may be unavailable, rate-limited, or have incomplete historical coverage. This app cannot retrieve content that was never archived and does not bypass private accounts or access controls. It is not affiliated with Reddit.

## Current MVP
- Username, `u/username`, and Reddit profile URL input
- Posts and comments loaded from public archive endpoints
- Deduplication, type filters, text filtering, sorting, and load-older control
- Direct links to source threads where available
- Responsive interface and explicit archive-coverage disclaimer

## Next engineering steps
- Verify the current Arctic Shift API response shape and cursor semantics against live responses.
- Add automated tests for username parsing, deduplication, pagination, and safe rendering.
- Add retry/backoff and independent pagination state per content type.
- Add a source-status indicator and export-to-JSON/CSV.
