/*
 * Notifications from the browser's side: whether this device can get push,
 * turning it on and off, and saving what someone wants to hear about. The
 * sending is done by the notify function (supabase/functions/notify).
 */

import { track } from './usage.js';

// import.meta.env is Vite's; the tests load this file without it.
const ENV = import.meta.env || {};
export const VAPID_PUBLIC_KEY = ENV.VITE_VAPID_PUBLIC_KEY || '';
const BASE = ENV.BASE_URL || '/';

export const KINDS = [
  ['birthdays', 'Birthdays', 'Before a birthday comes round.'],
  ['reminders', 'Reminders', 'When one comes into view, and when it is due.'],
  ['checkins', 'Check-ins', 'When it is time to catch up with someone.'],
  ['events', 'Events', 'The day before, and the day of.'],
  ['friend_requests', 'Friend requests', 'When someone asks to be friends, outside quiet hours.'],
  ['friend_activity', 'Friends’ activity', 'When a friend rates a concert or a game, or shows a trip, outside quiet hours.'],
  ['likes_comments', 'Likes and comments', 'When someone likes or comments on what you shared, outside quiet hours.'],
];

export const DEFAULT_PREFS = {
  push: false, email: false, email_every: 'daily', send_hour: 9, time_zone: 'UTC',
  quiet_start: 22, quiet_end: 7, birthday_days: 1,
  kinds: { birthdays: true, reminders: true, checkins: true, events: true, friend_requests: true, friend_activity: true, likes_comments: true },
};

export const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// Whether push can work here, and if not, what would make it.
export function pushSupport() {
  if (!VAPID_PUBLIC_KEY) return { ok: false, why: 'unset' };
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return { ok: false, why: 'unsupported' };
  // iPhones and iPads only allow push for sites added to the Home Screen.
  if (isIos() && !installed()) return { ok: false, why: 'install' };
  if (!('PushManager' in window) || !('Notification' in window)) return { ok: false, why: 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, why: 'denied' };
  return { ok: true, why: '' };
}

const keyBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

export function registerWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => null);
}

const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const app = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${app} on ${os}`;
};

const must = ({ data, error }) => {
  if (error) {
    throw new Error(/could not find the table|PGRST205|42P01/i.test(`${error.code} ${error.message}`)
      ? 'Notifications are not set up on the server yet.' : error.message);
  }
  return data;
};

export const notificationsApi = (client, userId, functionsUrl) => ({
  async load() {
    const rows = must(await client.from('notification_prefs').select('*').eq('user_id', userId).limit(1));
    // Kinds added since a setting was saved start on, as they would have.
    return rows?.[0] ? { ...DEFAULT_PREFS, ...rows[0], kinds: { ...DEFAULT_PREFS.kinds, ...rows[0].kinds } }
      : { ...DEFAULT_PREFS, time_zone: deviceTimeZone() };
  },
  async save(prefs) {
    const row = {
      user_id: userId, push: Boolean(prefs.push), email: Boolean(prefs.email), email_every: prefs.email_every,
      send_hour: Number(prefs.send_hour), time_zone: prefs.time_zone || deviceTimeZone(),
      quiet_start: prefs.quiet_start === '' || prefs.quiet_start == null ? null : Number(prefs.quiet_start),
      quiet_end: prefs.quiet_end === '' || prefs.quiet_end == null ? null : Number(prefs.quiet_end),
      kinds: prefs.kinds, birthday_days: Number(prefs.birthday_days),
    };
    must(await client.from('notification_prefs').upsert(row, { onConflict: 'user_id' }));
    // Which kinds people turn off says which notifications are unwanted.
    track('notify.save', { push: row.push, email: row.email, every: row.email_every,
      off: Object.entries(row.kinds || {}).filter(([, v]) => v === false).map(([k]) => k).sort().join(',') });
  },
  // Whether this very device is signed up for push.
  async deviceOn() {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration(BASE);
    return Boolean(await reg?.pushManager?.getSubscription());
  },
  async enableDevice() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied'
      ? 'Notifications are blocked for Orbit in this browser. Allow them in the browser’s site settings, then try again.'
      : 'Orbit was not allowed to send notifications.');
    const reg = (await registerWorker()) || (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    const j = sub.toJSON();
    must(await client.from('push_subscriptions').upsert({
      endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName(),
    }, { onConflict: 'endpoint' }));
    track('notify.push_on', {});
  },
  async disableDevice() {
    const reg = await navigator.serviceWorker?.getRegistration(BASE);
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    must(await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint));
    await sub.unsubscribe().catch(() => {});
    track('notify.push_off', {});
  },
  async devices() {
    return must(await client.from('push_subscriptions').select('endpoint, device, created_at').eq('user_id', userId)) || [];
  },
  async test() {
    const { data } = await client.auth.getSession();
    const res = await fetch(`${functionsUrl}/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    }).catch(() => null);
    if (!res) throw new Error('Orbit could not reach the notification service.');
    if (res.status === 404) throw new Error('The notification service is not set up yet.');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'The test could not be sent.');
    if (!body.sent) throw new Error('No device of yours has notifications on yet.');
    return body.sent;
  },
});
