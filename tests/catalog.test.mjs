// The shared catalog from the app's side: reading Wikidata's answers, the
// links an event keeps, and exactly what of an event is shared.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';
import { readWikidata, searchWikidata, cleanLinks, outingsToShare, LINKS_FOR } from '../src/catalog.js';

const A = await loadApp();

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('Wikidata', () => {
  it('keeps items, and leaves out disambiguation pages and anything malformed', () => {
    const out = readWikidata({ search: [
      { id: 'Q223455', label: 'Kansas City Chiefs', description: 'NFL franchise' },
      { id: 'Q224', label: 'Chiefs', description: 'Wikimedia disambiguation page' },
      { id: 'P31', label: 'instance of' },
      { id: 'Q1', label: '   ' },
      null,
      { id: 'Q5', label: 'No description' },
    ] });
    assert.deepEqual(out, [
      { source: 'wikidata', source_id: 'Q223455', name: 'Kansas City Chiefs', about: 'NFL franchise' },
      { source: 'wikidata', source_id: 'Q5', name: 'No description', about: '' },
    ]);
    assert.deepEqual(readWikidata(null), []);
    assert.deepEqual(readWikidata({ search: 'nope' }), []);
  });

  it('asks in the given language, from any site, and remembers the answer', async () => {
    const asked = [];
    const fetchFn = async (url) => { asked.push(new URL(url)); return { ok: true, json: async () => ({ search: [{ id: 'Q2', label: 'Earth' }] }) }; };
    const first = await searchWikidata('  Earth  ', { fetchFn, lang: 'fr-CA' });
    const again = await searchWikidata('earth', { fetchFn, lang: 'fr' });
    assert.equal(first[0].source_id, 'Q2');
    assert.equal(again, first, 'the same answer, not asked twice');
    assert.equal(asked.length, 1);
    const q = asked[0].searchParams;
    assert.deepEqual([q.get('action'), q.get('search'), q.get('language'), q.get('origin')], ['wbsearchentities', 'Earth', 'fr', '*']);
  });

  it('answers nothing, rather than failing, when it cannot be reached or asked', async () => {
    assert.deepEqual(await searchWikidata('offline test', { fetchFn: async () => { throw new Error('down'); } }), []);
    assert.deepEqual(await searchWikidata('bad status', { fetchFn: async () => ({ ok: false }) }), []);
    let called = false;
    assert.deepEqual(await searchWikidata('x', { fetchFn: async () => { called = true; } }), []);
    assert.equal(called, false, 'one letter is not searched');
  });
});

describe('links on an event', () => {
  it('keeps at most ten well-formed links of known kinds', () => {
    const links = [
      { id: ID(1), kind: 'team', name: 'Chiefs', extra: 'dropped' },
      { id: 'not-an-id', kind: 'team', name: 'X' },
      { id: ID(2), kind: 'car', name: 'X' },
      { id: ID(3), kind: 'venue' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: ID(10 + i), kind: 'performer', name: `P${i}` })),
    ];
    const out = cleanLinks(links);
    assert.equal(out.length, 10);
    assert.deepEqual(out[0], { id: ID(1), kind: 'team', name: 'Chiefs' });
    assert.deepEqual(cleanLinks('nope'), []);
  });

  it('are repaired with the rest of an event, and an event without any reads as before', () => {
    const e = { id: 'e', title: 'T', date: '2026-01-01', kind: 'Sports', links: [{ id: ID(1), kind: 'team', name: 'Chiefs' }], review: 'Good', visibility: 'everyone' };
    assert.equal(A.cleanEvent(e), e);
    const bad = A.cleanEvent({ ...e, links: 'x', review: 5, visibility: {} });
    assert.deepEqual([bad.links, bad.review, bad.visibility], [[], '5', '']);
  });

  it('each kind of outing asks for its own kind of entry', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(LINKS_FOR).map(([k, v]) => [k, v.kind])),
      { Concert: 'performer', Sports: 'team', Theater: 'show', Festival: 'festival' });
    assert.deepEqual(Object.keys(LINKS_FOR), A.OUTING_KINDS, 'every outing kind, and only those');
  });
});

describe('what is shared', () => {
  const ev = (id, over = {}) => ({
    id, title: ' Chiefs vs Broncos ', kind: 'Sports', date: '2026-01-05', rating: 4.5, review: ' Loud ', visibility: 'everyone',
    note: 'private note', people: ['p1'], place: 'Arrowhead', lat: 39, lon: -94,
    links: [{ id: ID(1), kind: 'team', name: 'Chiefs' }, { id: ID(2), kind: 'venue', name: 'Arrowhead' }], ...over,
  });
  const share = (events) => outingsToShare(events, A.OUTING_KINDS, '2026-09-22');

  it('sends only the kind, title, date, rating, thoughts, who sees it and the link ids', () => {
    assert.deepEqual(share([ev('a')]), [{
      event_id: 'a', kind: 'Sports', title: 'Chiefs vs Broncos', date: '2026-01-05', rating: 4.5, review: 'Loud', visibility: 'everyone', links: [ID(1), ID(2)],
    }]);
    assert.doesNotMatch(JSON.stringify(share([ev('a')])), /private note|p1|Arrowhead|39/);
  });

  it('leaves out what is kept to yourself, still to come, not an outing, or linked to nothing', () => {
    const out = share([
      ev('me', { visibility: 'me' }), ev('none', { visibility: undefined }), ev('later', { date: '2026-09-23' }),
      ev('milestone', { kind: 'Milestone' }), ev('bare', { links: [] }), ev('friends', { visibility: 'friends' }), ev('today', { date: '2026-09-22' }),
    ]);
    assert.deepEqual(out.map((o) => o.event_id), ['friends', 'today']);
  });

  it('comes out the same whatever order the events are in, so an unchanged set is not sent twice', () => {
    assert.deepEqual(share([ev('b'), ev('a')]), share([ev('a'), ev('b')]));
  });

  it('an unrated outing shares no rating', () => {
    assert.equal(share([ev('a', { rating: 0 })])[0].rating, null);
  });
});
