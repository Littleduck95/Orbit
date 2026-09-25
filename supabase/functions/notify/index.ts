// Orbit's notifications: push to each device people turned it on for, and
// an email digest for those who asked for one.
//
// Runs as a Supabase Edge Function. Every hour a scheduled job (see
// supabase/notifications-cron.sql) calls it, and for each person whose
// chosen hour it now is, in their own time zone, it works out what is due
// from their saved Orbit and sends it. Friend requests go out on any run,
// outside quiet hours, as do friends' activity (what they rated, where they
// went) and likes and comments on what you shared. A log of what went out
// keeps anything being sent twice. Signed-in people can also ask it for a test push to their own
// devices.
//
// Secrets it needs (Edge Functions → Secrets in the dashboard):
//   CRON_SECRET        long random text; the scheduled job sends it
//   VAPID_PUBLIC_KEY   the public half of the push key pair (also in .env)
//   VAPID_PRIVATE_KEY  the private half; never anywhere but here
//   VAPID_SUBJECT      mailto: address push services can contact
//   RESEND_API_KEY     optional; turns on email, through resend.com
//   EMAIL_FROM         optional; who emails come from, e.g. Orbit <hi@yourdomain.com>
//   APP_URL            optional; where notifications open Orbit
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

/* ---------- dates in someone's own time zone ---------- */

export type Local = { date: string; hour: number; weekday: number };

// The calendar day, hour and weekday (0 = Sunday) it is now where they are.
// An unknown time zone counts as UTC rather than stopping their messages.
export function localNow(now: Date, timeZone: string): Local {
  let tz = timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday };
}

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayNumber = (s: string) => Math.round(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const addDays = (s: string, n: number) => new Date((dayNumber(s) + n) * 86400000).toISOString().slice(0, 10);
const shortDay = (s: string) => new Date(dayNumber(s) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// The next time a birthday comes round, on or after today. February 29th
// comes round on the 28th in other years.
export function nextBirthday(birthday: string, today: string): string {
  const md = birthday.slice(5);
  const on = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
  };
  const y = Number(today.slice(0, 4));
  return on(y) >= today ? on(y) : on(y + 1);
}

/* ---------- what is due ---------- */

// friend_activity and likes_comments came later: a setting saved before them
// does not name them, and they count as on.
export type Kinds = {
  birthdays: boolean; reminders: boolean; checkins: boolean; events: boolean; friend_requests: boolean;
  friend_activity?: boolean; likes_comments?: boolean;
};
// also: more refs a gathered item stands for, each logged as sent with it.
export type Item = { kind: keyof Kinds; ref: string; text: string; day: string; also?: string[] };
// Something a friend did: who, so a pile from one friend can be gathered.
export type Social = { ref: string; who: string; text: string };
type Rec = Record<string, unknown>;

const when = (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
const nameOf = (p: Rec) => (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Someone');
const since = (d: number) => (d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`);

// Everything worth a nudge today (horizon 0), or in the week ahead for a
// weekly email (horizon 7). Each item has a ref that names exactly what it
// is about, so it is only ever sent once per channel.
export function dueItems(
  data: { people?: unknown; reminders?: unknown; events?: unknown },
  today: string,
  opts: { kinds: Kinds; birthdayDays: number; horizon?: number },
): Item[] {
  const horizon = opts.horizon ?? 0;
  const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Rec[] : []);
  const out: Item[] = [];

  if (opts.kinds.birthdays) {
    const ahead = Math.max(opts.birthdayDays, horizon);
    for (const p of list(data.people)) {
      if (!isDay(p.birthday)) continue;
      const next = nextBirthday(p.birthday, today);
      const d = daysBetween(today, next);
      if (d <= ahead) out.push({ kind: 'birthdays', ref: `bday:${p.id}:${next}`, day: next, text: `${nameOf(p)}'s birthday is ${when(d)}${d > 1 ? ` (${shortDay(next)})` : ''}` });
    }
  }

  if (opts.kinds.reminders) {
    for (const r of list(data.reminders)) {
      if (r.paused || r.done || !isDay(r.next) || typeof r.title !== 'string') continue;
      const d = daysBetween(today, r.next);
      const lead = Math.min(365, Math.max(0, Math.round(Number(r.lead) || 0)));
      if (d > Math.max(lead, horizon)) continue;
      // Once when it comes into view, and once more when it is due.
      const stage = d <= 0 ? 'due' : 'soon';
      const say = d < 0 ? `overdue by ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'due today' : `due ${when(d)}`;
      out.push({ kind: 'reminders', ref: `rem:${r.id}:${r.next}:${stage}`, day: r.next, text: `${r.title.trim()}: ${say}` });
    }
  }

  if (opts.kinds.events) {
    for (const e of list(data.events)) {
      if (!isDay(e.date) || typeof e.title !== 'string') continue;
      const d = daysBetween(today, e.date);
      if (d < 0 || d > Math.max(1, horizon)) continue;
      out.push({ kind: 'events', ref: `evt:${e.id}:${e.date}`, day: e.date, text: `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : shortDay(e.date)}: ${e.title.trim()}` });
    }
  }

  if (opts.kinds.checkins) {
    for (const p of list(data.people)) {
      const cadence = Number(p.cadence);
      if (p.paused || p.child || !(cadence > 0) || !isDay(p.lastContact)) continue;
      const gone = daysBetween(p.lastContact, today);
      if (gone < cadence) continue;
      // Once per catch-up missed: logging a new one starts the clock again.
      out.push({ kind: 'checkins', ref: `chk:${p.id}:${p.lastContact}`, day: today, text: `Time to catch up with ${nameOf(p)}: ${since(gone)} since you last talked` });
    }
  }

  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const SOCIAL = new Set<keyof Kinds>(['friend_activity', 'likes_comments', 'friend_requests']);

// Friends' activity and reactions as push items, only what has not been sent,
// with more than two from one friend gathered into one line.
export function socialItems(list: (Social & { kind: 'friend_activity' | 'likes_comments' })[], done: Set<string>, day: string): Item[] {
  const fresh = list.filter((s) => !done.has(s.ref));
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const s of fresh) {
    const key = `${s.kind}:${s.who}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const same = fresh.filter((x) => x.kind === s.kind && x.who === s.who);
    if (same.length > 2) {
      out.push({
        kind: s.kind, ref: same[0].ref, also: same.slice(1).map((x) => x.ref), day,
        text: s.kind === 'friend_activity' ? `${s.who} shared ${same.length} new things` : `${s.who} liked or commented on ${same.length} of your posts`,
      });
    } else {
      out.push(...same.map((x) => ({ kind: x.kind, ref: x.ref, text: x.text, day })));
    }
  }
  return out;
}

const refsOf = (i: Item) => [i.ref, ...(i.also ?? [])];

// Stars in text, halves and all: 4.5 is ★★★★½.
export const starText = (n: unknown) => {
  const r = Number(n);
  if (!(r > 0)) return '';
  return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');
};

// One push for everything new at once, rather than a stream of them.
export function pushFor(items: Item[]): { title: string; body: string; tag: string } {
  if (items.length === 1) return { title: 'Orbit', body: items[0].text, tag: 'orbit-digest' };
  const more = items.length - 3;
  const social = items.every((i) => SOCIAL.has(i.kind));
  return {
    title: social ? `Orbit: ${items.length} new from friends` : `Orbit: ${items.length} things coming up`,
    body: items.slice(0, 3).map((i) => i.text).join('\n') + (more > 0 ? `\nand ${more} more` : ''),
    tag: 'orbit-digest',
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function emailFor(items: Item[], opts: { weekly: boolean; appUrl: string; name?: string }) {
  const heading = opts.weekly ? 'Your week in Orbit' : 'Today in Orbit';
  const groups: [keyof Kinds, string][] = [['birthdays', 'Birthdays'], ['events', 'Events'], ['reminders', 'Reminders'], ['checkins', 'Catch up'], ['friend_requests', 'Friends']];
  const text = [`${heading}${opts.name ? `, ${opts.name}` : ''}`, ''];
  let html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#15211B"><h1 style="font-size:22px">${escapeHtml(heading)}</h1>`;
  for (const [kind, label] of groups) {
    const these = items.filter((i) => i.kind === kind);
    if (!these.length) continue;
    text.push(label, ...these.map((i) => `- ${i.text}`), '');
    html += `<h2 style="font-size:15px;margin:18px 0 6px">${label}</h2><ul style="margin:0;padding-left:20px">${these.map((i) => `<li style="margin:0 0 4px">${escapeHtml(i.text)}</li>`).join('')}</ul>`;
  }
  text.push(`Open Orbit: ${opts.appUrl}`, '', 'Change what you get under Settings → Preferences in Orbit.');
  html += `<p style="margin:22px 0 0"><a href="${escapeHtml(opts.appUrl)}">Open Orbit</a></p><p style="color:#5A6B60;font-size:12px">Change what you get under Settings → Preferences in Orbit.</p></div>`;
  return { subject: opts.weekly ? `Your week in Orbit: ${items.length} things` : `Orbit: ${items.length} thing${items.length === 1 ? '' : 's'} today`, text: text.join('\n'), html };
}

export const inQuiet = (hour: number, start: number | null, end: number | null) => {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

/* ---------- one run ---------- */

export type Prefs = {
  user_id: string; push: boolean; email: boolean; email_every: 'daily' | 'weekly'; send_hour: number; time_zone: string;
  quiet_start: number | null; quiet_end: number | null; kinds: Kinds; birthday_days: number;
};
export type Sub = { endpoint: string; p256dh: string; auth: string };
export type Db = {
  prefs(): Promise<Prefs[]>;
  data(userId: string): Promise<{ people?: unknown; reminders?: unknown; events?: unknown }>;
  subs(userId: string): Promise<Sub[]>;
  dropSub(endpoint: string): Promise<void>;
  requests(userId: string): Promise<{ id: string; name: string }[]>;
  // Friends' outings and trips first shared since then, and likes and
  // comments on this person's posts since then.
  activity(userId: string, since: string): Promise<Social[]>;
  reactions(userId: string, since: string): Promise<Social[]>;
  sent(userId: string, channel: 'push' | 'email', refs: string[]): Promise<Set<string>>;
  log(rows: { user_id: string; channel: 'push' | 'email'; ref: string }[]): Promise<void>;
  emailOf(userId: string): Promise<string | null>;
  prune(): Promise<void>;
};
export type Senders = {
  push(sub: Sub, payload: string): Promise<'ok' | 'gone' | 'failed'>;
  email: null | ((to: string, msg: { subject: string; text: string; html: string }) => Promise<boolean>);
};

// Sends to every device; a device the push service says is gone is dropped.
async function pushAll(db: Db, send: Senders, userId: string, payload: Rec) {
  let ok = 0;
  for (const sub of await db.subs(userId)) {
    const r = await send.push(sub, JSON.stringify(payload));
    if (r === 'ok') ok += 1;
    if (r === 'gone') await db.dropSub(sub.endpoint);
  }
  return ok;
}

export async function run(db: Db, send: Senders, now: Date, appUrl: string) {
  const summary = { people: 0, pushes: 0, emails: 0, errors: 0 };
  for (const p of await db.prefs()) {
    try {
      const here = localNow(now, p.time_zone);
      const onTime = here.hour === p.send_hour;
      const quiet = inQuiet(here.hour, p.quiet_start, p.quiet_end);
      const needData = onTime && (p.push || p.email);
      const data = needData ? await db.data(p.user_id) : {};
      summary.people += 1;

      if (p.push) {
        const items = onTime ? dueItems(data, here.date, { kinds: p.kinds, birthdayDays: p.birthday_days }) : [];
        const social: (Social & { kind: 'friend_activity' | 'likes_comments' })[] = [];
        if (!quiet) {
          if (p.kinds.friend_requests) {
            for (const r of await db.requests(p.user_id)) {
              items.push({ kind: 'friend_requests', ref: `req:${r.id}`, day: here.date, text: `${r.name} wants to be friends` });
            }
          }
          // A day and an hour back, so nothing falls between two runs.
          const since = new Date(now.getTime() - 25 * 3600000).toISOString();
          if (p.kinds.friend_activity !== false) social.push(...(await db.activity(p.user_id, since)).map((s) => ({ ...s, kind: 'friend_activity' as const })));
          if (p.kinds.likes_comments !== false) social.push(...(await db.reactions(p.user_id, since)).map((s) => ({ ...s, kind: 'likes_comments' as const })));
        }
        const refs = [...items.map((i) => i.ref), ...social.map((s) => s.ref)];
        const done = refs.length ? await db.sent(p.user_id, 'push', refs) : new Set<string>();
        const fresh = [...items.filter((i) => !done.has(i.ref)), ...socialItems(social, done, here.date)];
        if (fresh.length && (await pushAll(db, send, p.user_id, { ...pushFor(fresh), url: appUrl })) > 0) {
          summary.pushes += 1;
          await db.log(fresh.flatMap(refsOf).map((ref) => ({ user_id: p.user_id, channel: 'push' as const, ref })));
        }
      }

      // Weekly emails go on Monday mornings, daily ones every morning.
      const weekly = p.email_every === 'weekly';
      if (p.email && send.email && onTime && (!weekly || here.weekday === 1)) {
        const ref = `${weekly ? 'week' : 'day'}:${here.date}`;
        const already = await db.sent(p.user_id, 'email', [ref]);
        const items = dueItems(data, here.date, { kinds: p.kinds, birthdayDays: p.birthday_days, horizon: weekly ? 7 : 0 });
        const to = items.length && !already.has(ref) ? await db.emailOf(p.user_id) : null;
        if (to && await send.email(to, emailFor(items, { weekly, appUrl }))) {
          summary.emails += 1;
          await db.log([{ user_id: p.user_id, channel: 'email', ref }]);
        }
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`notify: ${p.user_id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  await db.prune();
  return summary;
}

/* ---------- the real database and senders ---------- */

const ORBIT_KEYS = { 'crm-people-v1': 'people', 'crm-reminders-v1': 'reminders', 'crm-events-v1': 'events' } as const;

// A list filter (.in) travels in the request's address, which has a length
// limit. A friend who shares a pile at once can mean hundreds of refs, so
// long lists are asked for in pieces.
export const IN_CHUNK = 50;
export const inPieces = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK));
  return out;
};

// deno-lint-ignore no-explicit-any
export function supabaseDb(client: any): Db {
  const must = <T>({ data, error }: { data: T; error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  // Every row where column is in the list, a piece at a time. q starts each query.
  // deno-lint-ignore no-explicit-any
  const inAll = async <T>(list: string[], column: string, q: () => any): Promise<T[]> => {
    const rows: T[] = [];
    for (const piece of inPieces(list)) rows.push(...((must(await q().in(column, piece)) as T[] | null) ?? []));
    return rows;
  };
  return {
    prefs: async () => must(await client.from('notification_prefs').select('*').or('push.eq.true,email.eq.true')) ?? [],
    data: async (userId) => {
      const rows: { key: string; value: string }[] = must(await client.from('orbit_data').select('key, value')
        .eq('user_id', userId).in('key', Object.keys(ORBIT_KEYS))) ?? [];
      const out: Record<string, unknown> = {};
      for (const r of rows) {
        try { out[ORBIT_KEYS[r.key as keyof typeof ORBIT_KEYS]] = JSON.parse(r.value); } catch { /* unreadable: nothing from it */ }
      }
      return out;
    },
    subs: async (userId) => must(await client.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId)) ?? [],
    dropSub: async (endpoint) => { must(await client.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
    requests: async (userId) => {
      const rows: { requester: string }[] = must(await client.from('friendships').select('requester')
        .eq('addressee', userId).eq('status', 'pending')) ?? [];
      if (!rows.length) return [];
      const names: { id: string; display_name: string }[] = must(await client.from('profiles').select('id, display_name')
        .in('id', rows.map((r) => r.requester))) ?? [];
      return names.map((n) => ({ id: n.id, name: n.display_name }));
    },
    activity: async (userId, since) => {
      const pairs: { requester: string; addressee: string }[] = must(await client.from('friendships').select('requester, addressee')
        .eq('status', 'accepted').or(`requester.eq.${userId},addressee.eq.${userId}`)) ?? [];
      const ids = pairs.map((f) => (f.requester === userId ? f.addressee : f.requester));
      if (!ids.length) return [];
      const people = await inAll<{ id: string; display_name: string; visibility: Rec }>(ids, 'id',
        () => client.from('profiles').select('id, display_name, visibility'));
      const who = new Map(people.map((x) => [x.id, x]));
      const outs = await inAll<{ user_id: string; event_id: string; title: string; rating: number | null }>(ids, 'user_id',
        () => client.from('outings').select('user_id, event_id, title, rating').gte('created_at', since).order('created_at'));
      const trips = await inAll<{ user_id: string; trip_id: string; title: string }>(ids, 'user_id',
        () => client.from('shared_trips').select('user_id, trip_id, title').gte('created_at', since).order('created_at'));
      const nameOf = (id: string) => who.get(id)?.display_name || 'A friend';
      return [
        ...outs.map((o) => ({
          ref: `act:${o.user_id}:o:${o.event_id}`, who: nameOf(o.user_id),
          text: o.rating ? `${nameOf(o.user_id)} rated ${o.title} ${starText(o.rating)}` : `${nameOf(o.user_id)} went to ${o.title}`,
        })),
        // Only trips they show to friends or everyone.
        ...trips.filter((t) => ['friends', 'everyone'].includes(String(who.get(t.user_id)?.visibility?.trips || 'me'))).map((t) => ({
          ref: `act:${t.user_id}:t:${t.trip_id}`, who: nameOf(t.user_id), text: `${nameOf(t.user_id)} went to ${t.title}`,
        })),
      ];
    },
    reactions: async (userId, since) => {
      const likes: { liker: string; kind: string; ref: string }[] = must(await client.from('post_likes').select('liker, kind, ref')
        .eq('owner', userId).neq('liker', userId).gte('created_at', since).order('created_at')) ?? [];
      const notes: { id: string; author: string; kind: string; ref: string; body: string }[] = must(await client.from('post_comments')
        .select('id, author, kind, ref, body').eq('owner', userId).neq('author', userId).gte('created_at', since).order('created_at')) ?? [];
      if (!likes.length && !notes.length) return [];
      const blocks: { blocker: string; blocked: string }[] = must(await client.from('blocks').select('blocker, blocked')
        .or(`blocker.eq.${userId},blocked.eq.${userId}`)) ?? [];
      const blocked = new Set(blocks.map((b) => (b.blocker === userId ? b.blocked : b.blocker)));
      const ids = [...new Set([...likes.map((l) => l.liker), ...notes.map((c) => c.author)])];
      const people = await inAll<{ id: string; display_name: string }>(ids, 'id', () => client.from('profiles').select('id, display_name'));
      const nameOf = (id: string) => people.find((x) => x.id === id)?.display_name || 'Someone';
      const outs: { event_id: string; title: string }[] = must(await client.from('outings').select('event_id, title').eq('user_id', userId)) ?? [];
      const trips: { trip_id: string; title: string }[] = must(await client.from('shared_trips').select('trip_id, title').eq('user_id', userId)) ?? [];
      const title = (kind: string, ref: string) => (kind === 'outing' ? outs.find((o) => o.event_id === ref)?.title : trips.find((t) => t.trip_id === ref)?.title) || 'your post';
      const clip = (t: string) => (t.length > 80 ? `${t.slice(0, 79)}…` : t);
      return [
        ...likes.filter((l) => !blocked.has(l.liker)).map((l) => ({
          ref: `like:${l.liker}:${l.kind}:${l.ref}`, who: nameOf(l.liker), text: `${nameOf(l.liker)} liked ${title(l.kind, l.ref)}`,
        })),
        ...notes.filter((c) => !blocked.has(c.author)).map((c) => ({
          ref: `cmt:${c.id}`, who: nameOf(c.author), text: `${nameOf(c.author)} commented on ${title(c.kind, c.ref)}: “${clip(c.body)}”`,
        })),
      ];
    },
    sent: async (userId, channel, refs) => {
      const rows = await inAll<{ ref: string }>(refs, 'ref',
        () => client.from('notification_log').select('ref').eq('user_id', userId).eq('channel', channel));
      return new Set(rows.map((r) => r.ref));
    },
    log: async (rows) => { must(await client.from('notification_log').upsert(rows, { onConflict: 'user_id,channel,ref', ignoreDuplicates: true })); },
    emailOf: async (userId) => {
      const { data, error } = await client.auth.admin.getUserById(userId);
      return error ? null : data?.user?.email ?? null;
    },
    prune: async () => {
      const cutoff = new Date(Date.now() - 400 * 86400000).toISOString();
      must(await client.from('notification_log').delete().lt('sent_at', cutoff));
    },
  };
}

export function realSenders(env: (k: string) => string | undefined): Senders {
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:orbit@example.com', env('VAPID_PUBLIC_KEY')!, env('VAPID_PRIVATE_KEY')!);
  const resendKey = env('RESEND_API_KEY');
  return {
    push: async (sub, payload) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 * 12 });
        return 'ok';
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? 'gone' : 'failed';
      }
    },
    email: resendKey ? async (to, msg) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env('EMAIL_FROM') || 'Orbit <onboarding@resend.dev>', to, subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (!res.ok) console.error(`notify: email to ${to} failed: ${res.status} ${await res.text()}`);
      return res.ok;
    } : null,
  };
}

/* ---------- the request ---------- */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handle(req: Request, env: (k: string) => string | undefined, deps?: { db?: Db; senders?: Senders; now?: Date; userOf?: (jwt: string) => Promise<string | null> }) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const body = await req.json().catch(() => ({}));
  const appUrl = env('APP_URL') || 'https://littleduck95.github.io/Orbit/';
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return reply(500, { error: 'Push keys are not set up (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).' });

  const client = deps?.db ? null : createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const db = deps?.db ?? supabaseDb(client);
  const senders = deps?.senders ?? realSenders(env);

  // A signed-in person asking for a test push to their own devices.
  if (body?.action === 'test') {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const userOf = deps?.userOf ?? (async (t: string) => (await client!.auth.getUser(t)).data?.user?.id ?? null);
    const userId = jwt ? await userOf(jwt) : null;
    if (!userId) return reply(401, { error: 'Sign in first.' });
    const sent = await pushAll(db, senders, userId, { title: 'Orbit', body: 'Notifications are working on this device.', tag: 'orbit-test', url: appUrl });
    return reply(200, { sent });
  }

  // The hourly run, from the scheduled job only.
  const secret = env('CRON_SECRET') || '';
  if (secret.length < 16 || req.headers.get('x-orbit-cron') !== secret) return reply(401, { error: 'Not allowed.' });
  return reply(200, await run(db, senders, deps?.now ?? new Date(), appUrl));
}

if (import.meta.main) Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
