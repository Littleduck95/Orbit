// Rated events, Recap's year in events, and what goes on the year's share
// card (the picture itself is checked in the browser, in recapshare).
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { loadApp } from './app.mjs';

const A = await loadApp();

const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const event = (id, title, kind, date, over = {}) => ({
  id, title, kind, date, endDate: null, note: 'private', people: ['p1'], place: '', lat: null, lon: null, addedOn: '2026-01-01', ...over,
});
const EVENTS = [
  event('a', 'Chiefs vs Broncos', 'Sports', '2026-09-14', { rating: 4, place: 'Arrowhead', lat: 39.05, lon: -94.48 }),
  event('b', 'Opening day', 'Sports', '2026-04-02'),
  event('c', 'Phoebe Bridgers', 'Concert', '2026-06-20', { rating: 5 }),
  event('d', 'Hamilton', 'Theater', '2026-10-30'),
  event('e', 'Old show', 'Concert', '2025-06-20', { rating: 5 }),
  event('f', 'Wedding', 'Celebration', '2026-07-04', { rating: 5 }),
  event('g', 'Moved', 'Milestone', '2026-02-01'),
];

describe('rated events', () => {
  it('can be rated once they have happened, and only the kinds you go to', () => {
    assert.equal(A.canRateEvent('Concert', '2026-09-22'), true, 'today counts');
    assert.equal(A.canRateEvent('Concert', '2026-09-23'), false);
    assert.equal(A.canRateEvent('Sports', '2020-01-01'), true);
    for (const k of ['Loss', 'Milestone', 'Work']) assert.equal(A.canRateEvent(k, '2020-01-01'), false, k);
  });

  it('keeps a half-star rating and drops anything else', () => {
    const e = event('x', 'X', 'Concert', '2026-01-01', { rating: 3.5 });
    assert.equal(A.cleanEvent(e), e);
    assert.equal(A.cleanEvent({ ...e, rating: 3.3 }).rating, null);
    assert.equal(A.cleanEvent({ ...e, rating: '4' }).rating, null);
    assert.equal(A.cleanEvent({ ...e, rating: 7 }).rating, null);
    const unrated = event('y', 'Y', 'Concert', '2026-01-01');
    assert.equal(A.cleanEvent(unrated), unrated, 'an event saved before ratings reads as it did');
  });

  it('round-trips a rating through CSV, and an empty cell leaves none', () => {
    const rows = (text) => A.fromCsv(A.EVENT_COLS, Papa.parse(text, { header: true, skipEmptyLines: true }).data, () => ({})).out;
    const [back] = rows(A.toCsv(A.EVENT_COLS, [event('x', 'X', 'Concert', '2026-01-01', { rating: 4.5 })]));
    assert.equal(back.rating, 4.5);
    const [none] = rows(A.toCsv(A.EVENT_COLS, [event('x', 'X', 'Concert', '2026-01-01')]));
    assert.equal('rating' in none, false);
  });

  it('carries its rating into a trip made from it', () => {
    const t = A.eventToTrip(event('x', 'Red Rocks', 'Concert', '2026-06-20', { rating: 4.5, place: 'Morrison, CO', lat: 39.66, lon: -105.2 }));
    assert.equal(t.rating, 4.5);
  });
});

describe('a year of events', () => {
  it('counts the outings that have happened, by kind, and what is still to come', () => {
    const y = A.eventsYear(EVENTS, 2026, '2026-09-22');
    assert.deepEqual(y.counts, [{ kind: 'Concert', n: 1 }, { kind: 'Sports', n: 2 }]);
    assert.deepEqual(y.outings.map((e) => e.id), ['a', 'c', 'b'], 'newest first');
    assert.deepEqual(y.ahead.map((e) => e.id), ['d']);
  });

  it('picks the best-rated event of any kind, the latest on a tie', () => {
    assert.equal(A.eventsYear(EVENTS, 2026, '2026-09-22').best.id, 'f');
    assert.equal(A.eventsYear(EVENTS, 2025, '2026-09-22').best.id, 'e');
    assert.equal(A.eventsYear([], 2026).best, null);
  });
});

describe('the share card', () => {
  const stop = (name, lat, lng) => ({ name, displayAddress: '', lat, lng });
  const trip = (id, title, s, startDate, over = {}) => A.cleanTrip({
    id, title, stops: [s], startDate, companions: ['p1'], notes: 'secret notes',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
  });
  const TRIPS = [
    trip('l', 'Lisbon', stop('Lisbon', 38.72, -9.14), '2026-05-10', { endDate: '2026-05-12', rating: 4.5 }),
    trip('c', 'Chicago', stop('Chicago', 41.88, -87.63), '2026-03-01', { rating: 3 }),
  ];
  const where = (st) => ({ country: st.lng < -30 ? 'United States' : 'Portugal', state: st.lng < -30 ? 'Illinois' : null });
  const PEOPLE = [{ id: 'p1', name: 'Dana Secret', circle: 'friend', log: [{ date: '2026-03-01' }, { date: '2026-04-01' }] }];
  const all = { trips: true, events: true, people: false };
  const make = (over = {}) => A.recapCard({ people: PEOPLE, events: EVENTS, trips: TRIPS, where, year: 2026, include: all, today: '2026-09-22', ...over });

  it('leads with trips and countries, then outings, then the rest, six at most', () => {
    const c = make();
    assert.equal(c.subtitle, 'in trips & events');
    assert.deepEqual(c.stats.map((s) => `${s.n} ${s.label}`),
      ['2 trips', '2 countries', '1 concert', '2 games', '4 days away', '1 US state']);
    assert.deepEqual(c.countries, ['Portugal', 'United States']);
    assert.deepEqual(c.pins, [{ lat: 39.05, lng: -94.48 }], 'outings with a pin');
  });

  it('names the best trip and the best event', () => {
    assert.deepEqual(make().highlights, [
      { label: 'Top-rated trip', title: 'Lisbon', rating: 4.5, sub: 'May 10–12, 2026' },
      { label: 'Top-rated event', title: 'Wedding', rating: 5, sub: 'Jul 4, 2026' },
    ]);
  });

  it('never carries who anyone was with, or notes, and catch-ups only as a count when asked', () => {
    const text = JSON.stringify(make({ include: { ...all, people: true } }));
    assert.doesNotMatch(text, /Dana|Secret|secret notes|private|p1/);
    assert.match(A.recapCardText(make({ include: { ...all, people: true } })), /2 catch-ups/);
    assert.doesNotMatch(A.recapCardText(make()), /catch-up/);
  });

  it('leaves out what is unticked, and says when nothing is left', () => {
    const trips = make({ include: { trips: true, events: false, people: false } });
    assert.equal(trips.subtitle, 'in trips');
    assert.equal(trips.highlights.length, 1);
    assert.deepEqual(trips.pins, []);
    const events = make({ include: { trips: false, events: true, people: false } });
    assert.equal(events.subtitle, 'in events');
    assert.deepEqual(events.countries, []);
    assert.equal(make({ include: { trips: false, events: false, people: false } }).empty, true);
    assert.equal(make({ year: 2019 }).empty, true, 'a year with nothing in it');
  });

  it('has no countries until the outlines load', () => {
    const c = make({ where: null });
    assert.deepEqual(c.countries, []);
    assert.ok(!c.stats.some((s) => /countr/.test(s.label)));
  });

  it('keeps the name short', () => {
    assert.equal(make({ name: `  ${'x'.repeat(100)}  ` }).name.length, 60);
  });
});
