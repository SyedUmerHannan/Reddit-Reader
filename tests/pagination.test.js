/**
 * Multi-page pagination and stream independence tests (mocked pages).
 * No live network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStream,
  applyPageToStream,
  filterAndSort,
  buildJsonExport,
  buildCsvExport,
} from '../core.js';

function page(ids, baseTime) {
  return ids.map((id, i) => ({
    id,
    created_utc: baseTime - i,
    title: 'Post ' + id,
    author: 'user',
    subreddit: 'test',
    score: i,
  }));
}

describe('multi-page pagination', () => {
  it('advances cursor across successive pages without duplicates', () => {
    const stream = createStream();
    const p1 = page(['a', 'b', 'c'], 300);
    const r1 = applyPageToStream(stream, p1, 'post');
    assert.equal(r1.added, 3);
    assert.equal(stream.cursor, 298); // 300, 299, 298
    assert.equal(stream.exhausted, false);

    const p2 = page(['d', 'e'], 297);
    // Ensure all p2 times are < cursor
    p2[0].created_utc = 290;
    p2[1].created_utc = 280;
    const r2 = applyPageToStream(stream, p2, 'post');
    assert.equal(r2.added, 2);
    assert.equal(stream.cursor, 280);
    assert.equal(stream.items.length, 5);
    assert.deepEqual(
      stream.items.map((x) => x.id),
      ['a', 'b', 'c', 'd', 'e']
    );
  });

  it('stops after empty third page without losing prior items', () => {
    const stream = createStream();
    applyPageToStream(stream, page(['x'], 100), 'post');
    applyPageToStream(stream, page(['y'], 50), 'post');
    // force times
    stream.cursor = 50;
    stream.items = [
      { id: 'x', created_utc: 100, __kind: 'post' },
      { id: 'y', created_utc: 50, __kind: 'post' },
    ];
    stream.seen = new Set(['post:x', 'post:y']);
    stream.exhausted = false;
    const r = applyPageToStream(stream, [], 'post');
    assert.equal(r.exhaustedNow, true);
    assert.equal(stream.exhausted, true);
    assert.equal(stream.items.length, 2);
  });

  it('independent post/comment cursors across multiple pages', () => {
    const posts = createStream();
    const comments = createStream();

    applyPageToStream(posts, [{ id: 'p1', created_utc: 500 }], 'post');
    applyPageToStream(comments, [{ id: 'c1', created_utc: 400, body: 'hi' }], 'comment');
    assert.equal(posts.cursor, 500);
    assert.equal(comments.cursor, 400);

    applyPageToStream(posts, [{ id: 'p2', created_utc: 450 }], 'post');
    assert.equal(posts.cursor, 450);
    assert.equal(comments.cursor, 400); // unchanged
    assert.equal(comments.items.length, 1);
  });

  it('retry after failure does not duplicate when page succeeds', () => {
    const stream = createStream();
    stream.lastError = 'Archive request failed (500).';
    stream.firstLoaded = true;
    const r = applyPageToStream(
      stream,
      [{ id: 'ok1', created_utc: 10 }],
      'comment'
    );
    assert.equal(stream.lastError, null);
    assert.equal(r.added, 1);
    // Second apply of same id is duplicate
    const r2 = applyPageToStream(
      stream,
      [{ id: 'ok1', created_utc: 5 }],
      'comment'
    );
    assert.equal(r2.added, 0);
    assert.equal(stream.exhausted, true);
  });

  it('three successive pages stop when cursor would not advance', () => {
    const stream = createStream();
    applyPageToStream(stream, [{ id: '1', created_utc: 10 }], 'post');
    applyPageToStream(stream, [{ id: '2', created_utc: 9 }], 'post');
    // Page claims oldest 9 again (non-advancing)
    const r = applyPageToStream(
      stream,
      [
        { id: '3', created_utc: 9 },
        { id: '4', created_utc: 11 },
      ],
      'post'
    );
    assert.equal(stream.exhausted, true);
    assert.equal(r.exhaustedNow, true);
  });
});

describe('export respects filter and sort over multi-page data', () => {
  it('exports only filtered posts in score order', () => {
    const posts = createStream();
    applyPageToStream(
      posts,
      [
        { id: 'p1', title: 'alpha', created_utc: 3, score: 1 },
        { id: 'p2', title: 'beta target', created_utc: 2, score: 9 },
        { id: 'p3', title: 'target gamma', created_utc: 1, score: 5 },
      ],
      'post'
    );
    const all = posts.items;
    const view = filterAndSort(all, {
      kind: 'post',
      filter: 'target',
      sort: 'score',
    });
    assert.equal(view.length, 2);
    assert.equal(view[0].id, 'p2');
    assert.equal(view[1].id, 'p3');

    const json = buildJsonExport(view, 'tester', 'post');
    assert.equal(json.count, 2);
    assert.equal(json.records[0].id, 'p2');

    const csv = buildCsvExport(view);
    assert.ok(csv.includes('p2'));
    assert.ok(csv.includes('p3'));
    assert.ok(!csv.split('\n').slice(1).some((line) => line.startsWith('post,p1,')));
  });
});
