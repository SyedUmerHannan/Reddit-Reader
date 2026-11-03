/**
 * Reddit Reader — pure core helpers (browser + Node testable)
 * No DOM, no fetch side-effects beyond pure transforms.
 */

'use strict';

const USERNAME_RE = /^[A-Za-z0-9_-]{1,20}$/;
const ALLOWED_REDDIT_HOSTS = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'np.reddit.com',
  'redd.it',
]);

/**
 * Normalize and validate a Reddit username or profile URL.
 * @param {unknown} raw
 * @returns {string}
 * @throws {Error}
 */
function normalizeUsername(raw) {
  if (raw == null) {
    throw new Error('Enter a Reddit username or profile URL.');
  }
  let s = String(raw).trim();
  if (!s) {
    throw new Error('Enter a Reddit username or profile URL.');
  }

  if (s.startsWith('@')) {
    s = s.slice(1).trim();
  }

  const looksLikeUrl =
    /^https?:\/\//i.test(s) ||
    /^www\./i.test(s) ||
    /^reddit\.com\//i.test(s) ||
    /^old\.reddit\.com\//i.test(s);

  if (looksLikeUrl) {
    let urlStr = s;
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = 'https://' + urlStr;
    }
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      throw new Error('That does not look like a valid Reddit profile URL.');
    }
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (
      host !== 'reddit.com' &&
      host !== 'old.reddit.com' &&
      host !== 'new.reddit.com' &&
      host !== 'np.reddit.com'
    ) {
      throw new Error('Only Reddit profile URLs are accepted (reddit.com/user/… or /u/…).');
    }
    // Require /user/NAME or /u/NAME with optional trailing slash or known profile tabs only.
    // Do not silently truncate /user/example/evil into "example".
    const pathMatch = url.pathname.match(
      /^\/(user|u)\/([A-Za-z0-9_-]{1,20})(?:\/?(?:(?:submitted|comments|about|saved|upvoted|downvoted|gilded|hidden|overview)\/?)?)?$/i
    );
    if (!pathMatch) {
      throw new Error('Only Reddit profile URLs are accepted (reddit.com/user/… or /u/…).');
    }
    s = pathMatch[2];
  } else {
    s = s.replace(/^u\//i, '').replace(/\/+$/, '');
    if (/\s/.test(s) || s.includes('/') || s.includes('?') || s.includes('#')) {
      throw new Error('Enter a valid Reddit username or profile URL.');
    }
  }

  if (!USERNAME_RE.test(s)) {
    throw new Error(
      'Username must be 1–20 characters and contain only letters, numbers, underscores, or hyphens.'
    );
  }
  return s;
}

/**
 * Validate an outbound Reddit URL. Returns a safe absolute HTTPS URL or null.
 * @param {unknown} input
 * @returns {string|null}
 */
function validateRedditLink(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  if (s.startsWith('/')) {
    if (s.startsWith('//') || /[\s<>"']/.test(s)) return null;
    if (
      !/^\/(r|user|u|comments|gallery|awards|message|wiki|search|s)\b/i.test(s) &&
      !/^\/[A-Za-z0-9_-]+\/?$/i.test(s)
    ) {
      if (
        !s.startsWith('/comments/') &&
        !s.startsWith('/r/') &&
        !s.startsWith('/user/') &&
        !s.startsWith('/u/')
      ) {
        return null;
      }
    }
    try {
      const abs = new URL(s, 'https://www.reddit.com');
      return validateRedditLink(abs.href);
    } catch {
      return null;
    }
  }

  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_REDDIT_HOSTS.has(host)) return null;

  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;

  return url.href;
}

/**
 * Normalize archive API response bodies into a plain array of records.
 * Supported: array | {data:[]} | {results:[]} | Reddit listing children.
 * @param {unknown} json
 * @returns {object[]}
 */
function normalizeApiResponse(json) {
  if (json == null) return [];
  if (Array.isArray(json)) {
    return json.filter((item) => item != null && typeof item === 'object');
  }
  if (typeof json !== 'object') {
    throw new Error('Unexpected archive response format.');
  }

  if (
    json.data &&
    typeof json.data === 'object' &&
    Array.isArray(json.data.children)
  ) {
    return json.data.children
      .map((c) => (c && typeof c === 'object' ? c.data || c : null))
      .filter((item) => item != null && typeof item === 'object');
  }

  if (Array.isArray(json.data)) {
    return json.data.filter((item) => item != null && typeof item === 'object');
  }
  if (Array.isArray(json.results)) {
    return json.results.filter((item) => item != null && typeof item === 'object');
  }

  if (
    Object.keys(json).length === 0 ||
    (json.data == null && json.results == null)
  ) {
    return [];
  }

  throw new Error('Unexpected archive response format.');
}

/**
 * Build a candidate Reddit link for a post/comment record (unvalidated).
 * Only returns a direct item/thread link when permalink or sufficient IDs exist.
 * Does NOT fall back to the user profile URL.
 * @param {object} x
 * @param {'post'|'comment'} kind
 * @returns {string|null}
 */
function buildCandidateLink(x, kind) {
  if (!x || typeof x !== 'object') return null;
  if (x.permalink) {
    const p = String(x.permalink);
    if (p.startsWith('http') || p.startsWith('/')) return p;
  }
  if (kind === 'post' && x.id) {
    const id = String(x.id).replace(/^t3_/, '');
    if (id) return 'https://www.reddit.com/comments/' + id + '/';
  }
  if (kind === 'comment' && x.link_id) {
    const linkId = String(x.link_id).replace(/^t3_/, '');
    const cid = String(x.id || '').replace(/^t1_/, '');
    if (linkId && cid) {
      return 'https://www.reddit.com/comments/' + linkId + '/_/' + cid + '/';
    }
  }
  return null;
}

function displayTitle(x, kind) {
  if (kind === 'post') {
    const t = x && x.title;
    return t != null && String(t).trim() ? String(t) : '(untitled post)';
  }
  const sub = x && x.subreddit != null ? String(x.subreddit) : 'unknown';
  return 'Comment in r/' + sub;
}

function displayBody(x, kind) {
  if (kind === 'post') {
    if (x && x.selftext != null && String(x.selftext).length) return String(x.selftext);
    if (x && x.url != null && String(x.url).length) return String(x.url);
    return '';
  }
  if (x && x.body != null) return String(x.body);
  return '';
}

function displayScore(x) {
  const n = Number(x && x.score);
  return Number.isFinite(n) ? n + ' points' : 'Score unavailable';
}

function displayDate(x) {
  const t = Number((x && (x.created_utc || x.created)) || 0);
  if (!t) return 'Date unavailable';
  try {
    return new Date(t * 1000).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return 'Date unavailable';
  }
}

function itemId(x) {
  return String(
    (x && (x.id || x.name || x.permalink)) ||
      JSON.stringify([x && x.author, x && x.created_utc, x && x.title])
  ).replace(/^t[13]_/, '');
}

function dateOf(x) {
  return Number((x && (x.created_utc || x.created)) || 0);
}

/**
 * Create independent pagination stream state.
 */
function createStream() {
  return {
    items: [],
    /** @type {number|null} next `before` cursor (oldest seen timestamp) */
    cursor: null,
    firstLoaded: false,
    loading: false,
    exhausted: false,
    /** @type {string|null} */
    lastError: null,
    seen: new Set(),
  };
}

/**
 * Merge unique rows into a stream. Returns number of newly added items.
 * Updates cursor from the oldest valid timestamp among the returned page.
 * Marks exhausted when page is empty or yields no new unique records while
 * cursor would not advance.
 * @param {ReturnType<typeof createStream>} stream
 * @param {object[]} rows
 * @param {'post'|'comment'} kind
 * @returns {{ added: number, exhaustedNow: boolean }}
 */
function applyPageToStream(stream, rows, kind) {
  const page = Array.isArray(rows) ? rows : [];
  let added = 0;
  let oldest = Infinity;

  for (const x of page) {
    if (x == null || typeof x !== 'object') continue;
    const t = dateOf(x);
    if (t > 0 && t < oldest) oldest = t;

    const key = kind + ':' + itemId(x);
    if (stream.seen.has(key)) continue;
    stream.seen.add(key);
    stream.items.push({ ...x, __kind: kind });
    added++;
  }

  stream.firstLoaded = true;
  stream.lastError = null;

  if (page.length === 0) {
    stream.exhausted = true;
    return { added, exhaustedNow: true };
  }

  if (Number.isFinite(oldest)) {
    // Prevent infinite loop if cursor does not move
    if (stream.cursor != null && oldest >= stream.cursor) {
      stream.exhausted = true;
      return { added, exhaustedNow: true };
    }
    stream.cursor = oldest;
  } else {
    // No usable timestamps — cannot paginate further safely
    stream.exhausted = true;
    return { added, exhaustedNow: true };
  }

  if (added === 0) {
    // Page had only duplicates
    stream.exhausted = true;
    return { added, exhaustedNow: true };
  }

  return { added, exhaustedNow: false };
}

/**
 * Filter + sort a list of records (shared by UI and export).
 * @param {object[]} list
 * @param {{ kind: string, filter: string, sort: string }} opts
 */
function filterAndSort(list, opts) {
  let a = Array.isArray(list) ? [...list] : [];
  const kind = opts.kind || 'all';
  if (kind === 'post') a = a.filter((x) => x.__kind === 'post');
  else if (kind === 'comment') a = a.filter((x) => x.__kind === 'comment');

  const q = (opts.filter || '').trim().toLowerCase();
  if (q) {
    a = a.filter((x) =>
      [x.title, x.selftext, x.body, x.subreddit, x.author].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(q)
      )
    );
  }

  const sort = opts.sort || 'newest';
  a.sort((x, y) => {
    if (sort === 'oldest') return dateOf(x) - dateOf(y);
    if (sort === 'score') return Number(y.score || 0) - Number(x.score || 0);
    return dateOf(y) - dateOf(x);
  });
  return a;
}

/**
 * Sanitize username for use in download filenames.
 * @param {string} user
 */
function sanitizeFilenamePart(user) {
  const s = String(user || 'user')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return s || 'user';
}

/**
 * Prefix cells that look like spreadsheet formulas so Excel/Sheets won't execute them.
 * @param {string} value
 */
function guardCsvFormula(value) {
  if (value === '' || value == null) return '';
  const s = String(value);
  // Guard formula markers even when preceded by whitespace, tabs, CR, or BOM.
  // Spreadsheets may still treat leading whitespace + formula chars as formulas.
  if (/^[\s\uFEFF\u200B\u0000-\u001F]*[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/**
 * Escape a CSV field (RFC-style quoting).
 * @param {unknown} value
 */
function csvEscape(value) {
  if (value == null) return '';
  const s = guardCsvFormula(String(value));
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build JSON export payload for current view records.
 * @param {object[]} records filtered+sorted
 * @param {string} username
 * @param {string} viewKind
 */
function buildJsonExport(records, username, viewKind) {
  return {
    exported_at: new Date().toISOString(),
    source: 'Reddit Reader (public archive)',
    username: username || null,
    view: viewKind,
    count: records.length,
    records: records.map((x) => {
      const { __kind, ...rest } = x;
      return { type: __kind || null, ...rest };
    }),
  };
}

/**
 * Build CSV string for current view records.
 * @param {object[]} records
 */
function buildCsvExport(records) {
  const headers = [
    'type',
    'id',
    'author',
    'subreddit',
    'title',
    'body',
    'created_utc',
    'score',
    'permalink',
    'url',
  ];
  const lines = [headers.join(',')];
  for (const x of records) {
    const kind = x.__kind || '';
    const body =
      kind === 'post'
        ? x.selftext != null
          ? String(x.selftext)
          : ''
        : x.body != null
          ? String(x.body)
          : '';
    const title = kind === 'post' ? (x.title != null ? String(x.title) : '') : '';
    const row = [
      csvEscape(kind),
      csvEscape(x.id != null ? x.id : ''),
      csvEscape(x.author != null ? x.author : ''),
      csvEscape(x.subreddit != null ? x.subreddit : ''),
      csvEscape(title),
      csvEscape(body),
      csvEscape(x.created_utc != null ? x.created_utc : x.created != null ? x.created : ''),
      csvEscape(x.score != null ? x.score : ''),
      csvEscape(x.permalink != null ? x.permalink : ''),
      csvEscape(x.url != null ? x.url : ''),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Export filename for a given format and view.
 */
function exportFilename(username, viewKind, format) {
  const u = sanitizeFilenamePart(username);
  const view =
    viewKind === 'post'
      ? 'posts'
      : viewKind === 'comment'
        ? 'comments'
        : 'all-activity';
  const ext = format === 'csv' ? 'csv' : 'json';
  return 'reddit-reader-' + u + '-' + view + '.' + ext;
}

export {
  normalizeUsername,
  validateRedditLink,
  normalizeApiResponse,
  buildCandidateLink,
  displayTitle,
  displayBody,
  displayScore,
  displayDate,
  itemId,
  dateOf,
  createStream,
  applyPageToStream,
  filterAndSort,
  sanitizeFilenamePart,
  guardCsvFormula,
  csvEscape,
  buildJsonExport,
  buildCsvExport,
  exportFilename,
  USERNAME_RE,
  ALLOWED_REDDIT_HOSTS,
};
