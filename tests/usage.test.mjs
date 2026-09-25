// Usage counts: what a save is counted as, and that only plain details go.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';
import { cleanProps, track, pendingUsage } from '../src/usage.js';

const A = await loadApp();
const names = (list) => list.map(([n]) => n);

describe('what a save is counted as', () => {
  it('an event added, edited and removed, with plain details of one', () => {
    const e = { id: 'e1', title: 'Secret party', kind: 'Concert', date: '2026-01-01', rating: 4, links: [{ id: 'x' }], visibility: 'friends', review: 'Loud' };
    assert.deepEqual(A.changeActions('events', [], [e]), [['event.add', { kind: 'Concert', rated: true, linked: 1, shared: 'friends', thoughts: true }]]);
    assert.deepEqual(names(A.changeActions('events', [e], [{ ...e, rating: 5 }])), ['event.edit']);
    assert.deepEqual(A.changeActions('events', [e], []), [['event.remove', { n: 1 }]]);
    assert.deepEqual(A.changeActions('events', [e], [e]), [], 'nothing changed, nothing counted');
  });

  it('a pile at once is one count, marked as such', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
    assert.deepEqual(A.changeActions('people', [], many), [['person.add', { n: 40, bulk: true }]]);
  });

  it('a catch-up logged is a catch-up, not an edit', () => {
    const p = { id: 'p1', name: 'Dana', log: [] };
    assert.deepEqual(A.changeActions('people', [p], [{ ...p, log: [{ date: '2026-01-01', text: 'Lunch' }] }]), [['catchup.log', { n: 1 }]]);
  });

  it('a reminder ticked off is done', () => {
    const r = { id: 'r1', title: 'Filter', history: [] };
    assert.deepEqual(names(A.changeActions('reminders', [r], [{ ...r, history: [{ date: '2026-01-01' }] }])), ['reminder.done']);
  });

  it('list entries added, finished and rated', () => {
    const c = { id: 'l1', name: 'Books', kind: 'Books', items: [{ id: 'a' }] };
    const next = { ...c, items: [{ id: 'a', doneOn: '2026-01-01', rating: 4 }, { id: 'b' }] };
    assert.deepEqual(names(A.changeActions('lists', [c], [next])), ['list.item_add', 'list.item_done', 'list.item_rate']);
  });

  it('trips, and photos added to one', () => {
    const t = { id: 't1', title: 'Lisbon', status: 'planned', stops: [{}], photoIds: [] };
    assert.deepEqual(A.changeActions('trips', [], [t]), [['trip.add', { status: 'planned', rated: false, stops: 1, photos: 0 }]]);
    assert.deepEqual(names(A.changeActions('trips', [t], [{ ...t, photoIds: ['a', 'b'] }])), ['trip.edit', 'trip.photo_add']);
  });

  it('never carries anything anyone wrote', () => {
    const e = { id: 'e1', title: 'Secret party for Dana', kind: 'Milestone', date: '2026-01-01', note: 'shh', place: 'Home' };
    const p = { id: 'p1', name: 'Dana Secret', note: 'shh', log: [{ text: 'Lunch at Joe' }] };
    const all = JSON.stringify([...A.changeActions('events', [], [e]), ...A.changeActions('people', [], [p])]);
    assert.doesNotMatch(all, /Secret|Dana|shh|Home|Joe/);
  });

  it('something that is not a list is not counted', () => {
    assert.deepEqual(A.changeActions('events', null, []), []);
  });
});

describe('details', () => {
  it('keeps short plain details only', () => {
    assert.deepEqual(cleanProps({ kind: 'Concert', n: 3, ok: true, long: 'x'.repeat(150), nested: { a: 1 }, list: [1], 'Bad Key': 1, nan: NaN, gone: undefined }),
      { kind: 'Concert', n: 3, ok: true, long: 'x'.repeat(100) });
    assert.deepEqual(cleanProps(null), {});
  });

  it('nothing is kept without an account server', () => {
    track('event.add', { kind: 'Concert' });
    assert.deepEqual(pendingUsage(), []);
  });
});
