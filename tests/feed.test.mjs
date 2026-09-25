// The friends feed: saying when, and gathering what one friend shared at once.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';

const A = await loadApp();

const NOW = Date.parse('2026-09-22T17:00:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();

describe('when it was shared', () => {
  it('in words, nearest first', () => {
    const cases = [[0, 'just now'], [0.4, 'just now'], [1, '1 min ago'], [59, '59 min ago'], [60, '1 h ago'], [60 * 23, '23 h ago'],
      [60 * 24, 'yesterday'], [60 * 24 * 3, '3 days ago'], [60 * 24 * 6, '6 days ago']];
    for (const [min, want] of cases) assert.equal(A.ago(at(min), NOW), want, `${min} min`);
  });

  it('a week or more is the date, and nonsense is nothing', () => {
    assert.match(A.ago(at(60 * 24 * 8), NOW), /Sep 1[34], 2026/);
    assert.equal(A.ago('not a time', NOW), '');
    assert.equal(A.ago(at(-5), NOW), 'just now', 'a clock a little ahead is not the future');
  });
});

describe('gathering', () => {
  const item = (id, who, min) => ({ id, at: at(min), by: { username: who, display_name: who } });

  it('gathers what one friend shared within two minutes, in order', () => {
    const groups = A.groupFeed([item('a', 'bea', 0), item('b', 'bea', 1), item('c', 'bea', 2.5), item('d', 'dora', 3), item('e', 'bea', 4)]);
    assert.deepEqual(groups.map((g) => [g.by.username, g.items.map((x) => x.id)]),
      [['bea', ['a', 'b', 'c']], ['dora', ['d']], ['bea', ['e']]]);
  });

  it('a gap of more than two minutes starts a new group, even for the same friend', () => {
    assert.equal(A.groupFeed([item('a', 'bea', 0), item('b', 'bea', 3)]).length, 2);
  });

  it('nothing gives nothing', () => {
    assert.deepEqual(A.groupFeed([]), []);
  });
});
