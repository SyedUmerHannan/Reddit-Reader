/**
 * Reddit Reader — application UI (browser only)
 * Independent post/comment streams, safe rendering, JSON/CSV export.
 */

'use strict';

import {
  normalizeUsername,
  validateRedditLink,
  normalizeApiResponse,
  buildCandidateLink,
  displayTitle,
  displayBody,
  displayScore,
  displayDate,
  createStream,
  applyPageToStream,
  filterAndSort,
  buildJsonExport,
  buildCsvExport,
  exportFilename,
} from './core.js';

const API = 'https://arctic-shift.photon-reddit.com/api';
const PAGE_SIZE = 100;
const $ = (id) => document.getElementById(id);

const state = {
  user: '',
  kind: 'all', // all | post | comment
  posts: createStream(),
  comments: createStream(),
  /** True after at least one successful completed search attempt (even if empty). */
  searchAttempted: false,
};

/**
 * Create a text-only element (no HTML interpretation of content).
 * Exported path for rendering-security tests via same contract.
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function streamFor(kind) {
  return kind === 'post' ? state.posts : state.comments;
}

function anyLoading() {
  return state.posts.loading || state.comments.loading;
}

async function fetchPage(kind, cursor) {
  const endpoint = kind === 'post' ? '/posts/search' : '/comments/search';
  const params = new URLSearchParams({
    author: state.user,
    limit: String(PAGE_SIZE),
    sort: 'desc',
  });
  if (cursor != null) params.set('before', String(cursor));

  let response;
  try {
    response = await fetch(API + endpoint + '?' + params, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    console.error('[Reddit Reader] Network error', kind, err);
    throw new Error(
      'Could not reach the archive service. Check your connection or try again later.'
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Archive rate limit reached. Wait briefly and try again.');
    }
    console.error('[Reddit Reader] HTTP', response.status, kind);
    throw new Error(
      'Archive request failed (' + response.status + '). The service may be unavailable.'
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    console.error('[Reddit Reader] Invalid JSON', kind, err);
    throw new Error('Archive returned invalid data. Try again later.');
  }

  try {
    return normalizeApiResponse(json);
  } catch (err) {
    console.error('[Reddit Reader] Unexpected response shape', kind, json);
    throw err;
  }
}

/**
 * Load next page for one stream. Independent of the other stream.
 * @param {'post'|'comment'} kind
 * @param {boolean} isInitial
 */
async function loadStream(kind, isInitial) {
  const stream = streamFor(kind);
  if (stream.loading) return { added: 0, error: null };
  if (!isInitial && stream.exhausted) return { added: 0, error: null };

  stream.loading = true;
  stream.lastError = null;
  updateControls();

  try {
    const cursor = isInitial ? null : stream.cursor;
    const rows = await fetchPage(kind, cursor);
    const result = applyPageToStream(stream, rows, kind);
    return { added: result.added, error: null };
  } catch (err) {
    const msg = (err && err.message) || 'Request failed.';
    stream.lastError = msg;
    stream.firstLoaded = true; // attempt completed (failed)
    console.error('[Reddit Reader]', kind, err);
    return { added: 0, error: msg };
  } finally {
    stream.loading = false;
  }
}

function mergedView() {
  const all = [...state.posts.items, ...state.comments.items];
  return filterAndSort(all, {
    kind: state.kind,
    filter: $('filterText') ? $('filterText').value : '',
    sort: $('sort') ? $('sort').value : 'newest',
  });
}

/**
 * Render one result card using only createElement + textContent.
 */
function createCard(x) {
  const kind = x.__kind;
  const title = displayTitle(x, kind);
  const body = displayBody(x, kind);
  const when = displayDate(x);
  const score = displayScore(x);
  const sub = x.subreddit != null ? String(x.subreddit) : 'unknown';

  const card = el('article', 'item');

  const head = el('div', 'itemhead');
  head.append(
    el('span', 'kind', kind === 'post' ? 'Post' : 'Comment'),
    el('span', 'sub', 'r/' + sub),
    el('span', null, '·'),
    el('span', null, when)
  );
  card.append(head);

  card.append(el('h3', null, title));

  if (body) {
    card.append(el('div', 'body', body));
  } else {
    card.append(el('div', 'body quiet', 'No text content available.'));
  }

  const foot = el('div', 'itemfoot');
  foot.append(el('span', null, score));

  const candidate = buildCandidateLink(x, kind);
  const safeHref = validateRedditLink(candidate);
  if (safeHref) {
    const a = el('a', null, 'Open on Reddit ↗');
    a.href = safeHref;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    foot.append(a);
  }

  if (body.length > 260) {
    const btn = el('button', 'tab expand', 'Expand text');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const bodyNode = card.querySelector('.body');
      if (!bodyNode) return;
      const open = bodyNode.classList.toggle('expanded');
      btn.textContent = open ? 'Collapse text' : 'Expand text';
    });
    foot.append(btn);
  }

  card.append(foot);
  return card;
}

/**
 * Empty-state message that never confuses API failure with "no activity".
 */
function emptyStateMessage() {
  const p = state.posts;
  const c = state.comments;
  const bothAttempted = p.firstLoaded && c.firstLoaded;
  const bothFailed = p.lastError && c.lastError && p.items.length === 0 && c.items.length === 0;
  const anyFailed = p.lastError || c.lastError;
  const anyItems = p.items.length + c.items.length > 0;
  const filterActive = ($('filterText') && $('filterText').value.trim()) || state.kind !== 'all';

  if (!state.searchAttempted) {
    return 'Search for a username to begin.';
  }
  if (bothFailed) {
    return 'Could not load archive data. See status message above and try again.';
  }
  if (!anyItems && anyFailed && bothAttempted) {
    return 'Could not load archive data for this view. See status message above.';
  }
  if (!anyItems && bothAttempted && !anyFailed) {
    return 'No archived posts or comments were returned for this username.';
  }
  if (anyItems && filterActive) {
    return 'No matching items for the current filter or tab. Try another filter or view.';
  }
  if (!anyItems) {
    return 'No results to show yet.';
  }
  return 'No matching items for the current filter or tab.';
}

function statusMessage(loadResults) {
  const p = state.posts;
  const c = state.comments;
  const parts = [];

  if (loadResults) {
    const { post, comment } = loadResults;
    if (post && post.error) parts.push('Posts: ' + post.error);
    if (comment && comment.error) parts.push('Comments: ' + comment.error);
    const added = (post ? post.added : 0) + (comment ? comment.added : 0);
    if (added > 0) parts.push('Loaded ' + added + ' new item' + (added === 1 ? '' : 's') + '.');
    if (
      !parts.length &&
      ((post && post.added === 0 && !post.error) || (comment && comment.added === 0 && !comment.error))
    ) {
      if (p.exhausted && c.exhausted) {
        parts.push('No additional archived items available.');
      } else if (
        (state.kind === 'post' && p.exhausted) ||
        (state.kind === 'comment' && c.exhausted)
      ) {
        parts.push('No additional items available for this view.');
      } else {
        parts.push('No new items in this page.');
      }
    }
  }

  if (p.lastError && !loadResults) parts.push('Posts: ' + p.lastError);
  if (c.lastError && !loadResults) parts.push('Comments: ' + c.lastError);

  if (!parts.length) {
    if (anyLoading()) return 'Loading…';
    if (p.exhausted && c.exhausted && p.items.length + c.items.length > 0) {
      return 'All available pages loaded for this username.';
    }
    return '';
  }
  return parts.join(' ');
}

function canLoadMore() {
  if (anyLoading()) return false;
  if (!state.searchAttempted) return false;
  if (state.kind === 'post') return !state.posts.exhausted || !!state.posts.lastError;
  if (state.kind === 'comment') return !state.comments.exhausted || !!state.comments.lastError;
  // all
  const postsNeed =
    !state.posts.exhausted || !!state.posts.lastError;
  const commentsNeed =
    !state.comments.exhausted || !!state.comments.lastError;
  return postsNeed || commentsNeed;
}

function loadMoreLabel() {
  if (anyLoading()) return 'Loading…';
  const pFail = !!state.posts.lastError && !state.posts.exhausted;
  const cFail = !!state.comments.lastError && !state.comments.exhausted;
  if (state.kind === 'post' && state.posts.lastError) return 'Retry posts';
  if (state.kind === 'comment' && state.comments.lastError) return 'Retry comments';
  if (state.kind === 'all' && (pFail || cFail)) return 'Retry failed streams';
  return 'Load older activity';
}

function updateControls() {
  const loading = anyLoading();
  $('searchBtn').disabled = loading;
  const loadMore = $('loadMore');
  loadMore.disabled = !canLoadMore() || loading;
  loadMore.textContent = loadMoreLabel();

  const showLoad = state.searchAttempted;
  $('loadRow').classList.toggle('hidden', !showLoad);

  const items = mergedView();
  const hasExport = items.length > 0;
  const expJson = $('exportJson');
  const expCsv = $('exportCsv');
  if (expJson) expJson.disabled = !hasExport || loading;
  if (expCsv) expCsv.disabled = !hasExport || loading;
}

function render(loadResults) {
  $('postCount').textContent = String(state.posts.items.length);
  $('commentCount').textContent = String(state.comments.items.length);
  $('totalCount').textContent = String(
    state.posts.items.length + state.comments.items.length
  );

  const items = mergedView();
  const results = $('results');
  results.replaceChildren();

  if (!items.length) {
    results.append(el('div', 'empty', emptyStateMessage()));
  } else {
    const frag = document.createDocumentFragment();
    for (const x of items) {
      try {
        frag.append(createCard(x));
      } catch (err) {
        console.warn('[Reddit Reader] Skipping malformed record', err);
      }
    }
    results.append(frag);
  }

  const status = statusMessage(loadResults);
  if (status) $('status').textContent = status;
  else if (!anyLoading() && state.searchAttempted && items.length) {
    // keep previous status if useful; otherwise clear transient noise
  }

  updateControls();
}

/**
 * @param {boolean} reset  true = new search
 */
async function search(reset) {
  if (anyLoading()) return;

  if (reset) {
    try {
      state.user = normalizeUsername($('username').value);
    } catch (e) {
      $('status').textContent = e.message || 'Invalid username.';
      return;
    }
    state.posts = createStream();
    state.comments = createStream();
    state.searchAttempted = false;
    $('profileName').textContent = 'u/' + state.user;
    $('profile').style.display = 'block';
    $('toolbar').style.display = 'flex';
    history.replaceState(null, '', '#' + encodeURIComponent(state.user));
    $('status').textContent = 'Searching public archive…';
  } else {
    $('status').textContent = 'Loading older activity…';
  }

  // Decide which streams to request
  const wantPosts =
    state.kind === 'all' || state.kind === 'post'
      ? reset || !state.posts.exhausted || !!state.posts.lastError
      : false;
  const wantComments =
    state.kind === 'all' || state.kind === 'comment'
      ? reset || !state.comments.exhausted || !!state.comments.lastError
      : false;

  // On load-more with a specific tab, only that stream
  const jobs = [];
  if (wantPosts) {
    jobs.push(
      loadStream('post', reset || !state.posts.firstLoaded).then((r) => ({
        kind: 'post',
        ...r,
      }))
    );
  }
  if (wantComments) {
    jobs.push(
      loadStream('comment', reset || !state.comments.firstLoaded).then((r) => ({
        kind: 'comment',
        ...r,
      }))
    );
  }

  if (!jobs.length) {
    $('status').textContent = 'No additional pages available for this view.';
    updateControls();
    return;
  }

  const settled = await Promise.all(jobs);
  state.searchAttempted = true;

  const loadResults = { post: null, comment: null };
  for (const r of settled) {
    if (r.kind === 'post') loadResults.post = r;
    else loadResults.comment = r;
  }

  render(loadResults);
}

function downloadBlob(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function doExport(format) {
  const items = mergedView();
  if (!items.length) return;
  const name = exportFilename(state.user, state.kind, format);
  if (format === 'csv') {
    downloadBlob(name, 'text/csv;charset=utf-8', buildCsvExport(items));
  } else {
    const payload = buildJsonExport(items, state.user, state.kind);
    downloadBlob(name, 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
  }
}

// Event wiring
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  search(true);
});
$('loadMore').addEventListener('click', () => search(false));
document.querySelectorAll('.tab[data-kind]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-kind]').forEach((x) =>
      x.classList.toggle('active', x === btn)
    );
    state.kind = btn.dataset.kind;
    render();
  });
});
$('filterText').addEventListener('input', () => render());
$('sort').addEventListener('change', () => render());

const expJson = $('exportJson');
const expCsv = $('exportCsv');
if (expJson) expJson.addEventListener('click', () => doExport('json'));
if (expCsv) expCsv.addEventListener('click', () => doExport('csv'));

// Deep-link via hash
const initial = decodeURIComponent(location.hash.slice(1) || '');
if (initial) {
  $('username').value = initial;
  search(true);
}

// Expose for optional browser console debugging / integration tests
export { state, createCard, el, search, mergedView, emptyStateMessage };
