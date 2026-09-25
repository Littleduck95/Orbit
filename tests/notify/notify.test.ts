// The notify function (supabase/functions/notify/index.ts), run under Deno as
// Supabase runs it. Run with `npm run test:notify`.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import webpush from 'npm:web-push@3.6.7';
import ece from 'npm:http_ece@1.2.0';
import { createECDH, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  type Db, type Kinds, type Prefs, type Senders, type Sub,
  type Social,
  IN_CHUNK, daysBetween, dueItems, emailFor, handle, inQuiet, localNow, nextBirthday, pushFor, realSenders, run, socialItems, starText, supabaseDb,
} from '../../supabase/functions/notify/index.ts';

const ALL: Kinds = { birthdays: true, reminders: true, checkins: true, events: true, friend_requests: true };

Deno.test('the day and hour are worked out where each person is', () => {
  const at = new Date('2026-09-24T14:30:00Z');
  assertEquals(localNow(at, 'America/Chicago'), { date: '2026-09-24', hour: 9, weekday: 4 });
  assertEquals(localNow(at, 'Asia/Kolkata'), { date: '2026-09-24', hour: 20, weekday: 4 });
  assertEquals(localNow(new Date('2026-09-24T02:00:00Z'), 'America/Los_Angeles').date, '2026-09-23', 'still yesterday there');
  assertEquals(localNow(at, 'Not/AZone'), { date: '2026-09-24', hour: 14, weekday: 4 }, 'an unknown zone counts as UTC');
});

Deno.test('birthdays come round each year, and February 29th on the 28th', () => {
  assertEquals(nextBirthday('1990-09-24', '2026-09-24'), '2026-09-24');
  assertEquals(nextBirthday('1990-09-23', '2026-09-24'), '2027-09-23');
  assertEquals(nextBirthday('2000-02-29', '2026-01-01'), '2026-02-28');
  assertEquals(nextBirthday('2000-02-29', '2027-12-01'), '2028-02-29');
  assertEquals(daysBetween('2026-12-31', '2027-01-01'), 1);
});

const DATA = {
  people: [
    { id: 'dana', name: 'Dana', birthday: '1990-09-25', cadence: 30, lastContact: '2026-07-01' },
    { id: 'cal', name: 'Cal', birthday: '1985-10-10', cadence: 14, lastContact: '2026-09-20' },
    { id: 'kid', name: 'Kid', child: true, cadence: 7, lastContact: '2020-01-01' },
    { id: 'fay', name: 'Fay', paused: true, cadence: 7, lastContact: '2020-01-01' },
    'not a person',
  ],
  reminders: [
    { id: 'filter', title: 'Furnace filter', next: '2026-09-24', lead: 0 },
    { id: 'passport', title: 'Passport', next: '2026-10-10', lead: 30 },
    { id: 'tax', title: 'Taxes', next: '2026-09-20', lead: 3 },
    { id: 'far', title: 'Far off', next: '2026-12-01', lead: 7 },
    { id: 'off', title: 'Paused one', next: '2026-09-24', paused: true },
    { id: 'done', title: 'Done one', next: '2026-09-24', done: true },
  ],
  events: [
    { id: 'wed', title: 'Sam and Dana’s wedding', date: '2026-09-25' },
    { id: 'trip', title: 'Lisbon trip', date: '2026-09-29' },
    { id: 'past', title: 'Last week', date: '2026-09-17' },
  ],
};

Deno.test('what is due today, in words', () => {
  const items = dueItems(DATA, '2026-09-24', { kinds: ALL, birthdayDays: 1 });
  assertEquals(items.map((i) => i.text), [
    'Taxes: overdue by 4 days',
    'Furnace filter: due today',
    'Time to catch up with Dana: 3 months since you last talked',
    'Dana\'s birthday is tomorrow',
    'Tomorrow: Sam and Dana’s wedding',
    'Passport: due in 16 days',
  ]);
  assert(items.every((i) => i.ref.includes(':')), 'every item names what it is about');
});

Deno.test('each kind can be turned off, and birthdays can come earlier', () => {
  assertEquals(dueItems(DATA, '2026-09-24', { kinds: { ...ALL, reminders: false, checkins: false }, birthdayDays: 0 }).map((i) => i.kind), ['events']);
  assert(dueItems(DATA, '2026-09-24', { kinds: ALL, birthdayDays: 0 }).every((i) => i.kind !== 'birthdays'), 'tomorrow is not today');
  assertEquals(dueItems({ people: DATA.people }, '2026-10-05', { kinds: ALL, birthdayDays: 7 }).filter((i) => i.kind === 'birthdays')[0].text,
    'Cal\'s birthday is in 5 days (Oct 10)');
});

Deno.test('a weekly email looks a week ahead', () => {
  const week = dueItems(DATA, '2026-09-24', { kinds: ALL, birthdayDays: 1, horizon: 7 });
  assert(week.some((i) => i.text === 'Sep 29: Lisbon trip'));
  assert(!week.some((i) => i.text.startsWith('Far off')));
});

Deno.test('one push says everything new at once', () => {
  const items = dueItems(DATA, '2026-09-24', { kinds: ALL, birthdayDays: 1 });
  const p = pushFor(items);
  assertEquals(p.title, 'Orbit: 6 things coming up');
  assertEquals(p.body.split('\n').length, 4);
  assertEquals(p.body.split('\n')[3], 'and 3 more');
  assertEquals(pushFor(items.slice(0, 1)).body, 'Taxes: overdue by 4 days');
});

Deno.test('emails group by kind, and escape whatever people typed', () => {
  const m = emailFor([{ kind: 'events', ref: 'x', day: '2026-09-24', text: 'Today: <script>alert(1)</script>' }], { weekly: false, appUrl: 'https://o.example/' });
  assertEquals(m.subject, 'Orbit: 1 thing today');
  assert(m.html.includes('&lt;script&gt;') && !m.html.includes('<script>'));
  assert(m.text.includes('Events\n- Today: <script>alert(1)</script>'));
});

Deno.test('quiet hours can run past midnight', () => {
  assert(inQuiet(23, 22, 7) && inQuiet(3, 22, 7) && !inQuiet(12, 22, 7));
  assert(inQuiet(13, 12, 14) && !inQuiet(14, 12, 14));
  assert(!inQuiet(3, null, 7) && !inQuiet(3, 5, 5));
});

/* ---------- a whole run, with a stand-in database ---------- */

const prefs = (over: Partial<Prefs> = {}): Prefs => ({
  user_id: 'u1', push: true, email: false, email_every: 'daily', send_hour: 9, time_zone: 'America/Chicago',
  quiet_start: 22, quiet_end: 7, kinds: ALL, birthday_days: 1, ...over,
});

function fakes(list: Prefs[], opts: { requests?: { id: string; name: string }[]; subs?: Sub[]; email?: boolean; failFor?: string; activity?: Social[]; reactions?: Social[] } = {}) {
  const log: { user_id: string; channel: string; ref: string }[] = [];
  const pushes: { endpoint: string; payload: Record<string, string> }[] = [];
  const emails: { to: string; subject: string }[] = [];
  const dropped: string[] = [];
  const db: Db = {
    prefs: async () => list,
    data: async (u) => { if (u === opts.failFor) throw new Error('boom'); return DATA; },
    subs: async (u) => (opts.subs ?? [{ endpoint: `https://push.example/${u}`, p256dh: 'k', auth: 'a' }]).filter((s) => !dropped.includes(s.endpoint)),
    dropSub: async (e) => { dropped.push(e); },
    requests: async () => opts.requests ?? [],
    activity: async () => opts.activity ?? [],
    reactions: async () => opts.reactions ?? [],
    sent: async (u, ch, refs) => new Set(log.filter((l) => l.user_id === u && l.channel === ch && refs.includes(l.ref)).map((l) => l.ref)),
    log: async (rows) => { log.push(...rows); },
    emailOf: async (u) => `${u}@example.com`,
    prune: async () => {},
  };
  const send: Senders = {
    push: async (sub, payload) => {
      if (sub.endpoint.includes('gone')) return 'gone';
      pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return 'ok';
    },
    email: opts.email === false ? null : async (to, m) => { emails.push({ to, subject: m.subject }); return true; },
  };
  return { db, send, log, pushes, emails, dropped };
}

const NINE_CHICAGO = new Date('2026-09-24T14:05:00Z'); // 9:05 in Chicago, a Thursday
const MONDAY_NINE = new Date('2026-09-28T14:05:00Z');

Deno.test('at their hour, one push with everything due, and never the same thing twice', async () => {
  const f = fakes([prefs()]);
  const s = await run(f.db, f.send, NINE_CHICAGO, 'https://o.example/');
  assertEquals(s.pushes, 1);
  assertEquals(f.pushes[0].payload.title, 'Orbit: 6 things coming up');
  assertEquals(f.pushes[0].payload.url, 'https://o.example/');
  assertEquals(f.log.length, 6);
  await run(f.db, f.send, NINE_CHICAGO, 'https://o.example/');
  assertEquals(f.pushes.length, 1, 'a second run in the same hour sends nothing new');
});

Deno.test('outside their hour, only friend requests, and not in quiet hours', async () => {
  const f = fakes([prefs()], { requests: [{ id: 'bea', name: 'Bea Cho' }] });
  await run(f.db, f.send, new Date('2026-09-24T18:00:00Z'), 'u'); // 1pm
  assertEquals(f.pushes.map((p) => p.payload.body), ['Bea Cho wants to be friends']);
  const q = fakes([prefs()], { requests: [{ id: 'bea', name: 'Bea Cho' }] });
  await run(q.db, q.send, new Date('2026-09-25T04:00:00Z'), 'u'); // 11pm
  assertEquals(q.pushes.length, 0, 'quiet hours hold it');
  await run(q.db, q.send, new Date('2026-09-25T13:00:00Z'), 'u'); // 8am
  assertEquals(q.pushes.length, 1, 'and it goes when they end');
  const off = fakes([prefs({ kinds: { ...ALL, friend_requests: false } })], { requests: [{ id: 'bea', name: 'Bea Cho' }] });
  await run(off.db, off.send, new Date('2026-09-24T18:00:00Z'), 'u');
  assertEquals(off.pushes.length, 0, 'unless they turned requests off');
});

Deno.test('a device that has gone away is dropped', async () => {
  const f = fakes([prefs()], { subs: [{ endpoint: 'https://push.example/gone', p256dh: 'k', auth: 'a' }, { endpoint: 'https://push.example/here', p256dh: 'k', auth: 'a' }] });
  await run(f.db, f.send, NINE_CHICAGO, 'u');
  assertEquals(f.dropped, ['https://push.example/gone']);
  assertEquals(f.pushes.map((p) => p.endpoint), ['https://push.example/here']);
});

Deno.test('nothing is logged as sent when no device took it', async () => {
  const f = fakes([prefs()], { subs: [] });
  await run(f.db, f.send, NINE_CHICAGO, 'u');
  assertEquals(f.log.length, 0);
});

Deno.test('daily emails once a day, weekly ones on Monday, and none without an email service', async () => {
  const d = fakes([prefs({ push: false, email: true })]);
  await run(d.db, d.send, NINE_CHICAGO, 'u');
  await run(d.db, d.send, NINE_CHICAGO, 'u');
  assertEquals(d.emails, [{ to: 'u1@example.com', subject: 'Orbit: 6 things today' }]);
  const w = fakes([prefs({ push: false, email: true, email_every: 'weekly' })]);
  await run(w.db, w.send, NINE_CHICAGO, 'u');
  assertEquals(w.emails.length, 0, 'not on a Thursday');
  await run(w.db, w.send, MONDAY_NINE, 'u');
  assertEquals(w.emails.length, 1);
  assert(w.emails[0].subject.startsWith('Your week in Orbit'));
  const none = fakes([prefs({ push: false, email: true })], { email: false });
  await run(none.db, none.send, NINE_CHICAGO, 'u');
  assertEquals(none.emails.length, 0);
});

Deno.test('one person\'s trouble does not stop anyone else\'s', async () => {
  const f = fakes([prefs({ user_id: 'bad' }), prefs({ user_id: 'good' })], { failFor: 'bad' });
  const s = await run(f.db, f.send, NINE_CHICAGO, 'u');
  assertEquals(s.errors, 1);
  assertEquals(f.pushes.map((p) => p.endpoint), ['https://push.example/good']);
});

/* ---------- the request ---------- */

const ENV: Record<string, string> = { CRON_SECRET: 'a-long-enough-secret-value', VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' };
const env = (k: string) => ENV[k];
const post = (headers: Record<string, string>, body: unknown) => new Request('https://f.example/notify', { method: 'POST', headers, body: JSON.stringify(body) });

Deno.test('the hourly run needs the scheduled job\'s secret', async () => {
  const f = fakes([prefs()]);
  const deps = { db: f.db, senders: f.send, now: NINE_CHICAGO };
  assertEquals((await handle(post({}, { action: 'run' }), env, deps)).status, 401);
  assertEquals((await handle(post({ 'x-orbit-cron': 'wrong' }, {}), env, deps)).status, 401);
  assertEquals(f.pushes.length, 0);
  const ok = await handle(post({ 'x-orbit-cron': ENV.CRON_SECRET }, { action: 'run' }), env, deps);
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).pushes, 1);
  const short = (k: string) => (k === 'CRON_SECRET' ? 'short' : ENV[k]);
  assertEquals((await handle(post({ 'x-orbit-cron': 'short' }, {}), short, deps)).status, 401, 'a short secret is no secret');
});

Deno.test('a test push goes only to the signed-in person\'s own devices', async () => {
  const f = fakes([]);
  const deps = { db: f.db, senders: f.send, userOf: async (t: string) => (t === 'good-token' ? 'me' : null) };
  assertEquals((await handle(post({}, { action: 'test' }), env, deps)).status, 401);
  assertEquals((await handle(post({ authorization: 'Bearer forged' }, { action: 'test' }), env, deps)).status, 401);
  const r = await handle(post({ authorization: 'Bearer good-token' }, { action: 'test' }), env, deps);
  assertEquals(await r.json(), { sent: 1 });
  assertEquals(f.pushes[0].endpoint, 'https://push.example/me');
  assertEquals(f.pushes[0].payload.body, 'Notifications are working on this device.');
});

Deno.test('the browser may ask first', async () => {
  const r = await handle(new Request('https://f.example/notify', { method: 'OPTIONS' }), env);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get('access-control-allow-origin'), '*');
});

/* ---------- real web push, end to end ---------- */
// web-push only speaks https, as every real push service does, so the
// stand-in push service gets a certificate made for the test. Deno's
// node:https reads whether to check certificates once, at start, so
// `npm run test:notify` sets NODE_TLS_REJECT_UNAUTHORIZED=0 for the run.
// Nothing else in these tests reaches the network; the function itself is
// never run this way.
const trusting = <T>(fn: () => Promise<T>) => {
  assert(Deno.env.get('NODE_TLS_REJECT_UNAUTHORIZED') === '0', 'run through npm run test:notify');
  return fn();
};
async function tlsPair() {
  const dir = await Deno.makeTempDir();
  const out = await new Deno.Command('openssl', {
    args: ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`],
    stderr: 'null', stdout: 'null',
  }).output();
  assert(out.success, 'openssl made a certificate');
  const pair = { cert: await Deno.readTextFile(`${dir}/c.pem`), key: await Deno.readTextFile(`${dir}/k.pem`) };
  await Deno.remove(dir, { recursive: true });
  return pair;
}

Deno.test('a real encrypted push reaches a push service, and only the device can read it', async () => {
  const vapid = webpush.generateVAPIDKeys();
  // The device: its own key pair and secret, as a browser makes them.
  const device = createECDH('prime256v1');
  device.generateKeys();
  const authSecret = randomBytes(16);
  let got: { body: Uint8Array; headers: Headers } | null = null;
  const server = Deno.serve({ port: 0, hostname: '127.0.0.1', ...(await tlsPair()), onListen() {} }, async (req) => {
    got = { body: new Uint8Array(await req.arrayBuffer()), headers: req.headers };
    return new Response(null, { status: 201 });
  });
  const endpoint = `https://127.0.0.1:${server.addr.port}/push/abc`;
  const senders = realSenders((k) => ({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' } as Record<string, string>)[k]);
  const r = await trusting(() => senders.push({ endpoint, p256dh: device.getPublicKey('base64url'), auth: authSecret.toString('base64url') }, JSON.stringify({ title: 'Orbit', body: 'Hello' })));
  await server.shutdown();
  assertEquals(r, 'ok');
  assert(got, 'the push service was reached');
  const g = got as { body: Uint8Array; headers: Headers };
  assertEquals(g.headers.get('content-encoding'), 'aes128gcm');
  assert(/^vapid t=.+, k=.+/.test(g.headers.get('authorization') || ''), 'signed with the VAPID key');
  assert(!new TextDecoder().decode(g.body).includes('Hello'), 'the push service cannot read it');
  const plain = ece.decrypt(Buffer.from(g.body), { version: 'aes128gcm', privateKey: device, authSecret });
  assertEquals(JSON.parse(new TextDecoder().decode(plain)), { title: 'Orbit', body: 'Hello' });
});

Deno.test('a push service saying the device is gone is reported as gone', async () => {
  const vapid = webpush.generateVAPIDKeys();
  const device = createECDH('prime256v1');
  device.generateKeys();
  const server = Deno.serve({ port: 0, hostname: '127.0.0.1', ...(await tlsPair()), onListen() {} }, () => new Response(null, { status: 410 }));
  const senders = realSenders((k) => ({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey } as Record<string, string>)[k]);
  const r = await trusting(() => senders.push({ endpoint: `https://127.0.0.1:${server.addr.port}/x`, p256dh: device.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') }, '{}'));
  await server.shutdown();
  assertEquals(r, 'gone');
});

const BEA_RATED = { ref: 'act:bea:o:e1', who: 'Bea Cho', text: 'Bea Cho rated Chiefs vs Broncos ★★★★½' };
const DORA_PILE = Array.from({ length: 5 }, (_, i) => ({ ref: `act:dora:o:${i}`, who: 'Dora', text: `Dora went to Show ${i}` }));

Deno.test('stars in text, halves and all', () => {
  assertEquals([starText(4.5), starText(3), starText(0.5), starText(null)], ['★★★★½', '★★★', '½', '']);
});

Deno.test('friends\' activity and likes go out on any run, outside quiet hours', async () => {
  const f = fakes([prefs()], { activity: [BEA_RATED], reactions: [{ ref: 'like:bea:outing:e9', who: 'Bea Cho', text: 'Bea Cho liked Lisbon' }] });
  await run(f.db, f.send, new Date('2026-09-24T18:00:00Z'), 'u'); // 1pm, not their hour
  assertEquals(f.pushes.length, 1);
  assertEquals(f.pushes[0].payload.title, 'Orbit: 2 new from friends');
  assertEquals(f.pushes[0].payload.body, 'Bea Cho rated Chiefs vs Broncos ★★★★½\nBea Cho liked Lisbon');
  await run(f.db, f.send, new Date('2026-09-24T19:00:00Z'), 'u');
  assertEquals(f.pushes.length, 1, 'never the same thing twice');
  const q = fakes([prefs()], { activity: [BEA_RATED] });
  await run(q.db, q.send, new Date('2026-09-25T04:00:00Z'), 'u'); // 11pm
  assertEquals(q.pushes.length, 0, 'quiet hours hold it');
});

Deno.test('they start on, and each can be turned off', async () => {
  const old = fakes([prefs({ kinds: { ...ALL } })], { activity: [BEA_RATED] });
  await run(old.db, old.send, new Date('2026-09-24T18:00:00Z'), 'u');
  assertEquals(old.pushes.length, 1, 'a setting saved before these kinds existed counts them as on');
  const off = fakes([prefs({ kinds: { ...ALL, friend_activity: false, likes_comments: false } })],
    { activity: [BEA_RATED], reactions: [{ ref: 'cmt:1', who: 'Bea', text: 'Bea commented on Lisbon: “Nice”' }] });
  await run(off.db, off.send, new Date('2026-09-24T18:00:00Z'), 'u');
  assertEquals(off.pushes.length, 0);
});

Deno.test('a pile from one friend is one line, and every part of it is logged', async () => {
  const items = socialItems([...DORA_PILE, BEA_RATED].map((x) => ({ ...x, kind: 'friend_activity' as const })), new Set(['act:dora:o:0']), '2026-09-24');
  assertEquals(items.map((i) => i.text), ['Dora shared 4 new things', 'Bea Cho rated Chiefs vs Broncos ★★★★½'], 'what was sent already is not counted');
  const f = fakes([prefs()], { activity: DORA_PILE });
  await run(f.db, f.send, new Date('2026-09-24T18:00:00Z'), 'u');
  assertEquals(f.pushes[0].payload.body, 'Dora shared 5 new things');
  assertEquals(f.log.map((l) => l.ref).sort(), DORA_PILE.map((x) => x.ref).sort());
  await run(f.db, f.send, new Date('2026-09-24T19:00:00Z'), 'u');
  assertEquals(f.pushes.length, 1, 'none of it goes again');
});

Deno.test('things coming up still say so, even beside friends\' news', () => {
  assertEquals(pushFor([
    { kind: 'events', ref: 'a', day: 'd', text: 'Tomorrow: Wedding' },
    { kind: 'friend_activity', ref: 'b', day: 'd', text: 'Bea went to Lisbon' },
  ]).title, 'Orbit: 2 things coming up');
});

// A stand-in for the Supabase client: each query records its .in() list and
// answers with the rows whose value is in it.
function fakeClient(rows: Record<string, Record<string, unknown>[]>) {
  const lists: number[] = [];
  const client = {
    from(table: string) {
      let col = '';
      let list: unknown[] = [];
      const q = {
        select: () => q, eq: () => q, gte: () => q, order: () => q, or: () => q,
        in: (c: string, l: unknown[]) => { col = c; list = l; lists.push(l.length); return q; },
        then: (ok: (v: unknown) => void) => ok({ data: (rows[table] ?? []).filter((r) => !col || list.includes(r[col])), error: null }),
      };
      return q;
    },
  };
  return { client, lists };
}

Deno.test('a long list is asked for in pieces, so the request stays short, and nothing is lost', async () => {
  const refs = Array.from({ length: 173 }, (_, i) => `act:friend:o:${i}`);
  const { client, lists } = fakeClient({ notification_log: refs.filter((_, i) => i % 2).map((ref) => ({ ref })) });
  const done = await supabaseDb(client).sent('u', 'push', refs);
  assertEquals(done.size, 86);
  assert(lists.every((n) => n <= IN_CHUNK), `pieces of at most ${IN_CHUNK}: ${lists}`);
  assertEquals(lists.reduce((a, b) => a + b, 0), 173);
});
