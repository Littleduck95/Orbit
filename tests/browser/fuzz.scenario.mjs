// Saved data with fields of the wrong shape (a hand edit, an older version,
// another tool), drawn in every tab. Nothing here may crash the app: the
// recovery screen must never appear and nothing may throw.
//
// A few React warnings about odd values are known and allowed (see KNOWN);
// they come from drawing such values as they are, and do not break anything.
// Any other console error still fails.
const JUNK = [null, true, false, 0, 1, -3.5, '', 'text', '2026-13-45', 'March 3', '2026-09-01', [], {}, [1, 'a', null], { a: 1 }, ['x', 2], '=1+1'];
const KNOWN = new RegExp([
  'Received NaN for the `%s` attribute', // a NaN age or date count drawn as text, or an SVG coordinate
  '<circle> attribute c[xy]: Expected length, "NaN"',
  'Encountered two children with the same key', // two records with the same junk id
  'The `%s` prop supplied to <select> must be a scalar value', // a list where the form expects one choice
].join('|'));

export default async function fuzz({ newPage, check }) {
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  // Replaces one to four fields, or fields of a nested entry, with junk.
  const junkInto = (obj, depth = 0) => {
    const keys = Object.keys(obj);
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i += 1) {
      const k = pick(keys);
      const v = obj[k];
      if (depth < 2 && Array.isArray(v) && v.length && typeof v[0] === 'object' && rnd() < 0.6) junkInto(v[0], depth + 1);
      else if (depth < 2 && v && typeof v === 'object' && !Array.isArray(v) && rnd() < 0.6) junkInto(v, depth + 1);
      else obj[k] = structuredClone(pick(JUNK));
    }
    return obj;
  };
  const person = (i) => ({
    id: `p${i}`, name: `Person ${i}`, circle: 'friend', tier: 'friend', cadence: 30, log: [{ date: '2026-09-01', text: 'hi' }],
    lastContact: '2026-09-01', birthday: '1990-03-05', dates: [{ kind: 'Moved', label: '', date: '2020-01-01' }],
    socials: { instagram: 'h' }, partner: { name: 'P', status: 'married' }, aka: ['A'], kids: ['K'], families: ['F'], groups: ['G'],
    email: 'e@x.com', phone: '1', address: 'Chicago, IL', note: 'n', relation: 'r', role: 'r', company: 'c', hobbies: 'h',
    addedOn: '2026-01-01', ageAsOf: '2026-01-01', age: 30, vip: false, paused: false, child: false,
  });
  const event = (i) => ({ id: `e${i}`, title: `Event ${i}`, date: '2026-05-01', endDate: '2026-05-03', kind: 'Trip', place: 'Denver',
    note: 'n', addedOn: '2026-05-01', people: ['p0'], lat: 39.7, lon: -104.9 });
  const reminder = (i) => ({ id: `r${i}`, title: `Reminder ${i}`, kind: 'Home', next: '2026-10-01', every: { unit: 'month', n: 1, dom: 1 },
    anchor: 'date', lead: 3, history: [{ date: '2026-09-01' }], people: ['p0'], note: '', lastDone: '2026-09-01', paused: false, done: false });
  const list = (i) => ({
    id: `l${i}`, name: `List ${i}`, kind: 'Books', track: true, labels: { want: 'Want', doing: 'Doing', done: 'Done' }, detail: 'Author',
    sort: 'manual', addedOn: '2026-01-01', updatedAt: '2026-09-01T00:00:00.000Z',
    items: [{ id: `l${i}i0`, title: 'Dune', detail: 'Herbert', status: 'want', rating: 3, link: 'https://example.com', note: 'n', from: null, addedOn: '2026-01-01', doneOn: null }],
  });

  const ROUNDS = 12;
  const bad = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const data = {
      'crm-people-v1': Array.from({ length: 4 }, (_, i) => junkInto(person(i))),
      'crm-events-v1': Array.from({ length: 3 }, (_, i) => junkInto(event(i))),
      'crm-reminders-v1': Array.from({ length: 3 }, (_, i) => junkInto(reminder(i))),
      'crm-collections-v1': Array.from({ length: 2 }, (_, i) => junkInto(list(i))),
    };
    const { page, open, problems, done } = await newPage({ seed: data });
    const crashed = async () => (await page.getByRole('alert').filter({ hasText: 'Orbit hit a problem' }).count()) > 0;
    // Clicks only what is there, so a step never waits on something the data left out.
    const tap = async (locator) => { if (await locator.count()) await locator.first().click(); };
    let where = 'load';
    const steps = [
      ['people list', () => tap(page.getByRole('button', { name: /^Everyone/ }))],
      ...[0, 1, 2, 3].flatMap((i) => [
        [`open person ${i}`, () => tap(page.locator('.crm-person .crm-row').nth(i))],
        [`edit person ${i}`, async () => {
          await tap(page.getByRole('button', { name: 'Edit', exact: true }));
          await tap(page.getByRole('button', { name: 'Cancel', exact: true }));
        }],
      ]),
      ...['Events', 'Reminders', 'Trips', 'Recap', 'Lists'].map((t) => [`tab ${t}`, () => tap(page.getByRole('button', { name: t, exact: true }))]),
      ['open a list', () => tap(page.getByText('List 0', { exact: true }))],
      ['export', async () => {
        await tap(page.getByRole('button', { name: 'More', exact: true }));
        await tap(page.getByRole('button', { name: 'Export', exact: true }));
        await page.getByLabel(/^Catch-up log/).check();
        await tap(page.getByRole('button', { name: 'Export CSV' }));
        await tap(page.getByRole('button', { name: 'Done', exact: true }));
      }],
      ['back up', () => tap(page.getByRole('button', { name: 'Back up' }))],
    ];
    try {
      await open();
      for (const [name, run] of steps) {
        if (await crashed()) break;
        where = name;
        await run();
      }
    } catch (e) {
      problems.push(`step "${where}" failed: ${e.message.split('\n')[0]}`);
    }
    const unexpected = problems.filter((p) => !KNOWN.test(p));
    if (await crashed() || unexpected.length) bad.push(`round ${round} at "${where}": ${unexpected.slice(0, 2).join(' | ') || 'recovery screen'}`);
    await done({ allow: KNOWN });
  }
  check(`${ROUNDS} sets of wrongly shaped saved data are drawn in every tab without a crash`, bad.length === 0, bad.join(' || '));
}
