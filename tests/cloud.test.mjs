// Tests for src/cloudStorage.js, window.storage for a signed-in account. The
// Supabase client is replaced by a small in-memory table that answers the same
// calls, so these run offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCache, cloudStorage, localEntries, parkLocal, readAccountState, replaceAccount,
} from '../src/cloudStorage.js';

const fakeLocalStorage = (init = {}) => {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
};

// Enough of supabase-js's query builder for what cloudStorage calls. Every
// request can be made to fail, the way a dropped connection does. With hold
// set, requests wait in held until released, in whatever order a test picks,
// the way requests over a network can finish out of order.
const fakeClient = (rows = []) => {
  const table = new Map(rows.map((r) => [`${r.user_id}|${r.key}`, { ...r }]));
  const state = { table, down: false, calls: [], hold: false, held: [] };
  const answer = (fn) => {
    const gate = state.hold ? new Promise((release) => state.held.push(release)) : Promise.resolve();
    return gate.then(() => (state.down ? { data: null, error: { message: 'Failed to fetch' } } : { data: fn(), error: null }));
  };
  const filtered = (filters) => [...table.values()].filter((r) => filters.every((f) => f(r)));
  const chain = (kind, payload) => {
    const filters = [];
    const q = {
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      then(ok, bad) {
        state.calls.push(kind);
        return answer(() => {
          if (kind === 'select') return filtered(filters).map(({ key, value }) => ({ key, value }));
          if (kind === 'delete') { for (const r of filtered(filters)) table.delete(`${r.user_id}|${r.key}`); return null; }
          for (const r of payload) table.set(`${r.user_id}|${r.key}`, { ...r });
          return null;
        }).then(ok, bad);
      },
    };
    return q;
  };
  state.client = {
    from: (name) => {
      assert.equal(name, 'orbit_data');
      return {
        select: () => chain('select'),
        upsert: (payload, opts) => { assert.equal(opts.onConflict, 'user_id,key'); return chain('upsert', payload); },
        delete: () => chain('delete'),
      };
    },
  };
  return state;
};

const valuesFor = (state, userId) => Object.fromEntries(
  [...state.table.values()].filter((r) => r.user_id === userId).map((r) => [r.key, r.value]),
);

describe('localEntries', () => {
  it('finds what the browser saved before sign-in, and nothing else', () => {
    const store = fakeLocalStorage({
      'orbit:crm-people-v1': '[1]',
      'orbit:crm-people-v1-set-aside': '["x"]',
      'orbit:@u1:crm-people-v1': '[2]',
      'orbit:parked:crm-events-v1': '[3]',
      'orbit:__seeded': '1',
      'sb-abc-auth-token': '{}',
      'orbit-pending-share': '#share=abc',
    });
    assert.deepEqual(localEntries(store), { 'crm-people-v1': '[1]', 'crm-people-v1-set-aside': '["x"]' });
  });
});

describe('opening an account', () => {
  it('moves this browser\'s data into an empty account, then removes the browser\'s copy', async () => {
    const store = fakeLocalStorage({ 'orbit:crm-people-v1': '[{"id":"a"}]', 'orbit:crm-theme-v1': 'dusk' });
    const db = fakeClient();
    const st = await readAccountState({ client: db.client, userId: 'u1', store });
    assert.equal(st.moved, true);
    assert.equal(st.conflict, false);
    assert.deepEqual(valuesFor(db, 'u1'), { 'crm-people-v1': '[{"id":"a"}]', 'crm-theme-v1': 'dusk' });
    assert.deepEqual(localEntries(store), {}, 'a second person signing in here does not inherit it');
    assert.equal(store.getItem('orbit:@u1:crm-theme-v1'), 'dusk', 'kept as the offline copy');
  });

  it('leaves the browser\'s data alone when moving it fails', async () => {
    const store = fakeLocalStorage({ 'orbit:crm-people-v1': '[]' });
    const db = fakeClient();
    const orig = db.client.from;
    db.client.from = (n) => ({ ...orig(n), upsert: () => { db.down = true; return orig(n).upsert([], { onConflict: 'user_id,key' }); } });
    await assert.rejects(readAccountState({ client: db.client, userId: 'u1', store }), /Failed to fetch/);
    assert.equal(store.getItem('orbit:crm-people-v1'), '[]');
  });

  it('reads an account with data, and reports a conflict rather than mixing in the browser\'s', async () => {
    const store = fakeLocalStorage({ 'orbit:crm-people-v1': '["local"]' });
    const db = fakeClient([
      { user_id: 'u1', key: 'crm-people-v1', value: '["cloud"]' },
      { user_id: 'u2', key: 'crm-people-v1', value: '["someone else"]' },
    ]);
    const st = await readAccountState({ client: db.client, userId: 'u1', store });
    assert.equal(st.conflict, true);
    assert.deepEqual(st.entries, { 'crm-people-v1': '["cloud"]' }, 'only this account\'s rows');
    assert.equal(store.getItem('orbit:crm-people-v1'), '["local"]', 'nothing decided yet');
    assert.deepEqual(valuesFor(db, 'u1'), { 'crm-people-v1': '["cloud"]' });
  });

  it('has no conflict when the browser has nothing of its own', async () => {
    const store = fakeLocalStorage();
    const db = fakeClient([{ user_id: 'u1', key: 'crm-owner-v1', value: 'Sam' }]);
    const st = await readAccountState({ client: db.client, userId: 'u1', store });
    assert.deepEqual(st, { entries: { 'crm-owner-v1': 'Sam' }, offline: false, conflict: false, moved: false });
  });

  it('opens from the last copy when offline, and refuses when there is no copy', async () => {
    const store = fakeLocalStorage();
    const db = fakeClient([{ user_id: 'u1', key: 'crm-owner-v1', value: 'Sam' }]);
    db.down = true;
    await assert.rejects(readAccountState({ client: db.client, userId: 'u1', store }), /Failed to fetch/,
      'never an empty Orbit that would save over the account');
    db.down = false;
    await readAccountState({ client: db.client, userId: 'u1', store });
    db.down = true;
    const st = await readAccountState({ client: db.client, userId: 'u1', store });
    assert.equal(st.offline, true);
    assert.deepEqual(st.entries, { 'crm-owner-v1': 'Sam' });
    assert.equal(await readAccountState({ client: db.client, userId: 'u2', store }).catch(() => 'refused'), 'refused',
      'one account\'s copy is never another\'s');
  });

  it('an account emptied elsewhere does not keep its old keys in the copy', async () => {
    const store = fakeLocalStorage({ 'orbit:@u1:crm-owner-v1': 'Old', 'orbit:@u1:__synced': 'x' });
    const db = fakeClient();
    const st = await readAccountState({ client: db.client, userId: 'u1', store });
    assert.deepEqual(st.entries, {});
    assert.equal(store.getItem('orbit:@u1:crm-owner-v1'), null);
  });
});

describe('choosing after a conflict', () => {
  it('keeping the account parks the browser\'s data instead of deleting it', () => {
    const store = fakeLocalStorage({ 'orbit:crm-people-v1': '["local"]' });
    parkLocal(store);
    assert.deepEqual(localEntries(store), {});
    assert.equal(store.getItem('orbit:parked:crm-people-v1'), '["local"]');
  });

  it('replacing the account makes it exactly what the browser had', async () => {
    const store = fakeLocalStorage({ 'orbit:crm-people-v1': '["local"]' });
    const db = fakeClient([
      { user_id: 'u1', key: 'crm-people-v1', value: '["cloud"]' },
      { user_id: 'u1', key: 'crm-events-v1', value: '["cloud event"]' },
      { user_id: 'u2', key: 'crm-events-v1', value: '["theirs"]' },
    ]);
    const entries = await replaceAccount({ client: db.client, userId: 'u1', store });
    assert.deepEqual(entries, { 'crm-people-v1': '["local"]' });
    assert.deepEqual(valuesFor(db, 'u1'), { 'crm-people-v1': '["local"]' });
    assert.deepEqual(valuesFor(db, 'u2'), { 'crm-events-v1': '["theirs"]' }, 'nobody else is touched');
    assert.deepEqual(localEntries(store), {});
  });
});

describe('cloud storage', () => {
  it('keeps the window.storage contract, saving to the account', async () => {
    const store = fakeLocalStorage();
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store, entries: { a: '1' } });
    assert.deepEqual(await s.get('a'), { value: '1' });
    assert.equal(await s.get('missing'), null);
    await s.set('n', 5);
    assert.deepEqual(await s.get('n'), { value: '5' }, 'values are stored as text');
    assert.equal(valuesFor(db, 'u1').n, '5');
    assert.equal(store.getItem('orbit:@u1:n'), '5');
    await s.set('a', '2');
    await s.delete('a');
    assert.equal(await s.get('a'), null);
    assert.equal('a' in valuesFor(db, 'u1'), false);
    assert.equal(store.getItem('orbit:@u1:a'), null);
  });

  it('rejects a save the account did not get, and does not pretend it happened', async () => {
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store: fakeLocalStorage(), entries: { a: '1' } });
    db.down = true;
    await assert.rejects(s.set('a', '2'), /Failed to fetch/);
    assert.deepEqual(await s.get('a'), { value: '1' });
  });

  // Lets every request already sent reach the point of waiting in held.
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('a save that finishes late never undoes a newer one', async () => {
    const store = fakeLocalStorage();
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store, entries: {} });
    db.hold = true;
    const first = s.set('a', '1');
    const second = s.set('a', '2');
    await settle();
    // The newest request is answered first, then the older one.
    while (db.held.length) { db.held.pop()(); await settle(); }
    await Promise.all([first, second]);
    assert.equal(valuesFor(db, 'u1').a, '2');
    assert.deepEqual(await s.get('a'), { value: '2' });
    assert.equal(store.getItem('orbit:@u1:a'), '2');
  });

  it('saves made while one is under way go as one, the newest', async () => {
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store: fakeLocalStorage(), entries: {} });
    db.hold = true;
    const saves = [s.set('a', '1'), s.set('a', '2'), s.set('a', '3'), s.set('b', 'x')];
    await settle();
    assert.equal(db.held.length, 2, 'one request for a, one for b; the rest wait');
    while (db.held.length) { db.held.shift()(); await settle(); }
    await Promise.all(saves);
    assert.deepEqual(db.calls, ['upsert', 'upsert', 'upsert'], 'a is sent twice (1, then 3), b once');
    assert.deepEqual(valuesFor(db, 'u1'), { a: '3', b: 'x' });
  });

  it('a failed save is reported to its callers, and the next still goes', async () => {
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store: fakeLocalStorage(), entries: { a: '0' } });
    db.hold = true;
    db.down = true;
    const first = s.set('a', '1');
    const second = s.set('a', '2');
    await settle();
    db.held.shift()();
    await assert.rejects(first, /Failed to fetch/);
    assert.deepEqual(await s.get('a'), { value: '0' }, 'the failed value is not kept');
    db.down = false;
    await settle();
    db.held.shift()();
    await second;
    assert.deepEqual(await s.get('a'), { value: '2' });
    assert.equal(valuesFor(db, 'u1').a, '2');
  });

  it('a delete waits its turn behind a save of the same key', async () => {
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store: fakeLocalStorage(), entries: {} });
    db.hold = true;
    const saved = s.set('a', '1');
    const gone = s.delete('a');
    await settle();
    while (db.held.length) { db.held.pop()(); await settle(); }
    await Promise.all([saved, gone]);
    assert.equal('a' in valuesFor(db, 'u1'), false);
    assert.equal(await s.get('a'), null);
  });

  it('a full localStorage never turns a saved change into a failure', async () => {
    const store = { ...fakeLocalStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    const db = fakeClient();
    const s = cloudStorage({ client: db.client, userId: 'u1', store, entries: {} });
    await s.set('a', '1');
    assert.equal(valuesFor(db, 'u1').a, '1');
  });

  it('sign out clears only that account\'s copy', () => {
    const store = fakeLocalStorage({ 'orbit:@u1:a': '1', 'orbit:@u1:__synced': 'x', 'orbit:@u2:a': '2', 'orbit:parked:b': '3' });
    clearCache(store, 'u1');
    assert.deepEqual([...store.data.keys()].sort(), ['orbit:@u2:a', 'orbit:parked:b']);
  });
});
