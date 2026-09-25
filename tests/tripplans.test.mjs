// Trips still to come (planned, someday), the counts on Trips and in Recap,
// and the country and state lookup behind them.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';
import * as geo from '../src/geo.js';

const A = await loadApp();

const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const stop = (name, lat, lng) => ({ name, displayAddress: '', lat, lng });
const trip = (over = {}) => A.cleanTrip({
  id: 't1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Lisbon', stops: [stop('Lisbon', 38.72, -9.14)], startDate: '2025-05-03', ...over,
});

describe('trips still to come', () => {
  it('a trip you took needs its start date; one to come does not', () => {
    assert.equal(trip({ startDate: null }), null);
    const planned = trip({ status: 'planned', startDate: null, endDate: '2026-12-01' });
    assert.deepEqual([planned.status, planned.startDate, planned.endDate], ['planned', null, null], 'an end with no start is dropped');
    assert.equal(trip({ status: 'planned', startDate: '2026-12-01' }).startDate, '2026-12-01');
  });

  it('someday keeps no dates and no rating; nor does planned keep a rating', () => {
    const s = trip({ status: 'someday', startDate: '2026-12-01', endDate: '2026-12-05', rating: 4 });
    assert.deepEqual([s.status, s.startDate, s.endDate, s.rating], ['someday', null, null, null]);
    assert.equal(trip({ status: 'planned', startDate: '2026-12-01', rating: 5 }).rating, null);
  });

  it('a trip you took reads exactly as before, with no status saved', () => {
    assert.equal('status' in trip({}), false);
    assert.equal('status' in trip({ status: 'been' }), false);
    assert.equal('status' in trip({ status: 'nonsense' }), false);
  });

  it('says when, even without dates', () => {
    assert.equal(A.tripWhen(trip({ status: 'someday' })).text, 'Someday');
    assert.equal(A.tripWhen(trip({ status: 'planned', startDate: null })).text, 'Dates to come');
    assert.deepEqual(A.tripYears(trip({ status: 'someday' })), []);
  });

  it('asks whether a planned trip happened once its dates are past', () => {
    assert.equal(A.tripOverdue(trip({ status: 'planned', startDate: '2026-09-01', endDate: '2026-09-05' }), '2026-09-22'), true);
    assert.equal(A.tripOverdue(trip({ status: 'planned', startDate: '2026-09-20', endDate: '2026-09-25' }), '2026-09-22'), false, 'still on');
    assert.equal(A.tripOverdue(trip({ status: 'planned', startDate: null }), '2026-09-22'), false);
    assert.equal(A.tripOverdue(trip({ startDate: '2026-09-01' }), '2026-09-22'), false, 'already been');
  });

  it('groups trips: coming up soonest first, been newest first, someday last added first', () => {
    const list = [
      trip({ id: 'b1', startDate: '2024-01-01' }), trip({ id: 'b2', startDate: '2025-01-01' }),
      trip({ id: 'p1', status: 'planned', startDate: '2027-03-01' }), trip({ id: 'p2', status: 'planned', startDate: '2026-11-01' }),
      trip({ id: 'p3', status: 'planned', startDate: null }),
      trip({ id: 's1', status: 'someday', createdAt: '2026-01-01T00:00:00Z' }), trip({ id: 's2', status: 'someday', createdAt: '2026-02-01T00:00:00Z' }),
    ];
    const g = A.tripGroups(list);
    assert.deepEqual([g.planned, g.been, g.someday].map((x) => x.map((t) => t.id).join()), ['p2,p1,p3', 'b2,b1', 's2,s1']);
  });

  it('filters by status', () => {
    const list = [trip({ id: 'b' }), trip({ id: 'p', status: 'planned' }), trip({ id: 's', status: 'someday' })];
    const ids = (status) => A.filterTrips(list, { ...A.NO_TRIP_FILTER, status }).map((t) => t.id).join();
    assert.deepEqual(['', 'been', 'planned', 'someday'].map(ids), ['b,p,s', 'b', 'p', 's']);
  });

  it('draws trips to come as hollow pins', () => {
    const [p] = A.tripPoints([trip({ status: 'planned' })]);
    const [s] = A.tripPoints([trip({ status: 'someday' })]);
    const [b] = A.tripPoints([trip({ rating: 4 })]);
    assert.deepEqual([p.hollow, s.hollow, b.hollow], ['planned', 'someday', '']);
    assert.deepEqual([p.color, s.color], [A.PLAN_COLORS.planned, A.PLAN_COLORS.someday]);
  });

  it('sends its status in a share, so a wish arrives as a wish', async () => {
    const t = trip({ status: 'someday', title: 'Northern lights' });
    const got = await A.readAnyShare(`#share=${await A.encodeShare(await A.tripSharePayload(t, {}))}`);
    assert.deepEqual([got.trip.status, got.trip.startDate, got.trip.title], ['someday', null, 'Northern lights']);
  });
});

describe('counting trips', () => {
  const been = [
    trip({ id: 'a', title: 'Chicago', stops: [stop('Chicago', 41.88, -87.63)], startDate: '2026-05-10', endDate: '2026-05-14' }),
    trip({ id: 'b', title: 'Chicago again', stops: [stop('The Loop', 41.88, -87.63), stop('Evanston', 42.05, -87.69)], startDate: '2025-06-10' }),
    trip({ id: 'c', title: 'Lisbon', stops: [stop('Lisbon', 38.72, -9.14), stop('Porto', 41.15, -8.61)], startDate: '2026-09-20', endDate: '2026-09-30' }),
    trip({ id: 'd', title: 'Overlap', stops: [stop('Chicago', 41.9, -87.6)], startDate: '2026-05-13', endDate: '2026-05-15' }),
  ];
  const plans = [trip({ id: 'p', status: 'planned', stops: [stop('Tokyo', 35.68, 139.69)], startDate: '2026-11-02' })];

  it('groups stops into places and finds the most visited', () => {
    const places = A.tripPlaces([...been, ...plans]);
    assert.equal(places.length, 4, 'Chicago (with Evanston nearby), Lisbon, Porto, not the plan');
    assert.deepEqual([places[0].name, places[0].trips], ['Chicago', 3]);
  });

  it('counts each day away once, only up to today', () => {
    // May 10–15 with the overlap counted once: 6. Lisbon Sept 20–22 so far: 3.
    assert.equal(A.daysAway([...been, ...plans], 2026, '2026-09-22'), 9);
    assert.equal(A.daysAway(been, 2025, '2026-09-22'), 1);
  });

  it('counts countries and US states from where each stop is', () => {
    const where = (st) => ({ country: st.lng < -30 ? 'United States' : 'Portugal', state: st.lng < -30 ? 'Illinois' : null });
    const s = A.tripStats([...been, ...plans], where, 2026, '2026-09-22');
    assert.deepEqual([[...s.countries].sort(), [...s.states], s.trips, s.places, s.top.name, s.days],
      [['Portugal', 'United States'], ['Illinois'], 4, 4, 'Chicago', 9]);
    assert.equal(A.tripStats(been, null, 2026).countries, null, 'unknown until the outlines load');
  });

  it('sums up a year for Recap, with the countries seen for the first time', () => {
    const where = (st) => ({ country: st.lng < -30 ? 'United States' : 'Portugal', state: null });
    const y = A.tripYear([...been, ...plans], where, 2026, '2026-09-22');
    assert.deepEqual(y.trips.map((t) => t.id), ['c', 'd', 'a']);
    assert.deepEqual(y.firsts, ['Portugal'], 'the US was seen in 2025');
    assert.equal(y.days, 9);
    const rated = A.tripYear([trip({ id: 'x', startDate: '2026-01-01', rating: 3 }), trip({ id: 'y', startDate: '2026-02-01', rating: 4.5 })], where, 2026);
    assert.equal(rated.best.id, 'y');
  });
});

describe('where a place is', () => {
  it('finds the country, and the state in the US', () => {
    assert.deepEqual(geo.whereIs(39.1, -84.5), { country: 'United States', state: 'Ohio' });
    assert.deepEqual(geo.whereIs(38.72, -9.14), { country: 'Portugal', state: null });
    assert.deepEqual(geo.whereIs(21.3, -157.85), { country: 'United States', state: 'Hawaii' });
    assert.equal(geo.whereIs(1.29, 103.85).country, 'Singapore', 'small countries too');
    assert.equal(geo.whereIs(49.6, 6.13).country, 'Luxembourg');
  });

  it('writes shortened names out in full', () => {
    assert.equal(geo.whereIs(18.5, -69.9).country, 'Dominican Republic');
    assert.ok(!geo.COUNTRIES.some((c) => c.name.includes('.')), 'no abbreviations left');
  });

  it('gives a stop just off the coast to the country beside it, and the open sea to none', () => {
    assert.equal(geo.whereIs(38.69, -9.45).country, 'Portugal', 'Cascais seafront');
    assert.deepEqual(geo.whereIs(0, -30), { country: null, state: null });
  });

  it('hands back the outlines of the places named, for shading', () => {
    const fc = geo.shapesNamed(new Set(['Portugal', 'United States']), new Set(['Ohio']));
    assert.deepEqual(fc.features.map((f) => `${f.properties.kind}:${f.properties.name}`).sort(),
      ['country:Portugal', 'country:United States', 'state:Ohio']);
  });
});
