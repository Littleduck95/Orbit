/*
 * The shared catalog, from the app's side: which kinds of entry an event can
 * link to, finding entries on Wikidata, and what of an event is shared.
 *
 * An entry is a performer, a team, a show, a festival or a venue. Most come
 * from Wikidata, whose item id (Q and digits) makes the Kansas City Chiefs
 * the same entry for everyone; anything it has never heard of can be made in
 * Orbit instead. The entries themselves, and the outings that link to them,
 * live in the account's database (supabase/schema.sql, part 4).
 *
 * Wikidata's search answers anyone, from any site, with no key:
 *   https://www.wikidata.org/w/api.php?action=help&modules=wbsearchentities
 */

export const CATALOG_KINDS = {
  performer: { one: 'performer', many: 'performers' },
  team: { one: 'team', many: 'teams' },
  show: { one: 'show', many: 'shows' },
  festival: { one: 'festival', many: 'festivals' },
  venue: { one: 'venue', many: 'venues' },
};

// What each kind of outing links to, besides where it was: the question the
// form asks, and how many it takes.
export const LINKS_FOR = {
  Concert: { kind: 'performer', label: 'Who played', ph: 'Search for an artist or band', many: true },
  Sports: { kind: 'team', label: 'Who played', ph: 'Search for a team', many: true },
  Theater: { kind: 'show', label: 'Which show', ph: 'Search for a show, play or musical', many: false },
  Festival: { kind: 'festival', label: 'Which festival', ph: 'Search for a festival', many: false },
};

// Who can see an outing's rating and thoughts. 'me' is never shared.
export const OUTING_VISIBILITY = [['everyone', 'Everyone'], ['friends', 'Friends'], ['me', 'Only me']];

export const WIKIDATA = {
  url: 'https://www.wikidata.org/w/api.php',
  page: (qid) => `https://www.wikidata.org/wiki/${qid}`,
  limit: 7,
};

// Pages that are not a thing at all.
const NOT_A_THING = /^(Wikimedia (disambiguation|list|category) page|Wikimedia template|family name|given name|scholarly article)/i;

// Wikidata's answer, as entries not yet in the catalog: { source, source_id,
// name, about }.
export const readWikidata = (body) => (Array.isArray(body?.search) ? body.search : [])
  .filter((r) => r && typeof r.id === 'string' && /^Q[1-9]\d{0,11}$/.test(r.id) && typeof r.label === 'string' && r.label.trim())
  .filter((r) => !NOT_A_THING.test(r.description || ''))
  .map((r) => ({
    source: 'wikidata',
    source_id: r.id,
    name: r.label.trim().slice(0, 200),
    about: typeof r.description === 'string' ? r.description.trim().slice(0, 300) : '',
  }));

const answers = new Map();

// Searches Wikidata by name, in the browser's language. Answers are
// remembered for the visit. Resolves to [] when it cannot be reached, rather
// than failing, since an entry can always be made in Orbit instead.
export const searchWikidata = async (q, { fetchFn = globalThis.fetch, lang } = {}) => {
  const term = String(q || '').trim().replace(/\s+/g, ' ');
  if (term.length < 2) return [];
  const language = (lang || (typeof navigator !== 'undefined' && navigator.language) || 'en').split('-')[0].toLowerCase() || 'en';
  const key = `${language}:${term.toLowerCase()}`;
  if (answers.has(key)) return answers.get(key);
  const url = `${WIKIDATA.url}?${new URLSearchParams({
    action: 'wbsearchentities', search: term, language, uselang: language, type: 'item',
    limit: String(WIKIDATA.limit), format: 'json', origin: '*',
  })}`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return [];
    const found = readWikidata(await res.json());
    answers.set(key, found);
    return found;
  } catch {
    return [];
  }
};

// One event's links, cleaned: at most ten, each an entry id with its kind and
// name kept alongside, so the event reads the same offline.
export const cleanLinks = (v) => (Array.isArray(v) ? v : [])
  .filter((l) => l && typeof l.id === 'string' && /^[0-9a-f-]{36}$/i.test(l.id) && CATALOG_KINDS[l.kind] && typeof l.name === 'string')
  .slice(0, 10)
  .map((l) => ({ id: l.id, kind: l.kind, name: l.name.slice(0, 200) }));

// What of the events is shared, as sync_outings takes it: outings that have
// happened, link to at least one entry, and are set to Everyone or Friends.
// Only the kind, title, date, rating, thoughts and links go; never who went,
// never the private notes. Sorted, so the same events always give the same
// text and nothing is sent twice.
export const outingsToShare = (events, outingKinds, today) => events
  .filter((e) => e && outingKinds.includes(e.kind) && e.date && e.date <= today
    && (e.visibility === 'everyone' || e.visibility === 'friends') && cleanLinks(e.links).length)
  .map((e) => ({
    event_id: String(e.id).slice(0, 100),
    kind: e.kind,
    title: String(e.title).trim().slice(0, 200),
    date: e.date,
    rating: e.rating || null,
    review: String(e.review || '').trim().slice(0, 2000),
    visibility: e.visibility,
    links: cleanLinks(e.links).map((l) => l.id),
  }))
  .sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));

// Trips shown on a person's page (see sync_trips in the schema, part 5):
// only trips taken, never ones still to come, which would say when someone is
// away. Title, dates, rating, highlight, and each stop's name, country and US
// state with its position rounded to about a kilometre. Never who went,
// notes, tags or photos. where(stop) gives { country, state } (see geo.js).
const km = (n) => Math.round(n * 100) / 100;
export const tripsToShare = (trips, where, today) => trips
  .filter((t) => t && !t.status && t.startDate && t.startDate <= today)
  .map((t) => ({
    trip_id: String(t.id).slice(0, 100),
    title: String(t.title).trim().slice(0, 200),
    start: t.startDate,
    end: t.endDate || null,
    rating: t.rating || null,
    highlight: String(t.excerpt || '').trim().slice(0, 300),
    stops: (t.stops || []).filter((st) => typeof st.lat === 'number' && typeof st.lng === 'number').slice(0, 50).map((st) => {
      const w = (where && where(st)) || {};
      return { name: String(st.name || '').slice(0, 200), lat: km(st.lat), lng: km(st.lng), country: w.country || '', state: w.state || '' };
    }),
  }))
  .sort((a, b) => (a.trip_id < b.trip_id ? -1 : a.trip_id > b.trip_id ? 1 : 0));
