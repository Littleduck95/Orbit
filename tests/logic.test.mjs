// Characterization tests: they pin down what the app's logic does today,
// including behaviour that looks odd. Tests whose name starts "CURRENT:" record
// behaviour the audit flagged; if one of those is changed on purpose, the test
// changes with it, in the same commit.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { loadApp } from './app.mjs';

const A = await loadApp();

// Tuesday 22 September 2026, noon, in the test timezone (America/Chicago).
const NOW = new Date(2026, 8, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const csvRows = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data;

describe('dates', () => {
  it('formats and parses days at local noon', () => {
    assert.equal(A.fmtDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(A.todayStr(), '2026-09-22');
    const d = A.parseDate('2026-03-08');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 2, 8, 12]);
  });

  it('counts days since, across a daylight-saving change', () => {
    assert.equal(A.daysSince(null), null);
    assert.equal(A.daysSince(''), null);
    assert.equal(A.daysSince('2026-09-22'), 0);
    assert.equal(A.daysSince('2026-09-21'), 1);
    assert.equal(A.daysSince('2026-08-23'), 30);
    assert.equal(A.daysSince('2026-03-01'), 205);
  });

  it('CURRENT: a contact date in the future counts as today', () => {
    assert.equal(A.daysSince('2026-10-30'), 0);
  });

  it('says how long ago in words', () => {
    const cases = [[null, 'never'], [0, 'today'], [1, 'yesterday'], [13, '13 days'], [14, '2 weeks'],
      [59, '8 weeks'], [60, '2 months'], [364, '12 months'], [548, '1.5 years'], [730, '2 years'], [3650, '10 years']];
    for (const [d, want] of cases) assert.equal(A.elapsed(d), want, `elapsed(${d})`);
  });

  it('CURRENT: exactly a year reads "1 years"', () => {
    assert.equal(A.elapsed(365), '1 years');
  });

  it('counts down and up to dates', () => {
    assert.equal(A.countdown(0), 'today');
    assert.equal(A.countdown(1), 'tomorrow');
    assert.equal(A.countdown(5), 'in 5 days');
    assert.equal(A.countdown(30), 'in 4 weeks');
    assert.equal(A.daysUntil('2026-09-25'), 3);
    assert.equal(A.daysUntil('2026-09-20'), -2);
    assert.equal(A.daysUntil(null), null);
  });

  it('works out ages and whole years', () => {
    assert.equal(A.yearsSince('2024-09-22'), 2);
    assert.equal(A.yearsSince('2024-09-23'), 1);
    assert.equal(A.yearsSince('2026-10-01'), 0);
    assert.equal(A.ageFromBirthday('1990-09-22'), 36);
    assert.equal(A.ageFromBirthday('1990-09-23'), 35);
    assert.equal(A.derivedAge(null), null);
    assert.equal(A.derivedAge('2026-01-01'), null, 'a birthday with no real year gives no age');
    assert.equal(A.derivedAge('2025-09-22'), 1);
    assert.equal(A.ageOf({ birthday: '1990-09-23', age: 50 }), 35, 'a birthday beats a typed age');
    assert.equal(A.ageOf({ age: '40', ageAsOf: '2024-09-22' }), 42, 'a typed age ages from the day it was typed');
    assert.equal(A.ageOf({ age: 40 }), 40);
    assert.equal(A.ageOf({}), null);
  });

  it('finds the next birthday and anniversary', () => {
    assert.equal(A.daysToBirthday('1990-09-22'), 0);
    assert.equal(A.daysToBirthday('1990-09-23'), 1);
    assert.equal(A.daysToBirthday('1990-09-21'), 364);
    assert.equal(A.daysToBirthday(null), null);
    assert.equal(A.annualCount('2016-10-01'), 10);
    assert.equal(A.annualCount('2016-09-21'), 11, 'already passed this year, so it counts next year\'s');
    assert.equal(A.annualCount('2016-09-22'), 10, 'today counts as this year');
  });

  it('CURRENT: a 29 February birthday falls on 1 March in other years', () => {
    assert.equal(A.daysToBirthday('2000-02-29'), 160);
  });

  it('CURRENT: an unreadable date gives NaN rather than null', () => {
    assert.ok(Number.isNaN(A.daysToBirthday('March 3')));
    assert.ok(Number.isNaN(A.daysSince('March 3')));
    assert.equal(A.elapsed(NaN), 'NaN years');
  });

  it('prints dates in the browser\'s own format', () => {
    assert.equal(A.prettyDate('2026-09-22'), 'Sep 22, 2026');
    assert.equal(A.prettyBirthday('1990-03-05'), 'March 5');
    assert.deepEqual(A.eventWhen({ date: '2026-06-03' }), { text: 'Jun 3, 2026', days: 1 });
    assert.deepEqual(A.eventWhen({ date: '2026-06-03', endDate: '2026-06-03' }), { text: 'Jun 3, 2026', days: 1 });
    assert.deepEqual(A.eventWhen({ date: '2026-06-03', endDate: '2026-06-10' }), { text: 'Jun 3–10, 2026', days: 8 });
    assert.deepEqual(A.eventWhen({ date: '2026-06-28', endDate: '2026-07-02' }), { text: 'Jun 28 – Jul 2, 2026', days: 5 });
    assert.deepEqual(A.eventWhen({ date: '2026-12-30', endDate: '2027-01-02' }), { text: 'Dec 30, 2026 – Jan 2, 2027', days: 4 });
  });

  it('formats days exactly as toLocaleDateString would, in any timezone, even one changed mid-visit', () => {
    const days = ['0100-00-01', '0050-06-15', '0001-01-01', '2026-02-30', '2026-13-01', '2011-12-30', '2026-03-08', '2026-11-01',
      '9999-12-31', '1899-12-31', 'March 3', ''];
    for (let t = Date.UTC(1995, 0, 1); t < Date.UTC(2035, 0, 1); t += 13 * 86400000) days.push(new Date(t).toISOString().slice(0, 10));
    const compare = (zone) => days.forEach((s) => {
      const d = A.parseDate(s);
      assert.equal(A.prettyDate(s), d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), `${zone} ${s}`);
      assert.equal(A.prettyBirthday(s), d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), `${zone} ${s}`);
    });
    const tz = process.env.TZ;
    const offsets = new Set();
    try {
      // The formatters are already built (above, in Chicago); switching the
      // timezone afterwards must not shift any day.
      for (const zone of ['America/Chicago', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata']) {
        process.env.TZ = zone;
        offsets.add(new Date(2026, 0, 1, 12).getTimezoneOffset());
        compare(zone);
      }
    } finally {
      process.env.TZ = tz;
    }
    assert.equal(offsets.size, 4, 'the timezone really changed each time');
    assert.equal(A.eventYear({ date: '2026-06-03' }), 2026);
  });
});

describe('who needs reaching out to', () => {
  const ago = (n) => A.fmtDate(new Date(2026, 8, 22 - n));

  it('grades how overdue someone is', () => {
    assert.equal(A.status({ paused: true, lastContact: ago(400), cadence: 7 }).paused, true);
    assert.equal(A.status({ child: true, lastContact: ago(400), cadence: 7 }).child, true);
    assert.equal(A.status({ cadence: 0, lastContact: null }).always, true);
    const never = A.status({ cadence: 30, lastContact: null });
    assert.deepEqual([never.over, never.ratio, never.days], [true, 2, null]);
    assert.equal(A.status({ cadence: 30, lastContact: ago(30) }).over, true);
    const soon = A.status({ cadence: 30, lastContact: ago(21) });
    assert.deepEqual([soon.over, soon.tone], [false, A.C.soonText]);
    const calm = A.status({ cadence: 30, lastContact: ago(20) });
    assert.deepEqual([calm.over, calm.tone], [false, A.C.calmText]);
    assert.equal(A.status({ cadence: '30', lastContact: ago(30) }).over, true, 'a cadence stored as text still works');
  });

  it('CURRENT: a cadence that is not a number is never overdue and sorts unpredictably', () => {
    const st = A.status({ cadence: NaN, lastContact: ago(400) });
    assert.equal(st.over, false);
    assert.ok(Number.isNaN(A.rank({ cadence: NaN, lastContact: ago(400) })));
  });

  it('ranks VIPs first, then no-reminder people, then by urgency, paused last', () => {
    assert.equal(A.rank({ paused: true }), -2);
    assert.equal(A.rank({ child: true }), -1.5);
    assert.equal(A.rank({ cadence: 0 }), 1000);
    assert.equal(A.rank({ cadence: 30, lastContact: null }), 2);
    assert.equal(A.rank({ cadence: 1, lastContact: ago(5000) }), 900, 'urgency is capped');
    assert.equal(A.rank({ cadence: 0, vip: true }), 11000);
  });

  it('sorts by rank in exactly the order comparing ranks directly gives, ties and all', () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const person = (i) => ({
      i, vip: rnd() < 0.1, paused: rnd() < 0.08, child: rnd() < 0.05,
      cadence: pick([0, 7, 30, 90, '30', '0', null, undefined, NaN, 'often']),
      lastContact: pick([null, ago(0), ago(3), ago(29), ago(30), ago(400), 'March 3', '']),
    });
    for (let round = 0; round < 2000; round += 1) {
      const list = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => person(i));
      const before = [...list].sort((a, b) => A.rank(b) - A.rank(a));
      const after = A.byRank(list);
      assert.deepEqual(after.map((p) => p.i), before.map((p) => p.i), `round ${round}`);
      assert.ok(after.every((p, k) => p === before[k]), 'the same objects come back');
    }
  });

  it('rebuilds last contact from the log', () => {
    const p = A.withLog({ name: 'x' }, [{ date: '2026-01-02' }, { date: '' }, { date: '2026-05-01', text: 'b' }]);
    assert.deepEqual(p.log.map((e) => e.date), ['2026-05-01', '2026-01-02']);
    assert.equal(p.lastContact, '2026-05-01');
    assert.equal(A.withLog({}, []).lastContact, null);
  });

  it('CURRENT: a log entry whose date is cleared is dropped', () => {
    const p = A.withLog({}, [{ date: '', text: 'we had lunch' }]);
    assert.deepEqual(p.log, []);
  });
});

describe('small text helpers', () => {
  it('splits, joins and names things', () => {
    assert.deepEqual(A.splitTags(' a, b ,,c '), ['a', 'b', 'c']);
    assert.equal(A.handle('@@dana'), 'dana');
    assert.equal(A.joinList(['a', 'b']), 'a; b');
    assert.deepEqual(A.splitList('a; ;b'), ['a', 'b']);
    assert.equal(A.packDates([{ kind: 'Other', label: 'Started piano', date: '2020-01-01' }]), 'Other|Started piano|2020-01-01');
    assert.deepEqual(A.unpackDates('Moved||2019-05-05; broken'), [{ kind: 'Moved', label: '', date: '2019-05-05' }]);
    assert.equal(A.isYes(' Yes '), true);
    assert.equal(A.isYes('nope'), false);
    assert.equal(A.norm('E-mail Address'), 'emailaddress');
    assert.equal(A.dateLabel({ kind: 'Other', label: '' }), 'Other');
    assert.equal(A.partnerLabel({ status: 'Married' }), 'Married to');
    assert.equal(A.partnerLabel(null), 'Partner');
    assert.equal(A.tierLabel('bestie'), 'Bestie');
    assert.equal(A.countPhrase(0), 'No one');
    assert.equal(A.countPhrase(12), '12 people');
    assert.equal(A.countThings(1, 'list', 'lists'), 'One list');
    assert.equal(A.countThings(11, 'list', 'lists'), '11 lists');
  });

  it('guesses a timezone from a US address', () => {
    assert.equal(A.zoneFromAddress('1420 Elm St\nWarrensburg, MO 64093'), 'America/Chicago');
    assert.equal(A.zoneFromAddress('Phoenix, Arizona'), 'America/Phoenix');
    assert.equal(A.zoneFromAddress('Portland OR 97201'), 'America/Los_Angeles');
    assert.equal(A.zoneFromAddress('London, UK'), null);
    assert.equal(A.zoneFromAddress(''), null);
    const now = A.zoneNow('America/New_York');
    assert.equal(typeof now.time, 'string');
    assert.equal(A.zoneNow('Not/A_Zone'), null);
  });

  it('CURRENT: a street named after a state can decide the timezone', () => {
    assert.equal(A.zoneFromAddress('123 Washington Ave, Boston'), 'America/Los_Angeles');
  });
});

describe('reminders', () => {
  it('adds calendar units, clamping to short months and keeping the pinned day', () => {
    assert.equal(A.addUnits('2026-01-31', 'month', 1), '2026-02-28');
    assert.equal(A.addUnits('2026-02-28', 'month', 1, 31), '2026-03-31');
    assert.equal(A.addUnits('2024-02-29', 'year', 1), '2025-02-28');
    assert.equal(A.addUnits('2026-09-22', 'day', 10), '2026-10-02');
    assert.equal(A.addUnits('2026-09-22', 'week', 2), '2026-10-06');
    assert.deepEqual(A.everyFrom('2026-10-31', 'month', 1), { unit: 'month', n: 1, dom: 31 });
  });

  it('reads repeats defensively', () => {
    assert.equal(A.repeatOf({}), null);
    assert.deepEqual(A.repeatOf({ every: { unit: 'fortnight', n: 0 }, next: '2026-10-09' }), { unit: 'month', n: 1, dom: 9 });
    assert.deepEqual(A.repeatOf({ every: { unit: 'week', n: 500, dom: 40 } }), { unit: 'week', n: 99, dom: 31 });
    assert.equal(A.repeatText({}), 'once');
    assert.equal(A.repeatText({ every: { unit: 'month', n: 1 } }), 'every month');
    assert.equal(A.repeatText({ every: { unit: 'month', n: 3 } }), 'every 3 months');
    assert.equal(A.leadOf({ lead: -4 }), 0);
    assert.equal(A.leadOf({ lead: 9999 }), 365);
  });

  it('bands reminders by how soon they are due', () => {
    const key = (r) => A.reminderState(r).key;
    assert.equal(key({ paused: true, next: '2026-09-01' }), 'paused');
    assert.equal(key({ done: true, next: '2026-09-01' }), 'done');
    assert.equal(key({ next: '2026-09-21' }), 'over');
    assert.equal(key({ next: '2026-09-22' }), 'today');
    assert.equal(key({ next: '2026-09-29', lead: 7 }), 'soon');
    assert.equal(key({ next: '2026-09-30', lead: 7 }), 'later');
    assert.equal(A.dueText(-1), 'due yesterday');
    assert.equal(A.dueText(-3), '3 days late');
    assert.equal(A.dueText(null), 'no date set');
    const sorted = [{ next: '2026-12-01' }, { paused: true, next: '2026-01-01' }, { next: '2026-09-01' }, { next: '2026-09-22' }]
      .sort(A.byDue).map((r) => r.next);
    assert.deepEqual(sorted, ['2026-09-01', '2026-09-22', '2026-12-01', '2026-01-01']);
  });

  it('works out the next date after ticking one off', () => {
    const bill = { every: { unit: 'month', n: 1, dom: 15 }, anchor: 'date', next: '2026-06-15' };
    assert.equal(A.nextAfter(bill, '2026-09-22'), '2026-10-15', 'calendar repeats skip what was missed');
    const filter = { every: { unit: 'month', n: 3, dom: 1 }, anchor: 'done', next: '2026-06-01' };
    assert.equal(A.nextAfter(filter, '2026-09-22'), '2026-12-22', 'completion repeats restart from the day done');
    const bins = { every: { unit: 'week', n: 1 }, anchor: 'date', next: '2026-01-05' };
    assert.equal(A.nextAfter(bins, '2026-09-22'), '2026-09-28');
    assert.equal(A.nextAfter({}, '2026-09-22'), null);
  });

  it('records completions and snoozes', () => {
    const r = { every: { unit: 'month', n: 1, dom: 15 }, anchor: 'date', next: '2026-09-15',
      history: Array.from({ length: 60 }, (_, i) => ({ date: A.fmtDate(new Date(2020, 0, 1 + i)) })) };
    const done = A.completeReminder(r, '2026-09-22');
    assert.equal(done.history.length, 60, 'history is capped at 60');
    assert.equal(done.history[0].date, '2026-09-22');
    assert.equal(done.next, '2026-10-15');
    assert.equal(done.lastDone, '2026-09-22');
    const once = A.completeReminder({ next: '2026-09-20' }, '2026-09-22');
    assert.deepEqual([once.done, once.next], [true, '2026-09-20']);
    assert.equal(A.snoozeReminder({ next: '2026-12-01' }, 7).next, '2026-12-08', 'pushes back from where it sits');
    assert.equal(A.snoozeReminder({ next: '2026-09-01' }, 7).next, '2026-09-29', 'something late restarts from today');
  });

  it('fills a starter in one interval out', () => {
    const r = A.fromStarter(A.STARTERS[0]);
    assert.equal(r.next, '2026-12-22');
    assert.deepEqual(r.every, { unit: 'month', n: 3, dom: 22 });
    assert.equal(r.anchor, 'done');
  });
});

describe('coming up', () => {
  const person = (over) => ({ id: 'p', name: 'Dana Whitfield', cadence: 30, ...over });

  it('collects birthdays, dates, events and reminders in date order', () => {
    const items = A.buildUpcoming(
      [
        person({ id: 'a', birthday: '1990-10-02' }),
        person({ id: 'b', birthday: '1990-12-25' }),
        person({ id: 'c', birthday: '1990-09-24', paused: true }),
        person({ id: 'd', dates: [{ kind: 'Wedding anniversary', date: '2016-09-30' }] }),
      ],
      [{ id: 'e1', title: 'Trip', date: '2026-09-25', place: 'Denver' }, { id: 'e0', title: 'Past', date: '2026-09-01' }],
      [
        { id: 'r1', title: 'Late', next: '2026-09-10' },
        { id: 'r2', title: 'Inside notice', next: '2026-09-26', lead: 7 },
        { id: 'r3', title: 'Outside notice', next: '2026-10-10', lead: 7 },
        { id: 'r4', title: 'Paused', next: '2026-09-10', paused: true },
      ],
    );
    assert.deepEqual(items.map((it) => [it.key, it.d]),
      [['r-r1', -12], ['e-e1', 3], ['r-r2', 4], ['d-d-0', 8], ['b-a', 10]]);
    assert.equal(items.find((it) => it.key === 'b-a').detail, 'turning 36');
    assert.equal(items.find((it) => it.key === 'd-d-0').detail, '10 years');
    assert.equal(items.find((it) => it.key === 'r-r1').tone, 'over');
  });

  it('looks exactly 45 days ahead for birthdays and events, and no further', () => {
    const keys = (people, events) => A.buildUpcoming(people, events, []).map((it) => it.key);
    assert.deepEqual(keys([person({ id: 'in', birthday: '1990-11-06' }), person({ id: 'out', birthday: '1990-11-07' })], []), ['b-in']);
    assert.deepEqual(keys([], [{ id: 'in', title: 'x', date: '2026-11-06' }, { id: 'out', title: 'y', date: '2026-11-07' }]), ['e-in']);
  });
});

describe('year in review', () => {
  it('counts the year\'s catch-ups', () => {
    const people = [
      { id: 'a', name: 'A', circle: 'friend', addedOn: '2026-01-01', families: ['Boyer family'],
        log: [{ date: '2026-03-01' }, { date: '2026-03-15' }, { date: '2025-11-01' }] },
      { id: 'b', name: 'B', circle: 'work', addedOn: '2025-01-01', log: [{ date: '2026-07-04' }] },
    ];
    const r = A.buildRecap(people, 2026);
    assert.equal(r.total, 3);
    assert.equal(r.top[0].p.id, 'a');
    assert.equal(r.peak, 2);
    assert.deepEqual([r.personal, r.work, r.added, r.activeMonths], [2, 1, 1, 2]);
    assert.equal(r.reunion.p.id, 'a');
    assert.deepEqual(r.topCircle, ['Boyer family', 2]);
  });
});

describe('CSV', () => {
  it('round-trips a person through the people columns', () => {
    const p = {
      name: 'Dana Whitfield', aka: ['Dee'], circle: 'work', tier: 'friend', relation: '', role: 'Ops lead',
      company: 'Ardent', birthday: '1990-03-05', email: 'dana@example.com', phone: '+1 816 555 0148',
      address: '1 Elm St', socials: { instagram: 'dana' }, partner: { name: 'Sam', status: 'Married' },
      kids: ['Ellie'], families: ['Boyer family'], groups: ['Climbing'], cadence: 30, lastContact: '2026-09-01',
      vip: true, child: false, paused: false, dates: [{ kind: 'Moved', label: '', date: '2019-05-05' }],
      hobbies: 'Climbing', note: 'Likes brisket',
    };
    const text = A.toCsv(A.PERSON_COLS, [p]);
    const { out, skipped } = A.fromCsv(A.PERSON_COLS, csvRows(text), () => ({ socials: {} }));
    assert.equal(skipped, 0);
    const back = out[0];
    for (const k of ['name', 'circle', 'role', 'company', 'birthday', 'email', 'phone', 'address', 'cadence',
      'lastContact', 'vip', 'child', 'paused', 'hobbies', 'note']) {
      assert.deepEqual(back[k], p[k], k);
    }
    assert.deepEqual([back.aka, back.kids, back.families, back.groups], [p.aka, p.kids, p.families, p.groups]);
    assert.deepEqual(back.partner, p.partner);
    assert.deepEqual(back.socials, p.socials);
    assert.deepEqual(back.dates, p.dates);
    assert.equal(back.tier, 'friend');
  });

  it('matches headers loosely and skips empty rows', () => {
    const { out, skipped } = A.fromCsv(A.PERSON_COLS, [{ 'E-MAIL': 'a@b.c', ' name ': 'Ann' }, { Unknown: 'x' }], () => ({}));
    assert.deepEqual(out, [{ email: 'a@b.c', name: 'Ann' }]);
    assert.equal(skipped, 1);
  });

  it('CURRENT: people import keeps dates and cadences it cannot read', () => {
    const { out } = A.fromCsv(A.PERSON_COLS, [{ Name: 'X', Birthday: 'March 3', 'Check in days': 'often' }], () => ({}));
    assert.equal(out[0].birthday, 'March 3');
    assert.ok(Number.isNaN(out[0].cadence));
  });

  it('round-trips events and reminders', () => {
    const e = { title: 'Trip', date: '2026-06-03', endDate: '2026-06-10', kind: 'Trip', place: 'Denver', lat: 39.7, lon: -104.99, note: 'n' };
    const back = A.fromCsv(A.EVENT_COLS, csvRows(A.toCsv(A.EVENT_COLS, [e])), () => ({})).out[0];
    assert.deepEqual(back, e);
    const r = { title: 'Card', kind: 'Money', next: '2026-10-31', every: { unit: 'month', n: 1, dom: 31 }, anchor: 'date',
      lead: 3, lastDone: '2026-09-30', paused: false, done: false, note: '' };
    const rb = A.fromCsv(A.REMINDER_COLS, csvRows(A.toCsv(A.REMINDER_COLS, [r])), () => ({})).out[0];
    assert.deepEqual([rb.next, rb.every, rb.anchor, rb.lead, rb.kind], [r.next, r.every, r.anchor, r.lead, r.kind]);
  });

  it('escapes formula-looking cells but not plain signed numbers, and reads them back', () => {
    const text = A.toCsv(A.EVENT_COLS, [{ title: '=HYPERLINK("x")', date: '2026-01-01', lat: 39.1, lon: -94.58, place: '+1 555', note: '@x' }]);
    assert.ok(text.includes(`"'=HYPERLINK`));
    assert.ok(text.includes(',-94.58,'));
    assert.ok(text.includes("'+1 555"));
    const back = A.fromCsv(A.EVENT_COLS, csvRows(text), () => ({})).out[0];
    assert.deepEqual([back.title, back.place, back.note, back.lon], ['=HYPERLINK("x")', '+1 555', '@x', -94.58]);
  });
});

describe('lists', () => {
  const list = (over = {}) => A.cleanCollection({
    id: 'L', name: 'Books', kind: 'Books', track: true,
    labels: { want: 'Want to read', doing: 'Reading', done: 'Read' }, detail: 'Author', ...over,
  });

  it('keeps only web links', () => {
    const cases = [['example.com:8080/p', 'https://example.com:8080/p'], ['tv.apple.com/x', 'https://tv.apple.com/x'],
      ['javascript:alert(1)', ''], [' JavaScript:alert(1)', ''], ['data:text/html,x', ''], ['mailto:a@b.c', ''],
      ['https://', ''], [42, '']];
    for (const [v, want] of cases) assert.equal(A.safeLink(v), want, String(v));
    assert.equal(A.safeLink(`https://e.com/${'a'.repeat(3000)}`), '');
  });

  it('reads stage words back', () => {
    const books = { want: 'Want to read', doing: 'Reading', done: 'Read' };
    const cases = [['Not started', 'want'], ['Have not watched', 'want'], ['Pending', 'want'], ['Reading', 'doing'],
      ['In progress', 'doing'], ['Read', 'done'], ['yes', 'done'], ['In the collection', 'done'], ['', 'want']];
    for (const [v, want] of cases) assert.equal(A.stageFrom(v, books), want, v);
  });

  it('CURRENT: a done status with a negative comment reads as not started', () => {
    assert.equal(A.stageFrom('Done, not great', { want: '', doing: '', done: '' }), 'want');
  });

  it('cleans outside data into a well-formed list', () => {
    const c = A.cleanCollection({ name: '  x ', kind: 'Nope', items: [{ title: 'a', id: 'dup' }, { title: 'b', id: 'dup' },
      { title: '' }, 'junk', { title: 5, rating: 9, link: 'javascript:x', status: 'weird', doneOn: '2026-01-01' }] });
    assert.equal(c.name, 'x');
    assert.equal(c.kind, 'Other');
    assert.deepEqual(c.items.map((i) => i.title), ['a', 'b', '5']);
    assert.notEqual(c.items[0].id, c.items[1].id);
    assert.deepEqual([c.items[2].rating, c.items[2].link, c.items[2].status, c.items[2].doneOn], [5, '', 'want', null]);
  });

  it('sorts like a shelf, keeping ties in your order', () => {
    const items = list({ items: ['the Zoo', 'An Apple', 'b 10', 'b 9', 'Émile'].map((title) => ({ title })) }).items;
    assert.deepEqual(A.sortItems({ sort: 'title' }, items).map((i) => i.title), ['An Apple', 'b 9', 'b 10', 'Émile', 'the Zoo']);
    const rated = list({ items: [{ title: 'a', rating: 2 }, { title: 'b', rating: 5 }, { title: 'c', rating: 2 }] }).items;
    assert.deepEqual(A.sortItems({ sort: 'rating' }, rated).map((i) => i.title), ['b', 'a', 'c']);
    assert.equal(A.sortItems({ sort: 'manual' }, rated), rated);
  });

  it('shares text and links without private fields', () => {
    const plain = list({ track: false, items: [{ title: 'A' }, { title: 'B' }] });
    assert.equal(A.collectionText(plain, { progress: true, notes: false }), 'Books\n\n1. A\n2. B');
    const rich = list({ note: 'Mine', items: [{ title: 'Ünï 😀', link: 'https://e.com', note: 'secret', from: 'p1', rating: 4, status: 'done' }] });
    const back = A.readShared(`http://h/#share=${A.shareCode(rich, { notes: false, by: 'Brock' })}`);
    assert.equal(back.by, 'Brock');
    assert.deepEqual([back.c.items[0].title, back.c.items[0].link, back.c.items[0].note, back.c.items[0].from,
      back.c.items[0].status, back.c.items[0].rating, back.c.note], ['Ünï 😀', 'https://e.com/', '', null, 'want', 0, '']);
    assert.equal(A.readShared('hello'), null);
    assert.equal(A.readShared('#share=!!!!'), null);
  });

  it('round-trips through CSV and merges into a list of the same name', () => {
    const custom = list({ labels: { want: 'TBR', doing: 'Nightstand', done: 'Devoured' },
      items: [{ title: 'Dune', status: 'done' }, { title: 'Emma', status: 'doing' }] });
    const rows = A.fromCsv(A.ITEM_COLS, csvRows(A.toCsv(A.ITEM_COLS, A.flattenCollections([custom]))),
      () => ({ list: '', kind: '', title: '', status: '' })).out;
    const merged = A.mergeCollections([list({ labels: custom.labels })], A.gatherCollections(rows, { fallback: 'f', have: [list({ labels: custom.labels })] }));
    assert.deepEqual(merged[0].items.map((i) => `${i.title}:${i.status}`), ['Dune:done', 'Emma:doing']);
    const full = list({ items: Array.from({ length: 1990 }, (_, i) => ({ title: `x${i}` })) });
    const more = A.gatherCollections(Array.from({ length: 30 }, (_, i) => ({ list: 'Books', title: `y${i}` })), { fallback: 'f' });
    assert.equal(A.importOverflow([full], more, 'add'), 20);
    assert.equal(A.importOverflow([full], more, 'replace'), 0);
  });
});

describe('repairing saved data', () => {
  const fullPerson = {
    id: 'p1', addedOn: '2026-01-02', name: 'Dana', circle: 'work', tier: 'friend', role: 'Ops', company: 'Ardent',
    hobbies: 'x', aka: ['Dee'], kids: ['Ellie (7)'], email: 'd@e.co', paused: false, families: ['Boyer family'], relation: 'Sister',
    groups: ['Climbing'], partner: { name: 'Sam', status: 'Married' }, cadence: 0, birthday: '1990-03-05', age: null, ageAsOf: null,
    dates: [{ kind: 'Other', label: 'Piano', date: '2020-01-01' }], phone: '816', address: '1 Elm', socials: { instagram: 'dana' },
    note: 'n', lastContact: '2026-09-01', log: [{ date: '2026-09-01', text: 'Lunch' }], vip: true, child: false,
  };
  const fullEvent = { id: 'e1', addedOn: '2026-01-01', date: '2026-06-03', endDate: null, title: 'Trip', kind: 'Trip', note: '', people: ['p1'], place: 'Denver', lat: 39.7, lon: -104.9 };
  const fullReminder = { id: 'r1', addedOn: '2026-01-01', title: 'Card', kind: 'Money', every: { unit: 'month', n: 1, dom: 15 }, anchor: 'date',
    next: '2026-10-15', lead: 3, note: '', people: ['p1'], history: [{ date: '2026-09-15' }], lastDone: '2026-09-15', paused: false, done: false };

  it('hands back well-formed records as the very same object', () => {
    for (const [clean, rec] of [[A.cleanPerson, fullPerson], [A.cleanEvent, fullEvent], [A.cleanReminder, fullReminder]]) {
      assert.equal(clean(rec), rec);
    }
    const minimal = { id: 'a', name: 'Minimal' };
    assert.equal(A.cleanPerson(minimal), minimal, 'missing optional fields are not added');
    const falsy = { id: 'b', name: 'F', log: null, families: '', socials: null, partner: null, birthday: null, lastContact: null };
    assert.equal(A.cleanPerson(falsy), falsy, 'empty values the app already handles are left alone');
  });

  it('repairs only the fields of the wrong shape', () => {
    const bad = { ...fullPerson, log: 'oops', families: 'Boyer', aka: ['ok', 7, { x: 1 }], note: { t: 1 }, birthday: 19900305,
      socials: { instagram: 42, x: {} }, partner: 'Sam', dates: [null, { kind: {}, date: '2020-01-01' }, 'x'] };
    const out = A.cleanPerson(bad);
    assert.notEqual(out, bad);
    assert.deepEqual(out.log, []);
    assert.deepEqual(out.families, []);
    assert.deepEqual(out.aka, ['ok', '7']);
    assert.equal(out.note, '');
    assert.equal(out.birthday, '19900305');
    assert.deepEqual(out.socials, { instagram: '42', x: '' });
    assert.equal(out.partner, null);
    assert.deepEqual(out.dates, [{ kind: '', date: '2020-01-01' }]);
    for (const k of ['id', 'name', 'company', 'cadence', 'vip', 'groups', 'kids', 'email']) assert.deepEqual(out[k], bad[k], k);
    assert.equal(bad.log, 'oops', 'the input is not modified');
    assert.equal(A.cleanPerson({ id: 'n' }).name, '', 'a person with no name gets an empty one');
    assert.deepEqual(A.cleanEvent({ ...fullEvent, lat: '39.7', people: 'x', title: 5 }),
      { ...fullEvent, lat: null, people: [], title: '5' });
    assert.deepEqual(A.cleanReminder({ ...fullReminder, every: 'monthly', history: [3, { date: {} }] }),
      { ...fullReminder, every: null, history: [{ date: '' }] });
  });

  it('keeps every record of a list it can use, dropping only what is not a record', () => {
    assert.deepEqual(A.cleanAll([fullPerson, null, 'x', 3, [], fullPerson], A.cleanPerson), [fullPerson, fullPerson]);
    assert.deepEqual(A.cleanAll({ not: 'a list' }, A.cleanPerson), []);
    assert.deepEqual(A.cleanAll(undefined, A.cleanEvent), []);
  });

  it('never throws, always yields drawable shapes, and never touches other fields (fuzzed)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    // Values JSON can hold (these only ever see parsed JSON), plus NaN, which a
    // CSV import can leave in memory.
    const junk = () => [undefined, null, '', 0, 1, -3.5, NaN, true, false, 'text', '2026-01-01', [], ['a', 1, null, {}],
      {}, { date: 5 }, { a: [1] }][Math.floor(rnd() * 16)];
    const people = ['name', 'role', 'company', 'hobbies', 'email', 'phone', 'address', 'note', 'relation', 'birthday',
      'lastContact', 'addedOn', 'ageAsOf', 'aka', 'kids', 'families', 'groups', 'log', 'dates', 'socials', 'partner'];
    const drawable = (v) => v == null || typeof v === 'string' || v === false || v === 0 || Number.isNaN(v);
    for (let i = 0; i < 3000; i += 1) {
      const rec = { id: `z${i}`, extra: { keep: i }, cadence: junk() };
      people.forEach((k) => { if (rnd() < 0.7) rec[k] = junk(); });
      const out = A.cleanPerson(rec);
      assert.equal(out.extra, rec.extra, 'fields outside the fix list are untouched');
      assert.equal(out.cadence, rec.cadence);
      for (const k of ['role', 'company', 'hobbies', 'email', 'phone', 'address', 'note', 'relation', 'birthday', 'lastContact', 'addedOn', 'ageAsOf']) {
        assert.ok(drawable(out[k]), `${k}: ${String(out[k])}`);
      }
      assert.equal(typeof out.name, 'string');
      for (const k of ['aka', 'kids', 'families', 'groups']) assert.ok(!out[k] || (Array.isArray(out[k]) && out[k].every((x) => typeof x === 'string')), k);
      for (const k of ['log', 'dates']) assert.ok(!out[k] || (Array.isArray(out[k]) && out[k].every((e) => e && typeof e === 'object' && drawable(e.date))), k);
      assert.ok(!out.socials || Object.values(out.socials).every((v) => drawable(v)));
      assert.ok(!out.partner || (typeof out.partner === 'object' && drawable(out.partner.name)));
      assert.equal(A.cleanPerson(out), out, 'repairing twice changes nothing');
      // And the code that used to crash on these shapes now runs.
      A.withLog(out, out.log || []);
      A.buildUpcoming([out], [], []);
      A.buildRecap([out], 2026);
      A.status(out);
    }
  });
});
