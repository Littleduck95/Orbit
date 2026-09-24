// Trips: the record, filters, merging, sharing, backup files and place search.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';

const A = await loadApp();

const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const stop = (name, lat, lng, displayAddress = '') => ({ name, displayAddress, lat, lng });
const trip = (over = {}) => A.cleanTrip({
  id: 't1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Lisbon', stops: [stop('Lisbon', 38.7, -9.1)], startDate: '2025-05-03', ...over,
});

describe('the trip record', () => {
  it('needs a title, a usable place and a start date', () => {
    assert.equal(A.cleanTrip({ title: 'x', stops: [stop('a', 1, 2)] }), null, 'no start date');
    assert.equal(A.cleanTrip({ title: ' ', stops: [stop('a', 1, 2)], startDate: '2025-01-01' }), null, 'no title');
    assert.equal(A.cleanTrip({ title: 'x', stops: [stop('a', 91, 2)], startDate: '2025-01-01' }), null, 'no usable place');
    assert.equal(A.cleanTrip('a string'), null);
  });

  it('keeps the fields it is given, in their places', () => {
    const t = trip({
      endDate: '2025-05-10', rating: 4, excerpt: 'Nata.', notes: 'Hills.', companions: ['dana', 'dana', 3],
      photoIds: ['p1', 'p2'], tags: ['Food', 'food', ' family '],
    });
    assert.deepEqual(
      { ...t },
      {
        id: 't1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', title: 'Lisbon',
        stops: [{ name: 'Lisbon', displayAddress: '', lat: 38.7, lng: -9.1 }], startDate: '2025-05-03', endDate: '2025-05-10',
        rating: 4, excerpt: 'Nata.', notes: 'Hills.', companions: ['dana'], photoIds: ['p1', 'p2'], tags: ['Food', 'family'],
      },
    );
  });

  it('puts dates the right way round and drops an end date equal to the start', () => {
    const t = trip({ startDate: '2025-05-10', endDate: '2025-05-03' });
    assert.deepEqual([t.startDate, t.endDate], ['2025-05-03', '2025-05-10']);
    assert.equal(trip({ endDate: '2025-05-03' }).endDate, null);
    assert.equal(trip({ endDate: 'soon' }).endDate, null);
  });

  it('only keeps whole-star ratings from 1 to 5', () => {
    assert.equal(trip({ rating: 0 }).rating, null);
    assert.equal(trip({ rating: 6 }).rating, null);
    assert.equal(trip({ rating: 3.5 }).rating, null);
    assert.equal(trip({ rating: '4' }).rating, null);
    assert.equal(trip({ rating: 5 }).rating, 5);
  });

  it('caps the highlight at 280 characters and a trip at 30 photos', () => {
    assert.equal(trip({ excerpt: 'x'.repeat(400) }).excerpt.length, 280);
    assert.equal(trip({ photoIds: Array.from({ length: 40 }, (_, i) => `p${i}`) }).photoIds.length, 30);
  });

  it('reads a stop saved with lon, or coordinates as text, and names an unnamed one', () => {
    const t = trip({ stops: [{ lat: '41.15', lon: '-8.61', displayAddress: 'Porto, Portugal' }, { lat: 1, lng: 2 }, { lat: 'x', lng: 2 }] });
    assert.deepEqual(t.stops, [
      { name: 'Porto', displayAddress: 'Porto, Portugal', lat: 41.15, lng: -8.61 },
      { name: '1.0000, 2.0000', displayAddress: '', lat: 1, lng: 2 },
    ]);
  });

  it('is unchanged by cleaning twice', () => {
    const t = trip({ endDate: '2025-06-01', tags: ['a'], rating: 2 });
    assert.deepEqual(A.cleanTrip(t), t);
  });

  it('keeps a saved list whole, dropping bad records and repeated ids', () => {
    const list = A.cleanTrips([trip(), trip(), { title: 'bad' }, null, trip({ id: 't2' })]);
    assert.deepEqual(list.map((t) => t.id), ['t1', 't2']);
    assert.deepEqual(A.cleanTrips('nope'), []);
  });
});

describe('looking at trips', () => {
  const trips = [
    trip({ id: 'a', title: 'New Year in Lisbon', startDate: '2024-12-30', endDate: '2025-01-02', rating: 5, companions: ['dana'], tags: ['Family'] }),
    trip({ id: 'b', title: 'Upstate', startDate: '2026-02-14', rating: 2, companions: ['sam'] }),
    trip({ id: 'c', title: 'Porto', startDate: '2025-06-01', stops: [stop('Porto', 41.1, -8.6), stop('Braga', 41.5, -8.4)] }),
  ];

  it('counts a trip in every year it touched', () => {
    assert.deepEqual(A.tripYears(trips[0]), [2024, 2025]);
    assert.deepEqual(A.tripFilterOptions(trips).years, [2026, 2025, 2024]);
  });

  it('sorts newest first', () => {
    assert.deepEqual(A.sortTrips(trips).map((t) => t.id), ['b', 'c', 'a']);
  });

  it('filters by year, rating, companion and tag', () => {
    const ids = (f) => A.filterTrips(trips, { ...A.NO_TRIP_FILTER, ...f }).map((t) => t.id).sort().join();
    assert.equal(ids({}), 'a,b,c');
    assert.equal(ids({ year: '2025' }), 'a,c');
    assert.equal(ids({ minRating: 2 }), 'a,b');
    assert.equal(ids({ minRating: 5 }), 'a');
    assert.equal(ids({ companion: 'sam' }), 'b');
    assert.equal(ids({ tag: 'family' }), 'a', 'tags match without case');
    assert.equal(ids({ year: '2026', companion: 'dana' }), '');
  });

  it('puts one pin on the map per stop, coloured by rating', () => {
    const pins = A.tripPoints(trips);
    assert.equal(pins.length, 4);
    const porto = pins.filter((p) => p.tripId === 'c');
    assert.deepEqual(porto.map((p) => p.label), ['Porto: Porto', 'Porto: Braga']);
    assert.equal(pins.find((p) => p.tripId === 'a').color, A.RATING_COLORS[5]);
    assert.equal(porto[0].color, A.RATING_COLORS[0], 'unrated');
    assert.equal(porto[0].text, '');
  });

  it('says when a trip was, collapsing what repeats', () => {
    assert.equal(A.tripWhen(trip({ startDate: '2025-05-03', endDate: '2025-05-10' })).text, 'May 3–10, 2025');
    assert.equal(A.tripWhen(trip({ startDate: '2025-05-03', endDate: '2025-05-10' })).days, 8);
  });

  it('turns a pinned event into a trip that remembers where it came from', () => {
    const t = A.eventToTrip({ id: 'e1', title: 'Moved', date: '2026-06-03', place: 'Denver, Colorado', lat: 39.7, lon: -104.9, people: ['dana'], kind: 'Milestone', note: 'Big day.' });
    assert.equal(t.fromEvent, 'e1');
    assert.deepEqual(t.stops, [{ name: 'Denver', displayAddress: 'Denver, Colorado', lat: 39.7, lng: -104.9 }]);
    assert.deepEqual([t.companions, t.tags, t.notes], [['dana'], ['Milestone'], 'Big day.']);
  });
});

describe('merging a backup by id', () => {
  const stamp = (x) => x.updatedAt;
  it('adds what is missing and never duplicates', () => {
    const r = A.mergeById([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual(r.list.map((x) => x.id), ['a', 'b']);
    assert.deepEqual([r.added, r.updated], [1, 0]);
    const again = A.mergeById(r.list, [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual([again.list.length, again.added, again.updated], [2, 0, 0]);
  });

  it('takes the newer copy when both say when they changed', () => {
    const mine = { id: 'a', v: 'mine', updatedAt: '2026-02-01' };
    assert.equal(A.mergeById([mine], [{ id: 'a', v: 'old', updatedAt: '2026-01-01' }], stamp).list[0].v, 'mine');
    const r = A.mergeById([mine], [{ id: 'a', v: 'new', updatedAt: '2026-03-01' }], stamp);
    assert.deepEqual([r.list[0].v, r.updated], ['new', 1]);
  });

  it('keeps what is here when there is nothing to compare', () => {
    assert.equal(A.mergeById([{ id: 'a', v: 'mine' }], [{ id: 'a', v: 'theirs' }]).list[0].v, 'mine');
  });
});

describe('sharing a trip', () => {
  const t = trip({ endDate: '2025-05-10', rating: 4, excerpt: 'Nata.', notes: 'Private.', companions: ['dana'], photoIds: ['p1'], tags: ['food'] });

  it('round-trips through a link, without who went or the photos', () => {
    const got = A.readSharedTrip(`https://orbit.example/#trip=${A.tripShareCode(t, { notes: false, by: 'Chris' })}`);
    assert.equal(got.by, 'Chris');
    assert.deepEqual(
      [got.trip.title, got.trip.stops, got.trip.startDate, got.trip.endDate, got.trip.rating, got.trip.excerpt, got.trip.tags],
      [t.title, t.stops, t.startDate, t.endDate, t.rating, t.excerpt, t.tags],
    );
    assert.deepEqual([got.trip.companions, got.trip.photoIds, got.trip.notes], [[], [], '']);
    assert.notEqual(got.trip.id, t.id, 'always a new trip');
  });

  it('carries notes only when asked', () => {
    assert.equal(A.readSharedTrip(A.tripShareCode(t, { notes: true })).trip.notes, 'Private.');
  });

  it('is not confused with a shared list, either way round', () => {
    const tripCode = A.tripShareCode(t, { notes: false });
    assert.equal(A.readShared(tripCode), null);
    assert.equal(A.readShared(`#trip=${tripCode}`), null);
    const listCode = A.shareCode({ name: 'Books', kind: 'Books', track: true, items: [{ title: 'Dune' }] }, { notes: false });
    assert.equal(A.readSharedTrip(listCode), null);
    assert.equal(A.readSharedTrip('#trip=nonsense!!'), null);
  });

  it('writes a plain-text copy without people', () => {
    const text = A.tripText(t, { notes: false });
    assert.ok(text.startsWith('Lisbon\n\nMay 3–10, 2025  ★★★★☆'), text);
    assert.ok(!text.includes('Private') && !text.includes('dana'));
  });
});

describe('backup and trip files', () => {
  const jpeg = (n) => new Blob([new Uint8Array(n).fill(7)], { type: 'image/jpeg' });
  const store = {
    p1: { blob: jpeg(5000), thumb: jpeg(500), width: 1600, height: 900 },
    p2: { blob: jpeg(4000), thumb: null, width: 800, height: 600 },
  };
  const load = async (id) => store[id] || null;

  it('round-trips a backup, photos included', async () => {
    const t = trip({ photoIds: ['p1', 'p2', 'gone'] });
    const manifest = {
      kind: 'orbit-backup', version: 1, people: [{ id: 'dana', name: 'Dana' }], events: [], reminders: [], collections: [], trips: [t],
      photos: ['p1', 'p2', 'gone'].map((id) => ({ id, tripId: 't1' })),
    };
    const steps = [];
    const zip = await A.packZip(manifest, load, (d, n) => steps.push(`${d}/${n}`));
    assert.deepEqual(steps, ['1/3', '2/3', '3/3']);
    const { parts, photos } = await A.readBackupFile(zip);
    assert.deepEqual(parts.trips, [t]);
    assert.equal(parts.people[0].name, 'Dana');
    assert.deepEqual(photos.map((p) => [p.id, p.blob.size, p.thumb?.size ?? null, p.width]), [['p1', 5000, 500, 1600], ['p2', 4000, null, 800]]);
    assert.equal(photos[0].blob.type, 'image/jpeg');
  });

  it('reads a pasted-style JSON backup saved as a file', async () => {
    const { parts, photos } = await A.readBackupFile(new Blob([JSON.stringify({ people: [{ name: 'Sam' }] })]));
    assert.equal(parts.people[0].name, 'Sam');
    assert.deepEqual(photos, []);
  });

  it('tells a backup and a shared trip apart', async () => {
    const shared = await A.packZip(A.tripPackage(trip({ photoIds: ['p1'] }), { notes: false, by: 'Chris' }), load);
    await assert.rejects(A.readBackupFile(shared), /shared trip, not a backup/);
    const got = await A.readTripFile(shared);
    assert.deepEqual([got.by, got.trip.title, got.trip.companions, got.photos.length], ['Chris', 'Lisbon', [], 1]);
    const backup = await A.packZip({ kind: 'orbit-backup', people: [{ name: 'x' }], photos: [] }, load);
    await assert.rejects(A.readTripFile(backup), /full Orbit backup/);
  });

  it('turns away files that are not Orbit files', async () => {
    await assert.rejects(A.readBackupFile(new Blob(['PK garbage'])), /could not be read/);
    await assert.rejects(A.readBackupFile(new Blob(['{"hello":1}'])), /nothing in it/);
  });

  it('ignores anything in a zip it does not expect, such as a path out of the folder', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const bytes = zipSync({
      'orbit.json': strToU8(JSON.stringify({ kind: 'orbit-backup', people: [{ name: 'x' }], photos: [{ id: '../evil' }, { id: 'ok' }] })),
      '../evil.jpg': new Uint8Array([1]),
      'photos/ok.jpg': new Uint8Array([1, 2]),
    });
    const { photos } = await A.readBackupFile(new Blob([bytes]));
    assert.deepEqual(photos.map((p) => p.id), ['ok']);
  });
});

describe('place search', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; });

  it('asks Nominatim, keeps a second between requests, and remembers answers', async () => {
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push({ url: String(url), at: performance.now() });
      return { ok: true, json: async () => [{ name: 'Porto', display_name: 'Porto, Portugal', lat: '41.1', lon: '-8.6' }, { lat: 'x' }] };
    };
    const a = await A.searchPlaces('Porto one');
    const b = await A.searchPlaces('Porto two');
    const c = await A.searchPlaces('porto ONE');
    assert.equal(asked.length, 2, 'the repeated search is answered from memory');
    assert.ok(asked[0].url.startsWith('https://nominatim.openstreetmap.org/search?'));
    assert.ok(asked[0].url.includes('format=jsonv2'));
    assert.ok(asked[1].at - asked[0].at >= 990, `requests ${asked[1].at - asked[0].at}ms apart`);
    assert.deepEqual(a, { status: 'ok', results: [{ label: 'Porto, Portugal', name: 'Porto', lat: 41.1, lon: -8.6 }] });
    assert.deepEqual(b, a);
    assert.equal(c, a);
  });

  it('reports a failed request as offline, not as no match', async () => {
    globalThis.fetch = async () => { throw new TypeError('network down'); };
    assert.equal((await A.searchPlaces('Nowhere at all')).status, 'offline');
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    assert.equal((await A.searchPlaces('Too many')).status, 'offline');
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    assert.equal((await A.searchPlaces('Xyzzy')).status, 'none');
  });
});
