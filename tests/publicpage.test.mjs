// Public pages: reading addresses, what of a trip is shown, and the numbers
// across the top of a page.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';
import { readRoute, profilePath, catalogPath } from '../src/route.js';
import { tripsToShare } from '../src/catalog.js';

const A = await loadApp();

const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const ID = '00000000-0000-4000-8000-00000000c41f';

describe('addresses', () => {
  it('reads a person\'s page, a year of it, and a catalog entry, under the site\'s base', () => {
    assert.deepEqual(readRoute('/Orbit/u/brock', '/Orbit/'), { kind: 'profile', username: 'brock', year: null });
    assert.deepEqual(readRoute('/Orbit/u/Brock/2026/', '/Orbit/'), { kind: 'profile', username: 'brock', year: 2026 });
    assert.deepEqual(readRoute('/u/@bea.reads', '/'), { kind: 'profile', username: 'bea.reads', year: null });
    assert.deepEqual(readRoute(`/Orbit/c/${ID.toUpperCase()}`, '/Orbit/'), { kind: 'catalog', id: ID });
  });

  it('anything else is the app', () => {
    for (const p of ['/Orbit/', '/Orbit/u', '/Orbit/u/ab', '/Orbit/u/no spaces', '/Orbit/u/brock/26', '/Orbit/u/brock/2026/x',
      '/Orbit/u/brock/1066', '/Orbit/c/not-a-uuid', '/u/brock', '/Orbit/x/brock', '/Orbit/u/%E0%A4%A']) {
      assert.equal(readRoute(p, '/Orbit/'), null, p);
    }
  });

  it('writes the addresses it reads', () => {
    assert.equal(profilePath('brock', null, '/Orbit/'), '/Orbit/u/brock');
    assert.equal(profilePath('brock', 2026, '/Orbit/'), '/Orbit/u/brock/2026');
    assert.equal(catalogPath(ID, '/Orbit/'), `/Orbit/c/${ID}`);
    assert.deepEqual(readRoute(profilePath('sam.lee', 2025, '/'), '/'), { kind: 'profile', username: 'sam.lee', year: 2025 });
  });
});

describe('trips on a page', () => {
  const trip = (id, over = {}) => ({
    id, title: ` ${id} trip `, startDate: '2025-05-10', endDate: '2025-05-17', rating: 4.5, excerpt: 'Tram 28',
    notes: 'private', companions: ['p1'], photoIds: ['ph1'], tags: ['food'],
    stops: [{ name: 'Lisbon', displayAddress: 'Rua X 12', lat: 38.72231, lng: -9.13934 }, { name: 'Nowhere', lat: null, lng: 3 }],
    ...over,
  });
  const where = (st) => ({ country: st.lng < -30 ? 'United States' : 'Portugal', state: st.lng < -30 ? 'Illinois' : null });

  it('shows the title, dates, rating, highlight, and places to about a kilometre', () => {
    assert.deepEqual(tripsToShare([trip('a')], where, '2026-09-22'), [{
      trip_id: 'a', title: 'a trip', start: '2025-05-10', end: '2025-05-17', rating: 4.5, highlight: 'Tram 28',
      stops: [{ name: 'Lisbon', lat: 38.72, lng: -9.14, country: 'Portugal', state: '' }],
    }]);
  });

  it('never who went, notes, photos, tags or the street address', () => {
    assert.doesNotMatch(JSON.stringify(tripsToShare([trip('a')], where, '2026-09-22')), /p1|private|ph1|food|Rua/);
  });

  it('not a trip still going: that would say someone is away now', () => {
    const out = tripsToShare([trip('away', { startDate: '2026-09-20', endDate: '2026-09-25' }), trip('today', { startDate: '2026-09-22', endDate: null }),
      trip('home', { startDate: '2026-09-15', endDate: '2026-09-21' })], where, '2026-09-22');
    assert.deepEqual(out.map((t) => t.trip_id), ['home']);
  });

  it('only trips taken: nothing planned, wished for, or yet to start', () => {
    const out = tripsToShare([trip('a'), trip('b', { status: 'planned' }), trip('c', { status: 'someday', startDate: null }),
      trip('d', { startDate: '2026-09-23', endDate: null }), trip('e', { startDate: '2026-09-21', endDate: null })], where, '2026-09-22');
    assert.deepEqual(out.map((t) => t.trip_id), ['a', 'e']);
  });

  it('the same trips always give the same set, and no outlines give no countries', () => {
    assert.deepEqual(tripsToShare([trip('b'), trip('a')], where, '2026-09-22'), tripsToShare([trip('a'), trip('b')], where, '2026-09-22'));
    assert.equal(tripsToShare([trip('a')], null, '2026-09-22')[0].stops[0].country, '');
  });
});

describe('the numbers on a page', () => {
  const trips = [
    A.pageTrip({ id: 't1', title: 'Lisbon', start: '2025-05-10', end: '2025-05-17', stops: [{ name: 'Lisbon', lat: 38.72, lng: -9.14, country: 'Portugal', state: '' }] }),
    A.pageTrip({ id: 't2', title: 'Chicago', start: '2025-12-30', end: '2026-01-02', stops: [
      { name: 'Chicago', lat: 41.88, lng: -87.63, country: 'United States', state: 'Illinois' },
      { name: 'Milwaukee', lat: 43.04, lng: -87.9, country: 'United States', state: 'Wisconsin' }] }),
  ];
  const outings = [{ kind: 'Concert' }, { kind: 'Concert' }, { kind: 'Sports' }];

  it('count trips, countries, US states, days away and outings by kind, leaving out what is none', () => {
    assert.deepEqual(A.pageStats(trips, outings).map((x) => `${x.n} ${x.label}`),
      ['2 trips', '2 countries', '2 US states', '12 days away', '2 concerts', '1 game']);
    assert.deepEqual(A.pageStats([], []), []);
  });

  it('in a year, count only that year\'s days away', () => {
    assert.equal(A.pageStats(trips, [], 2026).find((x) => /day/.test(x.label)).n, 2);
  });
});
