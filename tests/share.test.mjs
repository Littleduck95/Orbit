// Sharing a person as a copy: what may leave, what may come in, and how an
// incoming person is matched and merged with someone already here.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './app.mjs';

const A = await loadApp();

const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

// Every field a person can have, each holding text that can be searched for
// in the encoded share.
const dana = () => ({
  id: 'id-dana-SECRET', addedOn: '2020-01-01', name: 'Dana Whitfield', circle: 'friend',
  tier: 'bestie', relation: 'Cousin', vip: true, paused: true, child: false,
  role: 'Designer', company: 'Hallmark', aka: ['Dee'],
  email: 'dana@example.com', phone: '+1 (816) 555-0142', address: '4512 Wornall Rd',
  birthday: '1990-06-14', age: null, ageAsOf: null,
  dates: [{ kind: 'Wedding anniversary', label: '', date: '2018-09-22' }, { kind: 'Other', label: 'Sober since', date: '2021-03-01' }],
  partner: { name: 'Sam Whitfield', status: 'Married' }, kids: ['Milo', 'June'],
  socials: { instagram: 'danawhit', linkedin: 'dana-w' }, hobbies: 'Climbing',
  note: 'PRIVATE-NOTE owes me $40', groups: ['Book club'], families: ['Whitfields'], cadence: 14,
  lastContact: '2026-09-01', log: [{ date: '2026-09-01', text: 'PRIVATE-LOG talked about the move' }],
});

const allOn = () => Object.fromEntries(A.PERSON_SHARE_FIELDS.map((f) => [f.key, true]));
const allOff = () => Object.fromEntries(A.PERSON_SHARE_FIELDS.map((f) => [f.key, false]));
const roundTrip = async (list, by = 'Brock') => A.readAnyShare(await A.encodeShare(A.sharePeoplePayload(list, { by })));

// Text of each field, as it would appear in the JSON of a share.
const SECRETS = {
  work: ['Designer', 'Hallmark'], aka: ['Dee'], email: ['dana@example.com'], phone: ['555-0142'],
  address: ['Wornall'], birthday: ['1990-06-14'], dates: ['2018-09-22', 'Sober since'],
  partner: ['Sam Whitfield'], kids: ['Milo'], socials: ['danawhit'], hobbies: ['Climbing'],
  note: ['PRIVATE-NOTE'], groups: ['Book club'], families: ['Whitfields'], cadence: ['"c":14'],
};
const NEVER = ['SECRET', 'bestie', 'Cousin', 'PRIVATE-LOG', '2026-09-01', '2020-01-01', '"vip"', '"paused"', 'friend', 'circle', 'tier'];

describe('what a person share may carry', () => {
  it('starts with only role, company and also-known-as ticked, and offers only fields the person has', () => {
    const picks = A.defaultPicks(dana());
    assert.deepEqual(Object.keys(picks).filter((k) => picks[k]).sort(), ['aka', 'work']);
    assert.deepEqual(Object.keys(A.defaultPicks({ name: 'Just a name' })), [], 'nothing to offer for an empty card');
    const priv = A.PERSON_SHARE_FIELDS.filter((f) => f.private).map((f) => f.key).sort();
    assert.deepEqual(priv, ['cadence', 'families', 'groups', 'note']);
    assert.ok(A.PERSON_SHARE_FIELDS.filter((f) => f.private).every((f) => !f.on), 'nothing private starts ticked');
  });

  it('with nothing ticked, sends the name and nothing else', () => {
    assert.deepEqual(A.sharePerson(dana(), allOff()), { n: 'Dana Whitfield' });
  });

  it('an unticked field never appears in the share, for every field', () => {
    for (const f of A.PERSON_SHARE_FIELDS) {
      const picks = { ...allOn(), [f.key]: false };
      const json = JSON.stringify(A.sharePerson(dana(), picks));
      for (const s of SECRETS[f.key]) assert.ok(!json.includes(s), `${f.key} unticked but "${s}" was sent`);
    }
  });

  it('each ticked field goes, and nothing beyond it', () => {
    for (const f of A.PERSON_SHARE_FIELDS) {
      const json = JSON.stringify(A.sharePerson(dana(), { ...allOff(), [f.key]: true }));
      for (const s of SECRETS[f.key]) assert.ok(json.includes(s), `${f.key} ticked but "${s}" missing`);
      for (const [other, texts] of Object.entries(SECRETS)) {
        if (other === f.key) continue;
        for (const s of texts) assert.ok(!json.includes(s), `ticking ${f.key} also sent ${other} ("${s}")`);
      }
    }
  });

  it('never sends closeness, relation, history, last contact, VIP, paused, circle, id or date added, even with everything ticked', async () => {
    const payload = A.sharePeoplePayload([A.sharePerson(dana(), allOn())], { by: 'Brock' });
    const json = JSON.stringify(payload);
    for (const s of NEVER) assert.ok(!json.includes(s), `"${s}" leaked into the share`);
  });

  it('sends an age with no birthday as the age today', () => {
    const o = A.sharePerson({ name: 'Kid', age: 7, ageAsOf: '2024-09-22' }, { birthday: true });
    assert.deepEqual(o, { n: 'Kid', ag: 9, at: '2026-09-22' });
  });

  it('a child card never offers a check-in cadence', () => {
    assert.equal('cadence' in A.defaultPicks({ ...dana(), child: true }), false);
  });
});

describe('encoding a share', () => {
  it('round-trips a person through a compressed link code, under the app\'s field names', async () => {
    const got = await roundTrip([A.sharePerson(dana(), allOn())]);
    assert.equal(got.type, 'people');
    assert.equal(got.by, 'Brock');
    assert.equal(got.on, '2026-09-22');
    const p = got.people[0];
    assert.equal(p.name, 'Dana Whitfield');
    assert.equal(p.company, 'Hallmark');
    assert.deepEqual(p.partner, { name: 'Sam Whitfield', status: 'Married' });
    assert.deepEqual(p.dates[1], { kind: 'Other', label: 'Sober since', date: '2021-03-01' });
    assert.deepEqual(p.socials, { instagram: 'danawhit', linkedin: 'dana-w' });
    assert.equal(p.cadence, 14);
    for (const k of ['tier', 'relation', 'log', 'lastContact', 'vip', 'paused', 'circle', 'id']) assert.equal(k in p, false, k);
  });

  it('reads a whole link, the bare code, and a share file', async () => {
    const payload = A.sharePeoplePayload([{ n: 'Dana Whitfield', e: 'dana@example.com' }], { by: 'Brock' });
    const code = await A.encodeShare(payload);
    assert.ok(code.startsWith('z'));
    for (const text of [`https://littleduck95.github.io/Orbit/#share=${code}`, code, A.shareFileText(payload)]) {
      const got = await A.readAnyShare(text);
      assert.equal(got?.people?.[0]?.email, 'dana@example.com', text.slice(0, 40));
    }
  });

  it('keeps a single contact card short enough for a QR code', async () => {
    const code = await A.encodeShare(A.sharePeoplePayload([A.sharePerson(dana(), allOn())], { by: 'Brock' }));
    assert.ok(code.length + 60 < A.SHARE_QR_CAP, `${code.length}`);
  });

  it('still opens the older list links as lists', async () => {
    const c = A.cleanCollection({ name: 'Books to read', kind: 'Books', items: [{ title: 'The Overstory' }] });
    const got = await A.readAnyShare(`#share=${A.shareCode(c, { notes: false, by: 'Brock' })}`);
    assert.equal(got.type, 'list');
    assert.equal(got.c.items[0].title, 'The Overstory');
    assert.equal(got.by, 'Brock');
  });

  it('turns away anything that is not a share', async () => {
    for (const text of ['', 'hello', '#share=zzzz-not-deflate', '{"people":[]}', '{"orbit":"share","v":2,"t":"people","p":[{"n":""}]}', '{not json']) {
      assert.equal(await A.readAnyShare(text), null, text);
    }
  });

  it('reads only the fields a share may carry, whatever a sender puts in it', async () => {
    const hostile = {
      orbit: 'share', v: 2, t: 'people', by: 'x'.repeat(500), on: 'yesterday',
      p: [{
        n: `  ${'N'.repeat(300)}`, tier: 'bestie', log: [{ date: '2020-01-01', text: 'x' }], vip: true, id: 'abc',
        circle: 'work', lastContact: '2020-01-01', relation: 'Mom', e: { not: 'text' }, b: 'soon',
        so: { instagram: '@@handle', myspace: 'tom' }, pt: ['Pat', 'Best friend'], c: 3, d: [['Graduated', '', 'bad'], 'x'],
        a: ['ok', { x: 1 }, 5],
      }],
    };
    const got = await A.readAnyShare(JSON.stringify(hostile));
    const p = got.people[0];
    assert.equal(got.by.length, 60);
    assert.equal(got.on, null);
    assert.equal(p.name.length, 120);
    assert.deepEqual(Object.keys(p).sort(), ['aka', 'name', 'partner', 'socials']);
    assert.deepEqual(p.socials, { instagram: 'handle' });
    assert.deepEqual(p.partner, { name: 'Pat', status: '' });
    assert.deepEqual(p.aka, ['ok', '5']);
  });
});

describe('finding someone you already have', () => {
  const mine = [
    { id: '1', name: 'Dana Whitfield', aka: ['Dee'], phone: '816.555.0142', email: 'Dana@Example.com' },
    { id: '2', name: 'José O\'Neil', aka: [], phone: '', email: '' },
    { id: '3', name: 'Sam Lee', aka: ['Sammy'], phone: '555', email: '' },
  ];
  const ids = (inc) => A.findMatches(inc, mine).map((m) => m.p.id);

  it('matches on name without case, accents, punctuation or extra spaces', () => {
    assert.deepEqual(ids({ name: '  dana   WHITFIELD' }), ['1']);
    assert.deepEqual(ids({ name: 'Jose ONeil' }), ['2']);
  });

  it('matches on a name either side also goes by', () => {
    assert.deepEqual(ids({ name: 'Dee' }), ['1'], 'their name is one of my also-known-as');
    assert.deepEqual(ids({ name: 'Samuel Lee', aka: ['Sammy'] }), ['3'], 'one of theirs is one of mine');
    assert.deepEqual(A.matchReasons({ name: 'Dee' }, mine[0]), ['aka']);
  });

  it('matches on phone however it is written, and on email without case', () => {
    assert.deepEqual(ids({ name: 'D. W.', phone: '+1 (816) 555-0142' }), ['1']);
    assert.deepEqual(ids({ name: 'Someone', email: ' dana@example.COM ' }), ['1']);
    assert.deepEqual(A.matchReasons({ name: 'Dana Whitfield', phone: '8165550142', email: 'dana@example.com' }, mine[0]),
      ['phone', 'email', 'name']);
  });

  it('does not match on blanks or numbers too short to trust', () => {
    assert.deepEqual(ids({ name: 'Nobody', phone: '', email: '' }), []);
    assert.deepEqual(ids({ name: 'Nobody', phone: '555' }), [], 'three digits are not a phone number');
    assert.deepEqual(ids({ name: 'Nobody', email: 'not-an-email' }), []);
  });

  it('puts the strongest match first', () => {
    const two = [{ id: 'a', name: 'Dana Whitfield' }, { id: 'b', name: 'Dana W', phone: '8165550142', email: 'd@x.com' }];
    assert.deepEqual(A.findMatches({ name: 'Dana Whitfield', phone: '816 555 0142', email: 'd@x.com' }, two).map((m) => m.p.id), ['b', 'a']);
  });
});

describe('merging into someone you have', () => {
  const mine = () => ({
    ...dana(), email: '', address: '', role: 'Designer', company: 'Hallmark', phone: '816-555-0142',
    kids: ['Milo'], socials: { instagram: 'danawhit' }, partner: null, dates: [],
  });
  const incoming = () => ({
    name: 'Dana W', role: 'Art director', email: 'dana@new.com', phone: '(816) 555-0142',
    kids: ['milo', 'June'], socials: { instagram: 'dana.new', tiktok: 'dw' },
    partner: { name: 'Sam Whitfield', status: 'Married' }, note: 'From Brock: loves jazz', cadence: 30,
    dates: [{ kind: 'Moved', label: '', date: '2025-05-01' }],
  });
  const row = (rows, id) => rows.find((r) => r.id === id);

  it('shows each change as a row: blanks and additions ticked, differences not', () => {
    const rows = A.mergePlan(mine(), incoming());
    assert.equal(row(rows, 'email').kind, 'fill');
    assert.equal(row(rows, 'email').take, true);
    assert.equal(row(rows, 'role').kind, 'differs');
    assert.equal(row(rows, 'role').take, false, 'my data is kept unless I say otherwise');
    assert.equal(row(rows, 'note').take, false);
    assert.equal(row(rows, 'cadence').take, false);
    assert.equal(row(rows, 'social:instagram').take, false);
    assert.equal(row(rows, 'social:tiktok').take, true);
    assert.deepEqual(row(rows, 'kids').add, ['June'], 'Milo is already there, whatever the case');
    assert.deepEqual(row(rows, 'aka').add, ['Dana W'], 'a different name is kept as one they go by');
    assert.equal(row(rows, 'name'), undefined, 'the name I know them by is never offered for replacement');
    assert.equal(row(rows, 'phone'), undefined, 'the same number written differently is not a change');
  });

  it('with the defaults, fills blanks and adds to lists without changing anything I had', () => {
    const before = mine();
    const out = A.applyMerge(before, incoming(), A.mergePlan(before, incoming()), { by: 'Brock', on: '2026-09-22' });
    assert.equal(out.role, 'Designer');
    assert.equal(out.note, before.note);
    assert.equal(out.cadence, before.cadence);
    assert.equal(out.socials.instagram, 'danawhit');
    assert.equal(out.email, 'dana@new.com');
    assert.equal(out.socials.tiktok, 'dw');
    assert.deepEqual(out.kids, ['Milo', 'June']);
    assert.deepEqual(out.aka, ['Dee', 'Dana W']);
    assert.deepEqual(out.partner, { name: 'Sam Whitfield', status: 'Married' });
    assert.equal(out.dates.length, 1);
    assert.deepEqual(out.via, { by: 'Brock', on: '2026-09-22' });
    for (const k of ['id', 'tier', 'relation', 'vip', 'circle', 'log', 'lastContact', 'addedOn', 'paused', 'phone', 'name']) {
      assert.deepEqual(out[k], before[k], `${k} changed`);
    }
    assert.equal(before.email, '', 'the original record is not touched');
  });

  it('takes theirs only for the rows I tick', () => {
    const rows = A.mergePlan(mine(), incoming()).map((r) => (r.id === 'role' || r.id === 'cadence' ? { ...r, take: true } : { ...r, take: false }));
    const out = A.applyMerge(mine(), incoming(), rows, null);
    assert.equal(out.role, 'Art director');
    assert.equal(out.cadence, 30);
    assert.equal(out.email, '');
    assert.deepEqual(out.kids, ['Milo']);
    assert.equal('via' in out && out.via === undefined, false);
  });

  it('has nothing to offer when the share adds nothing new', () => {
    assert.deepEqual(A.mergePlan(mine(), { name: 'Dana Whitfield', phone: '8165550142', kids: ['MILO'] }), []);
  });

  it('a birthday replaces an age, and an age only fills in when there is neither', () => {
    const aged = { name: 'Kid', age: 5, ageAsOf: '2026-01-01' };
    const withBday = A.applyMerge(aged, { name: 'Kid', birthday: '2020-03-03' },
      A.mergePlan(aged, { name: 'Kid', birthday: '2020-03-03' }), null);
    assert.equal(withBday.birthday, '2020-03-03');
    assert.equal(withBday.age, null);
    assert.equal(A.mergePlan(aged, { name: 'Kid', age: 9, ageAsOf: '2026-09-22' }).length, 0);
  });
});

describe('a new card from a share', () => {
  it('gets the usual starting values, the circle chosen, and where it came from', () => {
    const p = A.personFromShare({ name: 'Dana', phone: '1' }, { circle: 'work', via: { by: 'Brock', on: '2026-09-22' } });
    assert.equal(p.circle, 'work');
    assert.equal(p.tier, null);
    assert.equal(p.cadence, 90);
    assert.deepEqual(p.log, []);
    assert.equal(p.lastContact, null);
    assert.deepEqual(p.via, { by: 'Brock', on: '2026-09-22' });
    assert.equal(A.cleanPerson(p), p, 'a clean record by the app\'s own rules');
    assert.equal(A.personFromShare({ name: 'Dana', cadence: 7 }).cadence, 7);
    assert.equal(A.personFromShare({ name: 'Dana' }).tier, 'friend');
  });
});

describe('a friend saved to your People', () => {
  it('becomes a person through the same checks as a share', () => {
    const p = A.profileToPerson({
      id: 'x', username: 'bea', display_name: 'Bea Cho', relation: 'friends', pronouns: 'she/her', bio: 'Reads a lot',
      location: 'Kansas City', birthday: '2000-01-01', phone: '816-555-0100', contact_email: 'bea@contact.example',
      website: 'javascript:alert(1)', socials: { instagram: '@beareads', myspace: 'tom' },
    });
    assert.equal(p.name, 'Bea Cho');
    assert.equal(p.address, 'Kansas City');
    assert.equal(p.birthday, '2000-01-01');
    assert.equal(p.phone, '816-555-0100');
    assert.equal(p.email, 'bea@contact.example');
    assert.deepEqual(p.socials, { instagram: 'beareads' });
    assert.equal(p.note, 'Pronouns: she/her\nReads a lot', 'a script link never comes along');
    for (const k of ['id', 'username', 'relation', 'tier', 'log']) assert.equal(k in p, false, k);
  });
  it('with only a name, is only a name', () => {
    assert.deepEqual(A.profileToPerson({ username: 'd', display_name: 'Dora' }), { name: 'Dora' });
  });
});
