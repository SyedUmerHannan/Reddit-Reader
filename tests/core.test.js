/**
 * Unit tests for Reddit Reader core helpers.
 * Run: npm test
 * Requires Node.js >= 18
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  validateRedditLink,
  normalizeApiResponse,
  buildCandidateLink,
  displayTitle,
  displayBody,
  createStream,
  applyPageToStream,
  filterAndSort,
  sanitizeFilenamePart,
  guardCsvFormula,
  csvEscape,
  buildJsonExport,
  buildCsvExport,
  exportFilename,
} from '../core.js';

describe('normalizeUsername', () => {
  it('accepts plain username', () => {
    assert.equal(normalizeUsername('example_user'), 'example_user');
  });
  it('accepts u/ prefix', () => {
    assert.equal(normalizeUsername('u/example_user'), 'example_user');
  });
  it('accepts @ prefix', () => {
    assert.equal(normalizeUsername('@example_user'), 'example_user');
  });
  it('accepts full profile URL with /user/', () => {
    assert.equal(
      normalizeUsername('https://www.reddit.com/user/example_user/'),
      'example_user'
    );
  });
  it('accepts /u/ URL without www', () => {
    assert.equal(
      normalizeUsername('https://reddit.com/u/example_user'),
      'example_user'
    );
  });
  it('accepts username with hyphen and underscore', () => {
    assert.equal(normalizeUsername('a-b_c1'), 'a-b_c1');
  });
  it('rejects empty input', () => {
    assert.throws(() => normalizeUsername(''), /Enter a Reddit username/);
    assert.throws(() => normalizeUsername('   '), /Enter a Reddit username/);
    assert.throws(() => normalizeUsername(null), /Enter a Reddit username/);
  });
  it('rejects whitespace inside username', () => {
    assert.throws(() => normalizeUsername('bad user'), /valid Reddit username/);
  });
  it('rejects invalid characters', () => {
    assert.throws(() => normalizeUsername('bad!user'), /1–20 characters/);
  });
  it('rejects excessive length', () => {
    assert.throws(() => normalizeUsername('a'.repeat(21)), /1–20 characters/);
  });
  it('rejects malformed profile URL', () => {
    assert.throws(
      () => normalizeUsername('https://www.reddit.com/r/programming'),
      /Only Reddit profile URLs/
    );
  });
  it('rejects unrelated URL', () => {
    assert.throws(
      () => normalizeUsername('https://example.com/user/foo'),
      /Only Reddit profile URLs/
    );
  });
  it('rejects attacker lookalike host that contains reddit.com', () => {
    assert.throws(
      () => normalizeUsername('https://reddit.com.attacker.example/user/foo'),
      /Only Reddit profile URLs/
    );
  });
  it('rejects javascript: style input', () => {
    assert.throws(
      () => normalizeUsername('javascript:alert(1)'),
      /valid Reddit username|profile URL|1–20 characters/
    );
  });
});

describe('validateRedditLink', () => {
  it('accepts valid HTTPS Reddit permalink', () => {
    const href = validateRedditLink(
      'https://www.reddit.com/r/test/comments/abc123/title/'
    );
    assert.equal(href, 'https://www.reddit.com/r/test/comments/abc123/title/');
  });
  it('accepts redd.it short link', () => {
    assert.equal(validateRedditLink('https://redd.it/abc123'), 'https://redd.it/abc123');
  });
  it('accepts valid relative Reddit permalink', () => {
    const href = validateRedditLink('/r/test/comments/abc123/');
    assert.equal(href, 'https://www.reddit.com/r/test/comments/abc123/');
  });
  it('accepts old.reddit.com', () => {
    const href = validateRedditLink('https://old.reddit.com/r/test/comments/abc/');
    assert.ok(href && href.includes('old.reddit.com'));
  });
  it('rejects hostname suffix spoof (reddit.com.attacker.example)', () => {
    assert.equal(validateRedditLink('https://reddit.com.attacker.example/'), null);
  });
  it('rejects attacker.example/reddit.com path', () => {
    assert.equal(validateRedditLink('https://attacker.example/reddit.com'), null);
  });
  it('rejects javascript: URLs', () => {
    assert.equal(validateRedditLink('javascript:alert(1)'), null);
  });
  it('rejects data: URLs', () => {
    assert.equal(
      validateRedditLink('data:text/html,<script>alert(1)</script>'),
      null
    );
  });
  it('rejects HTTP (non-HTTPS) Reddit URLs', () => {
    assert.equal(validateRedditLink('http://www.reddit.com/r/test/'), null);
  });
  it('rejects malformed URLs', () => {
    assert.equal(validateRedditLink('not a url at all'), null);
  });
  it('rejects arbitrary external URLs', () => {
    assert.equal(validateRedditLink('https://evil.example.com/'), null);
  });
  it('rejects protocol-relative URLs', () => {
    assert.equal(validateRedditLink('//evil.example/path'), null);
  });
  it('rejects empty / null', () => {
    assert.equal(validateRedditLink(''), null);
    assert.equal(validateRedditLink(null), null);
  });
});

describe('normalizeApiResponse', () => {
  it('returns array as-is (filtering non-objects)', () => {
    const rows = [{ id: '1' }, { id: '2' }];
    assert.deepEqual(normalizeApiResponse(rows), rows);
  });
  it('supports { data: [...] }', () => {
    assert.deepEqual(normalizeApiResponse({ data: [{ a: 1 }] }), [{ a: 1 }]);
  });
  it('supports { results: [...] }', () => {
    assert.deepEqual(normalizeApiResponse({ results: [{ b: 2 }] }), [{ b: 2 }]);
  });
  it('supports Reddit listing shape data.children[].data', () => {
    const input = {
      data: {
        children: [
          { data: { id: 't3_abc', title: 'Hi' } },
          { data: { id: 't3_def' } },
        ],
      },
    };
    const out = normalizeApiResponse(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 't3_abc');
  });
  it('returns empty array for null / undefined / empty array', () => {
    assert.deepEqual(normalizeApiResponse(null), []);
    assert.deepEqual(normalizeApiResponse(undefined), []);
    assert.deepEqual(normalizeApiResponse([]), []);
  });
  it('returns empty array for empty object', () => {
    assert.deepEqual(normalizeApiResponse({}), []);
  });
  it('filters null entries from arrays', () => {
    assert.deepEqual(
      normalizeApiResponse([null, { id: 1 }, 'string', 42]),
      [{ id: 1 }]
    );
  });
  it('throws on unexpected primitive', () => {
    assert.throws(() => normalizeApiResponse('nope'), /Unexpected/);
  });
  it('throws when data is non-array object without children', () => {
    assert.throws(
      () => normalizeApiResponse({ data: { foo: 'bar' } }),
      /Unexpected/
    );
  });
});

describe('buildCandidateLink', () => {
  it('uses relative permalink', () => {
    assert.equal(
      buildCandidateLink({ permalink: '/r/test/comments/abc/' }, 'post'),
      '/r/test/comments/abc/'
    );
  });
  it('builds post link from id', () => {
    assert.equal(
      buildCandidateLink({ id: 't3_xyz' }, 'post'),
      'https://www.reddit.com/comments/xyz/'
    );
  });
  it('builds comment link from link_id + id', () => {
    assert.equal(
      buildCandidateLink({ id: 't1_c1', link_id: 't3_p1' }, 'comment'),
      'https://www.reddit.com/comments/p1/_/c1/'
    );
  });
  it('returns null when no direct identifiers (no profile fallback)', () => {
    assert.equal(buildCandidateLink({ title: 'hi' }, 'post'), null);
    assert.equal(buildCandidateLink({ body: 'x' }, 'comment'), null);
  });
  it('validated external permalink is rejected by validateRedditLink', () => {
    const c = buildCandidateLink({ permalink: 'https://evil.example/phish' }, 'post');
    assert.equal(validateRedditLink(c), null);
  });
});

describe('display helpers', () => {
  it('displayTitle never treats markup specially', () => {
    assert.equal(
      displayTitle({ title: '<img src=x onerror=alert(1)>' }, 'post'),
      '<img src=x onerror=alert(1)>'
    );
  });
  it('displayBody returns raw text including script-like content', () => {
    assert.equal(
      displayBody({ body: '<script>alert(1)</script>' }, 'comment'),
      '<script>alert(1)</script>'
    );
  });
});

describe('rendering security (DOM mock)', () => {
  function mockEl(tag, className, text) {
    return {
      tagName: tag.toUpperCase(),
      className: className || '',
      textContent: text != null ? String(text) : '',
      children: [],
      attributes: {},
      append(...nodes) {
        this.children.push(...nodes);
      },
    };
  }

  it('malicious title becomes textContent, not child elements', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '"><svg onload=alert(1)>',
    ];
    for (const p of payloads) {
      const node = mockEl('h3', null, p);
      assert.equal(node.textContent, p);
      assert.equal(node.children.length, 0);
    }
  });

  it('displayTitle + textContent path keeps XSS payloads inert', () => {
    const raw = displayTitle({ title: '"><svg onload=alert(1)>' }, 'post');
    const node = mockEl('h3', null, raw);
    assert.equal(node.textContent, '"><svg onload=alert(1)>');
    assert.equal(node.children.length, 0);
  });
});

describe('applyPageToStream / createStream', () => {
  it('creates independent streams', () => {
    const a = createStream();
    const b = createStream();
    a.items.push({ id: 1 });
    assert.equal(b.items.length, 0);
  });

  it('adds unique records and advances cursor to oldest timestamp', () => {
    const s = createStream();
    const { added, exhaustedNow } = applyPageToStream(
      s,
      [
        { id: 'a', created_utc: 300 },
        { id: 'b', created_utc: 100 },
        { id: 'c', created_utc: 200 },
      ],
      'post'
    );
    assert.equal(added, 3);
    assert.equal(exhaustedNow, false);
    assert.equal(s.cursor, 100);
    assert.equal(s.exhausted, false);
    assert.equal(s.firstLoaded, true);
    assert.equal(s.items.length, 3);
  });

  it('empty page marks stream exhausted', () => {
    const s = createStream();
    const r = applyPageToStream(s, [], 'post');
    assert.equal(r.added, 0);
    assert.equal(r.exhaustedNow, true);
    assert.equal(s.exhausted, true);
    assert.equal(s.firstLoaded, true);
  });

  it('duplicate-only page marks exhausted', () => {
    const s = createStream();
    applyPageToStream(s, [{ id: 'x', created_utc: 50 }], 'post');
    const r = applyPageToStream(s, [{ id: 'x', created_utc: 40 }], 'post');
    assert.equal(r.added, 0);
    assert.equal(s.exhausted, true);
  });

  it('non-advancing cursor marks exhausted (prevents infinite requests)', () => {
    const s = createStream();
    applyPageToStream(s, [{ id: 'a', created_utc: 100 }], 'post');
    assert.equal(s.cursor, 100);
    const r = applyPageToStream(
      s,
      [
        { id: 'b', created_utc: 100 },
        { id: 'c', created_utc: 150 },
      ],
      'post'
    );
    assert.equal(s.exhausted, true);
    assert.equal(r.exhaustedNow, true);
  });

  it('missing timestamps mark exhausted safely', () => {
    const s = createStream();
    const r = applyPageToStream(s, [{ id: 'no-time' }], 'comment');
    assert.equal(r.added, 1);
    assert.equal(s.exhausted, true);
  });

  it('post stream does not affect comment stream', () => {
    const posts = createStream();
    const comments = createStream();
    applyPageToStream(posts, [{ id: 'p1', created_utc: 10 }], 'post');
    assert.equal(comments.items.length, 0);
    assert.equal(comments.cursor, null);
    assert.equal(comments.exhausted, false);
  });

  it('failed stream state can be cleared on successful apply', () => {
    const s = createStream();
    s.lastError = 'Archive request failed (500).';
    applyPageToStream(s, [{ id: 'ok', created_utc: 9 }], 'post');
    assert.equal(s.lastError, null);
    assert.equal(s.items.length, 1);
  });
});

describe('filterAndSort', () => {
  const data = [
    { __kind: 'post', id: '1', title: 'Alpha', created_utc: 10, score: 5 },
    { __kind: 'comment', id: '2', body: 'Beta note', created_utc: 20, score: 1 },
    { __kind: 'post', id: '3', title: 'Gamma', created_utc: 30, score: 9 },
  ];

  it('filters by tab kind', () => {
    assert.equal(filterAndSort(data, { kind: 'post', filter: '', sort: 'newest' }).length, 2);
    assert.equal(filterAndSort(data, { kind: 'comment', filter: '', sort: 'newest' }).length, 1);
  });

  it('filters by text', () => {
    const out = filterAndSort(data, { kind: 'all', filter: 'beta', sort: 'newest' });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '2');
  });

  it('sorts by score', () => {
    const out = filterAndSort(data, { kind: 'all', filter: '', sort: 'score' });
    assert.equal(out[0].id, '3');
  });
});

describe('export helpers', () => {
  const records = [
    {
      __kind: 'post',
      id: 'p1',
      author: 'alice',
      subreddit: 'test',
      title: 'Hello, "world"',
      selftext: 'Line1\nLine2',
      created_utc: 100,
      score: 3,
      permalink: '/r/test/comments/p1/',
      url: 'https://example.com',
    },
    {
      __kind: 'comment',
      id: 'c1',
      author: 'bob',
      subreddit: 'test',
      body: '=1+1',
      created_utc: 90,
      score: 0,
      permalink: '/r/test/comments/p1/_/c1/',
    },
  ];

  it('JSON retains original fields and type', () => {
    const payload = buildJsonExport(records, 'alice', 'all');
    assert.equal(payload.count, 2);
    assert.equal(payload.username, 'alice');
    assert.equal(payload.records[0].type, 'post');
    assert.equal(payload.records[0].title, 'Hello, "world"');
    assert.equal(payload.records[1].type, 'comment');
    assert.ok(!('__kind' in payload.records[0]));
  });

  it('CSV escapes commas, quotes, and newlines', () => {
    const csv = buildCsvExport(records);
    assert.ok(csv.includes('"Hello, ""world"""'));
  });

  it('CSV guards formula injection', () => {
    assert.equal(guardCsvFormula('=1+1'), "'=1+1");
    assert.equal(guardCsvFormula('+cmd'), "'+cmd");
    assert.equal(guardCsvFormula('-1'), "'-1");
    assert.equal(guardCsvFormula('@sum'), "'@sum");
    assert.equal(guardCsvFormula('normal'), 'normal');
    const csv = buildCsvExport(records);
    assert.ok(csv.includes("'=1+1"));
  });

  it('filenames are safe', () => {
    assert.equal(
      exportFilename('example_user', 'post', 'json'),
      'reddit-reader-example_user-posts.json'
    );
    assert.equal(
      exportFilename('all', 'all', 'csv'),
      'reddit-reader-all-all-activity.csv'
    );
    assert.ok(!exportFilename('../etc/passwd', 'all', 'json').includes('..'));
  });

  it('sanitizeFilenamePart strips unsafe chars', () => {
    assert.equal(sanitizeFilenamePart('a/b c'), 'a_b_c');
  });

  it('csvEscape quotes special fields', () => {
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  });
});

describe('normalizeUsername path strictness', () => {
  it('accepts profile URL with known tab suffix', () => {
    assert.equal(
      normalizeUsername('https://www.reddit.com/user/example_user/submitted/'),
      'example_user'
    );
  });
  it('rejects profile URL with extra unrelated path segment', () => {
    assert.throws(
      () => normalizeUsername('https://reddit.com/user/example/evil/'),
      /Only Reddit profile URLs/
    );
  });
  it('rejects username with embedded dot in profile path', () => {
    assert.throws(
      () => normalizeUsername('https://reddit.com/user/example.evil/'),
      /Only Reddit profile URLs/
    );
  });
});

describe('guardCsvFormula whitespace', () => {
  it('guards formula chars after leading whitespace', () => {
    assert.equal(guardCsvFormula(' =1+1'), "' =1+1");
    assert.equal(guardCsvFormula('\t=cmd'), "'\t=cmd");
    assert.equal(guardCsvFormula('\r\n@sum'), "'\r\n@sum");
  });
  it('does not alter ordinary leading spaces', () => {
    assert.equal(guardCsvFormula(' hello'), ' hello');
  });
});
