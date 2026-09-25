/*
 * Usage counts: which parts of Orbit people use, so what gets built next
 * follows what people do (see supabase/schema.sql, part 8).
 *
 * track('event.add', { kind: 'Concert', rated: true }) notes one action. Names
 * are "area.action". Details are a few short words, numbers or true/false,
 * and never anything anyone wrote: no names, titles, notes or places. Actions
 * wait here and go in small batches every few seconds, and when the page is
 * hidden or closed. Nothing is kept or sent:
 *   - without an account server (Orbit saving only in this browser),
 *   - for someone who turned it off (Settings → Preferences), which the
 *     server also enforces,
 *   - for a signed-out visitor whose browser asks not to be tracked (Do Not
 *     Track, Global Privacy Control).
 */

const MAX_BATCH = 50;
const WAIT_MS = 5000;

let server = null; // { url, key }
let token = '';
let enabled = true;
let signedIn = false;
let queue = [];
let timer = null;

const randomId = () => {
  try {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
};

// One id per visit (per tab), so a signed-out visitor's page views can be
// told apart without knowing who they are.
const session = (() => {
  try {
    const had = sessionStorage.getItem('orbit-visit');
    if (had) return had;
    const made = randomId();
    sessionStorage.setItem('orbit-visit', made);
    return made;
  } catch {
    return randomId();
  }
})();

const NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;

// Only short plain details go: the same rule the server applies.
export const cleanProps = (props) => {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props).slice(0, 12)) {
    if (!KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
};

const doNotTrack = () => {
  try {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  } catch {
    return false;
  }
};

const on = () => Boolean(server) && enabled && (signedIn || !doNotTrack());

export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length || !on()) { queue = []; return; }
  const now = Date.now();
  const batch = queue.splice(0, MAX_BATCH).map(({ name, props, at }) => ({ name, props, ago_ms: Math.max(0, now - at) }));
  try {
    fetch(`${server.url}/rest/v1/rpc/track_usage`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: server.key, authorization: `Bearer ${token || server.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch, p_session: session }),
    }).catch(() => {});
  } catch { /* counts are a nicety: never a reason for anything to fail */ }
  if (queue.length) flush();
}

export function track(name, props) {
  if (!on() || !NAME.test(name)) return;
  queue.push({ name, props: cleanProps(props), at: Date.now() });
  if (queue.length >= MAX_BATCH) flush();
  else if (!timer) timer = setTimeout(flush, WAIT_MS);
}

// Called once, when there is an account server.
export function startUsage({ url, key }) {
  if (!url || !key) return;
  server = { url, key };
  try {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
  } catch { /* no page to watch */ }
}

// Who is signed in (their token, or '' when signed out).
export function usageToken(accessToken = '') {
  token = accessToken || '';
  signedIn = Boolean(token);
}

// Whether this person shares usage (Settings → Preferences).
export function usageShare(share = true) {
  enabled = share !== false;
  if (!enabled) queue = [];
}

// For the tests: what is waiting.
export const pendingUsage = () => queue.map((q) => ({ name: q.name, props: q.props }));

// What kind of device, in two words, for app.open.
export const deviceKind = () => {
  try {
    const phone = window.matchMedia?.('(max-width: 700px)').matches || /Mobi|Android|iPhone/.test(navigator.userAgent);
    const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    return { device: phone ? 'phone' : 'computer', installed: Boolean(installed) };
  } catch {
    return { device: '?', installed: false };
  }
};
