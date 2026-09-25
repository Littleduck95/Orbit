import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useId, memo, Component } from 'react';
import Papa from 'papaparse';
import { KINDS, deviceTimeZone, pushSupport } from './notifications.js';
import {
  MIN_PASSWORD, PROFILE_FIELDS, publicApi, SOCIAL_KEYS, VISIBILITY, birthdayProblem, cleanUsername, displayNameProblem, emailProblem,
  passwordProblem, seenAs, usernameProblem, visibilityOf,
} from './accountApi.js';
import * as photoStore from './photoStore.js';
import { GEOCODER } from './mapConfig.js';
import { CARD_W, CARD_H, drawRecapCard, cardBlob, cardFontsReady } from './recapCard.js';
import { BASE, catalogPath, pageUrl, profilePath, readRoute } from './route.js';
import { deviceKind, flush as flushUsage, track, usageShare } from './usage.js';
import { CATALOG_KINDS, LINKS_FOR, OUTING_VISIBILITY, WIKIDATA, cleanLinks, outingsToShare, searchWikidata, tripsToShare } from './catalog.js';

/* ---------- palette ---------- */
const THEMES = {
  daylight: {
    ground: '#EDF2EE', surface: '#FBFDFB', ink: '#15211B',
    muted: '#5A6B60', faint: '#67786D', line: '#DCE5DE', paper: '#F7FBF8',
    accent: '#72DE88', accentSoft: '#D6F4DE', accentDeep: '#1F7A3A', onAccent: '#15211B',
    calmText: '#1F7A3A', calmBar: '#72DE88',
    soonText: '#8A6208', soonBar: '#E8B93C',
    overdue: '#A8362A', overdueBar: '#D2543F', overdueSoft: '#F8E5E1',
    rowHover: '#F2F9F4',
    sky: 'none',
    dark: false,
  },
  // Deep space. The same green reads as telemetry against navy, and every
  // colour below was checked for contrast on the dark surface.
  orbit: {
    ground: '#080D1A', surface: '#111A2E', ink: '#E9EFFA',
    muted: '#A3B0CA', faint: '#8593B0', line: '#25314C', paper: '#080D1A',
    accent: '#72DE88', accentSoft: '#173524', accentDeep: '#8FE8A2', onAccent: '#080D1A',
    calmText: '#72DE88', calmBar: '#72DE88',
    soonText: '#F2C75C', soonBar: '#F2C75C',
    overdue: '#FF9585', overdueBar: '#FF6B57', overdueSoft: '#3A1D19',
    rowHover: '#17223A',
    dark: true,
    sky: 'radial-gradient(1px 1px at 12% 18%, #ffffff55, transparent),'
       + 'radial-gradient(1px 1px at 34% 62%, #ffffff44, transparent),'
       + 'radial-gradient(1px 1px at 58% 12%, #ffffff55, transparent),'
       + 'radial-gradient(1px 1px at 71% 44%, #ffffff33, transparent),'
       + 'radial-gradient(1px 1px at 88% 74%, #ffffff4d, transparent),'
       + 'radial-gradient(1px 1px at 22% 88%, #ffffff33, transparent),'
       + 'radial-gradient(2px 2px at 46% 31%, #72DE8844, transparent)',
  },
};

const C = { ...THEMES.daylight };
const THEME_KEY = 'crm-theme-v1';


const STORE_KEY = 'crm-people-v1';
const OWNER_KEY = 'crm-owner-v1';

const CADENCES = [
  { days: 0, label: 'no reminder, we talk constantly', short: 'no reminder' },
  { days: 7, label: 'every week', short: 'weekly' },
  { days: 14, label: 'every couple weeks', short: 'every 2 weeks' },
  { days: 30, label: 'monthly', short: 'monthly' },
  { days: 90, label: 'every few months', short: 'quarterly' },
  { days: 182, label: 'twice a year', short: 'twice a year' },
  { days: 365, label: 'once a year', short: 'yearly' },
];

const TIERS = [
  { value: 'family', label: 'Family', cadence: 14 },
  { value: 'bestie', label: 'Bestie', cadence: 7 },
  { value: 'friend', label: 'Friend', cadence: 30 },
  { value: 'acquaintance', label: 'Acquaintance', cadence: 182 },
];
const tierLabel = (v) => TIERS.find((t) => t.value === v)?.label || '';

// Dates that come round every year. "Other" carries its own label so this can
// hold anything — started baseball, learning piano, sober since.
const DATE_KINDS = [
  'Wedding anniversary', 'Work anniversary', 'Passed away',
  'Graduated', 'Moved', 'Sober since', 'Other',
];

const dateLabel = (d) => (d.kind === 'Other' ? (d.label || 'Other') : d.kind);

// How many years the *upcoming* occurrence marks.
const annualCount = (s) => {
  const b = parseDate(s);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let y = now.getFullYear();
  if (new Date(y, b.getMonth(), b.getDate(), 12) < now) y += 1;
  return y - b.getFullYear();
};

const PARTNER_STATUSES = ['GF/BF', 'Engaged', 'Married'];

const RELATIONS = [
  ['Immediate', ['Mom', 'Dad', 'Sister', 'Brother', 'Son', 'Daughter', 'Spouse']],
  ['Extended', ['Grandma', 'Grandpa', 'Aunt', 'Uncle', 'Cousin', 'Niece', 'Nephew', 'Grandchild']],
  ['Step', ['Stepmom', 'Stepdad', 'Stepsister', 'Stepbrother', 'Half-sister', 'Half-brother']],
  ['In-law', ['Mother-in-law', 'Father-in-law', 'Sister-in-law', 'Brother-in-law']],
  ['Other', ['Godparent', 'Guardian', 'Family friend']],
];

const partnerLabel = (pt) => {
  if (pt?.status === 'Married') return 'Married to';
  if (pt?.status === 'Engaged') return 'Engaged to';
  if (pt?.status === 'GF/BF') return 'Dating';
  return 'Partner';
};

const handle = (h) => (h || '').trim().replace(/^@+/, '');

const splitTags = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

const SOCIALS = [
  { key: 'linkedin', label: 'LinkedIn', at: false, ph: 'profile URL or handle', circles: ['work'],
    url: (h) => (/^https?:/i.test(h.trim()) ? h.trim() : `https://linkedin.com/in/${handle(h)}`) },
  { key: 'instagram', label: 'Instagram', at: true, ph: '@handle', circles: ['friend'],
    url: (h) => `https://instagram.com/${handle(h)}` },
  { key: 'x', label: 'X', at: true, ph: '@handle', circles: ['friend', 'work'],
    url: (h) => `https://x.com/${handle(h)}` },
  { key: 'tiktok', label: 'TikTok', at: true, ph: '@handle', circles: ['friend'],
    url: (h) => `https://tiktok.com/@${handle(h)}` },
  { key: 'snapchat', label: 'Snapchat', at: false, ph: 'username', circles: ['friend'],
    url: (h) => `https://snapchat.com/add/${handle(h)}` },
];

/* ---------- date helpers ---------- */
const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayStr = () => fmtDate(new Date());

const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const daysSince = (s) => {
  if (!s) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((now - parseDate(s)) / 86400000));
};

const elapsed = (d) => {
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  if (d < 365) return `${Math.round(d / 30)} months`;
  const y = (d / 365).toFixed(1).replace('.0', '');
  return `${y} years`;
};

// toLocaleDateString builds a new formatter on every call, which is slow enough
// to matter across a few hundred events, so each one here is built once, on
// first use (building the first costs ~10ms, so not at load). They format in
// UTC a date made from the local calendar day, which shows the same day
// toLocaleDateString would, even if the computer's timezone changes while the
// app is open.
const DAY_OPTIONS = {
  full: { month: 'short', day: 'numeric', year: 'numeric' },
  monthDay: { month: 'short', day: 'numeric' },
  birthday: { month: 'long', day: 'numeric' },
};
const dayFormats = {};

const formatDay = (d, format) => {
  if (Number.isNaN(d.getTime())) return 'Invalid Date';
  if (!dayFormats[format]) dayFormats[format] = new Intl.DateTimeFormat(undefined, { ...DAY_OPTIONS[format], timeZone: 'UTC' });
  // setUTCFullYear, not Date.UTC, which would read years 0-99 as 1900-1999.
  const utc = new Date(Date.UTC(2000, 0, 1, 12));
  utc.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  return dayFormats[format].format(utc);
};

const prettyDate = (s) => formatDay(parseDate(s), 'full');

// Calendar years, not days/365 — averaging makes exactly two years floor to one.
const yearsSince = (d) => {
  const then = parseDate(d);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let n = now.getFullYear() - then.getFullYear();
  const reached =
    now.getMonth() > then.getMonth() ||
    (now.getMonth() === then.getMonth() && now.getDate() >= then.getDate());
  if (!reached) n -= 1;
  return Math.max(0, n);
};

// Worked out from today every render, never stored.
const ageFromBirthday = (b) => {
  const bd = parseDate(b);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let a = now.getFullYear() - bd.getFullYear();
  const hadItYet =
    now.getMonth() > bd.getMonth() ||
    (now.getMonth() === bd.getMonth() && now.getDate() >= bd.getDate());
  if (!hadItYet) a -= 1;
  return a;
};

// A birthday with no real year gives a nonsense age, so ignore it below 1.
const derivedAge = (b) => {
  if (!b) return null;
  const a = ageFromBirthday(b);
  return a >= 1 ? a : null;
};

// A typed-in age is anchored to the day it was entered, then ages itself.
const ageOf = (p) => {
  const fromBirthday = derivedAge(p.birthday);
  if (fromBirthday !== null) return fromBirthday;
  if (p.age && p.ageAsOf) return Number(p.age) + yearsSince(p.ageAsOf);
  if (p.age) return Number(p.age);
  return null;
};

const prettyBirthday = (s) => formatDay(parseDate(s), 'birthday');

const daysToBirthday = (s) => {
  if (!s) return null;
  const b = parseDate(s);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let next = new Date(now.getFullYear(), b.getMonth(), b.getDate(), 12);
  if (next < now) next = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate(), 12);
  return Math.round((next - now) / 86400000);
};

const countdown = (d) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${elapsed(d)}`);

// Signed, unlike daysToBirthday: a date that has gone by comes back negative
// rather than rolling forward to next year's occurrence.
const daysUntil = (s) => {
  if (!s) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((parseDate(s) - now) / 86400000);
};

const status = (p) => {
  const d = daysSince(p.lastContact);
  if (p.paused) return { ratio: -1, tone: C.muted, bar: C.line, over: false, days: d, paused: true };
  if (p.child) return { ratio: 0, tone: C.muted, bar: C.line, over: false, days: d, child: true };
  if (Number(p.cadence) === 0)
    return { ratio: 0, tone: C.calmText, bar: C.calmBar, over: false, days: d, always: true };
  if (d === null) return { ratio: 2, tone: C.overdue, bar: C.overdueBar, over: true, days: null };
  const ratio = d / p.cadence;
  if (ratio >= 1) return { ratio, tone: C.overdue, bar: C.overdueBar, over: true, days: d };
  if (ratio >= 0.7) return { ratio, tone: C.soonText, bar: C.soonBar, over: false, days: d };
  return { ratio, tone: C.calmText, bar: C.calmBar, over: false, days: d };
};

// Urgency drives colour; rank drives order. People with no reminder are the
// closest, so they sit at the top rather than the bottom of a browse list.
const rank = (p) => {
  const st = status(p);
  let base;
  if (st.paused) base = -2;
  else if (st.child) base = -1.5;
  else if (st.always) base = 1000;            // inner circle, nothing to chase
  else base = Math.min(st.ratio, 900);        // urgency
  return base + (p.vip ? 10000 : 0);
};

// Most urgent first. Works out each person's rank once, rather than twice in
// every comparison; the comparisons, and so the order, are the same.
const byRank = (list) =>
  list.map((p) => ({ p, r: rank(p) }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.p);


// lastContact is derived, so any edit to the log has to rebuild it.
const withLog = (p, log) => {
  const clean = [...log].filter((e) => e.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { ...p, log: clean, lastContact: clean.length ? clean[0].date : null };
};

const WORDS = ['No one', 'One person', 'Two people', 'Three people', 'Four people', 'Five people', 'Six people', 'Seven people', 'Eight people', 'Nine people'];
const countPhrase = (n) => (n < WORDS.length ? WORDS[n] : `${n} people`);

const NUMBERS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const countThings = (n, one, many) =>
  `${n < NUMBERS.length ? NUMBERS[n] : n} ${n === 1 ? one : many}`;

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- timezone, derived from a US address ---------- */
const ZONE_STATES = {
  'America/New_York': ['CT Connecticut DE Delaware FL Florida GA Georgia ME Maine MD Maryland',
    'MA Massachusetts MI Michigan NH "New Hampshire" NJ "New Jersey" NY "New York"',
    'NC "North Carolina" OH Ohio PA Pennsylvania RI "Rhode Island" SC "South Carolina"',
    'VT Vermont VA Virginia WV "West Virginia" DC IN Indiana KY Kentucky'].join(' '),
  'America/Chicago': ['AL Alabama AR Arkansas IL Illinois IA Iowa LA Louisiana MN Minnesota',
    'MS Mississippi MO Missouri OK Oklahoma WI Wisconsin TX Texas KS Kansas NE Nebraska',
    'ND "North Dakota" SD "South Dakota" TN Tennessee'].join(' '),
  'America/Denver': 'CO Colorado MT Montana NM "New Mexico" UT Utah WY Wyoming ID Idaho',
  'America/Phoenix': 'AZ Arizona',
  'America/Los_Angeles': 'CA California WA Washington OR Oregon NV Nevada',
  'America/Anchorage': 'AK Alaska',
  'Pacific/Honolulu': 'HI Hawaii',
};

const STATE_TZ = {};
Object.entries(ZONE_STATES).forEach(([zone, blob]) => {
  (blob.match(/"[^"]+"|\S+/g) || []).forEach((tok) => {
    STATE_TZ[tok.replace(/"/g, '').toUpperCase()] = zone;
  });
});

const zoneFromAddress = (addr) => {
  if (!addr) return null;
  const up = addr.toUpperCase();
  // Strongest signal: a two-letter code just before a ZIP, or after a comma.
  const m =
    up.match(/\b([A-Z]{2})\b\s+\d{5}(?:-\d{4})?/) ||
    up.match(/,\s*([A-Z]{2})\b/);
  if (m && STATE_TZ[m[1]]) return STATE_TZ[m[1]];
  const names = Object.keys(STATE_TZ).filter((k) => k.length > 2).sort((a, b) => b.length - a.length);
  const hit = names.find((n) => up.includes(n));
  return hit ? STATE_TZ[hit] : null;
};

const zoneNow = (zone) => {
  try {
    const d = new Date();
    const time = d.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    const abbr = d.toLocaleTimeString('en-US', { timeZone: zone, timeZoneName: 'short' }).split(' ').pop();
    const hour = Number(d.toLocaleString('en-US', { timeZone: zone, hour: 'numeric', hour12: false }));
    return { time, abbr, odd: hour < 8 || hour >= 21 };
  } catch {
    return null;
  }
};

/* ---------- small pieces ---------- */
/* ---------- orbital bits ---------- */
// Not decoration: the arc shows how far through their check-in period someone
// is, which the text ("3 weeks") cannot say on its own.
function OrbitDial({ p, size = 38 }) {
  const st = status(p);
  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const idle = st.paused || st.child;
  const frac = idle ? 0 : st.always ? 1 : Math.min(1, Math.max(0.02, st.ratio));
  const angle = -90 + 360 * frac;
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2 + r * Math.cos(rad);
  const cy = size / 2 + r * Math.sin(rad);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth="2"
        strokeDasharray={idle ? '2 4' : undefined} />
      {!idle && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={st.bar} strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${circ * frac} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      {!idle && <circle cx={cx} cy={cy} r="3.2" fill={st.bar} />}
      <circle cx={size / 2} cy={size / 2} r="2.4" fill={C.faint} />
    </svg>
  );
}

// Empty screens have nothing to compete with, so an illustration is free here.
// The planet and its moon, beside the name.
function OrbitMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" style={{ flexShrink: 0, overflow: 'visible' }}>
      <ellipse cx="9.5" cy="9.5" rx="9" ry="4.4" fill="none"
        stroke={C.accent} strokeWidth="1.1" opacity="0.65"
        transform="rotate(-28 9.5 9.5)" />
      <circle cx="9.5" cy="9.5" r="3.1" fill={C.accent} />
      <circle cx="17.2" cy="5.7" r="1.7" fill={C.accent} />
    </svg>
  );
}

function EmptySky({ width = 132 }) {
  return (
    <svg width={width} height={width * 0.62} viewBox="0 0 132 82"
      style={{ display: 'block', margin: '4px 0 18px' }} aria-hidden="true">
      <ellipse cx="66" cy="41" rx="58" ry="23" fill="none" stroke={C.line} strokeWidth="1.2"
        transform="rotate(-16 66 41)" />
      <ellipse cx="66" cy="41" rx="36" ry="13" fill="none" stroke={C.line} strokeWidth="1.2"
        transform="rotate(-16 66 41)" />
      <circle cx="66" cy="41" r="8" fill={C.accentSoft} stroke={C.accent} strokeWidth="1.4" />
      <circle cx="112" cy="27" r="3.4" fill={C.accent} />
      <circle cx="31" cy="52" r="2.4" fill={C.faint} />
      <circle cx="18" cy="14" r="1.3" fill={C.faint} />
      <circle cx="120" cy="66" r="1.3" fill={C.faint} />
      <circle cx="88" cy="9" r="1" fill={C.faint} />
    </svg>
  );
}


function Button({ children, onClick, kind = 'quiet', style, ...rest }) {
  const base = {
    font: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    padding: '9px 14px',
    borderRadius: 7,
    cursor: 'pointer',
    border: '1px solid transparent',
    letterSpacing: '-0.01em',
    ...style,
  };
  const kinds = {
    solid: { background: C.accent, color: C.onAccent, borderColor: C.accent },
    quiet: { background: 'transparent', color: C.ink, borderColor: C.line },
    danger: { background: 'transparent', color: C.overdue, borderColor: 'transparent', padding: '9px 10px' },
  };
  return (
    <button className="crm-btn" style={{ ...base, ...kinds[kind], ...(rest.disabled ? { opacity: 0.55, cursor: 'default' } : null) }} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

const Rule = () => <div style={{ height: 1, background: C.line, margin: '4px 0 16px' }} />;

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 5, fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

// Same thing to look at, but not a <label>. A label with no "for" attaches
// itself to the first labelable thing inside it, and a <button> counts: wrap a
// row of choices in Field and the heading becomes the first button's name, so
// it reads as "How often Just once" and clicking the heading presses it.
// Anything holding buttons rather than a single input belongs in here.
function Group({ label, children }) {
  return (
    <div style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 5, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

// Shared looks. Functions rather than objects: C changes with the theme, and
// an object built once at load would keep whichever theme came first.

// A chip in a row of filters or choices.
const filterChip = (on) => ({
  font: 'inherit', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em',
  padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
  background: on ? C.accent : 'transparent',
  border: `1px solid ${on ? C.accent : C.line}`,
  color: on ? C.onAccent : C.muted,
});

// One half of a two-way choice that fills the row: "Just once / Again and again".
const segment = (on) => ({
  flex: 1, font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 0',
  borderRadius: 7, cursor: 'pointer',
  background: on ? C.accent : 'transparent',
  border: `1px solid ${on ? C.accent : C.line}`,
  color: on ? C.onAccent : C.muted,
});

// A small label naming what kind of thing something is.
const kindChip = () => ({
  fontSize: 11, fontWeight: 600, color: C.muted, flexShrink: 0,
  border: `1px solid ${C.line}`, borderRadius: 20, padding: '2px 8px',
});

// Enter submits, unless it is the Enter that confirms a word being composed
// in an input method (Japanese, Chinese, Korean), which only finishes the word.
const isEnter = (e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229;

const hintStyle = () => ({ display: 'block', fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 });
const small = { fontSize: 12.5, padding: '6px 11px' };

let inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: 15,
  color: C.ink,
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 7,
  padding: '10px 11px',
  minHeight: 42,
};


let linkStyle = {
  fontSize: 13,
  color: C.ink,
  textDecoration: 'none',
  borderBottom: `1px solid ${C.line}`,
  paddingBottom: 1,
};

const applyTheme = (name) => {
  Object.assign(C, THEMES[name] || THEMES.daylight);
  // These must be NEW objects, not mutated ones. React compares style props by
  // reference first, so an in-place edit is invisible to it and the element
  // keeps the old theme until it happens to remount.
  inputStyle = {
    ...inputStyle, color: C.ink, background: C.surface, border: `1px solid ${C.line}`,
  };
  linkStyle = {
    ...linkStyle, color: C.ink, borderBottom: `1px solid ${C.line}`,
  };
};

// The app's own stylesheet: fonts, hover states, the map's pins. Shared with
// the public pages, which are drawn without the rest of the app.
function AppStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600&family=Source+Serif+4:opsz,wght@8..60,400&display=swap');
      .crm-serif { font-family: 'Source Serif 4', Georgia, serif; }
      .crm-btn:hover { filter: brightness(0.94); }
      .crm-row:hover { background: ${C.rowHover}; }
      .crm-btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible {
        outline: 2px solid ${C.ink}; outline-offset: 2px;
      }
      input, select, textarea { font-family: inherit; }
      .crm-full { grid-column: 1 / -1; }
      
      /* Narrow: one column. The panel replaces the list rather than pushing it. */
      .crm-shell { max-width: 460px; margin: 0 auto; padding: 22px 16px 60px; }
      .crm-main.is-hidden { display: none; }
      .crm-detail { display: none; }
      .crm-detail.is-open { display: block; }
      .crm-idle { display: none; }
      .crm-tpl-wide { display: none; }

      /* Wide: list and detail side by side, detail pinned while the list scrolls. */
      @media (min-width: 880px) {
        .crm-shell {
          max-width: 1000px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 384px;
          column-gap: 30px;
          align-items: start;
        }
        .crm-head { grid-column: 1 / -1; }
        .crm-main.is-hidden { display: block; }
        .crm-detail { display: block; position: sticky; top: 20px; }
        .crm-back { display: none; }
        .crm-idle { display: block; }
        .crm-tpl-wide { display: block; }
        .crm-tpl-pick { display: none; }
      }
      .crm-person:last-child, .crm-entry:last-child { border-bottom: none !important; }
      /* A list can hold thousands of entries. Rows off screen are skipped
         until scrolled to, which is most of what a keystroke costs on a long
         list. Still found by find-in-page and screen readers. */
      .crm-entry { content-visibility: auto; contain-intrinsic-size: auto 62px; }
      /* The same for people, who can run to hundreds. What every person
         row shares is here too, rather than inline (see PersonRow). */
      .crm-person {
        content-visibility: auto; contain-intrinsic-size: auto 65px;
        display: flex; border-bottom: 1px solid ${C.line};
      }
      .crm-person-bar { width: 4px; flex-shrink: 0; }
      .crm-person-body, .crm-person-main { flex: 1; min-width: 0; }
      .crm-person .crm-row { padding: 14px 15px; cursor: pointer; display: flex; align-items: baseline; gap: 10px; }
      .crm-person-top { display: flex; align-items: baseline; gap: 7px; }
      .crm-person-name {
        font-size: 17px; font-weight: 600; letter-spacing: -0.02em; color: ${C.ink};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .crm-person-age { font-size: 13px; color: ${C.faint}; flex-shrink: 0; }
      .crm-person-sub { font-size: 13px; color: ${C.muted}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .crm-person-when { text-align: right; flex-shrink: 0; max-width: 116px; white-space: nowrap; }
      .crm-person-status { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
      .crm-person-cadence { font-size: 12px; color: ${C.faint}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
      .crm-person-act {
        flex-shrink: 0; cursor: pointer; background: transparent;
        border: none; border-left: 1px solid ${C.line};
        display: flex; align-items: center; justify-content: center;
      }
      /* That also clips painting to each row, which would cut off a focus
         ring drawn outside a button that fills the row, so rings go inside. */
      .crm-entry .crm-btn:focus-visible, .crm-entry a:focus-visible,
      .crm-person .crm-btn:focus-visible { outline-offset: -3px; }
      /* Important, because every select also takes the shared input style
         inline, whose background and padding would otherwise paint over
         the arrow and run the text underneath it. */
      .crm-select {
        appearance: none; -webkit-appearance: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 4.5 L6 8 L9.5 4.5' fill='none' stroke='${encodeURIComponent(C.muted)}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>") !important;
        background-repeat: no-repeat !important; background-position: right 11px center !important; background-size: 12px !important;
        padding-right: 32px !important;
      }
      /* Hidden from sight, still there for keyboards and screen readers. */
      .crm-sr {
        position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
      }
      .crm-star input:focus-visible + span, .crm-file:focus-within {
        outline: 2px solid ${C.ink}; outline-offset: 2px; border-radius: 6px;
      }
      .crm-clamp { -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      /* Maps. Tiles, popups and controls all follow the theme. */
      /* Close to the tiles' own sea, so any gap around the world reads as ocean. */
      .orbit-map { font-family: inherit; background: ${C.dark ? '#1B1D20' : '#D6DCDE'}; }
      .orbit-map .leaflet-bar { border: 1px solid ${C.line}; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.12); overflow: hidden; }
      .orbit-map .leaflet-bar a {
        width: 34px; height: 34px; line-height: 32px; font-size: 18px; font-weight: 500;
        background: ${C.surface}; color: ${C.ink}; border-bottom: 1px solid ${C.line};
      }
      .orbit-map .leaflet-bar a:last-child { border-bottom: none; }
      .orbit-map .leaflet-bar a:hover, .orbit-map .leaflet-bar a:focus-visible { background: ${C.rowHover}; color: ${C.ink}; }
      .orbit-map .leaflet-bar a.leaflet-disabled { background: ${C.surface}; color: ${C.faint}; opacity: 0.5; }
      .orbit-map .leaflet-control-attribution {
        background: ${C.surface}cc; color: ${C.muted}; font-size: 10.5px; border-top-left-radius: 6px; padding: 1px 6px;
      }
      .orbit-map .leaflet-control-attribution a { color: ${C.muted}; }
      .orbit-map .leaflet-popup-content-wrapper, .orbit-map .leaflet-popup-tip {
        background: ${C.surface}; color: ${C.ink}; box-shadow: 0 6px 22px rgba(0,0,0,0.28);
      }
      .orbit-map .leaflet-popup-content { margin: 12px 14px; font-size: 13px; line-height: 1.4; }
      .orbit-map a.leaflet-popup-close-button { color: ${C.muted}; }
      .orbit-pin, .orbit-cluster { background: none; border: none; }
      .orbit-pin span, .orbit-cluster span {
        display: flex; align-items: center; justify-content: center; box-sizing: border-box;
        border-radius: 50%; color: #fff; font-weight: 700; font-family: system-ui, sans-serif;
      }
      .orbit-pin span { width: 28px; height: 28px; font-size: 13px; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.45); }
      /* Trips to come: the colour moves from the fill to a thick ring. */
      .orbit-pin-planned span, .orbit-pin-someday span {
        background: #fff !important; box-shadow: 0 0 0 2px #fff, 0 1px 5px rgba(0,0,0,0.45);
      }
      .orbit-pin-planned span { border: 4px solid ${PLAN_COLORS.planned}; }
      .orbit-pin-someday span { border: 3px dashed ${PLAN_COLORS.someday}; }
      .orbit-cluster span {
        width: 38px; height: 38px; font-size: 13px; background: #15211B;
        border: 3px solid #72DE88; box-shadow: 0 1px 6px rgba(0,0,0,0.4);
      }
      .orbit-pin:focus-visible, .orbit-cluster:focus-visible { outline: none; }
      .orbit-pin:focus-visible span, .orbit-cluster:focus-visible span { outline: 3px solid #15211B; outline-offset: 2px; }
      .crm-open { animation: crmIn .16s ease-out; }
      @keyframes crmIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .crm-open { animation: none; } }
    `}</style>
  );
}

/* ---------- add / edit ---------- */
function PersonForm({ initial, defaultCircle, inline, families, allGroups, companies, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [circle, setCircle] = useState(initial?.circle || defaultCircle || 'friend');
  const [tier, setTier] = useState(initial?.tier || 'friend');
  const [role, setRole] = useState(initial?.role || '');
  const [company, setCompany] = useState(initial?.company || '');
  const [hobbies, setHobbies] = useState(initial?.hobbies || '');
  const [aka, setAka] = useState((initial?.aka || []).join(', '));
  const [email, setEmail] = useState(initial?.email || '');
  const [kids, setKids] = useState((initial?.kids || []).join(', '));
  const [paused, setPaused] = useState(Boolean(initial?.paused));
  const [child, setChild] = useState(Boolean(initial?.child));
  const [family, setFamily] = useState((initial?.families || []).join(', '));
  const [relation, setRelation] = useState(initial?.relation || '');
  const [groups, setGroups] = useState((initial?.groups || []).join(', '));
  const [partnerName, setPartnerName] = useState(initial?.partner?.name || '');
  const [partnerStatus, setPartnerStatus] = useState(initial?.partner?.status || '');
  // 0 is a real choice ("no reminder", which status() also reads from a
  // stored "0"), so it is kept. Only a missing or unreadable cadence falls
  // back to 90, as before.
  const [cadence, setCadence] = useState([0, '0'].includes(initial?.cadence) ? 0 : initial?.cadence || 90);
  const [cadenceTouched, setCadenceTouched] = useState(Boolean(initial));
  const [birthday, setBirthday] = useState(initial?.birthday || '');
  const [age, setAge] = useState(initial?.age ? String(initial.age) : '');
  const [dates, setDates] = useState(initial?.dates || []);
  const [phone, setPhone] = useState(initial?.phone || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [socials, setSocials] = useState(initial?.socials || {});
  const [note, setNote] = useState(initial?.note || '');
  const [last, setLast] = useState(initial?.lastContact || '');

  const pickTier = (v) => {
    setTier(v);
    if (!cadenceTouched) {
      const t = TIERS.find((x) => x.value === v);
      if (t) setCadence(t.cadence);
    }
  };

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const fromBirthday = derivedAge(birthday);
    const cleaned = {};
    SOCIALS.forEach((s) => {
      const v = handle(socials[s.key]);
      if (v) cleaned[s.key] = v;
    });
    onSave({
      id: initial?.id || uid(),
      addedOn: initial?.addedOn || todayStr(),
      name: n,
      circle,
      tier: circle === 'friend' ? tier : null,
      role: role.trim(),
      child: circle === 'friend' ? child : false,
      company: circle === 'friend' && child ? '' : company.trim(),
      hobbies: hobbies.trim(),
      aka: splitTags(aka),
      kids: circle === 'friend' && child ? [] : splitTags(kids),
      email: email.trim(),
      paused,
      families: splitTags(family),
      relation: circle === 'friend' && splitTags(family).length ? relation : '',
      groups: groups.split(',').map((g) => g.trim()).filter(Boolean),
      partner: !(circle === 'friend' && child) && partnerName.trim()
        ? { name: partnerName.trim(), status: partnerStatus } : null,
      cadence: Number(cadence),
      birthday: birthday || null,
      age: fromBirthday !== null || age === '' ? null : Number(age),
      ageAsOf:
        fromBirthday !== null || age === ''
          ? null
          : Number(age) === Number(initial?.age) && initial?.ageAsOf
          ? initial.ageAsOf
          : todayStr(),
      dates: dates
        .filter((d) => d.date)
        .map((d) => ({ kind: d.kind, label: d.kind === 'Other' ? (d.label || '').trim() : '', date: d.date })),
      phone: phone.trim(),
      address: address.trim(),
      socials: cleaned,
      note: note.trim(),
      lastContact: last || initial?.lastContact || null,
      log: initial?.log || [],
    });
  };

  return (
    <div style={{
      background: C.surface,
      border: inline ? 'none' : `1px solid ${C.line}`,
      borderRadius: inline ? 0 : 12,
      padding: inline ? '15px 15px 16px' : 16,
      marginBottom: inline ? 0 : 18,
    }}>
      <Field label="Name">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dana Whitfield" />
      </Field>

      <Field label="Also known as">
        <input style={inputStyle} value={aka} onChange={(e) => setAka(e.target.value)}
          placeholder="Boyer, Liz" />
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
          Maiden name, nickname, anything you might search for instead.
        </span>
      </Field>

      <Group label="Circle">
        <div style={{ display: 'flex', gap: 8 }}>
          {[['friend', 'Personal'], ['work', 'Professional']].map(([v, l]) => (
            <button
              key={v}
              className="crm-btn"
              onClick={() => setCircle(v)}
              style={{
                flex: 1, font: 'inherit', fontSize: 14, fontWeight: 600, padding: '10px 0',
                borderRadius: 7, cursor: 'pointer',
                border: `1px solid ${circle === v ? C.ink : C.line}`,
                background: circle === v ? C.accent : 'transparent',
                color: circle === v ? C.onAccent : C.muted,
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </Group>

      {circle === 'friend' && (
        <Field label="Closeness">
          <select className="crm-select" style={inputStyle} value={tier} onChange={(e) => pickTier(e.target.value)}>
            {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      )}

      {circle === 'friend' && (
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={child} onChange={(e) => setChild(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16, accentColor: C.accentDeep, flexShrink: 0 }} />
          <span>
            <span style={{ fontSize: 14, color: C.ink }}>This is a child</span>
            <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2, lineHeight: 1.45 }}>
              Hides company, spouse and kids, and stops them ever showing as overdue.
              Birthdays and dates still come through.
            </span>
          </span>
        </label>
      )}

      <Field label={circle === 'work' ? 'Role' : 'How you know them'}>
        <input style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}
          placeholder={circle === 'work' ? 'Operations lead' : 'From the climbing gym'} />
      </Field>

{!(circle === 'friend' && child) && (
      <Field label="Company">
        <input style={inputStyle} value={company} list="crm-companies"
          onChange={(e) => setCompany(e.target.value)} placeholder="Ardent Systems" />
        <datalist id="crm-companies">
          {(companies || []).map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      )}

{!(circle === 'friend' && child) && (
      <Field label="Spouse or significant other">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ ...inputStyle, width: 'auto', flex: '1 1 150px' }}
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            placeholder="Name"
          />
          <select
            className="crm-select"
            style={{ ...inputStyle, width: 'auto', flex: '0 1 138px' }}
            value={partnerStatus}
            onChange={(e) => setPartnerStatus(e.target.value)}
          >
            <option value="">Not set</option>
            {PARTNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </Field>
      )}

{!(circle === 'friend' && child) && (
      <Field label="Kids">
        <input style={inputStyle} value={kids} onChange={(e) => setKids(e.target.value)}
          placeholder="Ellie (7), Jack (4)" />
      </Field>
      )}

      <Field label="Family">
        <input
          style={inputStyle}
          value={family}
          list="crm-families"
          onChange={(e) => setFamily(e.target.value)}
          placeholder="Boyer family, Yungck family"
        />
        <datalist id="crm-families">
          {(families || []).map((f) => <option key={f} value={f} />)}
        </datalist>
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
          Separate with commas to put someone in more than one household. On personal
          contacts, a relation dropdown appears below once tagged.
        </span>
      </Field>

      {circle === 'friend' && splitTags(family).length > 0 && (
        <Field label={`How they're related`}>
          <select className="crm-select" style={inputStyle} value={relation}
            onChange={(e) => setRelation(e.target.value)}>
            <option value="">Not set</option>
            {RELATIONS.map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((r) => <option key={r} value={r}>{r}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      )}

      <Field label="Knows">
        <input
          style={inputStyle}
          value={groups}
          list="crm-groups"
          onChange={(e) => setGroups(e.target.value)}
          placeholder="Climbing crew, Air Force guys"
        />
        <datalist id="crm-groups">
          {(allGroups || []).map((g) => <option key={g} value={g} />)}
        </datalist>
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
          Friend groups, separated by commas. Someone can be in several.
        </span>
      </Field>

      <Rule />

      <Field label="Email">
        <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="dana@example.com" />
      </Field>

      <Field label="Phone">
        <input type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="816-555-0148" />
      </Field>

      <Field label="Address">
        <textarea
          style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={'1420 Elm St\nWarrensburg, MO 64093'}
        />
      </Field>

      <Field label="Socials">
        <div style={{ display: 'grid', gap: 7 }}>
          {SOCIALS.filter((s) => s.circles.includes(circle)).map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: C.muted, width: 74, flexShrink: 0 }}>{s.label}</span>
              <input
                style={{ ...inputStyle, padding: '8px 10px', fontSize: 14, minHeight: 38 }}
                value={socials[s.key] || ''}
                placeholder={s.ph}
                onChange={(e) => setSocials({ ...socials, [s.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </Field>

      <Rule />

{!(circle === 'friend' && child) && (
      <Field label="Check in">
        <select className="crm-select" style={inputStyle} value={cadence}
          onChange={(e) => { setCadence(e.target.value); setCadenceTouched(true); }}>
          {CADENCES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
        </select>
      </Field>
      )}

      <Field label="Last time you talked">
        <input type="date" style={inputStyle} value={last} max={todayStr()} onChange={(e) => setLast(e.target.value)} />
      </Field>

      <Field label="Birthday">
        <input type="date" style={inputStyle} value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
          Include the real birth year and the age below fills itself in.
        </span>
      </Field>

      <Field label="Age">
        {derivedAge(birthday) !== null ? (
          <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: C.muted }}>
            {derivedAge(birthday)}
          </div>
        ) : (
          <input type="number" min="0" max="120" style={inputStyle} value={age}
            onChange={(e) => setAge(e.target.value)} placeholder="38" />
        )}
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
          {derivedAge(birthday) !== null
            ? 'Counted from the birthday each time you open this, so it never goes stale.'
            : 'Only needed when the birth year is unknown. It still ticks up every year.'}
        </span>
      </Field>

      <Group label="Dates to remember">
        {dates.length === 0 && (
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
            Anniversaries, the day someone passed, the year they took up a sport. These
            come back every year.
          </p>
        )}

        {dates.map((d, i) => {
          const set = (patch) =>
            setDates(dates.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} style={{
              border: `1px solid ${C.line}`, borderRadius: 9, padding: 10, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <select
                  className="crm-select"
                  aria-label="Kind of date"
                  style={{ ...inputStyle, width: 'auto', flex: '1 1 150px', minHeight: 38, fontSize: 14 }}
                  value={d.kind}
                  onChange={(e) => set({ kind: e.target.value })}
                >
                  {DATE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input
                  type="date"
                  aria-label="Date"
                  style={{ ...inputStyle, width: 'auto', flex: '1 1 140px', minHeight: 38, fontSize: 14 }}
                  value={d.date || ''}
                  onChange={(e) => set({ date: e.target.value })}
                />
              </div>

              {d.kind === 'Other' && (
                <input
                  style={{ ...inputStyle, marginTop: 7, minHeight: 38, fontSize: 14 }}
                  value={d.label || ''}
                  onChange={(e) => set({ label: e.target.value })}
                  placeholder="What is it? e.g. Started baseball"
                />
              )}

              <button
                className="crm-btn"
                onClick={() => setDates(dates.filter((_, j) => j !== i))}
                style={{
                  font: 'inherit', fontSize: 12, color: C.overdue, background: 'transparent',
                  border: 'none', padding: '7px 0 0', cursor: 'pointer',
                }}
              >
                Remove this date
              </button>
            </div>
          );
        })}

        <Button onClick={() => setDates([...dates, { kind: DATE_KINDS[0], label: '', date: '' }])}>
          Add a date
        </Button>
      </Group>

      <Field label="Hobbies and sports">
        <input style={inputStyle} value={hobbies} onChange={(e) => setHobbies(e.target.value)}
          placeholder="Climbing, brisket, Chiefs games" />
      </Field>

      <Field label="Worth remembering">
        <textarea
          className="crm-serif"
          style={{ ...inputStyle, minHeight: 70, resize: 'vertical', lineHeight: 1.55 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Kids' names, what they're working on, the thing to ask about next time."
        />
      </Field>

      {!(circle === 'friend' && child) && (
      <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)}
          style={{ marginTop: 2, width: 16, height: 16, accentColor: C.accentDeep, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>
          Pause check-ins. For someone you have fallen out of touch with. Keeps them and
          their history, but they stop going quiet and drop to the bottom of the list.
        </span>
      </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button kind="solid" onClick={save} style={{ flex: 1 }}>{initial ? 'Save changes' : 'Add to list'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------- one person ---------- */
// Memoised: a keystroke, a star or a tick redraws only the rows it changed.
// today and theme are passed only so a row is redrawn when either changes,
// since both feed what it shows (how long ago, the colours in C) without
// being in its other props.
const PersonRow = memo(function PersonRow({ p, selected, onOpen, onQuickLog, onStar, showCircle, today: _today, theme: _theme }) {
  const st = status(p);
  const [justLogged, setJustLogged] = useState(false);

  const quick = () => {
    onQuickLog(p.id);
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 1600);
  };
  // Only what differs row to row is inline; the rest is in .crm-person-*
  // in the app's stylesheet (see PersonalCRM), because setting inline styles
  // is most of what drawing hundreds of these costs.
  return (
    <div className="crm-person" style={{ background: selected ? C.accentSoft : C.surface }}>
      <div className="crm-person-bar" style={{ background: st.bar, opacity: st.over || selected ? 1 : 0.6 }} />
      <div className="crm-person-body">
        <div className="crm-row" onClick={() => onOpen(p.id)}>
          <div className="crm-person-main">
            <div className="crm-person-top">
              <span className="crm-person-name">{p.name}</span>
              {ageOf(p) !== null && (
                <span className="crm-person-age">{ageOf(p)}</span>
              )}
            </div>
            <div className="crm-person-sub">
              {[
                showCircle ? (p.circle === 'work' ? 'Professional' : 'Personal') : '',
                p.circle === 'friend' ? (p.relation || tierLabel(p.tier)) : '',
                p.role,
                p.circle === 'work' ? p.company : '',
              ].filter(Boolean).join(', ') ||
                (p.circle === 'work' ? 'Professional' : 'Personal')}
            </div>
          </div>
          <div className="crm-person-when">
            <div className="crm-person-status" style={{ color: st.tone }}>
              {st.paused ? 'paused'
                : st.child ? (st.days === null ? '—' : elapsed(st.days))
                : st.always ? 'in touch'
                : st.days === null ? 'no log' : elapsed(st.days)}
            </div>
            <div className="crm-person-cadence">
              {p.child ? 'child' : CADENCES.find((c) => c.days === Number(p.cadence))?.short || 'monthly'}
            </div>
          </div>
        </div>
      </div>

      <button
        className="crm-btn crm-person-act"
        onClick={() => onStar(p.id)}
        title={p.vip ? 'Remove from VIPs' : 'Mark as VIP'}
        aria-label={p.vip ? `Remove ${p.name} from VIPs` : `Mark ${p.name} as a VIP`}
        aria-pressed={Boolean(p.vip)}
        style={{ width: 40, color: p.vip ? C.soonBar : C.faint }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 1.6 L9.9 5.6 L14.2 6.2 L11.1 9.3 L11.9 13.7 L8 11.6 L4.1 13.7 L4.9 9.3 L1.8 6.2 L6.1 5.6 Z"
            fill={p.vip ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        className="crm-btn crm-person-act"
        onClick={quick}
        title="Caught up with them today"
        aria-label={`Log a catch-up with ${p.name} today`}
        style={{
          width: 48,
          background: justLogged ? C.accent : 'transparent',
          color: justLogged ? C.onAccent : C.faint,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
          <path d="M3.5 9 L7 12.5 L13.5 5" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
});

function PersonDetail({ p, owner, myEvents, myReminders, myRecs, myTrips, onTrip, onLog, onEditLog, onRemoveLog, onEdit, onRemove, onTag, onList, onClearVia, onClose }) {
  const [logging, setLogging] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [logDate, setLogDate] = useState(todayStr());
  const [logText, setLogText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The entry being edited, held as the entry itself rather than its place
  // in the list. Logging another catch-up while this is open moves every
  // entry down one; following the entry keeps Save and Delete on the one
  // that was opened. If it is gone, the editor simply closes.
  const [editEntry, setEditEntry] = useState(null);
  const [draft, setDraft] = useState({ date: '', text: '' });
  const [allLog, setAllLog] = useState(false);

  const zone = zoneFromAddress(p.address);
  const now = zone ? zoneNow(zone) : null;

  const facts = [
    (p.aka || []).length > 0 && { label: 'Also known as', value: p.aka.join(', ') },
    p.birthday && {
      label: 'Birthday',
      value: `${prettyBirthday(p.birthday)}, ${countdown(daysToBirthday(p.birthday))}`,
    },
    p.partner?.name && { label: partnerLabel(p.partner), value: p.partner.name },
    (p.kids || []).length > 0 && { label: 'Kids', value: p.kids.join(', ') },
    now && { label: 'Their time', value: `${now.time} ${now.abbr}`, warn: now.odd },
    p.hobbies && { label: 'Hobbies', value: p.hobbies },
  ].filter(Boolean);

  const links = [
    p.email && {
      key: 'email', label: 'Email', text: p.email, href: `mailto:${p.email}`, external: false,
    },
    p.phone && {
      key: 'phone',
      label: 'Phone',
      text: p.phone,
      href: `tel:${p.phone.replace(/[^\d+]/g, '')}`,
      external: false,
    },
    ...SOCIALS.filter((s) => p.socials?.[s.key]).map((s) => ({
      key: s.key,
      label: s.label,
      text: `${s.at ? '@' : ''}${p.socials[s.key]}`,
      href: s.url(p.socials[s.key]),
      external: true,
    })),
  ].filter(Boolean);

  const commit = () => {
    onLog(p.id, logDate, logText.trim());
    setLogging(false);
    setLogText('');
    setLogDate(todayStr());
  };

  return (
    <div>
      <button className="crm-back crm-btn" onClick={onClose} style={{
        font: 'inherit', fontSize: 13, fontWeight: 600, color: C.muted, background: 'transparent',
        border: 'none', padding: '0 0 12px', cursor: 'pointer',
      }}>
        ← Back to the list
      </button>

      <div style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 15px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 13 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', color: C.ink }}>
                {p.name}
              </span>
              {ageOf(p) !== null && (
                <span style={{ fontSize: 14, color: C.faint, flexShrink: 0 }}>{ageOf(p)}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              {[
                p.circle === 'work' ? 'Professional' : 'Personal',
                p.circle === 'friend' ? (p.relation || tierLabel(p.tier)) : '',
                p.role,
                p.circle === 'work' ? p.company : '',
              ].filter(Boolean).join(', ')}
            </div>
          </div>
          <OrbitDial p={p} />
          <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: status(p).tone }}>
              {status(p).paused ? 'paused'
                : status(p).child ? (status(p).days === null ? '—' : elapsed(status(p).days))
                : status(p).always ? 'in touch'
                : status(p).days === null ? 'no log'
                : elapsed(status(p).days)}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              {p.child ? 'child' : CADENCES.find((c) => c.days === Number(p.cadence))?.short || 'monthly'}
            </div>
          </div>
        </div>

          {(p.company || (p.families || []).length > 0 || (p.groups || []).length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              {p.company && (
                <button
                  className="crm-btn"
                  onClick={() => onTag('company', p.company)}
                  style={{
                    font: 'inherit', fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em',
                    color: C.ink, background: 'transparent', border: `1px solid ${C.ink}`,
                    padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                  }}
                >
                  {p.company}
                </button>
              )}
              {(p.families || []).map((f) => (
                <button
                  key={f}
                  className="crm-btn"
                  onClick={() => onTag('family', f)}
                  style={{
                    font: 'inherit', fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em',
                    color: C.ink, background: C.accentSoft, border: '1px solid transparent',
                    padding: '5px 10px', borderRadius: 20, cursor: 'pointer',
                  }}
                >
                  {f}
                </button>
              ))}
              {p.relation && (
                <span style={{ fontSize: 12, color: C.muted, marginRight: 2 }}>{p.relation}</span>
              )}
              {(p.groups || []).map((g) => (
                <button
                  key={g}
                  className="crm-btn"
                  onClick={() => onTag('group', g)}
                  style={{
                    font: 'inherit', fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em',
                    color: C.muted, background: 'transparent', border: `1px solid ${C.line}`,
                    padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ margin: '0 0 13px' }}>
              {facts.map((f, i) => (
                <p key={i} style={{ margin: '0 0 4px', fontSize: 13, lineHeight: 1.5, color: C.ink }}>
                  <span style={{ color: C.faint }}>{f.label} </span>
                  <span style={{ color: f.warn ? C.soonText : C.ink, fontWeight: f.warn ? 600 : 400 }}>
                    {f.value}
                  </span>
                </p>
              ))}
            </div>
          )}
          {links.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 14px', margin: '0 0 12px' }}>
              {links.map((l) => (
                <a
                  key={l.key}
                  href={l.href}
                  target={l.external ? '_blank' : undefined}
                  rel={l.external ? 'noreferrer' : undefined}
                  style={linkStyle}
                >
                  <span style={{ color: C.faint }}>{l.label} </span>
                  {l.text}
                </a>
              ))}
            </div>
          )}

          {p.address && (
            <div style={{ margin: '0 0 14px' }}>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`}
                target="_blank"
                rel="noreferrer"
                style={{ ...linkStyle, display: 'inline-block', whiteSpace: 'pre-line', lineHeight: 1.5 }}
              >
                <span style={{ color: C.faint }}>Address </span>
                {p.address}
              </a>
            </div>
          )}
          {p.via && (
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.faint, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span>{p.via.by ? `From ${p.via.by}` : 'Shared with you'}{isDay(p.via.on) ? ` · ${prettyDate(p.via.on)}` : ''}</span>
              <button className="crm-btn" onClick={onClearVia} aria-label="Remove the note about where this came from"
                style={{ font: 'inherit', fontSize: 12, fontWeight: 600, color: C.muted, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                Remove note
              </button>
            </p>
          )}
          {(myEvents || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.faint }}>Moments together</p>
              {myEvents.map((e) => (
                <p key={e.id} style={{ margin: '0 0 4px', fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
                  {e.title}
                  <span style={{ color: C.faint }}> — {eventWhen(e).text}</span>
                </p>
              ))}
            </div>
          )}

          {(myTrips || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.faint }}>Trips together</p>
              {myTrips.map((t) => (
                <button
                  key={t.id}
                  className="crm-btn"
                  onClick={() => onTrip(t.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                    fontSize: 13, color: C.ink, lineHeight: 1.45, cursor: 'pointer',
                    background: 'transparent', border: 'none', padding: '0 0 4px',
                  }}
                >
                  {t.title}
                  <span style={{ color: C.faint }}>{` — ${tripWhen(t).text}`}</span>
                </button>
              ))}
            </div>
          )}

          {(myReminders || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.faint }}>Coming round again</p>
              {myReminders.map((r) => {
                const st = reminderState(r);
                return (
                  <p key={r.id} style={{ margin: '0 0 4px', fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
                    {r.title}
                    <span style={{ color: st.key === 'over' ? C.overdue : C.faint }}>
                      {` — ${st.key === 'paused' ? 'paused' : st.key === 'done' ? 'done' : dueText(st.d)}`}
                    </span>
                  </p>
                );
              })}
            </div>
          )}

          {(myRecs || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.faint }}>Recommended</p>
              {myRecs.map(({ c, it }) => (
                <button
                  key={`${c.id}-${it.id}`}
                  className="crm-btn"
                  onClick={() => onList(c.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                    fontSize: 13, color: C.ink, lineHeight: 1.45, cursor: 'pointer',
                    background: 'transparent', border: 'none', padding: '0 0 4px',
                  }}
                >
                  {it.title}
                  <span style={{ color: C.faint }}>
                    {` — ${c.name}${stagesOf(c).length && stageOf(c, it) === 'done'
                      ? `, ${stageLabel(c, 'done').toLowerCase()}` : ''}`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {p.note && (
            <p className="crm-serif" style={{ margin: '0 0 14px', fontSize: 15, lineHeight: 1.6, color: C.ink }}>
              {p.note}
            </p>
          )}

          {logging ? (
            <div style={{ marginBottom: 14 }}>
              <input type="date" style={{ ...inputStyle, marginBottom: 8 }} value={logDate} max={todayStr()}
                onChange={(e) => setLogDate(e.target.value)} />
              <input className="crm-serif" style={{ ...inputStyle, marginBottom: 8 }} value={logText}
                onChange={(e) => setLogText(e.target.value)} placeholder="What came up?" />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button kind="solid" onClick={commit} style={{ flex: 1 }}>Save catch-up</Button>
                <Button onClick={() => setLogging(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: p.log?.length ? 14 : 0 }}>
              <Button kind="solid" onClick={() => setLogging(true)}>Log a catch-up</Button>
              <Button onClick={onEdit}>Edit</Button>
              <Button onClick={() => setSharing(!sharing)} style={sharing ? { borderColor: C.accent } : undefined}>Share</Button>
              <Button
                kind="danger"
                onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
                style={confirmRemove ? { fontWeight: 700 } : undefined}
              >
                {confirmRemove ? 'Tap again to remove' : 'Remove'}
              </Button>
            </div>
          )}

          {sharing && !logging && (
            <div style={{ marginTop: p.log?.length ? 0 : 14 }}>
              <PersonShare p={p} owner={owner} onClose={() => setSharing(false)} />
            </div>
          )}

          {p.log?.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              {(allLog ? p.log : p.log.slice(0, 4)).map((e, i) => (
                e === editEntry ? (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <input type="date" max={todayStr()} value={draft.date}
                      onChange={(ev) => setDraft({ ...draft, date: ev.target.value })}
                      style={{ ...inputStyle, marginBottom: 7, minHeight: 38, fontSize: 14 }} />
                    <input className="crm-serif" value={draft.text}
                      onChange={(ev) => setDraft({ ...draft, text: ev.target.value })}
                      placeholder="What came up?"
                      style={{ ...inputStyle, marginBottom: 7, minHeight: 38, fontSize: 14 }} />
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                      <Button kind="solid" style={{ fontSize: 12.5, padding: '6px 11px' }}
                        onClick={() => { onEditLog(p.id, i, draft); setEditEntry(null); }}>Save</Button>
                      <Button style={{ fontSize: 12.5, padding: '6px 11px' }}
                        onClick={() => setEditEntry(null)}>Cancel</Button>
                      <Button kind="danger" style={{ fontSize: 12.5, padding: '6px 9px' }}
                        onClick={() => { onRemoveLog(p.id, i); setEditEntry(null); }}>Delete</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={i}
                    className="crm-btn"
                    onClick={() => { setEditEntry(e); setDraft({ date: e.date, text: e.text || '' }); }}
                    style={{
                      display: 'flex', gap: 10, width: '100%', textAlign: 'left', font: 'inherit',
                      background: 'transparent', border: 'none', padding: '0 0 9px', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 12, color: C.faint, flexShrink: 0, width: 78, paddingTop: 2 }}>
                      {prettyDate(e.date)}
                    </span>
                    <span className="crm-serif" style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
                      {e.text || 'Talked.'}
                    </span>
                  </button>
                )
              ))}

              {p.log.length > 4 && (
                <button
                  className="crm-btn"
                  onClick={() => setAllLog(!allLog)}
                  style={{
                    font: 'inherit', fontSize: 12.5, fontWeight: 600, color: C.muted,
                    background: 'transparent', border: 'none', padding: '2px 0 0', cursor: 'pointer',
                  }}
                >
                  {allLog ? 'Show fewer' : `Show all ${p.log.length}`}
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

/* ---------- sharing a copy: sending ---------- */
// Drawn from the link itself, dark on white whatever the theme, since that
// is what phone cameras read best. The library is only fetched the first
// time a code is shown.
function QrCode({ text, label }) {
  const [cells, setCells] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then((m) => {
      const qr = (m.default || m)(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      if (live) setCells({ n, d });
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [text]);
  if (failed) return <p style={{ fontSize: 13, color: C.muted }}>The QR code could not be drawn here. Copy the link instead.</p>;
  if (!cells) return <p style={{ fontSize: 13, color: C.muted }}>Drawing the code…</p>;
  const pad = 4;
  return (
    <svg role="img" aria-label={label} viewBox={`${-pad} ${-pad} ${cells.n + pad * 2} ${cells.n + pad * 2}`}
      shapeRendering="crispEdges" style={{ width: 232, maxWidth: '100%', height: 'auto', display: 'block', background: '#FFFFFF', borderRadius: 8 }}>
      <rect x={-pad} y={-pad} width={cells.n + pad * 2} height={cells.n + pad * 2} fill="#FFFFFF" />
      <path d={cells.d} fill="#000000" />
    </svg>
  );
}

const fileSlug = (s) => (s || 'contact').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact';

function PersonShare({ p, owner, onClose }) {
  const fields = PERSON_SHARE_FIELDS.filter((f) => f.has(p));
  const [picks, setPicks] = useState(() => defaultPicks(p));
  const [by, setBy] = useState(owner || '');
  const [said, setSaid] = useState('');
  const [fallback, setFallback] = useState('');
  const [qr, setQr] = useState(false);
  const payload = useMemo(() => sharePeoplePayload([sharePerson(p, picks)], { by: by.trim() }), [p, picks, by]);
  // The code is tied to the payload it was made from. Until the new one is
  // ready nothing can be sent, so a field just unticked can never go out in
  // a link made a moment before.
  const [made, setMade] = useState({ payload: null, code: '' });
  useEffect(() => {
    let live = true;
    encodeShare(payload).then((code) => { if (live) setMade({ payload, code }); }, () => {
      if (live) setMade({ payload, code: '' });
    });
    return () => { live = false; };
  }, [payload]);
  const ready = made.payload === payload && Boolean(made.code);
  const link = ready ? shareLink(made.code) : '';
  const tooLong = link.length > SHARE_LINK_CAP;
  const canSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const first = p.name.split(' ')[0];
  const going = ['Name', ...fields.filter((f) => picks[f.key]).map((f) => (f.labelFor ? f.labelFor(p) : f.label))];

  const copy = async () => {
    track('share.person', { how: 'link', fields: going.length });
    try {
      await navigator.clipboard.writeText(link);
      setSaid('The link is copied. Send it however you like.');
      setFallback('');
    } catch {
      setSaid('Copying was blocked here. Select the link below and copy it yourself.');
      setFallback(link);
    }
  };
  const sheet = async () => {
    try {
      track('share.person', { how: 'sheet', fields: going.length });
      await navigator.share({ title: p.name, text: `${by.trim() || 'Someone'} shared ${p.name}'s contact from Orbit.`, url: link });
    } catch (e) {
      if (e?.name !== 'AbortError') copy();
    }
  };
  const save = () => {
    track('share.person', { how: 'file', fields: going.length });
    const ok = downloadCsv(`${fileSlug(p.name)}.orbit`, shareFileText(payload), 'application/json');
    setSaid(ok ? `Saved ${fileSlug(p.name)}.orbit. They open it from Import in their Orbit.` : 'This browser would not save the file.');
  };

  const box = (f) => (
    <Check key={f.key} on={Boolean(picks[f.key])} onChange={(v) => setPicks({ ...picks, [f.key]: v })}
      label={f.labelFor ? f.labelFor(p) : f.label} hint={f.show(p)} />
  );

  return (
    <div className="crm-open" style={{
      background: C.paper, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 14px 12px', margin: '0 0 14px',
    }}>
      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 600, color: C.ink }}>Share {first}’s card</p>
      <p style={{ margin: '0 0 13px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        They get their own copy to keep and change. Nothing stays linked to yours. Only what you tick goes.
      </p>

      <p style={{ margin: '0 0 9px', fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Card</p>
      <p style={{ margin: '0 0 11px 26px', fontSize: 14, color: C.ink }}>
        Name
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2 }}>{p.name}. Always included.</span>
      </p>
      {fields.filter((f) => !f.private).map(box)}

      {fields.some((f) => f.private) && (
        <>
          <p style={{ margin: '6px 0 3px', fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Private</p>
          <p style={{ margin: '0 0 9px', fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
            Only tick these if you are sure. Anyone with the link can read them.
          </p>
          {fields.filter((f) => f.private).map(box)}
        </>
      )}
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
        Never shared: how close you are, check-in history, last contact, VIP, and anything else about the two of you.
      </p>

      <Field label="From">
        <input style={{ ...inputStyle, minHeight: 38 }} value={by} maxLength={60} onChange={(e) => setBy(e.target.value)}
          placeholder="Your name, so they know who sent it" />
      </Field>

      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        Sending: {going.join(', ')}.
      </p>

      {tooLong ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.soonText, lineHeight: 1.5 }}>
          This is too long for a link that arrives in one piece. Save it as a file instead.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {canSheet && <Button kind="solid" onClick={sheet} style={small}>{ready ? 'Share…' : 'Getting it ready…'}</Button>}
          <Button kind={canSheet ? 'quiet' : 'solid'} onClick={() => ready && copy()} style={small}>Copy link</Button>
          <Button onClick={() => ready && setQr(!qr)} style={small}>{qr ? 'Hide QR code' : 'QR code'}</Button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Button onClick={save} style={small}>Save as file</Button>
        <Button onClick={onClose} style={small}>Done</Button>
      </div>

      {qr && ready && !tooLong && (
        <div style={{ marginTop: 12 }}>
          {link.length > SHARE_QR_CAP ? (
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
              Too much for a QR code a phone can read. Untick something, or send the link.
            </p>
          ) : (
            <>
              <QrCode text={link} label={`QR code for ${p.name}'s card`} />
              <p style={{ margin: '8px 0 0', fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                They point their phone’s camera at it and open the link.
              </p>
            </>
          )}
        </div>
      )}

      <p aria-live="polite" style={{ margin: said ? '10px 0 0' : 0, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{said}</p>
      {fallback && (
        <textarea readOnly aria-label="Link to copy" onFocus={(e) => e.target.select()} value={fallback}
          style={{ ...inputStyle, marginTop: 8, minHeight: 90, fontSize: 12, lineHeight: 1.45, resize: 'vertical' }} />
      )}
    </div>
  );
}

/* ---------- sharing a copy: receiving ---------- */
// What arrived, field by field, in the words the picker used to send it.
const sharedFacts = (inc) => PERSON_SHARE_FIELDS.filter((f) => f.has(inc)).map((f) => ({
  key: f.key,
  label: f.labelFor ? f.labelFor(inc) : f.label,
  value: f.key === 'socials'
    ? SOCIALS.filter((s) => inc.socials[s.key]).map((s) => `${s.label} ${s.at ? '@' : ''}${inc.socials[s.key]}`).join(', ')
    : f.show(inc),
}));

// Where each incoming person goes: merged into someone already here, added
// as someone new, or left out.
const planFor = (inc, people) => {
  const matches = findMatches(inc, people);
  return matches.length
    ? { action: 'merge', target: matches[0].p.id, rows: mergePlan(matches[0].p, inc) }
    : { action: 'add', target: null, rows: [] };
};

function MergeRows({ rows, onChange }) {
  if (!rows.length) {
    return <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>Nothing new. Your card already has all of this.</p>;
  }
  const set = (i, take) => onChange(rows.map((r, j) => (j === i ? { ...r, take } : r)));
  return (
    <div style={{ marginTop: 8 }}>
      {rows.map((r, i) => (r.kind === 'differs' ? (
        <fieldset key={r.id} style={{ border: 'none', padding: 0, margin: '0 0 11px' }}>
          <legend style={{ fontSize: 13, fontWeight: 600, color: C.ink, padding: 0, marginBottom: 5 }}>{r.label}</legend>
          {[[false, 'Keep mine', r.mine], [true, 'Use theirs', r.theirs]].map(([take, word, value]) => (
            <label key={word} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 5, cursor: 'pointer' }}>
              <input type="radio" name={`merge-${r.id}`} checked={r.take === take} onChange={() => set(i, take)}
                style={{ marginTop: 3, accentColor: C.accentDeep }} />
              <span style={{ fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
                <span style={{ color: C.faint }}>{word}: </span>{value}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <Check key={r.id} on={r.take} onChange={(v) => set(i, v)}
          label={r.kind === 'add' ? `Add to ${r.label.toLowerCase()}: ${r.theirs}` : `Fill in ${r.label.toLowerCase()}: ${r.theirs}`} />
      )))}
    </div>
  );
}

function ReceiveView({ share, people, onSave, onClose }) {
  const [circle, setCircle] = useState('friend');
  const [keepVia, setKeepVia] = useState(true);
  const [plans, setPlans] = useState(() => (share.people || []).map((inc) => planFor(inc, people)));

  if (share.broken) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em' }}>That share could not be read</h1>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
          The link may have been cut short on its way here. Ask them to send it again, or to send it as a file.
        </p>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }

  const by = share.by;
  const when = share.on ? prettyDate(share.on) : '';
  const one = share.people.length === 1;
  const setPlan = (i, next) => setPlans(plans.map((pl, j) => (j === i ? next : pl)));
  const adding = plans.filter((pl) => pl.action === 'add').length;
  const merging = plans.filter((pl) => pl.action === 'merge').length;

  const save = () => {
    const via = keepVia ? { by: by || '', on: todayStr() } : null;
    let next = [...people];
    let focus = null;
    share.people.forEach((inc, i) => {
      const pl = plans[i];
      if (pl.action === 'add') {
        const made = personFromShare(inc, { circle, via });
        next.push(made);
        focus = focus || made.id;
      } else if (pl.action === 'merge') {
        next = next.map((x) => (x.id === pl.target ? applyMerge(x, inc, pl.rows, via) : x));
        focus = focus || pl.target;
      }
    });
    onSave(next, focus);
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: C.muted }}>
        {by ? `${by} sent you ${one ? 'a contact' : 'some contacts'}` : `${one ? 'A contact was' : 'Some contacts were'} shared with you`}
        {when ? ` on ${when}` : ''}
      </p>
      <h1 style={{ margin: '0 0 6px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>
        {one ? share.people[0].name : `${share.people.length} people`}
      </h1>
      <p style={{ margin: '0 0 18px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
        {by ? `“${by}” is the name the sender gave; Orbit cannot check it. ` : ''}
        Nothing is added until you say so, and whatever you keep is yours to change.
      </p>

      {share.people.map((inc, i) => {
        const pl = plans[i];
        const matches = findMatches(inc, people);
        const target = people.find((x) => x.id === pl.target);
        return (
          <div key={i} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 15px', marginBottom: 14 }}>
            {!one && <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600, color: C.ink }}>{inc.name}</p>}
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>In this share</p>
            <p style={{ margin: '0 0 4px', fontSize: 13, lineHeight: 1.5, color: C.ink }}><span style={{ color: C.faint }}>Name </span>{inc.name}</p>
            {sharedFacts(inc).map((f) => (
              <p key={f.key} style={{ margin: '0 0 4px', fontSize: 13, lineHeight: 1.5, color: C.ink, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                <span style={{ color: C.faint }}>{f.label} </span>{f.value}
              </p>
            ))}

            {matches.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 12 }}>
                <p style={{ margin: '0 0 9px', fontSize: 13.5, color: C.ink, lineHeight: 1.5 }}>
                  <strong style={{ fontWeight: 600 }}>You may already have them.</strong>{' '}
                  {matches.map((m) => `${m.p.name} (${m.why.map((w) => REASON_WORDS[w]).join(', ')})`).join('; ')}.
                </p>
                <div role="radiogroup" aria-label={`What to do with ${inc.name}`} style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
                  {[['merge', 'Merge'], ['add', 'Add as new'], ['skip', 'Skip']].map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={pl.action === v} className="crm-btn"
                      onClick={() => setPlan(i, v === 'merge'
                        ? { action: 'merge', target: pl.target || matches[0].p.id, rows: mergePlan(people.find((x) => x.id === (pl.target || matches[0].p.id)), inc) }
                        : { ...pl, action: v })}
                      style={segment(pl.action === v)}>{l}</button>
                  ))}
                </div>
                {pl.action === 'merge' && matches.length > 1 && (
                  <select className="crm-select" aria-label="Merge into" value={pl.target}
                    onChange={(e) => setPlan(i, { ...pl, target: e.target.value, rows: mergePlan(people.find((x) => x.id === e.target.value), inc) })}
                    style={{ ...inputStyle, minHeight: 36, fontSize: 13, margin: '4px 0 6px' }}>
                    {matches.map((m) => <option key={m.p.id} value={m.p.id}>{m.p.name}</option>)}
                  </select>
                )}
                {pl.action === 'merge' && target && (
                  <>
                    <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
                      Into {target.name}. Only what you tick changes; everything else on the card stays as it is.
                    </p>
                    <MergeRows rows={pl.rows} onChange={(rows) => setPlan(i, { ...pl, rows })} />
                  </>
                )}
                {pl.action === 'skip' && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>{inc.name} will be left out.</p>}
              </div>
            )}
          </div>
        );
      })}

      {adding > 0 && (
        <Group label={`Add ${adding === 1 && one ? 'them' : adding === 1 ? 'the new one' : 'the new ones'} to`}>
          <div style={{ display: 'flex', gap: 8 }}>
            {CIRCLES.map(([v, l]) => (
              <button key={v} className="crm-btn" onClick={() => setCircle(v)} style={segment(circle === v)} aria-pressed={circle === v}>{l}</button>
            ))}
          </div>
        </Group>
      )}
      {(adding > 0 || merging > 0) && (
        <Check on={keepVia} onChange={setKeepVia}
          label={by ? `Note that this came from ${by}` : 'Note that this was shared with me'}
          hint="A small line on the card. You can take it off any time." />
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <Button kind="solid" onClick={save}>
          {adding + merging === 0 ? 'Done' : [adding && `Add ${adding === 1 ? (one ? share.people[0].name.split(' ')[0] : 'one') : adding}`, merging && `Merge ${merging === 1 ? '' : merging}`.trim()].filter(Boolean).join(' and ')}
        </Button>
        <Button onClick={onClose}>{adding + merging === 0 ? 'Close' : 'Not now'}</Button>
      </div>
    </div>
  );
}

// Paste a link, or pick a file someone sent. Both end up at the same preview.
function OpenShared({ onOpen }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const picker = useRef(null);
  const open = async (value) => {
    setProblem('');
    const got = await readAnyShare(value);
    if (!got) { setProblem('That is not something Orbit can open. Paste the whole link, or choose the .orbit file.'); return; }
    setText('');
    onOpen(got);
  };
  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setProblem('The file could not be read.');
    reader.onload = () => open(String(reader.result || ''));
    reader.readAsText(file);
  };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 15px', marginBottom: 20 }}>
      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 600, color: C.ink }}>Open something shared with you</p>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        Paste the link, or choose the .orbit file they sent. You see what is in it before anything is added.
      </p>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <input aria-label="Shared link" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isEnter(e)) open(text); }}
          placeholder="https://…#share=…" style={{ ...inputStyle, flex: '1 1 220px', minHeight: 38 }} />
        <Button kind="solid" onClick={() => open(text)} style={small}>Open</Button>
        <Button onClick={() => picker.current?.click()} style={small}>Choose a file</Button>
        <input ref={picker} type="file" aria-label="Shared file" onChange={(e) => { readFile(e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
      </div>
      {problem && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>}
    </div>
  );
}

/* ---------- reminders ---------- */
// Events are what happened. Reminders are what comes round again: the filter
// that needs changing, the card that needs paying, the talks that get posted
// every September. Two things make this more than a list of dates.
//
// First, repeats are counted in calendar units, not days. "Monthly" on the
// 15th stays on the 15th instead of drifting a day earlier every other month,
// and a yearly reminder keeps its date through leap years.
//
// Second, a repeat is anchored one of two ways, because the two jobs behave
// differently. A card bill is due on the 15th whether you paid early or a
// week late, so it counts from the calendar. A furnace filter lasts three
// months from the day you actually changed it, so it counts from completion.
// Getting this wrong makes a reminder app quietly useless: fixed dates drift,
// or maintenance intervals pile up while you are away.
const REMINDERS_KEY = 'crm-reminders-v1';

const REMINDER_KINDS = ['Home', 'Money', 'Health', 'Admin', 'Car', 'Pets', 'Watch', 'Other'];

const REPEAT_UNITS = [
  { unit: 'day', one: 'day', many: 'days' },
  { unit: 'week', one: 'week', many: 'weeks' },
  { unit: 'month', one: 'month', many: 'months' },
  { unit: 'year', one: 'year', many: 'years' },
];

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// Clamps rather than overflows: Jan 31 plus a month is the last day of
// February, not the third of March, and Feb 29 plus a year is Feb 28.
//
// keepDay is what stops that clamp from being a one-way door. Advancing month
// by month from the 31st would otherwise hit February, clamp to the 28th, and
// carry the 28th forward for good — a card due on the 31st would quietly
// become a card due on the 28th. Passing the day the series is really pinned
// to lets every month go back to it.
const addUnits = (s, unit, n, keepDay) => {
  const d = parseDate(s);
  if (unit === 'day') { d.setDate(d.getDate() + n); return fmtDate(d); }
  if (unit === 'week') { d.setDate(d.getDate() + n * 7); return fmtDate(d); }
  const months = unit === 'year' ? n * 12 : n;
  const day = Math.min(31, Math.max(1, Math.round(Number(keepDay)) || d.getDate()));
  d.setDate(1); // never overflow the month while the month is being changed
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return fmtDate(d);
};

// The day of the month a repeat is pinned to, carried alongside the interval
// so a short February cannot rewrite it. Every way of making a reminder goes
// through here, so nothing is left without one.
const everyFrom = (next, unit, n) => ({ unit, n, dom: Number((next || '').slice(8, 10)) || 1 });

// Everything downstream reads the repeat through here, so a hand-edited CSV
// carrying "every 0 fortnights" cannot stall the advance loop below.
const repeatOf = (r) => {
  if (!r?.every?.unit) return null;
  const unit = REPEAT_UNITS.some((u) => u.unit === r.every.unit) ? r.every.unit : 'month';
  const n = Math.min(99, Math.max(1, Math.round(Number(r.every.n) || 1)));
  // Older entries, and hand-made CSVs, carry no pinned day: fall back to the
  // day the next date already sits on.
  const dom = Math.min(31, Math.max(1, Math.round(Number(r.every.dom)) || Number((r.next || '').slice(8, 10)) || 1));
  return { unit, n, dom };
};

const repeatText = (r) => {
  const rep = repeatOf(r);
  if (!rep) return 'once';
  const u = REPEAT_UNITS.find((x) => x.unit === rep.unit);
  return rep.n === 1 ? `every ${u.one}` : `every ${rep.n} ${u.many}`;
};

// How much warning you get. Renewals are the reason this exists: a passport
// or an open-enrollment window is no use to you on the morning it closes.
const leadOf = (r) => Math.min(365, Math.max(0, Math.round(Number(r?.lead) || 0)));

const REMINDER_ORDER = { over: 0, today: 1, soon: 2, later: 3, paused: 4, done: 5 };

const reminderState = (r) => {
  const d = daysUntil(r.next);
  if (r.paused) return { key: 'paused', tone: C.muted, bar: C.line, d };
  if (r.done) return { key: 'done', tone: C.muted, bar: C.line, d };
  if (d === null) return { key: 'later', tone: C.muted, bar: C.line, d };
  if (d < 0) return { key: 'over', tone: C.overdue, bar: C.overdueBar, d };
  if (d === 0) return { key: 'today', tone: C.soonText, bar: C.soonBar, d };
  if (d <= leadOf(r)) return { key: 'soon', tone: C.soonText, bar: C.soonBar, d };
  return { key: 'later', tone: C.calmText, bar: C.calmBar, d };
};

const dueText = (d) => {
  if (d === null) return 'no date set';
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d === -1) return 'due yesterday';
  if (d < 0) return `${elapsed(-d)} late`;
  return `in ${elapsed(d)}`;
};

// Worst first, then soonest within each band. Paused and finished sink.
const byDue = (a, b) => {
  const sa = reminderState(a);
  const sb = reminderState(b);
  if (REMINDER_ORDER[sa.key] !== REMINDER_ORDER[sb.key]) {
    return REMINDER_ORDER[sa.key] - REMINDER_ORDER[sb.key];
  }
  if (sa.d === null) return sb.d === null ? 0 : 1;
  if (sb.d === null) return -1;
  return sa.d - sb.d;
};

// Where a repeat lands after you tick it off. A calendar-anchored reminder
// keeps its slot and skips over anything already missed, so catching up on
// three late months does not leave you three months behind.
const nextAfter = (r, on) => {
  const rep = repeatOf(r);
  if (!rep) return null;
  // Counting from the day it was actually done: the interval simply restarts,
  // so the day of the month is free to move with it.
  if (r.anchor === 'done') return addUnits(on, rep.unit, rep.n);

  const from = r.next || on;
  let next = addUnits(from, rep.unit, rep.n, rep.dom);
  if (rep.unit === 'day' || rep.unit === 'week') {
    // Even intervals: work out the jump instead of stepping. A daily reminder
    // left alone for years would otherwise need thousands of iterations.
    const step = rep.unit === 'week' ? rep.n * 7 : rep.n;
    const gap = Math.round((parseDate(on) - parseDate(from)) / 86400000);
    if (gap >= 0) next = addUnits(from, 'day', step * (Math.floor(gap / step) + 1));
  } else {
    for (let i = 0; i < 1200 && next <= on; i += 1) next = addUnits(next, rep.unit, rep.n, rep.dom);
  }
  // Whatever happened above, never hand back a date that is already behind:
  // a reminder ticked off should not come back still overdue.
  return next > on ? next : addUnits(on, rep.unit, rep.n, rep.dom);
};

// History is capped: a daily reminder kept for years would otherwise grow
// without limit inside a storage backend measured in megabytes.
const HISTORY_CAP = 60;

const completeReminder = (r, on) => {
  const history = [{ date: on }, ...(r.history || [])]
    .filter((h) => h && h.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, HISTORY_CAP);
  const rep = repeatOf(r);
  if (!rep) return { ...r, history, lastDone: on, done: true };
  return { ...r, history, lastDone: on, done: false, next: nextAfter(r, on) };
};

// Pushed back from wherever it already sits, not from today: nudging a
// reminder that is months out should move it further out, never drag it
// forward to next week. Something already late restarts from today.
const snoozeReminder = (r, days) => {
  const today = todayStr();
  const base = r.next && r.next > today ? r.next : today;
  return { ...r, next: addUnits(base, 'day', days) };
};

// Starter reminders, with the intervals each job is usually given: filters
// every three months, dryer vents and gutters twice a year, estimated taxes
// with a fortnight of notice because no one sends you an invoice for them.
const STARTERS = [
  { title: 'Replace the HVAC filter', kind: 'Home', n: 3, unit: 'month', anchor: 'done', lead: 7,
    note: 'Every three months for a standard filter. Monthly if you have pets or allergies.' },
  { title: 'Clean out the dryer vent', kind: 'Home', n: 6, unit: 'month', anchor: 'done', lead: 7,
    note: 'Lint in the duct is the single biggest cause of dryer fires.' },
  { title: 'Clean the gutters', kind: 'Home', n: 6, unit: 'month', anchor: 'done', lead: 14,
    note: 'Once after the leaves come down, once before the spring rain.' },
  { title: 'Flush the water heater', kind: 'Home', n: 1, unit: 'year', anchor: 'done', lead: 14,
    note: 'Clears the sediment that quietly eats efficiency and lifespan.' },
  { title: 'Test the smoke and CO alarms', kind: 'Home', n: 6, unit: 'month', anchor: 'done', lead: 3 },
  { title: 'Service the furnace and AC', kind: 'Home', n: 1, unit: 'year', anchor: 'done', lead: 21,
    note: 'Book it before the first cold snap, when every other house is calling.' },
  { title: 'Take the bins out', kind: 'Home', n: 1, unit: 'week', anchor: 'date', lead: 0 },

  { title: 'Pay the credit card in full', kind: 'Money', n: 1, unit: 'month', anchor: 'date', lead: 3 },
  { title: 'Pay the estimated taxes', kind: 'Money', n: 3, unit: 'month', anchor: 'date', lead: 14,
    note: 'Mid-January, April, June and September. Nobody invoices you for these.' },
  { title: 'Read through the subscriptions', kind: 'Money', n: 3, unit: 'month', anchor: 'done', lead: 3,
    note: 'The ones you have forgotten about are the expensive ones.' },
  { title: 'File the tax return', kind: 'Money', n: 1, unit: 'year', anchor: 'date', lead: 30 },
  { title: 'Decide if the card annual fee still earns its keep', kind: 'Money', n: 1, unit: 'year', anchor: 'date', lead: 30 },

  { title: 'Book the dental cleaning', kind: 'Health', n: 6, unit: 'month', anchor: 'done', lead: 14 },
  { title: 'Book the annual physical', kind: 'Health', n: 1, unit: 'year', anchor: 'done', lead: 21 },
  { title: 'Book an eye exam', kind: 'Health', n: 1, unit: 'year', anchor: 'done', lead: 21 },

  { title: 'Open enrollment for health insurance', kind: 'Admin', n: 1, unit: 'year', anchor: 'date', lead: 14,
    note: 'The window is short and it does not reopen because you missed it.' },
  { title: 'Renew the vehicle registration', kind: 'Admin', n: 1, unit: 'year', anchor: 'date', lead: 30 },
  { title: 'Check the passports are still in date', kind: 'Admin', n: 1, unit: 'year', anchor: 'date', lead: 30,
    note: 'Renewals take months, and plenty of countries want six of them left on the clock.' },
  { title: 'Shop the home and auto insurance rates', kind: 'Admin', n: 1, unit: 'year', anchor: 'done', lead: 14 },

  { title: 'Change the oil', kind: 'Car', n: 6, unit: 'month', anchor: 'done', lead: 7 },
  { title: 'Rotate the tires', kind: 'Car', n: 6, unit: 'month', anchor: 'done', lead: 7 },

  { title: 'Take the pets for a checkup', kind: 'Pets', n: 1, unit: 'year', anchor: 'done', lead: 14 },
  { title: 'Flea and heartworm dose', kind: 'Pets', n: 1, unit: 'month', anchor: 'date', lead: 1 },

  { title: 'Catch up on the All-In Summit talks', kind: 'Watch', n: 1, unit: 'year', anchor: 'date', lead: 7,
    note: 'The talks go up after the summit. No subscription to anything required.' },
  { title: 'Rewatch the thing you say you will rewatch', kind: 'Watch', n: 1, unit: 'year', anchor: 'date', lead: 7 },
];

// A starter arrives already scheduled one interval out, so it can be saved
// without filling anything in, and moved if that is not the right date.
const fromStarter = (s) => ({
  id: uid(),
  addedOn: todayStr(),
  title: s.title,
  kind: s.kind,
  every: everyFrom(addUnits(todayStr(), s.unit, s.n), s.unit, s.n),
  anchor: s.anchor,
  next: addUnits(todayStr(), s.unit, s.n),
  lead: s.lead,
  note: s.note || '',
  people: [],
  history: [],
  lastDone: null,
  paused: false,
  done: false,
});

/* ---------- lists ---------- */
// Lists are the things you keep track of that are not people or dates: shows
// to watch, books to read, the collection you are building. Called
// "collections" in code, because "list" already means the people list here.
//
// Every entry moves through at most three stages. The keys are fixed so a
// list can be renamed, re-worded or switched between kinds without losing
// anyone's progress; only the words shown for each stage belong to the list.
const COLLECTIONS_KEY = 'crm-collections-v1';

const STAGES = ['want', 'doing', 'done'];

// The kind only supplies starting words. Everything it fills in can be
// changed on the list itself, and "Other" is there for anything at all.
const COLLECTION_KINDS = [
  { kind: 'Shows', add: 'Add a show', name: 'Shows to watch', one: 'show', many: 'shows', detail: 'Where to watch',
    labels: { want: 'Want to watch', doing: 'Watching', done: 'Watched' }, ph: 'Severance' },
  { kind: 'Movies', add: 'Add a movie', name: 'Movies to see', one: 'movie', many: 'movies', detail: 'Director or year',
    labels: { want: 'Want to watch', doing: '', done: 'Watched' }, ph: 'Past Lives' },
  { kind: 'Books', add: 'Add a book', name: 'Books to read', one: 'book', many: 'books', detail: 'Author',
    labels: { want: 'Want to read', doing: 'Reading', done: 'Read' }, ph: 'The Overstory' },
  { kind: 'Music', add: 'Add an album', name: 'Albums to hear', one: 'album', many: 'albums', detail: 'Artist',
    labels: { want: 'Want to hear', doing: '', done: 'Heard' }, ph: 'Blue' },
  { kind: 'Games', add: 'Add a game', name: 'Games to play', one: 'game', many: 'games', detail: 'Platform',
    labels: { want: 'Want to play', doing: 'Playing', done: 'Finished' }, ph: 'Wingspan' },
  { kind: 'Collectibles', add: 'Add a piece', name: 'The collection', one: 'piece', many: 'pieces', detail: 'Set or series',
    labels: { want: 'Wanted', doing: 'On the way', done: 'In the collection' }, ph: '1st edition Charizard' },
  { kind: 'Places', add: 'Add a place', name: 'Places to go', one: 'place', many: 'places', detail: 'Where',
    labels: { want: 'Want to go', doing: '', done: 'Been there' }, ph: 'The Nelson-Atkins' },
  { kind: 'Other', add: 'Add something', name: '', one: 'thing', many: 'things', detail: 'Detail',
    labels: { want: 'To do', doing: 'In progress', done: 'Done' }, ph: 'Anything at all' },
];

const kindOf = (k) => COLLECTION_KINDS.find((x) => x.kind === k) || COLLECTION_KINDS[COLLECTION_KINDS.length - 1];

const COLLECTION_SORTS = [
  ['manual', 'My order'], ['title', 'A to Z'], ['added', 'Newest first'],
  ['rating', 'Highest rated'], ['status', 'By progress'],
];

// The stages a list actually uses, in order. A list can leave out the middle
// one (a film is rarely half-watched), and one that does not track progress
// has none at all.
//
// There are only three possible answers, so they are shared rather than
// rebuilt: this runs for every entry on every render and inside sorts.
const ALL_STAGES = Object.freeze([...STAGES]);
const NO_MIDDLE = Object.freeze(['want', 'done']);
const NO_STAGES = Object.freeze([]);
const stagesOf = (c) => (!c.track ? NO_STAGES : (c.labels?.doing || '').trim() ? ALL_STAGES : NO_MIDDLE);

const stageLabel = (c, s) => (c.labels?.[s] || '').trim() || kindOf(c.kind).labels[s] || s;

// Where an entry shows. Dropping the middle stage from a list leaves anything
// already in it stored as it was, so putting the stage back brings it all
// back; in the meantime it reads as not started, because it is not finished.
const stageOf = (c, it) => (stagesOf(c).includes(it.status) ? it.status : 'want');

// Tapping the status steps forward through the stages the list uses and
// wraps round, so nothing is ever more than two taps from where you want it.
const nextStage = (c, it) => {
  const used = stagesOf(c);
  if (used.length === 0) return it.status;
  return used[(used.indexOf(stageOf(c, it)) + 1) % used.length];
};

// Only http and https links are ever kept. Links arrive from shared lists and
// imported sheets as well as the form, and a javascript: URL in an href would
// run in this page the moment it was clicked. Whatever the input, the
// protocol check on the parsed result is the gate.
//
// A word then a colon is a scheme ("mailto:", "javascript:") unless a port
// follows it, so "localhost:3000" and "example.com:8080/x" get https added.
// A link too long to keep is refused, not cut into one that goes nowhere.
const LINK_CAP = 2048;
const safeLink = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) ? s : `https://${s}`);
    const web = u.protocol === 'http:' || u.protocol === 'https:';
    return web && u.href.length <= LINK_CAP ? u.href : '';
  } catch {
    return '';
  }
};

const linkHost = (href) => {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return 'link'; }
};

const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');

// One set of limits, used by the loader and by every box that writes these
// fields, so nothing the forms accept is cut short the next time it loads.
const TITLE_CAP = 300;
const NOTE_CAP = 5000;
const LIST_NAME_CAP = 120;
const LIST_NOTE_CAP = 2000;
const LABEL_CAP = 40;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Everything that comes in from outside, a backup, a sheet or a list someone
// shared, goes through here, so a hand-edited or hostile file can only ever
// produce a well-formed list.
const cleanItem = (raw, seen) => {
  if (!raw || typeof raw !== 'object') return null;
  const title = clip(raw.title, TITLE_CAP);
  if (!title) return null;
  let id = clip(raw.id, 40);
  if (!id || seen.has(id)) id = uid();
  seen.add(id);
  const status = STAGES.includes(raw.status) ? raw.status : 'want';
  return {
    id,
    title,
    detail: clip(raw.detail, TITLE_CAP),
    status,
    rating: halfStep(raw.rating),
    link: safeLink(raw.link),
    note: clip(raw.note, NOTE_CAP),
    from: clip(raw.from, 40) || null,
    addedOn: isDay(raw.addedOn) ? raw.addedOn : todayStr(),
    doneOn: status === 'done' && isDay(raw.doneOn) ? raw.doneOn : null,
  };
};

const ITEM_CAP = 2000;

const cleanCollection = (raw, seen = new Set()) => {
  if (!raw || typeof raw !== 'object') return null;
  const name = clip(raw.name, LIST_NAME_CAP);
  if (!name) return null;
  let id = clip(raw.id, 40);
  if (!id || seen.has(id)) id = uid();
  seen.add(id);
  const kind = kindOf(raw.kind).kind;
  const itemIds = new Set();
  return {
    id,
    addedOn: isDay(raw.addedOn) ? raw.addedOn : todayStr(),
    // A full timestamp, not a day, so "Recently changed" can tell apart two
    // lists both touched today.
    updatedAt: typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt : new Date().toISOString(),
    name,
    kind,
    note: clip(raw.note, LIST_NOTE_CAP),
    track: raw.track !== false,
    labels: Object.fromEntries(STAGES.map((s) => [s, clip(raw.labels?.[s], LABEL_CAP)])),
    detail: clip(raw.detail, LABEL_CAP),
    sort: COLLECTION_SORTS.some(([v]) => v === raw.sort) ? raw.sort : 'manual',
    items: (Array.isArray(raw.items) ? raw.items : [])
      .slice(0, ITEM_CAP)
      .map((x) => cleanItem(x, itemIds))
      .filter(Boolean),
  };
};

const cleanCollections = (raw) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map((c) => cleanCollection(c, seen)).filter(Boolean);
};

// Library order: "The Overstory" files under O, the way a shelf would. One
// collator for everything: localeCompare with options builds a fresh one on
// every comparison, which is most of the cost of sorting a long list.
const SHELF = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const shelfKey = (t) => (t || '').replace(/^(the|a|an)\s+/i, '');
const PROGRESS_ORDER = { doing: 0, want: 1, done: 2 };

// Every order but "My order" is a view: the stored sequence is never
// rewritten, and ties keep the order you gave them. Each entry's sort key is
// worked out once, not once per comparison. Callers only read the result, so
// "My order" hands back the stored array as it is.
const sortItems = (c, items) => {
  const keyOf = {
    title: (it) => shelfKey(it.title),
    added: (it) => it.addedOn || '',
    rating: (it) => it.rating || 0,
    status: c.track ? (it) => PROGRESS_ORDER[stageOf(c, it)] : null,
  }[c.sort];
  if (!keyOf) return items;
  const cmp = {
    title: (a, b) => SHELF.compare(a, b),
    added: (a, b) => (a < b ? 1 : a > b ? -1 : 0),
    rating: (a, b) => b - a,
    status: (a, b) => a - b,
  }[c.sort];
  return items
    .map((it, i) => ({ it, i, k: keyOf(it) }))
    .sort((a, b) => cmp(a.k, b.k) || a.i - b.i)
    .map((x) => x.it);
};

// Every stage counted in one pass, for the bar, the chips and the cards.
const tally = (c) => {
  const n = { want: 0, doing: 0, done: 0 };
  c.items.forEach((it) => { n[stageOf(c, it)] += 1; });
  return n;
};

const withStatus = (it, status) => ({
  ...it,
  status,
  doneOn: status === 'done' ? (it.status === 'done' && it.doneOn ? it.doneOn : todayStr()) : null,
});

// Ratings go from half a star to five in half steps: ten steps in all. A
// whole number is a rating from before halves existed and means the same now,
// so nothing saved, backed up or shared needs converting.
const halfStep = (n) => Math.min(5, Math.max(0, Math.round((Number(n) || 0) * 2) / 2));
const isRating = (n) => typeof n === 'number' && Number.isInteger(n * 2) && n >= 0.5 && n <= 5;
const starWord = (n) => `${n} star${n === 1 ? '' : 's'}`;

const stars = (n) => {
  const full = Math.floor(n);
  const half = n - full ? 1 : 0;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
};

// Plain text anyone can read, for a message, an email or a note. Grouped by
// stage when progress is included, because "Watched ★★★★★" is the part a
// friend actually wants; numbered in your order when it is not.
const collectionText = (c, { progress, notes }) => {
  // Numbered whenever the text is not grouped, which includes a plain list
  // shared with progress on: its order is the whole point of it.
  const stages = progress ? stagesOf(c) : NO_STAGES;
  const line = (it, i) => {
    const bits = [
      stages.length ? '-' : `${i + 1}.`,
      it.title,
      it.detail ? `(${it.detail})` : '',
      progress && it.rating ? stars(it.rating) : '',
      it.link ? `— ${it.link}` : '',
    ].filter(Boolean).join(' ');
    return notes && it.note ? `${bits}\n   ${it.note.replace(/\s*\n\s*/g, ' ')}` : bits;
  };
  const head = [c.name, notes && c.note ? c.note : ''].filter(Boolean).join('\n');
  const items = sortItems(c, c.items);
  if (items.length === 0) return `${head}\n\nNothing on it yet.`;
  if (stages.length === 0) return `${head}\n\n${items.map(line).join('\n')}`;
  const groups = stages
    .map((s) => [s, items.filter((it) => stageOf(c, it) === s)])
    .filter(([, g]) => g.length > 0)
    .map(([s, g]) => `${stageLabel(c, s)}\n${g.map(line).join('\n')}`);
  return `${head}\n\n${groups.join('\n\n')}`;
};

// A shared list travels inside the link itself, so there is no server to
// hold it and nothing to expire. Short keys and trimmed tuples keep the link
// as short as it can be.
//
// It carries the list, never your progress: whoever opens it gets their own
// copy to work through from the start. Who recommended what is yours alone
// and is never included, and notes only go when you say so.
const SHARE_PREFIX = 'share=';

// btoa wants one character per byte. Built in chunks rather than a byte at a
// time; each chunk stays well under the engine's limit on call arguments.
const toCode = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromCode = (code) => {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
};

const shareCode = (c, { notes, by }) => {
  const trim = (row) => {
    const out = [...row];
    while (out.length > 1 && !out[out.length - 1]) out.pop();
    return out;
  };
  return toCode({
    v: 1,
    n: c.name,
    k: c.kind,
    t: c.track ? 1 : 0,
    l: STAGES.map((s) => c.labels?.[s] || ''),
    dl: c.detail || '',
    ...(notes && c.note ? { d: c.note } : {}),
    ...(by ? { by } : {}),
    i: sortItems(c, c.items).map((it) => trim([it.title, it.detail, it.link, notes ? it.note : ''])),
  });
};

// Accepts the whole link or just the code after it, since people paste both.
const readShared = (text) => {
  const s = String(text || '').trim();
  const m = s.match(/(?:^|[#&?])share=([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{16,})$/);
  if (!m) return null;
  try {
    const o = fromCode(m[1]);
    if (!o || o.v !== 1 || !Array.isArray(o.i)) return null;
    const l = Array.isArray(o.l) ? o.l : [];
    const c = cleanCollection({
      name: o.n, kind: o.k, note: o.d, track: o.t !== 0, detail: o.dl,
      labels: { want: l[0], doing: l[1], done: l[2] },
      items: o.i.filter(Array.isArray)
        .map((x) => ({ title: x[0], detail: x[1], link: x[2], note: x[3] })),
    });
    return c ? { c, by: clip(o.by, 60) } : null;
  } catch {
    return null;
  }
};

/* ---------- sharing a copy: people ---------- */
// Sending someone a person sends a copy: a snapshot they own and can change
// however they like. Nothing stays linked to the sender's card.
//
// What goes is decided field by field on the way out, and checked again on
// the way in. The two lists below are the only way anything gets into a
// share or out of one: the sender side copies only the fields ticked, never
// the record, and the receiving side rebuilds a person from the fields it
// knows, so anything else in a share (a closeness tier, a check-in history,
// a hand-edited extra) is simply never read.
//
// Some things are never offered at all, because they describe the sender's
// side of the relationship, not the person: closeness, relation ("Mom"),
// check-in history and last contact, VIP, paused, circle, and dates added.

// Shares are compressed and marked with a leading "z", which a list link
// (plain JSON in base64, so always starting "eyJ") can never begin with.
const SHARE_V2 = 'z';
// Past this, a link risks being cut short by a messaging app, so the share
// is offered as a file instead.
const SHARE_LINK_CAP = 8000;
// Past this, a QR code gets too dense for a phone camera to read reliably.
const SHARE_QR_CAP = 1200;

const PERSON_SHARE_FIELDS = [
  { key: 'work', label: 'Role and company', on: true,
    has: (p) => Boolean(p.role || p.company),
    show: (p) => [p.role, p.company].filter(Boolean).join(', '),
    put: (p, o) => { if (p.role) o.ro = p.role; if (p.company) o.co = p.company; } },
  { key: 'aka', label: 'Also known as', on: true,
    has: (p) => (p.aka || []).length > 0, show: (p) => p.aka.join(', '),
    put: (p, o) => { o.a = [...p.aka]; } },
  { key: 'email', label: 'Email', has: (p) => Boolean(p.email), show: (p) => p.email,
    put: (p, o) => { o.e = p.email; } },
  { key: 'phone', label: 'Phone', has: (p) => Boolean(p.phone), show: (p) => p.phone,
    put: (p, o) => { o.ph = p.phone; } },
  { key: 'address', label: 'Address', has: (p) => Boolean(p.address), show: (p) => p.address,
    put: (p, o) => { o.ad = p.address; } },
  { key: 'birthday', label: 'Birthday', has: (p) => Boolean(p.birthday) || ageOf(p) !== null,
    labelFor: (p) => (p.birthday ? 'Birthday' : 'Age'),
    show: (p) => (p.birthday ? prettyBirthday(p.birthday) : String(ageOf(p))),
    // An age with no birthday goes as the age today, so it keeps counting up
    // on their side from the day it was sent.
    put: (p, o) => { if (p.birthday) o.b = p.birthday; else { o.ag = ageOf(p); o.at = todayStr(); } } },
  { key: 'dates', label: 'Other dates to remember', has: (p) => (p.dates || []).some((d) => d.date),
    show: (p) => p.dates.filter((d) => d.date).map(dateLabel).join(', '),
    put: (p, o) => { o.d = p.dates.filter((d) => d.date).map((d) => [d.kind, d.kind === 'Other' ? d.label || '' : '', d.date]); } },
  { key: 'partner', label: 'Partner', has: (p) => Boolean(p.partner?.name),
    show: (p) => `${p.partner.name}${p.partner.status ? ` (${p.partner.status})` : ''}`,
    put: (p, o) => { o.pt = [p.partner.name, p.partner.status || '']; } },
  { key: 'kids', label: 'Kids', has: (p) => (p.kids || []).length > 0, show: (p) => p.kids.join(', '),
    put: (p, o) => { o.k = [...p.kids]; } },
  { key: 'socials', label: 'Socials', has: (p) => SOCIALS.some((s) => p.socials?.[s.key]),
    show: (p) => SOCIALS.filter((s) => p.socials?.[s.key]).map((s) => s.label).join(', '),
    put: (p, o) => { o.so = Object.fromEntries(SOCIALS.filter((s) => p.socials?.[s.key]).map((s) => [s.key, p.socials[s.key]])); } },
  { key: 'hobbies', label: 'Hobbies', has: (p) => Boolean(p.hobbies), show: (p) => p.hobbies,
    put: (p, o) => { o.h = p.hobbies; } },
  { key: 'note', label: 'Notes', private: true, has: (p) => Boolean(p.note), show: (p) => p.note,
    put: (p, o) => { o.no = p.note; } },
  { key: 'groups', label: '“Knows” tags', private: true, has: (p) => (p.groups || []).length > 0,
    show: (p) => p.groups.join(', '), put: (p, o) => { o.g = [...p.groups]; } },
  { key: 'families', label: 'Family names', private: true, has: (p) => (p.families || []).length > 0,
    show: (p) => p.families.join(', '), put: (p, o) => { o.f = [...p.families]; } },
  { key: 'cadence', label: 'Check-in cadence', private: true,
    has: (p) => !p.child && CADENCES.some((c) => c.days === Number(p.cadence)),
    show: (p) => CADENCES.find((c) => c.days === Number(p.cadence)).label,
    put: (p, o) => { o.c = Number(p.cadence); } },
];

// The fields ticked when the picker opens: only what identifies someone.
const defaultPicks = (p) => Object.fromEntries(
  PERSON_SHARE_FIELDS.filter((f) => f.has(p)).map((f) => [f.key, Boolean(f.on)]));

// One person as it goes into a share: the name, and each ticked field the
// person actually has. Built up from nothing, never copied from the record.
const sharePerson = (p, picks) => {
  const o = { n: p.name };
  PERSON_SHARE_FIELDS.forEach((f) => { if (picks[f.key] && f.has(p)) f.put(p, o); });
  return o;
};

const sharePeoplePayload = (list, { by, on = todayStr() } = {}) => ({
  v: 2, t: 'people', ...(by ? { by: clip(by, 60) } : {}), on, p: list,
});

const bytesToCode = (bytes) => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const codeToBytes = (code) => Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

// Built-in compression, so no library travels with the app for it.
const squeeze = async (bytes, how) => new Uint8Array(await new Response(
  new Blob([bytes]).stream().pipeThrough(how === 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw')),
).arrayBuffer());

const encodeShare = async (payload) =>
  SHARE_V2 + bytesToCode(await squeeze(new TextEncoder().encode(JSON.stringify(payload)), 'in'));

const shareLink = (code) => `${window.location.origin}${window.location.pathname}#${SHARE_PREFIX}${code}`;

// The file holds the same share as plain JSON, readable by anyone who opens
// it, and marked so it is never mistaken for a backup.
const shareFileText = (payload) => JSON.stringify({ orbit: 'share', ...payload }, null, 2);

// One incoming person, rebuilt from the fields a share may carry, each one
// checked and trimmed. Returns only the fields present, under the names the
// app uses, or null when there is no name.
const listOf = (v, n, cap) => (Array.isArray(v) ? v : [])
  .map((x) => clip(x, n)).filter(Boolean).slice(0, cap);

const cleanSharedPerson = (raw) => {
  if (!isPlainObject(raw)) return null;
  const name = clip(raw.n, 120);
  if (!name) return null;
  const out = { name };
  const text = (k, field, n) => { const v = clip(raw[k], n); if (v) out[field] = v; };
  text('ro', 'role', 120);
  text('co', 'company', 120);
  text('e', 'email', 200);
  text('ph', 'phone', 40);
  text('ad', 'address', 300);
  text('h', 'hobbies', 500);
  text('no', 'note', NOTE_CAP);
  const lists = [['a', 'aka', 60, 10], ['k', 'kids', 60, 20], ['g', 'groups', 60, 20], ['f', 'families', 60, 20]];
  lists.forEach(([k, field, n, cap]) => { const v = listOf(raw[k], n, cap); if (v.length) out[field] = v; });
  if (isDay(raw.b)) out.birthday = raw.b;
  else if (Number.isInteger(raw.ag) && raw.ag >= 0 && raw.ag <= 130) {
    out.age = raw.ag;
    out.ageAsOf = isDay(raw.at) ? raw.at : todayStr();
  }
  if (Array.isArray(raw.d)) {
    const dates = raw.d.filter(Array.isArray).filter((d) => isDay(d[2])).slice(0, 20).map((d) => {
      const kind = DATE_KINDS.includes(d[0]) ? d[0] : 'Other';
      return { kind, label: kind === 'Other' ? clip(d[1] || d[0], 60) : '', date: d[2] };
    });
    if (dates.length) out.dates = dates;
  }
  if (Array.isArray(raw.pt) && clip(raw.pt[0], 120)) {
    out.partner = { name: clip(raw.pt[0], 120), status: PARTNER_STATUSES.includes(raw.pt[1]) ? raw.pt[1] : '' };
  }
  if (isPlainObject(raw.so)) {
    const so = {};
    SOCIALS.forEach((s) => { const v = handle(clip(raw.so[s.key], 200)); if (v) so[s.key] = v; });
    if (Object.keys(so).length) out.socials = so;
  }
  if (CADENCES.some((c) => c.days === raw.c)) out.cadence = raw.c;
  return out;
};

const PEOPLE_SHARE_CAP = 500;
const readPeopleShare = (o) => {
  if (!isPlainObject(o) || o.v !== 2 || o.t !== 'people' || !Array.isArray(o.p)) return null;
  const people = o.p.slice(0, PEOPLE_SHARE_CAP).map(cleanSharedPerson).filter(Boolean);
  if (!people.length) return null;
  return { type: 'people', by: clip(o.by, 60), on: isDay(o.on) ? o.on : null, people };
};

// Anything that might be a share: a link, the code on its own, or the text of
// a share file. Old list links still open as lists.
const readAnyShare = async (text) => {
  const s = String(text || '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (o?.orbit !== 'share') return null;
      return o.t === 'trip' ? readTripShare(o) : readPeopleShare(o);
    } catch {
      return null;
    }
  }
  const m = s.match(/(?:^|[#&?])share=([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{16,})$/);
  if (!m) return null;
  if (!m[1].startsWith(SHARE_V2)) {
    const list = readShared(s);
    return list ? { type: 'list', ...list } : null;
  }
  try {
    const o = JSON.parse(new TextDecoder().decode(await squeeze(codeToBytes(m[1].slice(1)), 'out')));
    return o?.t === 'trip' ? readTripShare(o) : readPeopleShare(o);
  } catch {
    return null;
  }
};

/* ---------- sharing a copy: is this someone I already have? ---------- */
// Names are compared without case, accents, punctuation or spacing, so
// "José  O'Neil" is "jose oneil". "Also known as" counts on both sides.
const personKey = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// The last ten digits, so +1 (816) 555-0142 and 816.555.0142 are the same
// number. Anything under seven digits is too short to trust.
const phoneKey = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length < 7 ? '' : d.slice(-10);
};
const emailKey = (s) => {
  const e = String(s || '').trim().toLowerCase();
  return e.includes('@') ? e : '';
};

const namesOf = (p) => [p.name, ...(p.aka || [])].map(personKey).filter(Boolean);

// Why an incoming person looks like one already here, strongest first.
const matchReasons = (inc, p) => {
  const why = [];
  const ph = phoneKey(inc.phone);
  if (ph && ph === phoneKey(p.phone)) why.push('phone');
  const em = emailKey(inc.email);
  if (em && em === emailKey(p.email)) why.push('email');
  const mine = namesOf(p);
  const theirs = namesOf(inc);
  if (personKey(inc.name) === personKey(p.name)) why.push('name');
  else if (theirs.some((n) => mine.includes(n))) why.push('aka');
  return why;
};

const findMatches = (inc, people) => people
  .map((p) => ({ p, why: matchReasons(inc, p) }))
  .filter((m) => m.why.length)
  .sort((a, b) => b.why.length - a.why.length);

const REASON_WORDS = { phone: 'same phone', email: 'same email', name: 'same name', aka: 'a name they also go by' };

/* ---------- sharing a copy: merging into someone I have ---------- */
// A merge never changes anything without it being shown. Each field that
// would change is a row: a blank filled from theirs, an addition to a list,
// or a real difference. Blanks and additions start ticked, since they lose
// nothing; a difference starts on keeping mine.
const MERGE_TEXT = [
  ['name', 'Name'], ['role', 'Role'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'],
  ['address', 'Address'], ['birthday', 'Birthday'], ['hobbies', 'Hobbies'], ['note', 'Notes'],
];
const MERGE_LISTS = [['aka', 'Also known as'], ['kids', 'Kids'], ['groups', '“Knows” tags'], ['families', 'Family names']];

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
// Phones and emails are the same when matching says they are, so a number
// written another way is never offered as a change.
const sameField = (k, a, b) => {
  if (k === 'phone' && phoneKey(a)) return phoneKey(a) === phoneKey(b);
  if (k === 'email' && emailKey(a)) return emailKey(a) === emailKey(b);
  return sameText(a, b);
};
const showDay = (s) => (isDay(s) ? prettyDate(s) : s);

const mergePlan = (mine, inc) => {
  const rows = [];
  MERGE_TEXT.forEach(([k, label]) => {
    const theirs = inc[k];
    if (!theirs || sameField(k, theirs, mine[k])) return;
    // A name that differs is kept as one they go by, below, not offered as
    // a replacement for the name you know them by.
    if (k === 'name') return;
    const shown = k === 'birthday' ? showDay : (x) => x;
    rows.push({ id: k, label, kind: mine[k] ? 'differs' : 'fill', mine: mine[k] ? shown(mine[k]) : '', theirs: shown(theirs) });
  });
  if (inc.age != null && !mine.birthday && ageOf(mine) === null && !inc.birthday) {
    rows.push({ id: 'age', label: 'Age', kind: 'fill', mine: '', theirs: String(ageOf(inc)) });
  }
  if (inc.partner?.name && !(sameText(inc.partner.name, mine.partner?.name) && (inc.partner.status || '') === (mine.partner?.status || ''))) {
    const say = (pt) => (pt?.name ? `${pt.name}${pt.status ? ` (${pt.status})` : ''}` : '');
    rows.push({ id: 'partner', label: 'Partner', kind: mine.partner?.name ? 'differs' : 'fill', mine: say(mine.partner), theirs: say(inc.partner) });
  }
  const candidates = { ...inc, aka: [...(inc.aka || []), ...(sameText(inc.name, mine.name) ? [] : [inc.name])] };
  MERGE_LISTS.forEach(([k, label]) => {
    const have = new Set([...(mine[k] || []), ...(k === 'aka' ? [mine.name] : [])].map(personKey));
    const add = [...new Set((candidates[k] || []).filter((x) => !have.has(personKey(x))))];
    if (add.length) rows.push({ id: k, label, kind: 'add', mine: (mine[k] || []).join(', '), theirs: add.join(', '), add });
  });
  const dayKey = (d) => `${d.kind}|${personKey(d.label)}|${d.date}`;
  const haveDates = new Set((mine.dates || []).map(dayKey));
  const newDates = (inc.dates || []).filter((d) => !haveDates.has(dayKey(d)));
  if (newDates.length) {
    rows.push({ id: 'dates', label: 'Dates to remember', kind: 'add', mine: '', theirs: newDates.map((d) => `${dateLabel(d)} ${showDay(d.date)}`).join(', '), add: newDates });
  }
  SOCIALS.forEach((s) => {
    const theirs = inc.socials?.[s.key];
    const have = mine.socials?.[s.key];
    if (!theirs || sameText(theirs, have)) return;
    rows.push({ id: `social:${s.key}`, label: s.label, kind: have ? 'differs' : 'fill', mine: have || '', theirs });
  });
  if (inc.cadence != null && !mine.child && Number(inc.cadence) !== Number(mine.cadence)) {
    const say = (d) => CADENCES.find((c) => c.days === Number(d))?.label || '';
    rows.push({ id: 'cadence', label: 'Check-in cadence', kind: 'differs', mine: say(mine.cadence), theirs: say(inc.cadence) });
  }
  return rows.map((r) => ({ ...r, take: r.kind !== 'differs' }));
};

// Applies the rows ticked. Anything a share cannot carry (history, closeness,
// VIP, circle, and so on) is left exactly as it was.
const applyMerge = (mine, inc, rows, via) => {
  const out = { ...mine, socials: { ...(mine.socials || {}) } };
  rows.filter((r) => r.take).forEach((r) => {
    if (r.id.startsWith('social:')) { out.socials[r.id.slice(7)] = inc.socials[r.id.slice(7)]; return; }
    if (r.id === 'age') { out.age = inc.age; out.ageAsOf = inc.ageAsOf; return; }
    if (r.id === 'birthday') { out.birthday = inc.birthday; out.age = null; out.ageAsOf = null; return; }
    if (r.id === 'dates') { out.dates = [...(mine.dates || []), ...r.add]; return; }
    if (r.add) { out[r.id] = [...(mine[r.id] || []), ...r.add]; return; }
    out[r.id] = inc[r.id];
  });
  if (via) out.via = via;
  return out;
};

// A new card from a share, with this app's usual starting values for
// everything the share did not bring.
const personFromShare = (inc, { circle = 'friend', via = null } = {}) => ({
  id: uid(),
  addedOn: todayStr(),
  circle,
  tier: circle === 'friend' ? 'friend' : null,
  role: '', company: '', hobbies: '', aka: [], email: '', kids: [], paused: false, child: false,
  families: [], relation: '', groups: [], partner: null, cadence: 90,
  birthday: null, age: null, ageAsOf: null, dates: [], phone: '', address: '', socials: {},
  note: '', lastContact: null, log: [],
  ...inc,
  ...(circle === 'work' ? { tier: null } : {}),
  ...(via ? { via } : {}),
});

/* ---------- repairing saved data ---------- */
// Saved data and backups are only as well-formed as whatever wrote them: an
// older version, a hand edit, another tool. One field of the wrong type (a
// history that is not a list, a note that is an object) used to take the
// whole app down, and after a reload the loader gave up on every record.
//
// These make each record safe to draw without second-guessing anything that
// is already right. A record that needs nothing comes back as the very same
// object. Otherwise only the bad fields are replaced, with the empty value
// the app already reads as "nothing here". Falsy values are left alone; the
// app handles those everywhere.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Text the app draws or parses. A number becomes its digits; anything else
// that is not text becomes empty.
const fixText = (v) => (v == null || typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
// The same, for fields every record has to have.
const fixNeeded = (v) => fixText(v) ?? '';
const fixNumber = (v) => (v == null || typeof v === 'number' ? v : null);
// Half stars from 0.5 to 5; anything else is no rating.
const fixRating = (v) => (v == null || isRating(v) ? v : null);
const fixTextList = (v) => {
  if (!v) return v;
  if (!Array.isArray(v)) return [];
  if (v.every((x) => typeof x === 'string')) return v;
  return v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
};

// Replaces only the fields whose fix changes them, on a copy made the first
// time one does.
const fixFields = (rec, fixes) => {
  let out = rec;
  fixes.forEach(([k, fix]) => {
    const v = fix(rec[k]);
    if (!Object.is(v, rec[k])) {
      if (out === rec) out = { ...rec };
      out[k] = v;
    }
  });
  return out;
};

// A list of entries (a catch-up history, dates to remember): anything that is
// not an entry is dropped, and each entry's own fields are fixed.
const fixEntries = (fixes) => (v) => {
  if (!v) return v;
  if (!Array.isArray(v)) return [];
  let changed = false;
  const out = [];
  v.forEach((e) => {
    if (!isPlainObject(e)) { changed = true; return; }
    const f = fixFields(e, fixes);
    if (f !== e) changed = true;
    out.push(f);
  });
  return changed ? out : v;
};

const fixObject = (inner, empty) => (v) => {
  if (!v) return v;
  if (!isPlainObject(v)) return empty();
  return inner ? inner(v) : v;
};

const PERSON_FIXES = [
  ['name', fixNeeded],
  ...['role', 'company', 'hobbies', 'email', 'phone', 'address', 'note', 'relation',
    'birthday', 'lastContact', 'addedOn', 'ageAsOf'].map((k) => [k, fixText]),
  ...['aka', 'kids', 'families', 'groups'].map((k) => [k, fixTextList]),
  ['log', fixEntries([['date', fixText], ['text', fixText]])],
  ['dates', fixEntries([['kind', fixText], ['label', fixText], ['date', fixText]])],
  ['socials', fixObject((s) => fixFields(s, Object.keys(s).map((k) => [k, fixText])), () => ({}))],
  ['partner', fixObject((pt) => fixFields(pt, [['name', fixText], ['status', fixText]]), () => null)],
  ['via', fixObject((v) => fixFields(v, [['by', fixText], ['on', fixText]]), () => null)],
];

const EVENT_FIXES = [
  ['title', fixNeeded], ['date', fixNeeded],
  ...['endDate', 'kind', 'place', 'note', 'addedOn'].map((k) => [k, fixText]),
  ['people', fixTextList],
  ['lat', fixNumber], ['lon', fixNumber],
  ['rating', fixRating],
  // Links to the shared catalog, what you thought (shared), and who sees it.
  ['links', fixEntries([['id', fixText], ['kind', fixText], ['name', fixText]])],
  ['review', fixText],
  ['visibility', fixText],
];

const REMINDER_FIXES = [
  ['title', fixNeeded], ['next', fixNeeded],
  ...['kind', 'note', 'lastDone', 'addedOn'].map((k) => [k, fixText]),
  ['people', fixTextList],
  ['history', fixEntries([['date', fixText]])],
  ['every', fixObject(null, () => null)],
];

const cleanPerson = (p) => (isPlainObject(p) ? fixFields(p, PERSON_FIXES) : null);
const cleanEvent = (e) => (isPlainObject(e) ? fixFields(e, EVENT_FIXES) : null);
const cleanReminder = (r) => (isPlainObject(r) ? fixFields(r, REMINDER_FIXES) : null);

// A whole saved list, record by record: one bad record no longer costs the
// rest. Anything that is not a list at all comes back empty.
const cleanAll = (list, clean) => (Array.isArray(list) ? list.map(clean).filter(Boolean) : []);

// Reads one saved list. damaged means the text could not be used exactly as
// saved: it would not parse, was not a list, or had records dropped or (when
// records are compared by identity) repaired. The caller then sets the
// original aside before anything can save over it.
const readSaved = (raw, cleanList, byIdentity) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { list: [], damaged: true }; }
  if (!Array.isArray(parsed)) return { list: [], damaged: true };
  const list = cleanList(parsed);
  const damaged = list.length !== parsed.length || (byIdentity && list.some((x, i) => x !== parsed[i]));
  return { list, damaged };
};

// Keeps the original text of a damaged list under a side key, untouched. Each
// distinct version is kept once, so reloading does not pile up copies.
const asideKey = (key) => `${key}-set-aside`;
const setAside = async (key, raw) => {
  const prev = await window.storage.get(asideKey(key));
  let kept = [];
  if (prev?.value) {
    try {
      const p = JSON.parse(prev.value);
      kept = Array.isArray(p) ? p : [prev.value];
    } catch {
      kept = [prev.value];
    }
  }
  if (!kept.includes(raw)) await window.storage.set(asideKey(key), JSON.stringify([...kept, raw]));
};

/* ---------- csv ---------- */
// Arrays are joined with ";" so they survive a comma-delimited file.
const joinList = (a) => (a || []).join('; ');
const splitList = (v) => (v || '').split(';').map((x) => x.trim()).filter(Boolean);

const packDates = (ds) =>
  (ds || []).map((d) => `${d.kind}|${d.label || ''}|${d.date}`).join('; ');

const unpackDates = (v) =>
  splitList(v).map((chunk) => {
    const [kind, label, date] = chunk.split('|').map((x) => (x || '').trim());
    return date ? { kind: kind || 'Other', label: label || '', date } : null;
  }).filter(Boolean);

const yesNo = (b) => (b ? 'yes' : 'no');
const isYes = (v) => /^(y|yes|true|1)$/i.test((v || '').trim());

// group: which checkbox on the export screen controls this column.
const PERSON_COLS = [
  { h: 'Name', g: 'basics', get: (p) => p.name, set: (p, v) => { p.name = v; } },
  { h: 'Also known as', g: 'basics', get: (p) => joinList(p.aka), set: (p, v) => { p.aka = splitList(v); } },
  { h: 'List', g: 'basics', get: (p) => (p.circle === 'work' ? 'Professional' : 'Personal'),
    set: (p, v) => { p.circle = /prof|work/i.test(v) ? 'work' : 'friend'; } },
  { h: 'Closeness', g: 'basics', get: (p) => tierLabel(p.tier),
    set: (p, v) => { p.tier = (TIERS.find((t) => t.label.toLowerCase() === (v || '').toLowerCase()) || {}).value || 'friend'; } },
  { h: 'Relation', g: 'basics', get: (p) => p.relation || '', set: (p, v) => { p.relation = v; } },
  { h: 'Role', g: 'basics', get: (p) => p.role || '', set: (p, v) => { p.role = v; } },
  { h: 'Company', g: 'basics', get: (p) => p.company || '', set: (p, v) => { p.company = v; } },
  { h: 'Birthday', g: 'basics', get: (p) => p.birthday || '', set: (p, v) => { p.birthday = v || null; } },
  { h: 'Age', g: 'basics', get: (p) => (ageOf(p) === null ? '' : String(ageOf(p))),
    set: (p, v) => { if (!p.birthday && v) { p.age = Number(v); p.ageAsOf = todayStr(); } } },

  { h: 'Email', g: 'contact', get: (p) => p.email || '', set: (p, v) => { p.email = v; } },
  { h: 'Phone', g: 'contact', get: (p) => p.phone || '', set: (p, v) => { p.phone = v; } },
  { h: 'Address', g: 'contact', get: (p) => p.address || '', set: (p, v) => { p.address = v; } },
  ...SOCIALS.map((soc) => ({
    h: soc.label, g: 'contact',
    get: (p) => (p.socials || {})[soc.key] || '',
    set: (p, v) => { if (v) { p.socials = { ...(p.socials || {}), [soc.key]: handle(v) }; } },
  })),

  { h: 'Partner', g: 'links', get: (p) => p.partner?.name || '',
    set: (p, v) => { if (v) p.partner = { ...(p.partner || {}), name: v }; } },
  { h: 'Partner status', g: 'links', get: (p) => p.partner?.status || '',
    set: (p, v) => { if (v && p.partner) p.partner.status = v; } },
  { h: 'Kids', g: 'links', get: (p) => joinList(p.kids), set: (p, v) => { p.kids = splitList(v); } },
  { h: 'Families', g: 'links', get: (p) => joinList(p.families), set: (p, v) => { p.families = splitList(v); } },
  { h: 'Knows', g: 'links', get: (p) => joinList(p.groups), set: (p, v) => { p.groups = splitList(v); } },

  { h: 'Check in days', g: 'cadence', get: (p) => String(p.cadence ?? 90),
    set: (p, v) => { p.cadence = v === '' ? 90 : Number(v); } },
  { h: 'Last contact', g: 'cadence', get: (p) => p.lastContact || '', set: (p, v) => { p.lastContact = v || null; } },
  { h: 'VIP', g: 'basics', get: (p) => yesNo(p.vip), set: (p, v) => { p.vip = isYes(v); } },
  { h: 'Child', g: 'basics', get: (p) => yesNo(p.child), set: (p, v) => { p.child = isYes(v); } },
  { h: 'Paused', g: 'cadence', get: (p) => yesNo(p.paused), set: (p, v) => { p.paused = isYes(v); } },

  { h: 'Dates to remember', g: 'dates', get: (p) => packDates(p.dates), set: (p, v) => { p.dates = unpackDates(v); } },

  { h: 'Hobbies', g: 'notes', get: (p) => p.hobbies || '', set: (p, v) => { p.hobbies = v; } },
  { h: 'Notes', g: 'notes', get: (p) => p.note || '', set: (p, v) => { p.note = v; } },
];

const EVENT_COLS = [
  { h: 'Title', get: (e) => e.title, set: (e, v) => { e.title = v; } },
  { h: 'Start', get: (e) => e.date, set: (e, v) => { e.date = v; } },
  { h: 'End', get: (e) => e.endDate || '', set: (e, v) => { e.endDate = v || null; } },
  { h: 'Kind', get: (e) => e.kind || '', set: (e, v) => { e.kind = v || 'Other'; } },
  { h: 'Rating', get: (e) => (e.rating ? String(e.rating) : ''), set: (e, v) => { if (v) e.rating = halfStep(v) || null; } },
  { h: 'Place', get: (e) => e.place || '', set: (e, v) => { e.place = v; } },
  { h: 'Latitude', get: (e) => (e.lat == null ? '' : String(e.lat)), set: (e, v) => { e.lat = v === '' ? null : Number(v); } },
  { h: 'Longitude', get: (e) => (e.lon == null ? '' : String(e.lon)), set: (e, v) => { e.lon = v === '' ? null : Number(v); } },
  { h: 'Details', get: (e) => e.note || '', set: (e, v) => { e.note = v; } },
];

const REMINDER_COLS = [
  { h: 'Title', get: (r) => r.title, set: (r, v) => { r.title = v; } },
  { h: 'Category', get: (r) => r.kind || 'Other',
    set: (r, v) => { r.kind = REMINDER_KINDS.find((k) => k.toLowerCase() === v.toLowerCase()) || 'Other'; } },
  { h: 'Next due', get: (r) => r.next || '', set: (r, v) => { r.next = v; } },
  { h: 'Repeat every', get: (r) => (repeatOf(r) ? String(repeatOf(r).n) : ''),
    set: (r, v) => { r.every = { unit: 'month', ...(r.every || {}), n: Number(v) }; } },
  { h: 'Repeat unit', get: (r) => (repeatOf(r) ? repeatOf(r).unit : ''),
    set: (r, v) => { r.every = { n: 1, ...(r.every || {}), unit: v.toLowerCase().replace(/s$/, '') }; } },
  // Exported so a monthly reminder pinned to the 31st comes back pinned to the
  // 31st, rather than to whichever day a short month had clamped it to.
  { h: 'Repeat day of month', get: (r) => (repeatOf(r) ? String(repeatOf(r).dom) : ''),
    set: (r, v) => { r.every = { unit: 'month', n: 1, ...(r.every || {}), dom: Number(v) }; } },
  { h: 'Counts from', get: (r) => (r.anchor === 'done' ? 'the day it is done' : 'the calendar'),
    set: (r, v) => { r.anchor = /done|last/i.test(v) ? 'done' : 'date'; } },
  { h: 'Notice days', get: (r) => String(leadOf(r)), set: (r, v) => { r.lead = Number(v); } },
  { h: 'Last done', get: (r) => r.lastDone || '', set: (r, v) => { r.lastDone = v || null; } },
  { h: 'Paused', get: (r) => yesNo(r.paused), set: (r, v) => { r.paused = isYes(v); } },
  { h: 'Finished', get: (r) => yesNo(r.done), set: (r, v) => { r.done = isYes(v); } },
  { h: 'Details', get: (r) => r.note || '', set: (r, v) => { r.note = v; } },
];

// One row per entry, with the list it belongs to named on every row, which is
// the shape a spreadsheet wants. Stages go out in the list's own words.
const ITEM_COLS = [
  { h: 'List', get: (r) => r.list, set: (r, v) => { r.list = v; } },
  { h: 'List kind', get: (r) => r.kind, set: (r, v) => { r.kind = v; } },
  { h: 'Title', get: (r) => r.title, set: (r, v) => { r.title = v; } },
  { h: 'Detail', get: (r) => r.detail || '', set: (r, v) => { r.detail = v; } },
  { h: 'Status', get: (r) => r.status || '', set: (r, v) => { r.status = v; } },
  { h: 'Rating', get: (r) => (r.rating ? String(r.rating) : ''), set: (r, v) => { r.rating = Number(v); } },
  { h: 'Link', get: (r) => r.link || '', set: (r, v) => { r.link = v; } },
  { h: 'Notes', get: (r) => r.note || '', set: (r, v) => { r.note = v; } },
  { h: 'Added', get: (r) => r.addedOn || '', set: (r, v) => { r.addedOn = v; } },
  { h: 'Finished on', get: (r) => r.doneOn || '', set: (r, v) => { r.doneOn = v; } },
];

const flattenCollections = (cs) => cs.flatMap((c) => c.items.map((it) => ({
  list: c.name,
  kind: c.kind,
  title: it.title,
  detail: it.detail,
  status: stagesOf(c).length ? stageLabel(c, stageOf(c, it)) : '',
  rating: it.rating,
  link: it.link,
  note: it.note,
  addedOn: it.addedOn,
  doneOn: it.doneOn,
})));

// Every kind's own words for its stages, so "In the collection" or "Want to
// watch" reads right whichever list a row lands in.
const STAGE_WORDS = new Map(COLLECTION_KINDS.flatMap((k) =>
  STAGES.filter((s) => k.labels[s]).map((s) => [k.labels[s].toLowerCase(), s])));

// Reads a stage back from whatever a sheet calls it: the list's own words,
// then any kind's, then the usual ones. Negatives are tested before anything
// else, because "Not started" and "Have not watched" contain the very words
// that would otherwise mark them started or watched.
const stageFrom = (v, labels) => {
  const s = (v || '').trim().toLowerCase();
  if (!s) return 'want';
  const own = STAGES.find((k) => (labels[k] || '').trim().toLowerCase() === s);
  if (own) return own;
  if (STAGE_WORDS.has(s)) return STAGE_WORDS.get(s);
  if (/\b(not|no|never|nothing|none|haven'?t|hasn'?t|yet to|to do|todo|want(ed)?|wish ?list|planned|pending|upcoming|queued?|backlog|meaning to|someday)\b/.test(s)) return 'want';
  if (/\b(in progress|under ?way|started|ongoing|current(ly)?|reading|watching|playing|listening|on the way|ordered|doing|part(ly|ially)?)\b/.test(s)) return 'doing';
  if (/\b(done|finished|complete(d)?|watched|read|seen|heard|played|beaten|have|owned|got|been|visited|yes|y|true|x)\b/.test(s)) return 'done';
  return 'want';
};

// A hand-made sheet rarely has a kind column, but the list's name usually
// says what it is ("Books", "Shows to watch"), and the kind decides what
// "Reading" means when the stages are read back.
const KIND_HINTS = [
  ['Shows', /\b(shows?|series|tv)\b/i],
  ['Movies', /\b(movies?|films?)\b/i],
  ['Books', /\b(books?|reading)\b/i],
  ['Music', /\b(music|albums?|records?|vinyl)\b/i],
  ['Games', /\b(games?)\b/i],
  ['Collectibles', /\b(collect\w*)\b/i],
  ['Places', /\b(places?|travel|trips?|restaurants?)\b/i],
];

const guessKind = (kind, name) => {
  const named = COLLECTION_KINDS.find((x) => x.kind.toLowerCase() === (kind || '').trim().toLowerCase());
  if (named) return named;
  return kindOf((KIND_HINTS.find(([, re]) => re.test(name || '')) || ['Other'])[0]);
};

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Rows are grouped into lists by name. A sheet with no list names at all
// becomes one list, named after the file it came from.
//
// have: lists the rows may join. A row for one of those is read in that
// list's own stage words, which a sheet it exported will be written in.
//
// statusColumn: whether the sheet had a Status column at all. With one, a
// list is staged only if some row says where it stands, which is what brings
// a plain list back as a plain list; without one, it takes its kind's usual.
const gatherCollections = (rows, { fallback, have = [], statusColumn = true }) => {
  const groups = new Map();
  rows.forEach((r) => {
    const name = (r.list || '').trim() || fallback;
    const key = name.toLowerCase();
    if (!groups.has(key)) {
      const mine = have.find((x) => sameName(x.name, name));
      const k = mine ? kindOf(mine.kind) : guessKind(r.kind, name);
      groups.set(key, {
        name, kind: k.kind, track: !statusColumn,
        labels: mine ? { ...mine.labels } : { ...k.labels }, detail: mine ? mine.detail : k.detail, items: [],
      });
    }
    const g = groups.get(key);
    if ((r.status || '').trim()) g.track = true;
    g.items.push({ ...r, status: stageFrom(r.status, g.labels) });
  });
  return cleanCollections([...groups.values()]);
};

// Adding a sheet to lists you already keep: entries for a list with the same
// name join it rather than starting a second list beside it. The list keeps
// its own settings; only its entries grow.
const mergeCollections = (have, incoming) => {
  const out = [...have];
  incoming.forEach((c) => {
    const i = out.findIndex((x) => sameName(x.name, c.name));
    if (i === -1) out.push(c);
    else out[i] = { ...out[i], updatedAt: new Date().toISOString(), items: [...out[i].items, ...c.items].slice(0, ITEM_CAP) };
  });
  return out;
};

// How many entries an import would leave out for want of room, so the screen
// can say so before anything is saved rather than dropping them quietly.
const importOverflow = (have, incoming, mode) => incoming.reduce((n, c) => {
  const mine = mode === 'add' ? have.find((x) => sameName(x.name, c.name)) : null;
  return n + Math.max(0, (mine ? mine.items.length : 0) + c.items.length - ITEM_CAP);
}, 0);

const norm = (h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A cell starting = + - or @ runs as a formula when the file is opened in a
// spreadsheet, and list titles can come from anyone who shares a list. Such
// cells get a leading ' (the usual defence), except a plain signed number, so
// a longitude of -94.58 stays a number. fromCsv takes the ' back off.
const FORMULA_START = /^(?![+-][0-9]+(\.[0-9]+)?$)[=+\-@\t\r]/;

const toCsv = (cols, rows, extra) =>
  Papa.unparse({
    fields: cols.map((c) => c.h).concat(extra ? extra.fields : []),
    data: rows.map((r) => cols.map((c) => c.get(r)).concat(extra ? extra.row(r) : [])),
  }, { escapeFormulae: FORMULA_START });

// Matches headers loosely, so a hand-made sheet still lands in the right fields.
const fromCsv = (cols, rows, make) => {
  const lookup = new Map(cols.map((c) => [norm(c.h), c]));
  const out = [];
  let skipped = 0;
  rows.forEach((row) => {
    const obj = make();
    let touched = false;
    Object.entries(row).forEach(([header, value]) => {
      const col = lookup.get(norm(header));
      const v = value == null ? '' : String(value).replace(/^'(?=[=+\-@\t\r])/, '').trim();
      if (!col || v === '') return;
      col.set(obj, v);
      touched = true;
    });
    if (touched) out.push(obj); else skipped += 1;
  });
  return { out, skipped };
};

// What a save changed, as usage counts (see usage.js): how many were added,
// removed or edited, and a few plain details of a single one, never what
// anyone wrote. A pile at once (an import, a restore) is one count.
const changeActions = (what, prev, next) => {
  const out = [];
  if (!Array.isArray(prev) || !Array.isArray(next)) return out;
  const before = new Map(prev.map((x) => [x?.id, x]));
  const after = new Map(next.map((x) => [x?.id, x]));
  const added = next.filter((x) => !before.has(x?.id));
  const removed = prev.filter((x) => !after.has(x?.id));
  const edited = next.filter((x) => before.has(x?.id) && before.get(x.id) !== x);
  const total = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);
  const grew = (f) => Math.max(0, total(next, f) - total(prev, f));
  const one = (name, xs, detail) => {
    if (!xs.length) return;
    out.push([name, xs.length === 1 && detail ? detail(xs[0]) : { n: xs.length, ...(xs.length > 3 ? { bulk: true } : {}) }]);
  };
  const eventDetail = (e) => ({ kind: e.kind || 'Other', rated: Boolean(e.rating), linked: (e.links || []).length, shared: e.visibility || 'me', thoughts: Boolean(e.review) });
  if (what === 'people') {
    const logs = grew((p) => (p.log || []).length);
    one('person.add', added, (p) => ({ circle: p.circle || 'friend', birthday: Boolean(p.birthday), cadence: p.cadence || 0 }));
    one('person.remove', removed);
    one('person.edit', edited.filter((p) => (p.log || []).length === (before.get(p.id).log || []).length));
    if (logs) out.push(['catchup.log', { n: logs }]);
  } else if (what === 'events') {
    one('event.add', added, eventDetail);
    one('event.remove', removed);
    one('event.edit', edited, eventDetail);
  } else if (what === 'reminders') {
    const done = grew((r) => (r.history || []).length);
    one('reminder.add', added, (r) => ({ kind: r.kind || 'Other', repeats: Boolean(r.every), anchor: r.anchor || 'date' }));
    one('reminder.remove', removed);
    one('reminder.edit', edited.filter((r) => (r.history || []).length === (before.get(r.id).history || []).length));
    if (done) out.push(['reminder.done', { n: done }]);
  } else if (what === 'lists') {
    one('list.add', added, (c) => ({ kind: c.kind || 'Other', stages: Boolean(c.track) }));
    one('list.remove', removed);
    const items = grew((c) => (c.items || []).length);
    const finished = grew((c) => (c.items || []).filter((it) => it.doneOn).length);
    const rated = grew((c) => (c.items || []).filter((it) => it.rating).length);
    if (items) out.push(['list.item_add', { n: items }]);
    if (finished) out.push(['list.item_done', { n: finished }]);
    if (rated) out.push(['list.item_rate', { n: rated }]);
  } else if (what === 'trips') {
    one('trip.add', added, (t) => ({ status: t.status || 'been', rated: Boolean(t.rating), stops: (t.stops || []).length, photos: (t.photoIds || []).length }));
    one('trip.remove', removed);
    one('trip.edit', edited, (t) => ({ status: t.status || 'been', rated: Boolean(t.rating) }));
    const photos = grew((t) => (t.photoIds || []).length);
    if (photos) out.push(['trip.photo_add', { n: photos }]);
  }
  return out;
};
const trackChanges = (what, prev, next) => changeActions(what, prev, next).forEach(([name, props]) => track(name, props));

// A short fingerprint of some text (FNV-1a), to tell whether it changed
// without keeping it.
const fingerprint = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(36)}`;
};

const downloadCsv = (name, text, type = 'text/csv;charset=utf-8;') => {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};

/* ---------- what is coming up ---------- */
const HORIZON = 45;

// Everything time-sensitive across people and events, in one ordered list.
const buildUpcoming = (people, events, reminders) => {
  const out = [];

  people.forEach((p) => {
    if (p.paused) return;

    if (p.birthday) {
      const d = daysToBirthday(p.birthday);
      if (d <= HORIZON) {
        const age = derivedAge(p.birthday);
        out.push({
          key: `b-${p.id}`, d, tone: 'soon', person: p,
          what: `${p.name.split(' ')[0]}'s birthday`,
          detail: age !== null ? `turning ${age + 1}` : '',
        });
      }
    }

    (p.dates || []).forEach((ev, i) => {
      if (!ev.date) return;
      const d = daysToBirthday(ev.date);
      if (d > HORIZON) return;
      const n = annualCount(ev.date);
      out.push({
        key: `d-${p.id}-${i}`, d, tone: 'calm', person: p,
        what: `${p.name.split(' ')[0]} — ${dateLabel(ev).toLowerCase()}`,
        detail: n > 0 ? `${n} year${n === 1 ? '' : 's'}` : '',
      });
    });
  });

  events.forEach((e) => {
    const start = parseDate(e.date);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const d = Math.round((start - now) / 86400000);
    if (d >= 0 && d <= HORIZON) {
      out.push({ key: `e-${e.id}`, d, tone: 'calm', what: e.title, detail: e.place || '' });
    }
  });

  // Reminders are the one thing here that can already be late, so unlike a
  // birthday they are allowed a negative d and sort above everything else.
  (reminders || []).forEach((r) => {
    if (r.paused || r.done) return;
    const st = reminderState(r);
    // Only once it is inside the notice period asked for. "Tell me a week
    // ahead" means this list stays quiet until that week, however far off the
    // date is; anything already late is always worth showing.
    if (st.d === null || st.d > Math.min(leadOf(r), HORIZON)) return;
    out.push({
      key: `r-${r.id}`, d: st.d, reminder: r, what: r.title,
      tone: st.key === 'over' ? 'over' : st.key === 'later' ? 'calm' : 'soon',
      detail: r.kind && r.kind !== 'Other' ? r.kind.toLowerCase() : '',
      due: dueText(st.d),
    });
  });

  return out.sort((a, b) => a.d - b.d);
};

function Upcoming({ people, events, reminders, quiet, onShowQuiet, onPerson, onReminder }) {
  const [open, setOpen] = useState(true);
  const items = buildUpcoming(people, events, reminders);
  const total = items.length + (quiet > 0 ? 1 : 0);
  if (total === 0) return null;
  // A late reminder counts as something wanting attention, same as a person
  // who has gone quiet, so the badge does not read green while one sits red.
  const pressing = quiet > 0 || items.some((it) => it.tone === 'over');

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11,
      margin: '14px 0 0', overflow: 'hidden',
    }}>
      <button
        className="crm-btn"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          font: 'inherit', textAlign: 'left', cursor: 'pointer',
          padding: '11px 13px', background: 'transparent', border: 'none',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>Coming up</span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
          background: pressing ? C.overdue : C.accent,
          color: pressing ? C.paper : C.onAccent,
        }}>{total}</span>
        <span style={{ fontSize: 11, color: C.faint }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 13px 5px' }}>
          {quiet > 0 && (
            <button
              className="crm-btn"
              onClick={onShowQuiet}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 9, width: '100%',
                font: 'inherit', textAlign: 'left', cursor: 'pointer',
                padding: '9px 0', background: 'transparent', border: 'none',
                borderTop: `1px solid ${C.line}`,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: 7, background: C.overdueBar, flexShrink: 0,
              }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.overdue }}>
                {quiet} {quiet === 1 ? 'person has' : 'people have'} gone quiet
              </span>
              <span style={{ fontSize: 12, color: C.overdue, opacity: 0.75 }}>Show them</span>
            </button>
          )}

          {items.map((it) => (
            <button
              key={it.key}
              className="crm-btn"
              onClick={() => {
                if (it.person) onPerson(it.person.id);
                else if (it.reminder) onReminder();
              }}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 9, width: '100%',
                font: 'inherit', textAlign: 'left',
                cursor: it.person || it.reminder ? 'pointer' : 'default',
                padding: '9px 0', background: 'transparent', border: 'none',
                borderTop: `1px solid ${C.line}`,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: 7, flexShrink: 0,
                background: it.tone === 'over' ? C.overdueBar : it.tone === 'soon' ? C.soonBar : C.accent,
              }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink }}>
                {it.what}
                {it.detail && <span style={{ color: C.faint }}>{`, ${it.detail}`}</span>}
              </span>
              <span style={{
                fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap',
                color: it.tone === 'over' ? C.overdue : C.muted,
              }}>
                {it.due || countdown(it.d)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- three ways to switch lists ---------- */
const CIRCLES = [['friend', 'Personal'], ['work', 'Professional']];

function Switcher({ value, onChange, quietIn }) {
  const chips = [['all', 'Everyone'], ['friend', 'Personal'], ['work', 'Professional'], ['vip', 'VIP']];
  return (
    <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' }}>
      {chips.map(([v, l]) => {
        const on = value === v;
        const n = quietIn(v);
        return (
          <button
            key={v}
            className="crm-btn"
            onClick={() => onChange(v)}
            style={{
              font: 'inherit', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
              padding: '7px 13px', borderRadius: 20, cursor: 'pointer',
              background: on ? C.accent : 'transparent',
              border: `1px solid ${on ? C.accent : C.line}`,
              color: on ? C.onAccent : C.muted,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {l}
            {n > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
                background: on ? 'rgba(0,0,0,0.20)' : C.overdue, color: on ? C.onAccent : C.paper,
              }}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- year in review ---------- */
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const buildRecap = (people, year) => {
  const entries = [];
  people.forEach((p) => (p.log || []).forEach((e) => {
    if (e.date && Number(e.date.slice(0, 4)) === year) entries.push({ date: e.date, p });
  }));

  const byPerson = new Map();
  entries.forEach(({ p }) => byPerson.set(p.id, (byPerson.get(p.id) || 0) + 1));
  const top = [...byPerson.entries()]
    .map(([id, n]) => ({ p: people.find((x) => x.id === id), n }))
    .filter((x) => x.p)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  const months = Array(12).fill(0);
  entries.forEach(({ date }) => { months[Number(date.slice(5, 7)) - 1] += 1; });
  const peakCount = Math.max(...months);
  const peak = peakCount > 0 ? months.indexOf(peakCount) : -1;

  const personal = entries.filter(({ p }) => (p.circle || 'friend') === 'friend').length;

  // Biggest silence you actually broke this year.
  let reunion = null;
  people.forEach((p) => {
    const dates = (p.log || []).map((e) => e.date).filter(Boolean).sort();
    for (let i = 1; i < dates.length; i += 1) {
      if (Number(dates[i].slice(0, 4)) !== year) continue;
      const gap = Math.round((parseDate(dates[i]) - parseDate(dates[i - 1])) / 86400000);
      if (gap > 45 && (!reunion || gap > reunion.gap)) reunion = { p, gap, on: dates[i] };
    }
  });

  const circles = new Map();
  entries.forEach(({ p }) => {
    [...(p.families || []), ...(p.groups || [])].forEach((g) =>
      circles.set(g, (circles.get(g) || 0) + 1));
  });
  const topCircle = [...circles.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const added = people.filter((p) => p.addedOn && Number(p.addedOn.slice(0, 4)) === year).length;
  const activeMonths = months.filter((m) => m > 0).length;

  return { entries, top, months, peak, peakCount, personal, work: entries.length - personal,
    reunion, topCircle, added, activeMonths, total: entries.length };
};

function Stat({ n, label, tone }) {
  return (
    <div style={{
      flex: '1 1 128px', background: C.surface, border: `1px solid ${C.line}`,
      borderRadius: 12, padding: '15px 14px',
    }}>
      <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.04em',
        color: tone || C.ink, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 7, lineHeight: 1.35 }}>{label}</div>
    </div>
  );
}

// The four latest years as chips; any before that in a menu, so a long
// history does not push the page sideways.
function YearPicker({ year, years, onYear }) {
  if (years.length < 2) return null;
  const recent = years.slice(0, 4);
  const older = years.slice(4);
  return (
    <div role="group" aria-label="Year" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {recent.map((y) => (
        <button
          key={y}
          className="crm-btn"
          aria-pressed={y === year}
          onClick={() => onYear(y)}
          style={{
            font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '4px 10px',
            borderRadius: 20, cursor: 'pointer',
            background: y === year ? C.accent : 'transparent',
            border: `1px solid ${y === year ? C.accent : C.line}`,
            color: y === year ? C.onAccent : C.muted,
          }}
        >{y}</button>
      ))}
      {older.length > 0 && (
        <select className="crm-select" aria-label="Earlier years" value={older.includes(year) ? year : ''}
          onChange={(e) => e.target.value && onYear(Number(e.target.value))}
          style={{ ...inputStyle, width: 'auto', minHeight: 30, padding: '3px 30px 3px 10px', fontSize: 12.5, borderRadius: 20 }}>
          <option value="">Earlier</option>
          {older.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    </div>
  );
}

// A year of trips in Recap: the numbers, the best one, a map and the rest.
function RecapTrips({ trips, year, onTrip }) {
  const { where } = useGeo();
  const y = useMemo(() => tripYear(trips, where, year), [trips, where, year]);
  const planned = trips.filter((t) => t.status === 'planned' && tripYears(t).includes(year) && !tripOverdue(t));
  const points = useMemo(() => tripPoints(y.trips), [y.trips]);
  if (!y.trips.length && !planned.length) return null;
  const n = (x) => (x === null ? '…' : x.size);
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12 };
  return (
    <section aria-labelledby="recap-trips" style={{ marginTop: 22 }}>
      <h2 id="recap-trips" style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{`${year} in trips`}</h2>
      {y.trips.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <Stat n={y.trips.length} label={y.trips.length === 1 ? 'trip' : 'trips'} tone={C.accentDeep} />
            <Stat n={y.days} label="days away" />
            <Stat n={n(y.countries)} label={y.countries?.size === 1 ? 'country' : 'countries'} />
            {y.states && y.states.size > 0 && <Stat n={y.states.size} label={y.states.size === 1 ? 'US state' : 'US states'} />}
            <Stat n={y.places} label={y.places === 1 ? 'place' : 'places'} />
          </div>

          {y.best && (
            <button className="crm-btn crm-row" onClick={() => onTrip(y.best.id)} style={{
              ...box, display: 'flex', gap: 14, width: '100%', textAlign: 'left', font: 'inherit', color: C.ink,
              padding: 12, cursor: 'pointer', alignItems: 'flex-start',
            }}>
              {y.best.photoIds[0] && (
                <PhotoThumb id={y.best.photoIds[0]} alt={photoAlt(y.best.title, 0)} style={{ width: 120, height: 96, borderRadius: 8, flexShrink: 0 }} />
              )}
              <span style={{ display: 'block', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, color: C.muted }}>{y.best.rating ? 'Top-rated trip' : 'Longest trip'}</span>
                <span style={{ display: 'block', fontSize: 19, fontWeight: 600, letterSpacing: '-0.025em', marginTop: 2 }}>{y.best.title}</span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12.5, color: C.muted, marginTop: 3 }}>
                  <span>{tripWhen(y.best).text}</span>
                  <Stars n={y.best.rating} size={12.5} />
                </span>
                {y.best.excerpt && (
                  <span className="crm-serif crm-clamp" style={{ display: '-webkit-box', fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{y.best.excerpt}</span>
                )}
              </span>
            </button>
          )}

          <div style={{ ...mapFrame(), marginBottom: 12 }}>
            <MapSlot height={280} render={(m) => (
              <m.TripsMap points={points} height={280} dark={C.dark} renderPopup={(p) => {
                const t = y.trips.find((x) => x.id === p.tripId);
                return t ? <TripPopup trip={t} stop={p.stop} onOpen={() => onTrip(t.id)} /> : null;
              }} />
            )} />
          </div>

          <div style={{ ...box, padding: '6px 15px' }}>
            {y.firsts && y.firsts.length > 0 && y.trips.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '11px 0', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ flex: 1, fontSize: 13, color: C.muted }}>First time in</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, textAlign: 'right' }}>{y.firsts.join(', ')}</span>
              </div>
            )}
            {y.trips.map((t) => (
              <button key={t.id} className="crm-btn" onClick={() => onTrip(t.id)} style={{
                display: 'flex', gap: 12, alignItems: 'baseline', width: '100%', textAlign: 'left', font: 'inherit',
                padding: '11px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', color: C.ink,
              }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>{t.title}</span>
                <Stars n={t.rating} size={11.5} />
                <span style={{ fontSize: 12.5, color: C.muted, flexShrink: 0 }}>{tripWhen(t).text}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {planned.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: C.muted }}>
          {`Still to come in ${year}: `}
          {planned.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ', '}
              <button className="crm-btn" onClick={() => onTrip(t.id)} style={{ ...textButton(), fontSize: 13.5 }}>{t.title}</button>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// What each kind of outing is called when counted: "3 concerts", "1 game".
const OUTING_WORDS = { Concert: ['concert', 'concerts'], Sports: ['game', 'games'], Theater: ['show', 'shows'], Festival: ['festival', 'festivals'] };

// A year of outings for Recap: the concerts, games, shows and festivals that
// have happened, how many of each, the best-rated event of any kind, and the
// outings still to come.
const eventsYear = (events, year, today = todayStr()) => {
  const mine = events.filter((e) => eventYear(e) === year);
  const outings = mine.filter((e) => OUTING_KINDS.includes(e.kind));
  const done = outings.filter((e) => e.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
  const counts = OUTING_KINDS.map((k) => ({ kind: k, n: done.filter((e) => e.kind === k).length })).filter((c) => c.n);
  const best = mine.filter((e) => e.rating && e.date <= today)
    .sort((a, b) => b.rating - a.rating || (a.date < b.date ? 1 : -1))[0] || null;
  const ahead = outings.filter((e) => e.date > today).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { outings: done, counts, best, ahead };
};

function RecapEvents({ events, year, onEvent }) {
  const y = useMemo(() => eventsYear(events, year), [events, year]);
  if (!y.outings.length && !y.ahead.length && !y.best) return null;
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12 };
  return (
    <section aria-labelledby="recap-events" style={{ marginTop: 22 }}>
      <h2 id="recap-events" style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{`${year} in events`}</h2>
      {y.counts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {y.counts.map((c, i) => (
            <Stat key={c.kind} n={c.n} label={OUTING_WORDS[c.kind][c.n === 1 ? 0 : 1]} tone={i === 0 ? C.accentDeep : undefined} />
          ))}
        </div>
      )}
      {y.best && (
        <button className="crm-btn crm-row" onClick={() => onEvent(y.best)} style={{
          ...box, display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: C.ink, padding: 12, cursor: 'pointer',
        }}>
          <span style={{ display: 'block', fontSize: 13, color: C.muted }}>Top-rated event</span>
          <span style={{ display: 'block', fontSize: 19, fontWeight: 600, letterSpacing: '-0.025em', marginTop: 2 }}>{y.best.title}</span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12.5, color: C.muted, marginTop: 3 }}>
            <span>{eventWhen(y.best).text}</span>
            {y.best.place && <span>{y.best.place}</span>}
            <Stars n={y.best.rating} size={12.5} />
          </span>
        </button>
      )}
      {y.outings.length > 0 && (
        <div style={{ ...box, padding: '6px 15px' }}>
          {y.outings.map((e) => (
            <button key={e.id} className="crm-btn" onClick={() => onEvent(e)} style={{
              display: 'flex', gap: 12, alignItems: 'baseline', width: '100%', textAlign: 'left', font: 'inherit',
              padding: '11px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', color: C.ink,
            }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>{e.title}</span>
              <Stars n={e.rating} size={11.5} />
              <span style={kindChip()}>{e.kind}</span>
              <span style={{ fontSize: 12.5, color: C.muted, flexShrink: 0 }}>{eventWhen(e).text}</span>
            </button>
          ))}
        </div>
      )}
      {y.ahead.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: C.muted }}>
          {`Still to come in ${year}: `}
          {y.ahead.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ', '}
              <button className="crm-btn" onClick={() => onEvent(e)} style={{ ...textButton(), fontSize: 13.5 }}>{e.title}</button>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// What goes on the year's share card (see recapCard.js): counts, titles and
// ratings only. Who anyone was with, notes, and anything from People but the
// number of catch-ups never go, and the catch-ups only when asked for.
// include: { trips, events, people }. where: from useGeo, or null while the
// outlines load (the card then has no countries).
const recapCard = ({ people, events, trips, where, year, include, name = '', site = '', today = todayStr() }) => {
  const t = include.trips ? tripYear(trips, where, year, today) : null;
  const ev = include.events ? eventsYear(events, year, today) : null;
  const catchUps = include.people ? buildRecap(people, year).total : 0;
  const word = (n, one, many) => (n === 1 ? one : many);
  const stats = [
    t && { n: t.trips.length, label: word(t.trips.length, 'trip', 'trips') },
    t && t.countries && { n: t.countries.size, label: word(t.countries.size, 'country', 'countries') },
    ...(ev ? ev.counts.map((c) => ({ n: c.n, label: OUTING_WORDS[c.kind][c.n === 1 ? 0 : 1] })) : []),
    t && { n: t.days, label: word(t.days, 'day away', 'days away') },
    include.people && { n: catchUps, label: word(catchUps, 'catch-up', 'catch-ups') },
    t && t.states && { n: t.states.size, label: word(t.states.size, 'US state', 'US states') },
    t && { n: t.places, label: word(t.places, 'place', 'places') },
  ].filter((x) => x && x.n > 0).slice(0, 6);
  const highlights = [
    t?.best && {
      label: t.best.rating ? 'Top-rated trip' : 'Longest trip',
      title: t.best.title, rating: t.best.rating || null, sub: tripWhen(t.best).text,
    },
    ev?.best && {
      label: 'Top-rated event',
      title: ev.best.title, rating: ev.best.rating, sub: [ev.best.place, eventWhen(ev.best).text].filter(Boolean).join(' · '),
    },
  ].filter(Boolean);
  const hasTrips = Boolean(t?.trips.length);
  const hasEvents = Boolean(ev && (ev.outings.length || ev.best));
  return {
    year,
    name: clip(name.trim(), 60),
    subtitle: hasTrips && hasEvents ? 'in trips & events' : hasTrips ? 'in trips' : hasEvents ? 'in events' : 'in review',
    stats,
    highlights,
    countries: t?.countries ? [...t.countries].sort() : [],
    pins: ev ? ev.outings.filter((e) => typeof e.lat === 'number' && typeof e.lon === 'number').map((e) => ({ lat: e.lat, lng: e.lon })) : [],
    site,
    empty: !stats.length && !highlights.length,
  };
};

// The card in words, for the preview's label and for anyone sharing it as text.
const recapCardText = (card) => [
  `${card.year} ${card.subtitle}`,
  card.stats.map((x) => `${x.n} ${x.label}`).join(', '),
  ...card.highlights.map((h) => `${h.label}: ${h.title}${h.rating ? ` (${stars(h.rating)})` : ''}`),
].filter(Boolean).join('\n');

// page: the address of this year on your page, when you have one, which the
// picture names and the share sheet sends with it.
function RecapShare({ people, events, trips, year, owner, page = '' }) {
  const { geo, where } = useGeo();
  const [include, setInclude] = useState({ trips: true, events: true, people: false });
  const [by, setBy] = useState(owner || '');
  const [said, setSaid] = useState('');
  const canvas = useRef(null);
  const site = page ? page.replace(/^https?:\/\//, '') : typeof location === 'undefined' ? '' : location.host;
  const card = useMemo(() => recapCard({ people, events, trips, where, year, include, name: by, site }),
    [people, events, trips, where, year, include, by, site]);
  // Which card the canvas holds, so nothing is sent from a picture of the
  // choices made a moment before.
  const [drawn, setDrawn] = useState(null);
  useEffect(() => {
    let live = true;
    cardFontsReady().then(() => {
      if (!live || !canvas.current) return;
      drawRecapCard(canvas.current, card, geo);
      setDrawn(card);
    });
    return () => { live = false; };
  }, [card, geo]);
  const ready = drawn === card && !card.empty;
  const file = `orbit-${year}.png`;

  const picture = async () => {
    const blob = await cardBlob(canvas.current);
    if (!blob) throw new Error('no picture');
    return blob;
  };
  const save = async () => {
    track('recap.card_save', { trips: include.trips, events: include.events, catchups: include.people, named: Boolean(by.trim()) });
    try {
      const url = URL.createObjectURL(await picture());
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaid('Saved the picture.');
    } catch {
      setSaid('The picture could not be made in this browser.');
    }
  };
  const canSheet = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof File === 'function';
  const sheet = async () => {
    track('recap.card_share', { trips: include.trips, events: include.events, catchups: include.people, linked: Boolean(page) });
    try {
      const f = new File([await picture()], file, { type: 'image/png' });
      if (!navigator.canShare({ files: [f] })) { await save(); return; }
      await navigator.share({ files: [f], title: `My ${year} in Orbit`, ...(page ? { text: page } : {}) });
    } catch (e) {
      if (e?.name !== 'AbortError') setSaid('Sharing did not work here. Save the picture instead.');
    }
  };
  const tick = (k) => (v) => setInclude({ ...include, [k]: v });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 600, color: C.ink }}>Share your {year}</p>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        A picture of the year, made on this device. Only counts, titles and ratings go on it: never who you were with, and never your notes.
      </p>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} role="img" aria-label={recapCardText(card)}
          style={{ width: '100%', maxWidth: 300, aspectRatio: `${CARD_W} / ${CARD_H}`, borderRadius: 10, border: `1px solid ${C.line}`, flex: '0 1 300px' }} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Check on={include.trips} onChange={tick('trips')} label="Trips" hint="How many, where, days away, and the best one" />
          <Check on={include.events} onChange={tick('events')} label="Events" hint="Concerts, games, shows and festivals, and the top-rated event" />
          <Check on={include.people} onChange={tick('people')} label="Catch-ups" hint="Only how many. Never names." />
          <Field label="Your name on it">
            <input style={{ ...inputStyle, minHeight: 38 }} value={by} onChange={(e) => setBy(e.target.value)} placeholder="Optional" />
          </Field>
          {card.empty ? (
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Nothing from {year} to put on it with these ticked.</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canSheet && <Button kind="solid" disabled={!ready} onClick={sheet}>{ready ? 'Share…' : 'Getting it ready…'}</Button>}
              <Button kind={canSheet ? 'quiet' : 'solid'} disabled={!ready} onClick={save}>Save image</Button>
            </div>
          )}
          {said && <p role="status" style={{ margin: '10px 0 0', fontSize: 12.5, color: C.muted }}>{said}</p>}
        </div>
      </div>
    </div>
  );
}

function Recap({ people, year, years, onYear, eventCount, reminderCount, listCount, trips = [], onTrip, events = [], onEvent, owner, pageFor = null }) {
  const r = buildRecap(people, year);
  const maxMonth = Math.max(1, ...r.months);
  const tripCount = trips.filter((t) => tripYears(t).includes(year)).length;
  const [sharing, setSharing] = useState(false);
  const outings = eventsYear(events, year);
  const shareable = Boolean(tripCount || outings.outings.length || outings.best || r.total);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>
          {year} in review
        </h1>
        <YearPicker year={year} years={years} onYear={onYear} />
        {shareable && (
          <Button onClick={() => { if (!sharing) track('recap.card_open', { year }); setSharing(!sharing); }} aria-expanded={sharing}
            style={{ marginLeft: 'auto', ...(sharing ? { borderColor: C.accent } : null) }}>Share your year</Button>
        )}
      </div>

      {sharing && shareable && <RecapShare people={people} events={events} trips={trips} year={year} owner={owner} page={pageFor ? pageFor(year) : ''} />}

      {r.total === 0 && r.added === 0 && !eventCount && !reminderCount && !listCount ? (tripCount ? null : (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: 0 }}>
          Nothing logged in {year} yet. Every catch-up you record builds this page, so it
          gets more interesting the longer you use it.
        </p>
      )) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <Stat n={r.total} label="catch-ups logged" tone={C.accentDeep} />
            <Stat n={r.added} label="people added" />
            <Stat n={r.activeMonths} label={`of 12 months with contact`} />
            <Stat n={eventCount} label="events recorded" />
            {reminderCount > 0 && <Stat n={reminderCount} label="reminders kept" />}
            {listCount > 0 && <Stat n={listCount} label="crossed off your lists" />}
          </div>

          {r.top.length > 0 && (
            <div style={{
              background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: '15px 15px 8px', marginBottom: 12,
            }}>
              <p style={{ margin: '0 0 3px', fontSize: 13, color: C.muted }}>Most connected with</p>
              <p style={{ margin: '0 0 14px', fontSize: 19, fontWeight: 600, letterSpacing: '-0.025em' }}>
                {r.top[0].p.name}
              </p>
              {r.top.map(({ p, n }) => (
                <div key={p.id} style={{ marginBottom: 11 }}>
                  <div style={{ display: 'flex', gap: 10, fontSize: 13, marginBottom: 4 }}>
                    <span style={{ flex: 1, minWidth: 0, color: C.ink, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ color: C.muted, flexShrink: 0 }}>{n}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 6, background: C.line, overflow: 'hidden' }}>
                    <div style={{ width: `${(n / r.top[0].n) * 100}%`, height: '100%',
                      background: C.accent, borderRadius: 6 }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {r.total > 0 && (
            <div style={{
              background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: '15px 15px 12px', marginBottom: 12,
            }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted }}>
                {r.peak >= 0 ? `Busiest month was ${MONTH_NAMES[r.peak]}` : 'Across the year'}
              </p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 62 }}>
                {r.months.map((m, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      height: Math.max(3, (m / maxMonth) * 46), borderRadius: 3,
                      background: i === r.peak ? C.accentDeep : C.accent,
                      opacity: m === 0 ? 0.22 : 1,
                    }} />
                    <div style={{ fontSize: 10, color: C.faint, marginTop: 5 }}>{MONTHS[i]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(r.total > 0 || r.reunion || r.topCircle) && <div style={{
            background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '6px 15px',
          }}>
            {[
              r.total > 0 && {
                k: 'split',
                label: 'Personal and professional',
                value: `${r.personal} personal, ${r.work} professional`,
              },
              r.reunion && {
                k: 'reunion',
                label: 'Longest silence you broke',
                value: `${r.reunion.p.name}, after ${elapsed(r.reunion.gap)}`,
              },
              r.topCircle && {
                k: 'circle',
                label: 'Group you saw most',
                value: `${r.topCircle[0]} (${r.topCircle[1]})`,
              },
            ].filter(Boolean).map((row) => (
              <div key={row.k} style={{
                display: 'flex', gap: 12, alignItems: 'baseline', padding: '11px 0',
                borderBottom: `1px solid ${C.line}`,
              }}>
                <span style={{ flex: 1, fontSize: 13, color: C.muted }}>{row.label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, textAlign: 'right' }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>}
        </>
      )}

      {onTrip && <RecapTrips trips={trips} year={year} onTrip={onTrip} />}
      {onEvent && <RecapEvents events={events} year={year} onEvent={onEvent} />}
    </div>
  );
}

/* ---------- place lookup ---------- */
// Stadia Maps' place search (see mapConfig.js). Every lookup waits its turn
// here, however many search boxes are asking, and answers are remembered for
// the visit, so asking again costs nothing.
const placeCache = new Map();
let placeNext = 0;

const pause = (ms, signal) => new Promise((resolve, reject) => {
  const stop = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal?.aborted) { stop(); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); stop(); }, { once: true });
});

// A short name for a place: the search's own, or the first part of its address.
const placeName = (p) => clip(p?.name, 200) || clip(String(p?.label || '').split(',')[0], 200);

// -> { status: 'ok' | 'none' | 'offline' | 'aborted', results: [{ label, name, lat, lon }] }
const searchPlaces = async (raw, { signal } = {}) => {
  const q = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!q) return { status: 'none', results: [] };
  const key = q.toLowerCase();
  if (placeCache.has(key)) return placeCache.get(key);
  try {
    const now = Date.now();
    const at = Math.max(now, placeNext);
    placeNext = at + GEOCODER.minGapMs;
    if (at > now) await pause(at - now, signal);
    const params = new URLSearchParams({
      text: q, size: String(GEOCODER.limit),
      lang: ((typeof navigator !== 'undefined' && navigator.language) || 'en').split('-')[0],
    });
    const res = await fetch(`${GEOCODER.url}?${params}`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { status: 'offline', results: [] };
    const data = await res.json();
    // GeoJSON: each place is a feature, its point given as [longitude, latitude].
    const good = (Array.isArray(data?.features) ? data.features : [])
      .map((f) => ({
        label: clip(f?.properties?.label, 300),
        name: placeName(f?.properties),
        lat: Number(f?.geometry?.coordinates?.[1]),
        lon: Number(f?.geometry?.coordinates?.[0]),
      }))
      .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon)
        && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);
    const out = good.length ? { status: 'ok', results: good } : { status: 'none', results: [] };
    placeCache.set(key, out);
    return out;
  } catch (e) {
    if (e?.name === 'AbortError') return { status: 'aborted', results: [] };
    return { status: 'offline', results: [] };
  }
};

/* ---------- trips: the records ---------- */
// A trip is a place (or several) you went, when, how it was, and who with.
// The record lives in localStorage like everything else; its photos are too
// big for that and live in IndexedDB (see photoStore.js), referenced here by id.
const TRIPS_KEY = 'crm-trips-v1';
// Been is a trip you took. Planned has somewhere to go and maybe dates;
// someday is a wish, with no dates at all.
const TRIP_STATUSES = ['been', 'planned', 'someday'];
// Set once the "this stays on this device" notice has been read.
const TRIPS_NOTICE_KEY = 'crm-trips-notice-v1';
const TRIP_STATS_KEY = 'crm-trip-stats-v1';
// Set once the offer to turn pinned events into trips has been answered.
const TRIPS_OFFER_KEY = 'crm-trips-events-offer-v1';
// When a backup file was last downloaded, to say how old the newest one is.
const BACKUP_AT_KEY = 'crm-backup-file-v1';

const TRIP_TITLE_CAP = 200;
const EXCERPT_CAP = 280;
const TRIP_NOTES_CAP = 20000;
const STOP_CAP = 50;
const PHOTO_CAP = 30;
const TAG_CAP = 20;

const toCoord = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const validLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const validLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;
const coordText = (lat, lng) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

const cleanStop = (raw) => {
  if (!isPlainObject(raw)) return null;
  const lat = toCoord(raw.lat);
  const lng = toCoord(raw.lng ?? raw.lon);
  if (!validLat(lat) || !validLng(lng)) return null;
  const displayAddress = clip(raw.displayAddress, 300);
  const name = clip(raw.name, 200) || clip(displayAddress.split(',')[0], 200) || coordText(lat, lng);
  return { name, displayAddress, lat: round6(lat), lng: round6(lng) };
};

const idList = (v, cap) => [...new Set((Array.isArray(v) ? v : [])
  .filter((x) => typeof x === 'string' && x && x.length <= 64))].slice(0, cap);

// Tags compare without case, and keep the spelling they were first given.
const cleanTags = (v) => {
  const seen = new Set();
  return (Array.isArray(v) ? v : []).map((x) => clip(x, 40)).filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, TAG_CAP);
};

const stampOr = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

// Every trip, typed in, saved, restored or shared, goes through here, so a
// hand-edited or hostile file can only ever produce a well-formed trip. A trip
// with no title, no usable place or no start date is not a trip: null.
const cleanTrip = (raw) => {
  if (!isPlainObject(raw)) return null;
  const title = clip(raw.title, TRIP_TITLE_CAP);
  const stops = (Array.isArray(raw.stops) ? raw.stops : []).map(cleanStop).filter(Boolean).slice(0, STOP_CAP);
  const status = TRIP_STATUSES.includes(raw.status) ? raw.status : 'been';
  let start = status !== 'someday' && isDay(raw.startDate) ? raw.startDate : null;
  let end = start && isDay(raw.endDate) ? raw.endDate : null;
  if (!title || !stops.length || (status === 'been' && !start)) return null;
  if (end && end < start) [start, end] = [end, start];
  if (end === start) end = null;
  const createdAt = stampOr(raw.createdAt) || new Date().toISOString();
  const trip = {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 64 ? raw.id : uid(),
    createdAt,
    updatedAt: stampOr(raw.updatedAt) || createdAt,
    title,
    stops,
    startDate: start,
    endDate: end,
    rating: status === 'been' && isRating(raw.rating) ? raw.rating : null,
    excerpt: clip(raw.excerpt, EXCERPT_CAP),
    notes: clip(raw.notes, TRIP_NOTES_CAP),
    companions: idList(raw.companions, 500),
    photoIds: idList(raw.photoIds, PHOTO_CAP),
    tags: cleanTags(raw.tags),
  };
  if (typeof raw.fromEvent === 'string' && raw.fromEvent) trip.fromEvent = raw.fromEvent.slice(0, 64);
  // Only a trip still to come says so, so every trip saved before plans
  // existed reads exactly as it did.
  if (status !== 'been') trip.status = status;
  return trip;
};

// A saved or restored list of trips: bad records dropped, repeated ids kept once.
const cleanTrips = (raw) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map(cleanTrip).filter((t) => {
    if (!t || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
};

const tripStatus = (t) => t.status || 'been';

// A trip to come with no dates yet says what it is instead.
const tripWhen = (t) => (t.startDate
  ? eventWhen({ date: t.startDate, endDate: t.endDate })
  : { text: tripStatus(t) === 'someday' ? 'Someday' : 'Dates to come', days: 0 });

// A planned trip whose dates have gone by: did it happen?
const tripOverdue = (t, today = todayStr()) => tripStatus(t) === 'planned' && Boolean(t.startDate)
  && (t.endDate || t.startDate) < today;

// Every year a trip touched, so New Year's in Lisbon counts for both.
const tripYears = (t) => {
  if (!t.startDate) return [];
  const a = Number(t.startDate.slice(0, 4));
  const b = t.endDate ? Number(t.endDate.slice(0, 4)) : a;
  const out = [];
  for (let y = a; y <= b && out.length < 50; y += 1) out.push(y);
  return out;
};

// Newest first: latest start, then the one written down last.
const sortTrips = (trips) => [...trips].sort((a, b) =>
  (b.startDate || '').localeCompare(a.startDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

// The trips in the three groups they show in: what is coming up (soonest
// first, undated last), where you have been (newest first), and someday.
const tripGroups = (trips) => {
  const of = (st) => trips.filter((t) => tripStatus(t) === st);
  return {
    planned: of('planned').sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999')
      || (a.createdAt || '').localeCompare(b.createdAt || '')),
    been: sortTrips(of('been')),
    someday: of('someday').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
  };
};

/* ---------- trips: counting ---------- */
// Only trips you took count. where(stop) gives { country, state } (see
// geo.js); until that has loaded it is null, and so are the counts that need it.

// Stops this close together are one place: a city, not every café in it.
const PLACE_KM = 15;
const kmApart = (a, b) => {
  const x = ((b.lng - a.lng) * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = ((b.lat - a.lat) * Math.PI / 180);
  return Math.sqrt(x * x + y * y) * 6371;
};

// The places been to, most visited first: [{ name, trips, last }]. A place
// is named by what its stops were called most often.
const tripPlaces = (trips) => {
  const groups = [];
  sortTrips(trips.filter((t) => !t.status)).forEach((t) => t.stops.forEach((st) => {
    let g = groups.find((x) => kmApart(x, st) <= PLACE_KM);
    if (!g) {
      g = { lat: st.lat, lng: st.lng, trips: new Set(), names: new Map(), last: t.startDate };
      groups.push(g);
    }
    g.trips.add(t.id);
    g.names.set(st.name, (g.names.get(st.name) || 0) + 1);
  }));
  return groups
    .map((g) => ({
      name: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      trips: g.trips.size,
      last: g.last,
    }))
    .sort((a, b) => b.trips - a.trips || b.last.localeCompare(a.last));
};

// Days spent on trips in a year, up to today, each day counted once however
// many trips it was part of.
const daysAway = (trips, year, today = todayStr()) => {
  const first = `${year}-01-01`;
  const last = `${year}-12-31` < today ? `${year}-12-31` : today;
  const days = new Set();
  trips.filter((t) => !t.status).forEach((t) => {
    const from = t.startDate > first ? t.startDate : first;
    const to = (t.endDate || t.startDate) < last ? (t.endDate || t.startDate) : last;
    for (let d = parseDate(from), n = 0; n < 370; d.setDate(d.getDate() + 1), n += 1) {
      const k = fmtDate(d);
      if (k > to) break;
      days.add(k);
    }
  });
  return days.size;
};

const whereAll = (trips, where) => {
  if (!where) return { countries: null, states: null };
  const countries = new Set();
  const states = new Set();
  trips.filter((t) => !t.status).forEach((t) => t.stops.forEach((st) => {
    const w = where(st);
    if (w.country) countries.add(w.country);
    if (w.state) states.add(w.state);
  }));
  return { countries, states };
};

// Everything the stats row shows.
const tripStats = (trips, where, year, today = todayStr()) => {
  const places = tripPlaces(trips);
  return {
    ...whereAll(trips, where),
    trips: trips.filter((t) => !t.status).length,
    places: places.length,
    top: places[0] && places[0].trips > 1 ? places[0] : null,
    days: daysAway(trips, year, today),
    year,
  };
};

// One year of trips, for Recap: the ones that touched it, what they added
// up to, the countries seen for the first time, and the best of them.
const tripYear = (trips, where, year, today = todayStr()) => {
  const been = trips.filter((t) => !t.status);
  const mine = sortTrips(been.filter((t) => tripYears(t).includes(year)));
  const { countries, states } = whereAll(mine, where);
  let firsts = null;
  if (countries) {
    const before = whereAll(been.filter((t) => t.startDate < `${year}-01-01`), where).countries;
    firsts = [...countries].filter((c) => !before.has(c)).sort();
  }
  const best = [...mine].sort((a, b) => (b.rating || 0) - (a.rating || 0)
    || tripWhen(b).days - tripWhen(a).days)[0] || null;
  return {
    trips: mine, countries, states, firsts, best,
    places: tripPlaces(mine).length,
    days: daysAway(mine, year, today),
  };
};

const NO_TRIP_FILTER = Object.freeze({ year: '', minRating: 0, companion: '', tag: '', status: '' });

const filterTrips = (trips, f) => trips.filter((t) =>
  (!f.status || tripStatus(t) === f.status)
  && (!f.year || tripYears(t).includes(Number(f.year)))
  && (!f.minRating || (t.rating || 0) >= f.minRating)
  && (!f.companion || t.companions.includes(f.companion))
  && (!f.tag || t.tags.some((g) => g.toLowerCase() === f.tag.toLowerCase())));

const tripFilterOptions = (trips) => ({
  years: [...new Set(trips.flatMap(tripYears))].sort((a, b) => b - a),
  companions: [...new Set(trips.flatMap((t) => t.companions))],
  tags: [...new Map(trips.flatMap((t) => t.tags).map((g) => [g.toLowerCase(), g])).values()]
    .sort((a, b) => SHELF.compare(a, b)),
});

// Pins on the map run from red for a trip you would not repeat to deep green
// for a favourite, with the rating written on each, so colour is never the
// only way to tell. A half star shares its whole star's colour (4.5 is a 4),
// and half a star counts with one. The white ring keeps them apart from light
// and dark tiles alike, so these do not change with the theme. Each carries
// white text at 4.5:1 or better.
const RATING_COLORS = ['#56655C', '#B42318', '#B04A0C', '#8A6208', '#2C7A3B', '#145A32'];
// Trips still to come are hollow pins: a solid ring for planned, a dashed one
// for someday.
const PLAN_COLORS = { planned: '#1F7A3A', someday: '#56655C' };
const ratingColor = (r) => (r ? RATING_COLORS[Math.max(1, Math.floor(r))] || RATING_COLORS[0] : RATING_COLORS[0]);

// One point per stop.
const tripPoints = (trips) => trips.flatMap((t) => t.stops.map((s, i) => ({
  key: `${t.id}:${i}`,
  tripId: t.id,
  stop: i,
  lat: s.lat,
  lng: s.lng,
  color: tripStatus(t) === 'been' ? ratingColor(t.rating) : PLAN_COLORS[tripStatus(t)],
  text: t.rating ? String(t.rating) : '',
  hollow: tripStatus(t) === 'been' ? '' : tripStatus(t),
  label: t.stops.length > 1 ? `${t.title}: ${s.name}` : t.title,
})));

// Records from a backup are matched to what is here by id, so restoring the
// same file twice adds nothing. A record only one side has is kept. When both
// have it, the one changed more recently wins if both say when; otherwise the
// one already here stays.
const mergeById = (have, incoming, stampOf) => {
  const byId = new Map(have.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  incoming.forEach((x) => {
    const mine = byId.get(x.id);
    if (!mine) {
      byId.set(x.id, x);
      added += 1;
      return;
    }
    const a = stampOf ? stampOf(mine) : '';
    const b = stampOf ? stampOf(x) : '';
    if (a && b && b > a) {
      byId.set(x.id, x);
      updated += 1;
    }
  });
  return { list: [...byId.values()], added, updated };
};

// A pinned event, as a trip. The event itself stays on the timeline.
const eventToTrip = (e) => cleanTrip({
  title: e.title,
  stops: [{ name: clip((e.place || '').split(',')[0], 200) || e.title, displayAddress: e.place || '', lat: e.lat, lng: e.lon }],
  startDate: e.date,
  endDate: e.endDate,
  notes: e.note || '',
  companions: e.people || [],
  rating: e.rating || null,
  tags: e.kind && e.kind !== 'Other' && e.kind !== 'Trip' ? [e.kind] : [],
  fromEvent: e.id,
});

/* ---------- trips: sharing ---------- */
// A trip is sent the way a person is (see "sharing a copy"): a compressed
// link, a QR code of it, or an .orbit file, all opening to a preview before
// anything is added. It carries the trip, never who went: that is yours, and
// their ids mean nothing on anyone else's Orbit. Notes only go when ticked.
// Photos only fit in the file, as JPEGs written out in base64.
const SHARE_PHOTO_CAP = 8 * 1024 * 1024;

const bytesToB64 = (bytes) => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
};
const b64ToBlob = (s) => {
  if (typeof s !== 'string' || !s || s.length > SHARE_PHOTO_CAP * 1.4 || !/^[A-Za-z0-9+/]+=*$/.test(s)) return null;
  try {
    return new Blob([Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' });
  } catch {
    return null;
  }
};

// photos: [{ blob, thumb, width, height }] to include, already read.
const tripSharePayload = async (t, { notes, by, photos = [], on = todayStr() }) => ({
  v: 2,
  t: 'trip',
  ...(by ? { by: clip(by, 60) } : {}),
  on,
  trip: {
    ti: t.title,
    s: t.stops.map((x) => [x.name, x.displayAddress, x.lat, x.lng]),
    ...(t.startDate ? { a: t.startDate } : {}),
    ...(t.endDate ? { b: t.endDate } : {}),
    ...(t.rating ? { r: t.rating } : {}),
    ...(t.status ? { st: t.status } : {}),
    ...(t.excerpt ? { x: t.excerpt } : {}),
    ...(notes && t.notes ? { n: t.notes } : {}),
    ...(t.tags.length ? { g: t.tags } : {}),
  },
  ...(photos.length ? {
    ph: await Promise.all(photos.map(async (p) => ({
      d: bytesToB64(new Uint8Array(await p.blob.arrayBuffer())),
      ...(p.thumb ? { th: bytesToB64(new Uint8Array(await p.thumb.arrayBuffer())) } : {}),
      ...(p.width ? { w: p.width, h: p.height } : {}),
    }))),
  } : {}),
});

// A trip arriving from someone else: always a new one, never tied to anyone here.
const sharedTrip = (raw) => {
  const t = cleanTrip({ ...raw, id: undefined, createdAt: undefined, updatedAt: undefined, fromEvent: undefined });
  return t ? { ...t, companions: [], photoIds: [] } : null;
};

const readTripShare = (o) => {
  if (!isPlainObject(o) || o.v !== 2 || o.t !== 'trip' || !isPlainObject(o.trip)) return null;
  const r = o.trip;
  const trip = sharedTrip({
    title: r.ti,
    stops: (Array.isArray(r.s) ? r.s : []).filter(Array.isArray).map((x) => ({ name: x[0], displayAddress: x[1], lat: x[2], lng: x[3] })),
    startDate: r.a, endDate: r.b, rating: r.r, status: r.st, excerpt: r.x, notes: r.n, tags: r.g,
  });
  if (!trip) return null;
  const photos = (Array.isArray(o.ph) ? o.ph : []).slice(0, PHOTO_CAP).filter(isPlainObject).map((p) => {
    const blob = b64ToBlob(p.d);
    if (!blob) return null;
    const w = Number.isInteger(p.w) && p.w > 0 ? p.w : null;
    return { blob, thumb: b64ToBlob(p.th), width: w, height: w && Number.isInteger(p.h) ? p.h : null };
  }).filter(Boolean);
  return { type: 'trip', by: clip(o.by, 60), on: isDay(o.on) ? o.on : null, trip, photos };
};

const tripText = (t, { notes }) => {
  const lines = [t.title, [tripWhen(t).text, t.rating ? stars(t.rating) : ''].filter(Boolean).join('  ')];
  lines.push(t.stops.map((s) => s.displayAddress || s.name).join('\n'));
  if (t.excerpt) lines.push(t.excerpt);
  if (notes && t.notes) lines.push(t.notes);
  if (t.tags.length) lines.push(t.tags.map((g) => `#${g.replace(/\s+/g, '')}`).join(' '));
  return lines.filter(Boolean).join('\n\n');
};

/* ---------- trips: files ---------- */
// Backups and trips shared with their photos are zip files: orbit.json with
// the records, and each photo as a JPEG beside it (full size and thumbnail).
// Photos are stored in the zip as they are; they are already compressed.
const PACKAGE_JSON = 'orbit.json';
const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const photoPath = (id, small) => `${small ? 'thumbs' : 'photos'}/${id}.jpg`;
// Nothing in a real file comes near these; a hostile one cannot use them to
// exhaust memory.
const ENTRY_CAP = 40 * 1024 * 1024;
const MANIFEST_CAP = 50 * 1024 * 1024;

const approxBytes = (n) => {
  if (n < 1000) return `${n} bytes`;
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
};

// manifest: the records, and a photos list of { id, ... }. load(id) gives
// { blob, thumb } for each photo, or null to leave it out. Returns a Blob.
const packZip = async (manifest, load, onProgress) => {
  const { Zip, ZipPassThrough, ZipDeflate, strToU8 } = await import('fflate');
  const chunks = [];
  let failed = null;
  const zip = new Zip((err, chunk) => {
    if (err) failed = err;
    else chunks.push(chunk);
  });
  const put = (name, bytes, squeeze) => {
    const entry = squeeze ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  };
  const kept = [];
  const photos = manifest.photos || [];
  for (let i = 0; i < photos.length; i += 1) {
    const p = photos[i];
    const got = PHOTO_ID.test(p.id || '') ? await load(p.id) : null;
    if (got?.blob) {
      put(photoPath(p.id), new Uint8Array(await got.blob.arrayBuffer()));
      if (got.thumb) put(photoPath(p.id, true), new Uint8Array(await got.thumb.arrayBuffer()));
      kept.push(got.width ? { ...p, width: got.width, height: got.height } : p);
    }
    onProgress?.(i + 1, photos.length);
  }
  put(PACKAGE_JSON, strToU8(JSON.stringify({ ...manifest, photos: kept })), true);
  zip.end();
  if (failed) throw failed;
  return new Blob(chunks, { type: 'application/zip' });
};

// bytes -> { manifest, photos: [{ id, blob, thumb, width, height, tripId }] }.
// A plain JSON file (a pasted-style backup saved to disk) reads too, without photos.
const unpackFile = async (bytes) => {
  const { unzipSync, strFromU8 } = await import('fflate');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes, {
      filter: (f) => f.originalSize <= (f.name === PACKAGE_JSON ? MANIFEST_CAP : ENTRY_CAP)
        && (f.name === PACKAGE_JSON || /^(photos|thumbs)\/[A-Za-z0-9_-]{1,64}\.jpg$/.test(f.name)),
    });
    if (!files[PACKAGE_JSON]) throw new Error('no manifest');
    const manifest = JSON.parse(strFromU8(files[PACKAGE_JSON]));
    const photos = (Array.isArray(manifest?.photos) ? manifest.photos : []).filter(isPlainObject).map((p) => {
      if (!PHOTO_ID.test(p.id || '') || !files[photoPath(p.id)]) return null;
      const small = files[photoPath(p.id, true)];
      return {
        id: p.id,
        tripId: typeof p.tripId === 'string' ? p.tripId.slice(0, 64) : '',
        blob: new Blob([files[photoPath(p.id)]], { type: 'image/jpeg' }),
        thumb: small ? new Blob([small], { type: 'image/jpeg' }) : null,
        width: fixNumber(p.width) ?? null,
        height: fixNumber(p.height) ?? null,
      };
    }).filter(Boolean);
    return { manifest, photos };
  }
  if (bytes.length > MANIFEST_CAP) throw new Error('too big');
  return { manifest: JSON.parse(new TextDecoder().decode(bytes)), photos: [] };
};

// What a backup holds, each kind of record checked the same way the pasted
// backup always has been. Older backups were a bare array of people.
const backupParts = (parsed) => {
  const list = (k) => (Array.isArray(parsed) ? [] : Array.isArray(parsed?.[k]) ? parsed[k] : []);
  const rawPeople = Array.isArray(parsed) ? parsed : parsed?.people;
  if (!Array.isArray(rawPeople) && !isPlainObject(parsed)) throw new Error('not a backup');
  return {
    people: cleanAll((Array.isArray(rawPeople) ? rawPeople : []).filter((r) => r && typeof r.name === 'string' && r.name.trim()), cleanPerson)
      .map((r) => ({ ...r, id: r.id || uid() })),
    events: cleanAll(list('events').filter((e) => e && e.title && e.date), cleanEvent).map((e) => ({ ...e, id: e.id || uid() })),
    reminders: cleanAll(list('reminders').filter((r) => r && r.title && r.next), cleanReminder).map((r) => ({ ...r, id: r.id || uid() })),
    collections: cleanCollections(list('collections')),
    trips: cleanTrips(list('trips')),
  };
};

// A file picked under Restore. Throws an Error whose message can be shown.
const readBackupFile = async (file) => {
  let got;
  try {
    got = await unpackFile(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('That file could not be read as an Orbit backup. Pick the .zip Orbit saved, as it was downloaded.');
  }
  if (got.manifest?.orbit === 'share') {
    throw new Error('That is something shared with you, not a backup. Open it from Import, under Open something shared with you.');
  }
  let parts;
  try {
    parts = backupParts(got.manifest);
  } catch {
    throw new Error('That file could not be read as an Orbit backup.');
  }
  if (Object.values(parts).every((x) => x.length === 0)) throw new Error('That backup has nothing in it.');
  return { parts, photos: got.photos };
};

const downloadBlob = (name, blob) => {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
};

/* ---------- events ---------- */
const EVENTS_KEY = 'crm-events-v1';
const EVENT_KINDS = ['Milestone', 'Trip', 'Celebration', 'Concert', 'Sports', 'Theater', 'Festival', 'Work', 'Loss', 'Other'];
// Things you went to, rather than things that happened: these can be rated
// once they have happened, and are what Recap counts as the year's outings.
const OUTING_KINDS = ['Concert', 'Sports', 'Theater', 'Festival'];
const RATED_EVENT_KINDS = [...OUTING_KINDS, 'Trip', 'Celebration', 'Other'];
const canRateEvent = (kind, date, today = todayStr()) => RATED_EVENT_KINDS.includes(kind) && Boolean(date) && date <= today;

const eventYear = (e) => Number(e.date.slice(0, 4));

// One date, or a span. Collapses the repeated parts: "Jun 3–10, 2026".
const eventWhen = (e) => {
  const end = e.endDate && e.endDate !== e.date ? e.endDate : null;
  if (!end) return { text: prettyDate(e.date), days: 1 };

  const a = parseDate(e.date);
  const b = parseDate(end);
  const days = Math.round((b - a) / 86400000) + 1;

  let text;
  if (a.getFullYear() !== b.getFullYear()) {
    text = `${formatDay(a, 'full')} – ${formatDay(b, 'full')}`;
  } else if (a.getMonth() === b.getMonth()) {
    text = `${formatDay(a, 'monthDay')}–${b.getDate()}, ${a.getFullYear()}`;
  } else {
    text = `${formatDay(a, 'monthDay')} – ${formatDay(b, 'monthDay')}, ${a.getFullYear()}`;
  }
  return { text, days };
};

function EventForm({ initial, people, onSave, onCancel, catalog = null }) {
  const [date, setDate] = useState(initial?.date || todayStr());
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [spans, setSpans] = useState(Boolean(initial?.endDate && initial.endDate !== initial.date));
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState(initial?.kind || 'Milestone');
  const [note, setNote] = useState(initial?.note || '');
  const [rating, setRating] = useState(initial?.rating || null);
  const [links, setLinks] = useState(() => cleanLinks(initial?.links));
  const [review, setReview] = useState(initial?.review || '');
  const [visibility, setVisibility] = useState(initial?.visibility || 'friends');
  const [who, setWho] = useState(initial?.people || []);
  const [place, setPlace] = useState(initial?.place || '');
  const [coords, setCoords] = useState(
    // A pin needs both halves. One on its own (a sheet with only a latitude
    // column) counts as no pin, rather than being drawn and crashing on the
    // missing half.
    typeof initial?.lat === 'number' && typeof initial?.lon === 'number' ? { lat: initial.lat, lon: initial.lon } : null);
  const [looking, setLooking] = useState('');
  const [hits, setHits] = useState([]);
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState('');

  const findPlace = async () => {
    const q = place.trim();
    if (!q) return;
    setLooking('searching');
    setHits([]);
    const { status, results } = await searchPlaces(q);
    setHits(results);
    setLooking(status === 'ok' ? 'picking' : status);
  };

  const choose = (r) => {
    setCoords({ lat: r.lat, lon: r.lon });
    setPlace(r.label);
    setHits([]);
    setLooking('found');
  };

  const toggle = (id) =>
    setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);

  const shown = people.filter((x) =>
    !filter.trim() || x.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const save = () => {
    const t = title.trim();
    if (!t || !date) return;
    let start = date;
    let finish = spans && endDate ? endDate : null;
    if (finish && finish < start) [start, finish] = [finish, start];
    if (finish === start) finish = null;
    onSave({
      id: initial?.id || uid(),
      addedOn: initial?.addedOn || todayStr(),
      date: start, endDate: finish, title: t, kind, note: note.trim(), people: who,
      rating: canRateEvent(kind, start) ? rating : null,
      // Only an outing links to the catalog, and only one that has happened
      // has thoughts to share.
      links: LINKS_FOR[kind] ? cleanLinks(links) : [],
      review: LINKS_FOR[kind] && start <= todayStr() ? review.trim().slice(0, 2000) : '',
      visibility: LINKS_FOR[kind] ? visibility : 'me',
      place: place.trim(),
      lat: coords ? coords.lat : null,
      lon: coords ? coords.lon : null,
    });
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <Field label="What happened">
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Dana and Sam got married" />
      </Field>

      <Group label="When">
        <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
          {[[false, 'One day'], [true, 'Over several days']].map(([v, l]) => (
            <button key={l} className="crm-btn" onClick={() => setSpans(v)} style={segment(spans === v)}>{l}</button>
          ))}
        </div>

        {spans ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 138px' }}>
              <span style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>Started</span>
              <input type="date" style={inputStyle} value={date} aria-label="Started"
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 138px' }}>
              <span style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>Ended</span>
              <input type="date" style={inputStyle} value={endDate} min={date} aria-label="Ended"
                onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        ) : (
          <input type="date" style={inputStyle} value={date} aria-label="When"
            onChange={(e) => setDate(e.target.value)} />
        )}
      </Group>

      <Field label="Kind">
        <select className="crm-select" style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)}>
          {EVENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>

      {catalog && LINKS_FOR[kind] && (
        <>
          <CatalogPicker api={catalog} kind={LINKS_FOR[kind].kind} label={LINKS_FOR[kind].label} ph={LINKS_FOR[kind].ph}
            many={LINKS_FOR[kind].many} value={links.filter((l) => l.kind !== 'venue')}
            onChange={(ls) => setLinks([...ls, ...links.filter((l) => l.kind === 'venue')])} />
          <CatalogPicker api={catalog} kind="venue" label="Venue" ph="Search for a stadium, arena, theatre or club"
            value={links.filter((l) => l.kind === 'venue')}
            onChange={(ls) => {
              setLinks([...links.filter((l) => l.kind !== 'venue'), ...ls]);
              if (ls[0] && !place.trim()) setPlace(ls[0].name);
            }} />
        </>
      )}

      {canRateEvent(kind, date) && <StarInput label="How was it?" value={rating} onChange={setRating} />}

      {catalog && LINKS_FOR[kind] && date && date <= todayStr() && (
        <>
          <Field label="Your thoughts">
            <textarea className="crm-serif" maxLength={2000} value={review} onChange={(e) => setReview(e.target.value)}
              style={{ ...inputStyle, minHeight: 80, resize: 'vertical', lineHeight: 1.55 }}
              placeholder="What was it like? This goes with your rating." />
          </Field>
          <Group label="Who sees your rating and thoughts">
            <div style={{ display: 'flex', gap: 8 }}>
              {OUTING_VISIBILITY.map(([v, l]) => (
                <button key={v} type="button" className="crm-btn" aria-pressed={visibility === v} onClick={() => setVisibility(v)} style={segment(visibility === v)}>{l}</button>
              ))}
            </div>
            <span style={hintStyle()}>
              {visibility === 'me' ? 'Kept to yourself.'
                : !links.length ? `Link ${LINKS_FOR[kind].kind === 'team' ? 'a team' : `a ${LINKS_FOR[kind].kind}`} or a venue above to share it on ${visibility === 'everyone' ? 'their pages' : 'their pages, for friends'}.`
                : `Shows on the pages of what it links to, for ${visibility === 'everyone' ? 'everyone in Orbit' : 'your friends'}, with your username.`}
              {' '}Who you went with and the details below are never shared.
            </span>
          </Group>
        </>
      )}

      <Field label="Where">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, width: 'auto', flex: 1 }}
            value={place}
            onChange={(e) => { setPlace(e.target.value); setCoords(null); setLooking(''); setHits([]); }}
            onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); findPlace(); } }}
            placeholder="Cincinnati, Ohio"
          />
          <Button onClick={findPlace}>Find</Button>
        </div>

        {hits.length > 0 && (
          <div style={{
            marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden',
          }}>
            {hits.map((r, i) => (
              <button
                key={`${r.lat}-${r.lon}-${i}`}
                className="crm-btn"
                onClick={() => choose(r)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                  fontSize: 13.5, color: C.ink, cursor: 'pointer', padding: '10px 12px',
                  background: C.surface, border: 'none',
                  borderTop: i ? `1px solid ${C.line}` : 'none',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
          {looking === 'searching' ? 'Looking it up…'
            : coords ? `Pinned at ${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}.`
            : looking === 'picking' ? 'Pick the right one.'
            : looking === 'none' ? 'No match. Check the spelling, or try just the city on its own.'
            : looking === 'offline' ? 'Could not reach the place search from here. Enter the coordinates below instead.'
            : 'Optional. Hit Find to drop a pin, or leave it as plain text.'}
        </span>

        {!manual ? (
          <button
            className="crm-btn"
            onClick={() => setManual(true)}
            style={{
              font: 'inherit', fontSize: 12, color: C.muted, background: 'transparent',
              border: 'none', padding: '4px 0 0', cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Enter coordinates myself
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              type="number" step="any" placeholder="Latitude"
              value={coords ? coords.lat : ''}
              onChange={(e) => setCoords({ lat: Number(e.target.value), lon: coords ? coords.lon : 0 })}
              style={{ ...inputStyle, width: 'auto', flex: '1 1 130px', minHeight: 38, fontSize: 14 }}
            />
            <input
              type="number" step="any" placeholder="Longitude"
              value={coords ? coords.lon : ''}
              onChange={(e) => setCoords({ lat: coords ? coords.lat : 0, lon: Number(e.target.value) })}
              style={{ ...inputStyle, width: 'auto', flex: '1 1 130px', minHeight: 38, fontSize: 14 }}
            />
          </div>
        )}
      </Field>

      <Group label="Who was there">
        {people.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: C.faint }}>
            Nobody on your lists yet. Events work fine without people attached.
          </p>
        ) : (
          <>
            {people.length > 10 && (
              <input style={{ ...inputStyle, marginBottom: 8, minHeight: 38, fontSize: 14 }}
                value={filter} onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter names" placeholder="Filter names" />
            )}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              maxHeight: 150, overflowY: 'auto',
              border: `1px solid ${C.line}`, borderRadius: 8, padding: 9,
            }}>
              {shown.map((x) => {
                const on = who.includes(x.id);
                return (
                  <button
                    key={x.id}
                    className="crm-btn"
                    onClick={() => toggle(x.id)}
                    style={{
                      font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '5px 10px',
                      borderRadius: 20, cursor: 'pointer',
                      background: on ? C.accent : 'transparent',
                      border: `1px solid ${on ? C.accent : C.line}`,
                      color: on ? C.onAccent : C.muted,
                    }}
                  >
                    {x.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Group>

      <Field label="The details">
        <textarea
          className="crm-serif"
          style={{ ...inputStyle, minHeight: 110, resize: 'vertical', lineHeight: 1.6 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write as much as you want. This is the part you will be glad you kept."
        />
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button kind="solid" onClick={save} style={{ flex: 1 }}>
          {initial ? 'Save changes' : 'Add to the timeline'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EventCard({ e, people, onPerson, onEdit, onRemove, onCatalog }) {
  const [confirm, setConfirm] = useState(false);
  const attended = (e.people || []).map((id) => people.find((x) => x.id === id)).filter(Boolean);
  const when = eventWhen(e);

  return (
    <div style={{ display: 'flex', gap: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: C.accent, marginTop: 6 }} />
        <span style={{ flex: 1, width: 1, background: C.line, marginTop: 4 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: C.faint }}>{when.text}</span>
          {when.days > 1 && (
            <span style={{ fontSize: 12, color: C.faint }}>{when.days} days</span>
          )}
          <Stars n={e.rating} size={12.5} />
          {e.kind && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: C.muted,
              border: `1px solid ${C.line}`, borderRadius: 20, padding: '2px 8px',
            }}>{e.kind}</span>
          )}
        </div>

        <p style={{ margin: '5px 0 0', fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink }}>
          {e.title}
        </p>

        {e.links?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
            {e.links.map((l) => (onCatalog ? (
              <button key={l.id} className="crm-btn" onClick={() => onCatalog(l.id)} aria-label={`Open ${l.name}`}
                style={{ ...filterChip(false), padding: '3px 10px', fontSize: 12 }}>{l.name}</button>
            ) : (
              <span key={l.id} style={{ ...kindChip(), fontSize: 12 }}>{l.name}</span>
            )))}
          </div>
        )}

        {e.review && (
          <p className="crm-serif" style={{ margin: '7px 0 0', fontSize: 15, lineHeight: 1.6, color: C.ink }}>
            <span style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>
              {e.visibility === 'everyone' ? 'Shared with everyone' : e.visibility === 'friends' ? 'Shared with friends' : 'Your thoughts'}
            </span>
            {e.review}
          </p>
        )}

        {e.note && (
          <p className="crm-serif" style={{ margin: '7px 0 0', fontSize: 15, lineHeight: 1.6, color: C.ink }}>
            {e.note}
          </p>
        )}

        {e.place && (
          <p style={{ margin: '7px 0 0', fontSize: 12.5, color: C.muted }}>
            <span style={{ color: C.faint }}>At </span>{e.place}
          </p>
        )}

        {attended.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: C.muted }}>
            <span style={{ color: C.faint }}>With </span>
            {attended.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ', '}
                <button
                  className="crm-btn"
                  onClick={() => onPerson && onPerson(x.name)}
                  style={{
                    font: 'inherit', fontSize: 12.5, color: C.ink, background: 'transparent',
                    border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
                    textDecorationColor: C.line,
                  }}
                >{x.name}</button>
              </span>
            ))}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button onClick={onEdit} style={{ fontSize: 12.5, padding: '6px 11px' }}>Edit</Button>
          <Button
            kind="danger"
            onClick={() => (confirm ? onRemove() : setConfirm(true))}
            style={{ fontSize: 12.5, padding: '6px 8px' }}
          >
            {confirm ? 'Tap again to remove' : 'Remove'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventsView({ events, people, onAdd, onEdit, onRemove, onCatalog, onExplore }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('All');
  const [sort, setSort] = useState('newest');

  const nameOf = (id) => people.find((x) => x.id === id)?.name || '';

  const query = q.trim().toLowerCase();
  const matches = (e) =>
    `${e.title} ${e.note || ''} ${e.place || ''} ${e.kind || ''} ${(e.people || []).map(nameOf).join(' ')}`
      .toLowerCase()
      .includes(query);

  // Only offer filters that would actually return something.
  const kindsPresent = EVENT_KINDS.filter((k) => events.some((e) => e.kind === k));

  const shown = events
    .filter((e) => kind === 'All' || e.kind === kind)
    .filter((e) => !query || matches(e));

  const byAdded = sort === 'added';
  const sorted = [...shown].sort((a, b) => {
    if (byAdded) return (b.addedOn || '').localeCompare(a.addedOn || '');
    if (sort === 'oldest') return a.date < b.date ? -1 : 1;
    return a.date < b.date ? 1 : -1;
  });

  const narrowed = Boolean(query) || kind !== 'All';
  const years = byAdded ? [] : [...new Set(sorted.map(eventYear))];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>
          {events.length === 0
            ? 'Nothing on the timeline yet'
            : narrowed
            ? `${countThings(sorted.length, 'event', 'events')} ${sorted.length === 1 ? 'matches' : 'match'}`
            : `${countThings(events.length, 'event', 'events')} worth keeping`}
        </h1>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {onExplore && <Button onClick={onExplore}>Explore</Button>}
          <Button kind="solid" onClick={onAdd}>Add an event</Button>
        </div>
      </div>

      {events.length === 0 && <EmptySky />}

      <p style={{ margin: '0 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        {events.length === 0
          ? 'Weddings, moves, concerts, games, the trip you never want to forget.'
          : byAdded
          ? 'Most recently written down first.'
          : sort === 'oldest'
          ? 'Oldest first.'
          : 'Newest first.'}
      </p>

      {events.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              style={inputStyle}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles, notes, places, people"
            />
            {query && <Button onClick={() => setQ('')}>Clear</Button>}
          </div>

          <div style={{
            display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 22,
          }}>
            <button className="crm-btn" onClick={() => setKind('All')} style={filterChip(kind === 'All')}>
              All
            </button>
            {kindsPresent.map((k) => (
              <button key={k} className="crm-btn" onClick={() => setKind(k)} style={filterChip(kind === k)}>
                {k}
              </button>
            ))}
            <select
              className="crm-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              style={{
                ...inputStyle, width: 'auto', marginLeft: 'auto',
                minHeight: 34, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, color: C.muted,
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="added">Recently added</option>
            </select>
          </div>
        </>
      )}

      {events.length > 0 && sorted.length === 0 && (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: 0 }}>
          Nothing matches that. Try a looser search, or set the kind back to All.
        </p>
      )}

      {byAdded
        ? sorted.map((e) => (
            <EventCard key={e.id} e={e} people={people} onPerson={(n) => setQ(n)} onCatalog={onCatalog}
              onEdit={() => onEdit(e)} onRemove={() => onRemove(e.id)} />
          ))
        : years.map((y) => (
            <div key={y}>
              <p style={{
                margin: '0 0 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: C.faint,
              }}>{y}</p>
              {sorted.filter((e) => eventYear(e) === y).map((e) => (
                <EventCard key={e.id} e={e} people={people} onPerson={(n) => setQ(n)} onCatalog={onCatalog}
                  onEdit={() => onEdit(e)} onRemove={() => onRemove(e.id)} />
              ))}
            </div>
          ))}
    </div>
  );
}

/* ---------- the shared catalog ---------- */
const catalogKindWord = (k) => CATALOG_KINDS[k]?.one || k;
const ratingLine = (n, avg) => [n ? `${n} logged` : '', avg ? `★ ${Number(avg).toFixed(1)}` : ''].filter(Boolean).join(' · ');

// Finds entries of one kind in the shared catalog and on Wikidata; picking
// one links it, and anything neither has can be made in Orbit. value: the
// links of this kind already chosen.
function CatalogPicker({ api, kind, label, ph, many = false, value, onChange }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', orbit: [], wiki: [] });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const listId = useId();
  const term = q.trim().replace(/\s+/g, ' ');
  useEffect(() => {
    if (term.length < 2) return undefined;
    let live = true;
    // A pause in typing before asking, as place search does.
    const t = setTimeout(async () => {
      const [orbit, wiki] = await Promise.all([api.search(term, kind).catch(() => []), searchWikidata(term)]);
      if (live) setFound({ q: term, orbit, wiki });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [term, api, kind]);

  const showing = term.length >= 2 && found.q === term;
  const inOrbit = new Set(found.orbit.map((e) => `${e.source}:${e.source_id}`));
  const wiki = found.wiki.filter((e) => !inOrbit.has(`wikidata:${e.source_id}`));
  const exact = found.orbit.some((e) => e.name.toLowerCase() === term.toLowerCase());
  const chosen = new Set(value.map((l) => l.id));

  const pick = async (entry) => {
    setBusy(true);
    setProblem('');
    try {
      const e = entry.id ? entry : await api.add({ ...entry, kind });
      if (!e?.id) throw new Error('That could not be added.');
      track('catalog.link', { kind, source: entry.id ? 'orbit' : entry.source });
      const link = { id: e.id, kind: e.kind, name: e.name };
      if (!chosen.has(link.id)) onChange(many ? [...value, link] : [link]);
      setQ('');
    } catch (err) {
      setProblem(err?.message || 'That could not be added.');
    }
    setBusy(false);
  };

  const row = (key, onClick, name, about, extra) => (
    <button key={key} type="button" className="crm-btn" onClick={onClick} disabled={busy} style={{
      display: 'flex', gap: 10, alignItems: 'baseline', width: '100%', textAlign: 'left', font: 'inherit', color: C.ink,
      padding: '9px 12px', background: C.surface, border: 'none', borderTop: `1px solid ${C.line}`, cursor: 'pointer',
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{name}</span>
        {about && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 1 }}>{about}</span>}
      </span>
      {extra && <span style={{ fontSize: 11.5, color: C.faint, flexShrink: 0 }}>{extra}</span>}
    </button>
  );

  return (
    <div style={{ marginBottom: 14 }}>
      <span style={labelText()}>{label}</span>
      {value.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 7 }}>
          {value.map((l) => (
            <span key={l.id} style={{ ...filterChip(true), display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'default' }}>
              {l.name}
              <button type="button" className="crm-btn" aria-label={`Remove ${l.name}`} onClick={() => onChange(value.filter((x) => x.id !== l.id))}
                style={{ font: 'inherit', fontSize: 14, lineHeight: 1, padding: 0, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>×</button>
            </span>
          ))}
        </div>
      )}
      {(many || !value.length) && (
        <input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} aria-label={label} aria-controls={listId}
          placeholder={ph} autoComplete="off" />
      )}
      {showing && (
        <div id={listId} role="group" aria-label={`Matches for ${term}`} style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', marginBottom: 0 }}>
          <div style={{ marginTop: -1 }}>
            {found.orbit.filter((e) => !chosen.has(e.id)).map((e) => row(e.id, () => pick(e), e.name, e.about, ratingLine(e.outings, e.average) || 'In Orbit'))}
            {wiki.map((e) => row(e.source_id, () => pick(e), e.name, e.about, 'Wikidata'))}
            {!exact && row('new', () => pick({ source: 'orbit', name: term, about: '' }), `Add “${term}”`, `As a new ${catalogKindWord(kind)}, for anything the lists above do not have`)}
          </div>
        </div>
      )}
      {term.length >= 2 && !showing && <span style={hintStyle()}>Looking…</span>}
      {problem && <span role="alert" style={{ ...hintStyle(), color: C.overdue }}>{problem}</span>}
    </div>
  );
}

// Half-star bars, 0.5 to 5.
function RatingSpread({ spread }) {
  const most = Math.max(1, ...spread);
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }}>
      {spread.map((n, i) => (
        <div key={i} title={`${(i + 1) / 2} stars: ${n}`} style={{
          flex: 1, height: Math.max(3, (n / most) * 44), borderRadius: 2, background: C.soonBar, opacity: n ? 1 : 0.25,
        }} />
      ))}
    </div>
  );
}

// Explore: search the shared catalog, and each entry's page. trail is the
// entries opened in order; with none, it is the search.
function ExploreView({ api, trail, onOpen, onBack }) {
  const id = trail[trail.length - 1] || null;
  return (
    <div>
      <button className="crm-btn" onClick={onBack} style={{ ...textButton(), fontSize: 13.5, marginBottom: 14 }}>
        {id ? '← Back' : '← Events'}
      </button>
      {id ? <CatalogPage key={id} api={api} id={id} onOpen={onOpen} /> : <CatalogSearch api={api} onOpen={onOpen} />}
    </div>
  );
}

function CatalogSearch({ api, onOpen }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [found, setFound] = useState({ key: '', rows: [], problem: '' });
  const term = q.trim().replace(/\s+/g, ' ');
  const key = `${kind}:${term}`;
  useEffect(() => {
    if (term.length < 2) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.search(term, kind || null).then(
        (rows) => { if (live) { setFound({ key, rows, problem: '' }); track('explore.search', { kind: kind || 'all', found: rows.length }); } },
        (e) => { if (live) setFound({ key, rows: [], problem: e.message || 'The search did not work.' }); },
      );
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [term, kind, key, api]);
  const ready = term.length >= 2 && found.key === key;
  return (
    <div>
      <h1 style={{ margin: '0 0 6px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Explore</h1>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        Teams, artists, shows, festivals and venues people in Orbit have been to, with their ratings and what they thought.
      </p>
      <input style={{ ...inputStyle, marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalog"
        placeholder="Search for a team, artist, show or venue" />
      <div role="group" aria-label="Kind" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['', 'All'], ...Object.entries(CATALOG_KINDS).map(([k, w]) => [k, w.many[0].toUpperCase() + w.many.slice(1)])].map(([k, l]) => (
          <button key={k || 'all'} className="crm-btn" aria-pressed={kind === k} onClick={() => setKind(k)} style={filterChip(kind === k)}>{l}</button>
        ))}
      </div>
      {found.problem && ready && <p role="alert" style={{ fontSize: 13.5, color: C.overdue }}>{found.problem}</p>}
      {ready && !found.problem && !found.rows.length && (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55 }}>
          Nothing in Orbit by that name yet. Anything you link from an event (a team, an artist, a venue) shows up here.
        </p>
      )}
      {ready && found.rows.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '4px 15px' }}>
          {found.rows.map((e) => (
            <button key={e.id} className="crm-btn" onClick={() => onOpen(e.id)} style={{
              display: 'flex', gap: 10, alignItems: 'baseline', width: '100%', textAlign: 'left', font: 'inherit', color: C.ink,
              padding: '11px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`, cursor: 'pointer',
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{e.name}</span>
                {e.about && <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 1 }}>{e.about}</span>}
              </span>
              <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{ratingLine(e.outings, e.average)}</span>
              <span style={kindChip()}>{catalogKindWord(e.kind)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogPage({ api, id, onOpen, onPerson, canAct = true }) {
  const [page, setPage] = useState({ state: 'loading' });
  useEffect(() => {
    let live = true;
    api.page(id).then(
      (p) => {
        if (!live) return;
        setPage(p ? { state: 'ok', ...p } : { state: 'gone' });
        if (p) track('catalog.view', { kind: p.entry.kind, ratings: p.ratings, outings: p.outings.length });
      },
      (e) => { if (live) setPage({ state: 'failed', problem: e.message }); },
    );
    return () => { live = false; };
  }, [api, id]);
  if (page.state === 'loading') return <p style={{ fontSize: 14, color: C.muted }}>Loading…</p>;
  if (page.state !== 'ok') {
    return <p role="alert" style={{ fontSize: 14, color: C.muted }}>{page.state === 'gone' ? 'That is not in the catalog.' : page.problem || 'That page could not be loaded.'}</p>;
  }
  const { entry, ratings, average, spread, outings } = page;
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12 };
  return (
    <div>
      <span style={kindChip()}>{catalogKindWord(entry.kind)}</span>
      <h1 style={{ margin: '8px 0 4px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>{entry.name}</h1>
      {entry.about && <p style={{ margin: '0 0 6px', fontSize: 14, color: C.muted }}>{entry.about}</p>}
      {entry.source === 'wikidata' && (
        <a href={WIKIDATA.page(entry.source_id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: C.muted }}>On Wikidata</a>
      )}

      <div style={{ ...box, padding: 15, marginTop: 16, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        {ratings ? (
          <>
            <div>
              <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>{Number(average).toFixed(1)}</div>
              <div style={{ marginTop: 6 }}><Stars n={halfStep(average)} size={14} /></div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>{countThings(ratings, 'rating', 'ratings')} shared with everyone</div>
            </div>
            <div style={{ flex: '1 1 180px' }}><RatingSpread spread={spread} /></div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No ratings shared with everyone yet.</p>
        )}
      </div>

      <h2 style={{ margin: '22px 0 10px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>What people thought</h2>
      {!outings.length ? (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55 }}>
          Nobody you can see has logged this yet. Add an event and link it here to be the first.
        </p>
      ) : outings.map((o, i) => (
        <article key={`${o.by.username}-${o.date}-${i}`} style={{ ...box, padding: '13px 15px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {onPerson ? (
              <a href={profilePath(o.by.username)} onClick={(ev) => { ev.preventDefault(); onPerson(o.by.username); }}
                style={{ fontSize: 14, fontWeight: 600, color: C.ink, textDecoration: 'none' }}>{o.by.display_name}</a>
            ) : <span style={{ fontSize: 14, fontWeight: 600 }}>{o.by.display_name}</span>}
            <span style={{ fontSize: 12.5, color: C.faint }}>@{o.by.username}</span>
            {o.by.relation === 'self' && <span style={kindChip()}>You</span>}
            {o.by.relation === 'friends' && <span style={kindChip()}>Friend</span>}
            <span style={{ marginLeft: 'auto' }}><Stars n={o.rating} size={12.5} /></span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.muted }}>{o.title} · {prettyDate(o.date)}</p>
          {o.review && <p className="crm-serif" style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.6 }}>{o.review}</p>}
          {o.links.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
              {o.links.map((l) => (
                <button key={l.id} className="crm-btn" onClick={() => onOpen(l.id)} aria-label={`Open ${l.name}`}
                  style={{ ...filterChip(false), padding: '3px 10px', fontSize: 12 }}>{l.name}</button>
              ))}
            </div>
          )}
          <PostActions api={api} post={o} canAct={canAct} />
        </article>
      ))}
    </div>
  );
}

/* ---------- likes and comments ---------- */
// The heart and the comments under a shared outing or trip. post: { owner,
// post, ref, likes, liked, comments } as the server hands them out. canAct:
// signed in; otherwise the counts show, with a way in.
function PostActions({ api, post, canAct = true }) {
  const [likes, setLikes] = useState({ n: post.likes || 0, mine: Boolean(post.liked) });
  const [count, setCount] = useState(post.comments || 0);
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const name = useId();
  if (!post.owner || !post.ref) return null;

  const toggleLike = async () => {
    const was = likes;
    setLikes({ n: was.n + (was.mine ? -1 : 1), mine: !was.mine });
    setProblem('');
    try {
      const r = await api.like(post, !was.mine);
      setLikes({ n: r.likes, mine: r.liked });
      track(was.mine ? 'post.unlike' : 'post.like', { post: post.post });
    } catch (e) {
      setLikes(was);
      setProblem(e.message || 'That did not work.');
    }
  };
  const load = async () => {
    try {
      const t = await api.thread(post);
      if (!t) { setProblem('That is not there any more.'); return; }
      setThread(t);
      setCount(t.comments);
      setLikes({ n: t.likes, mine: t.liked });
    } catch (e) {
      setProblem(e.message || 'The comments could not be loaded.');
    }
  };
  const toggleOpen = () => {
    if (!open && !thread) load();
    setOpen(!open);
    if (!open) track('post.open_comments', { post: post.post });
  };
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const c = await api.comment(post, body);
      setThread((t) => ({ ...(t || { thread: [], likers: [] }), thread: [...(t?.thread || []), c] }));
      setCount((n) => n + 1);
      setDraft('');
      track('post.comment', { post: post.post, length: body.length });
    } catch (e) {
      setProblem(e.message || 'That comment did not post.');
    }
    setBusy(false);
  };
  const remove = async (id) => {
    try {
      await api.uncomment(id);
      setThread((t) => ({ ...t, thread: t.thread.filter((c) => c.id !== id) }));
      setCount((n) => Math.max(0, n - 1));
    } catch (e) {
      setProblem(e.message || 'That did not work.');
    }
  };
  const small = { font: 'inherit', fontSize: 12.5, fontWeight: 600, background: 'transparent', border: 'none', padding: '4px 2px', color: C.muted };

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {canAct ? (
          <button className="crm-btn" aria-pressed={likes.mine} onClick={toggleLike}
            aria-label={likes.mine ? `Unlike, ${likes.n} ${likes.n === 1 ? 'like' : 'likes'}` : `Like, ${likes.n} ${likes.n === 1 ? 'like' : 'likes'}`}
            style={{ ...small, cursor: 'pointer', color: likes.mine ? C.overdueBar : C.muted }}>
            <span aria-hidden="true">{likes.mine ? '♥' : '♡'}</span> {likes.n || ''}
          </button>
        ) : (
          <span style={small} aria-label={`${likes.n} ${likes.n === 1 ? 'like' : 'likes'}`}><span aria-hidden="true">♡</span> {likes.n || ''}</span>
        )}
        {canAct ? (
          <button className="crm-btn" aria-expanded={open} onClick={toggleOpen} style={{ ...small, cursor: 'pointer' }}>
            {count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Comment'}
          </button>
        ) : (
          <span style={small}>{count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : ''}</span>
        )}
        {!canAct && <a href={BASE} style={{ fontSize: 12, color: C.muted }}>Log in to like or comment</a>}
      </div>
      {problem && <p role="alert" style={{ margin: '4px 0 0', fontSize: 12.5, color: C.overdue }}>{problem}</p>}
      {open && canAct && (
        <div style={{ marginTop: 6 }}>
          {thread === null && !problem && <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>Loading…</p>}
          {thread?.likers?.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: C.muted }}>
              Liked by {thread.likers.slice(0, 3).map((l) => l.display_name).join(', ')}{thread.likers.length > 3 ? ` and ${thread.likers.length - 3} more` : ''}
            </p>
          )}
          {thread?.thread.map((c) => (
            <div key={c.id} style={{ padding: '6px 0', borderTop: `1px solid ${C.line}` }}>
              <p style={{ margin: 0, fontSize: 12.5, color: C.muted, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <a href={profilePath(c.by.username)} style={{ fontWeight: 600, color: C.ink, textDecoration: 'none' }}>{c.by.display_name}</a>
                <span style={{ color: C.faint }}>{ago(c.at)}</span>
                {c.can_delete && (
                  <button className="crm-btn" onClick={() => remove(c.id)} aria-label={`Delete ${c.mine ? 'your' : `${c.by.display_name}’s`} comment`}
                    style={{ ...textButton(), fontSize: 12, fontWeight: 500, marginLeft: 'auto', color: C.faint }}>Delete</button>
                )}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</p>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label htmlFor={name} className="crm-sr">Add a comment</label>
            <textarea id={name} rows={1} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (isEnter(e) && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Add a comment" style={{ ...inputStyle, minHeight: 38, fontSize: 14, resize: 'vertical', flex: 1 }} />
            <Button kind="solid" onClick={send} disabled={busy || !draft.trim()} style={{ fontSize: 13, padding: '7px 12px' }}>Post</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- the friends feed ---------- */
// How long ago something was shared, in words.
const ago = (at, now = Date.now()) => {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return formatDay(new Date(t), 'full');
};

// Runs of things one friend shared at once (a year of concerts linked in one
// go) are gathered, so they do not bury everyone else. Returns groups of
// consecutive items by the same person shared within two minutes of each
// other, in the feed's order.
const groupFeed = (items) => {
  const out = [];
  items.forEach((x) => {
    const last = out[out.length - 1];
    const prev = last?.items[last.items.length - 1];
    if (last && last.by.username === x.by.username && Math.abs(Date.parse(prev.at) - Date.parse(x.at)) <= 120000) {
      last.items.push(x);
    } else {
      out.push({ key: x.id, by: x.by, items: [x] });
    }
  });
  return out;
};
const GROUP_SHOWN = 3;

function FeedItem({ x, onCatalog, api }) {
  const trip = x.type === 'trip' ? pageTrip({ ...x, id: x.id }) : null;
  const verb = !trip && x.rating ? 'rated' : 'went to';
  return (
    <article style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 15px', marginBottom: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: C.muted, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <a href={profilePath(x.by.username)} style={{ fontWeight: 600, color: C.ink, textDecoration: 'none' }}>{x.by.display_name}</a>
        <span>{verb}</span>
        <span style={{ marginLeft: 'auto', color: C.faint, fontSize: 12 }}>{ago(x.at)}</span>
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 4 }}>
        <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-0.02em' }}>{x.title}</span>
        {!trip && <span style={kindChip()}>{x.kind}</span>}
        <span style={{ marginLeft: 'auto' }}><Stars n={x.rating} size={13} /></span>
      </div>
      <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.muted }}>
        {trip ? tripWhen(trip).text : prettyDate(x.date)}
        {trip && trip.stops.length > 0 && ` · ${[...new Set(trip.stops.map((st) => st.name).filter(Boolean))].join(' → ')}`}
      </p>
      {(x.review || x.highlight) && (
        <p className="crm-serif" style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.55 }}>{x.review || x.highlight}</p>
      )}
      {x.links?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
          {x.links.map((l) => (
            <button key={l.id} className="crm-btn" onClick={() => onCatalog(l.id)} aria-label={`Open ${l.name}`}
              style={{ ...filterChip(false), padding: '3px 10px', fontSize: 12 }}>{l.name}</button>
          ))}
        </div>
      )}
      <PostActions api={api} post={x} />
    </article>
  );
}

// What friends have shared, newest first, a page at a time. onSeen gets the
// newest item's time once it is showing.
function FeedView({ api, onCatalog, onSeen, onFriends }) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const PAGE = 30;
  useEffect(() => {
    let live = true;
    api.feed(null, PAGE).then(
      (rows) => {
        if (!live) return;
        setItems(rows);
        setMore(rows.length === PAGE);
        if (rows[0]) onSeen(rows[0].at);
        track('feed.view', { items: rows.length });
      },
      (e) => { if (live) { setItems([]); setProblem(e.message || 'The feed could not be loaded.'); } },
    );
    return () => { live = false; };
  }, [api, onSeen]);
  const loadMore = async () => {
    setBusy(true);
    try {
      const rows = await api.feed(items[items.length - 1], PAGE);
      track('feed.more', { shown: items.length });
      setItems([...items, ...rows]);
      setMore(rows.length === PAGE);
    } catch (e) {
      setProblem(e.message || 'More could not be loaded.');
    }
    setBusy(false);
  };
  const groups = useMemo(() => groupFeed(items || []), [items]);

  return (
    <div>
      <h1 style={{ margin: '0 0 6px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Feed</h1>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        The concerts, games and shows your friends went to, and the trips they have taken, as they share them.
      </p>
      {problem && <p role="alert" style={{ fontSize: 13.5, color: C.overdue }}>{problem}</p>}
      {items === null && <p style={{ fontSize: 14, color: C.muted }}>Loading…</p>}
      {items && items.length === 0 && !problem && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.55 }}>
            Nothing from friends yet. When a friend rates a concert or a game, or shows their trips, it appears here.
          </p>
          {onFriends && <Button kind="solid" onClick={onFriends}>Find friends</Button>}
        </div>
      )}
      {groups.map((g) => {
        const shown = open.has(g.key) ? g.items : g.items.slice(0, GROUP_SHOWN);
        const rest = g.items.length - shown.length;
        return (
          <div key={g.key}>
            {shown.map((x) => <FeedItem key={x.id} x={x} onCatalog={onCatalog} api={api} />)}
            {rest > 0 && (
              <button className="crm-btn" onClick={() => { track('feed.expand', { n: rest }); setOpen(new Set([...open, g.key])); }}
                style={{ ...textButton(), fontSize: 13, margin: '0 0 14px 4px' }}>
                {`${rest} more from ${g.by.display_name.split(' ')[0]}`}
              </button>
            )}
          </div>
        );
      })}
      {more && <Button onClick={busy ? undefined : loadMore}>{busy ? 'Loading…' : 'Load more'}</Button>}
    </div>
  );
}

/* ---------- usage report (Orbit's team only) ---------- */
// The parts of the app, as the report names them (the part of each action's
// name before the dot), in plain words.
const USAGE_AREAS = {
  app: 'Opening Orbit', view: 'Moving between tabs', person: 'People', catchup: 'Logging catch-ups', event: 'Events',
  reminder: 'Reminders', list: 'Lists', trip: 'Trips', recap: 'Recap and its card', share: 'Sending copies',
  catalog: 'The catalog', explore: 'Explore', feed: 'The feed', post: 'Likes and comments', friends: 'Friends',
  notify: 'Notifications', settings: 'Settings', profile: 'Their profile and page', page: 'Public pages', data: 'Import, export, backup',
};
const areaName = (a) => USAGE_AREAS[a] || a;
const shortDay = (d) => formatDay(parseDate(d), 'monthDay');

// Active people by day: one column per day, one colour. Hovering or
// focusing a day shows its numbers above; the table has them all.
function DailyActive({ rows }) {
  const [at, setAt] = useState(rows.length - 1);
  const [asTable, setAsTable] = useState(false);
  const most = Math.max(1, ...rows.map((r) => r.active));
  const r = rows[Math.min(at, rows.length - 1)] || rows[rows.length - 1];
  const H = 120;
  if (!rows.length) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Active people each day</p>
        <button className="crm-btn" onClick={() => setAsTable(!asTable)} style={{ ...textButton(), fontSize: 12.5, marginLeft: 'auto' }}>
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <UsageTable head={['Day', 'Active', 'New', 'Actions']} rows={[...rows].reverse().map((x) => [shortDay(x.day), x.active, x.joined, x.actions])} />
        </div>
      ) : (
        <>
          <p aria-live="polite" style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>
            <strong style={{ fontSize: 16, color: C.ink }}>{r.active}</strong> active on {shortDay(r.day)}
            {` · ${r.joined} new · ${r.actions} actions`}
          </p>
          <div style={{ position: 'relative', height: H, display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: `1px solid ${C.line}` }}>
            <span aria-hidden="true" style={{ position: 'absolute', top: -2, left: 0, fontSize: 11, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{most}</span>
            {rows.map((x, i) => (
              <button key={x.day} className="crm-btn" onMouseEnter={() => setAt(i)} onFocus={() => setAt(i)}
                aria-label={`${shortDay(x.day)}: ${x.active} active, ${x.joined} new, ${x.actions} actions`}
                style={{ flex: '1 1 0', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'transparent', border: 'none', padding: 0, cursor: 'default', minWidth: 0 }}>
                <span style={{
                  display: 'block', width: '100%', maxWidth: 24, height: Math.max(x.active ? 3 : 1, (x.active / most) * (H - 14)),
                  background: x.active ? C.accentDeep : C.line, borderRadius: '4px 4px 0 0', opacity: i === at ? 1 : 0.78,
                }} />
              </button>
            ))}
          </div>
          <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.faint, marginTop: 5 }}>
            <span>{shortDay(rows[0].day)}</span><span>{shortDay(rows[rows.length - 1].day)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function UsageTable({ head, rows, bar }) {
  const cell = { padding: '7px 8px', borderBottom: `1px solid ${C.line}`, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{head.map((h, i) => <th key={h} scope="col" style={{ ...cell, textAlign: i ? 'right' : 'left', color: C.muted, fontWeight: 600, fontSize: 12 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, j) => (
          <tr key={j}>
            {r.map((v, i) => (
              <td key={i} style={{ ...cell, textAlign: i ? 'right' : 'left', color: C.ink }}>
                {i === 0 && bar ? (
                  <span style={{ display: 'block' }}>
                    {v}
                    <span aria-hidden="true" style={{ display: 'block', height: 4, marginTop: 4, borderRadius: 2, background: C.line }}>
                      <span style={{ display: 'block', height: 4, borderRadius: 2, width: `${Math.max(0, Math.min(100, bar(j)))}%`, background: C.accentDeep }} />
                    </span>
                  </span>
                ) : v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UsageView({ api }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [problem, setProblem] = useState('');
  const [allActions, setAllActions] = useState(false);
  useEffect(() => {
    let live = true;
    api.report(days).then((r) => { if (live) { setReport(r); setProblem(''); } }, (e) => { if (live) setProblem(e.message || 'The report could not be loaded.'); });
    return () => { live = false; };
  }, [api, days]);
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, marginBottom: 12 };
  const head = (t, sub) => (
    <>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t}</p>
      {sub && <p style={{ margin: '3px 0 8px', fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{sub}</p>}
    </>
  );
  const pct = (n) => `${n}%`;
  const t = report?.totals;
  return (
    <div style={{ opacity: report || problem ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Usage</h1>
        <div role="group" aria-label="Window" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {[7, 30, 90].map((d) => (
            <button key={d} className="crm-btn" aria-pressed={days === d} onClick={() => setDays(d)} style={filterChip(days === d)}>{d} days</button>
          ))}
        </div>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
        What people do in Orbit, as counts: never what they wrote. People who turned usage counts off are not in it.
      </p>
      {problem && <p role="alert" style={{ fontSize: 13.5, color: C.overdue }}>{problem}</p>}
      {!report && !problem && <p style={{ fontSize: 14, color: C.muted }}>Loading…</p>}
      {report && (
        <>
          <div role="region" aria-label="Headline numbers" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <Stat n={t.active_today} label="active today" tone={C.accentDeep} />
            <Stat n={t.active_week} label="active in the last 7 days" />
            <Stat n={t.active} label={`active in ${report.days} days`} />
            <Stat n={t.people} label="people in all" />
            <Stat n={t.joined} label={`joined in ${report.days} days`} />
            <Stat n={t.visits} label="visits from people signed out" />
          </div>

          <DailyActive rows={report.daily} />

          <div style={card}>
            {head('Parts of the app', 'How many of the people active in this window used each part.')}
            <UsageTable head={['Part', 'Of active people', 'People', 'Actions']} bar={(j) => report.areas[j].share}
              rows={report.areas.map((a) => [areaName(a.area), pct(a.share), a.people, a.actions])} />
          </div>

          <div style={card}>
            {head('What engaged people rely on', `Heavy: active on 8 or more days in this window (${report.heavy.heavy_people} people). Light: fewer (${report.heavy.light_people}). A part far more used by heavy people is a good candidate to build on, or to charge for.`)}
            <UsageTable head={['Part', 'Heavy', 'Light']}
              rows={report.heavy.areas.map((a) => [areaName(a.area), pct(a.heavy), pct(a.light)])} />
          </div>

          <div style={card}>
            {head('How often people come back', 'People by the number of days they were active in this window.')}
            <UsageTable head={['Days active', 'People']} rows={Object.entries(report.depth).map(([k, v]) => [k === '1' ? '1 day' : `${k} days`, v])} />
          </div>

          <div style={card}>
            {head('Do new people stay?', 'People by the week they joined, and how many came back 1–7, 8–14 and 22–28 days later.')}
            <UsageTable head={['Joined', 'People', 'Week 1', 'Week 2', 'Week 4']}
              rows={report.cohorts.map((c) => [`Week of ${shortDay(c.week)}`, c.joined, c.week1, c.week2, c.week4])} />
          </div>

          <div style={card}>
            {head('Tabs opened')}
            <UsageTable head={['Tab', 'Opens', 'People']} rows={report.views.map((v) => [v.view || '?', v.count, v.people])} />
          </div>

          <div style={card}>
            {head('Public pages', 'Views of people’s pages and catalog pages, and whether visitors go on to join.')}
            <UsageTable head={['', 'Count']} rows={[
              ['Page views', report.public.views], ['Visitors signed out', report.public.visitors],
              ['“Join Orbit” clicks', report.public.join_clicks], ['New accounts in this window', report.public.joined],
            ]} />
          </div>

          <div style={card}>
            {head('Devices', 'Each time Orbit was opened.')}
            <UsageTable head={['Device', 'From the Home Screen', 'Opens']}
              rows={report.devices.map((d) => [d.device, d.installed ? 'Yes' : 'No', d.opens])} />
          </div>

          <div style={card}>
            {head('Every action', 'Each thing counted, most frequent first.')}
            <UsageTable head={['Action', 'Times', 'People']}
              rows={(allActions ? report.actions : report.actions.slice(0, 15)).map((a) => [a.name, a.count, a.people])} />
            {report.actions.length > 15 && (
              <button className="crm-btn" onClick={() => setAllActions(!allActions)} style={{ ...textButton(), fontSize: 13, marginTop: 10 }}>
                {allActions ? 'Show fewer' : `Show all ${report.actions.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- public pages ---------- */
// A shared trip as the rest of the app knows trips, so the same map, dates
// and stars work on it.
const pageTrip = (t) => ({
  id: t.id, title: t.title, startDate: t.start, endDate: t.end || null, rating: t.rating || null, excerpt: t.highlight || '',
  notes: '', companions: [], photoIds: [], tags: [],
  stops: (t.stops || []).map((st) => ({ name: st.name, displayAddress: '', lat: st.lat, lng: st.lng, country: st.country, state: st.state })),
});

// The numbers across the top of a page: trips, countries, US states, days
// away and places from the trips shown; the outings by kind.
const pageStats = (trips, outings, year = null) => {
  const stops = trips.flatMap((t) => t.stops);
  const countries = new Set(stops.map((st) => st.country).filter(Boolean));
  const states = new Set(stops.filter((st) => st.country === 'United States').map((st) => st.state).filter(Boolean));
  const days = year ? daysAway(trips, year) : trips.reduce((n, t) => n + tripWhen(t).days, 0);
  const word = (n, one, many) => (n === 1 ? one : many);
  return [
    { n: trips.length, label: word(trips.length, 'trip', 'trips') },
    { n: countries.size, label: word(countries.size, 'country', 'countries') },
    { n: states.size, label: word(states.size, 'US state', 'US states') },
    { n: days, label: word(days, 'day away', 'days away') },
    ...OUTING_KINDS.map((k) => {
      const n = outings.filter((o) => o.kind === k).length;
      return { n, label: OUTING_WORDS[k][n === 1 ? 0 : 1] };
    }),
  ].filter((x) => x.n > 0);
};

// Someone's page. go(path) moves to another public page.
function ProfilePage({ api, username, year, go, signedIn }) {
  const [page, setPage] = useState({ state: 'loading' });
  const [said, setSaid] = useState('');
  useEffect(() => {
    let live = true;
    api.profile(username, year).then(
      (p) => { if (live) setPage(p ? { state: 'ok', ...p } : { state: 'gone' }); },
      (e) => { if (live) setPage({ state: 'failed', problem: e.message }); },
    );
    return () => { live = false; };
  }, [api, username, year]);
  const trips = useMemo(() => (page.trips || []).map(pageTrip), [page.trips]);
  const points = useMemo(() => tripPoints(trips), [trips]);
  const pr = page.profile;
  useEffect(() => {
    if (pr) document.title = `${pr.display_name} (@${pr.username})${year ? ` · ${year}` : ''} · Orbit`;
  }, [pr, year]);

  if (page.state === 'loading') return <p style={{ fontSize: 14, color: C.muted }}>Loading…</p>;
  if (page.state === 'gone') {
    return (
      <div>
        <h1 style={{ margin: '0 0 8px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Nobody here by that name</h1>
        <p style={{ fontSize: 14, color: C.muted }}>There is no page for @{username}. Check the link.</p>
      </div>
    );
  }
  if (page.state !== 'ok') return <p role="alert" style={{ fontSize: 14, color: C.muted }}>{page.problem || 'That page could not be loaded.'}</p>;

  const link = pageUrl(profilePath(pr.username, year));
  const copy = async () => {
    track('page.copy_link', { own: pr.relation === 'self' });
    try { await navigator.clipboard.writeText(link); setSaid('Link copied.'); } catch { setSaid(link); }
  };
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12 };
  const head = (
    <header style={{ marginBottom: 18 }}>
      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.04em' }}>{pr.display_name}</h1>
      <p style={{ margin: '3px 0 0', fontSize: 14, color: C.muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span>@{pr.username}</span>
        {pr.pronouns && <span>{pr.pronouns}</span>}
        {pr.location && <span>{pr.location}</span>}
        {pr.relation === 'self' && <span style={kindChip()}>You</span>}
        {pr.relation === 'friends' && <span style={kindChip()}>Friend</span>}
      </p>
      {pr.bio && <p className="crm-serif" style={{ margin: '10px 0 0', fontSize: 15.5, lineHeight: 1.55 }}>{pr.bio}</p>}
      {pr.website && safeLink(pr.website) && (
        <a href={safeLink(pr.website)} target="_blank" rel="noopener noreferrer nofollow" style={{ display: 'inline-block', marginTop: 8, fontSize: 13, color: C.muted }}>
          {safeLink(pr.website).replace(/^https?:\/\//, '')}
        </a>
      )}
    </header>
  );

  if (page.hidden) {
    return (
      <div>
        {head}
        <div style={{ ...box, padding: 16 }}>
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55 }}>
            {pr.display_name.split(' ')[0]}’s page is only for people signed in to Orbit.
          </p>
          <a href={BASE} onClick={() => { track('page.join', { where: 'hidden' }); flushUsage(); }} style={{ ...solidLink(), display: 'inline-block' }}>Log in or join Orbit</a>
        </div>
      </div>
    );
  }

  const stats = pageStats(trips, page.outings, year);
  const nothing = !trips.length && !page.outings.length;
  return (
    <div>
      {head}
      {(page.years.length > 0 || year) && (
        <nav aria-label="Years" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {[null, ...[...new Set([...page.years, ...(year ? [year] : [])])].sort((a, b) => b - a)].map((y) => (
            <a key={y ?? 'all'} href={profilePath(pr.username, y)} aria-current={y === year ? 'page' : undefined}
              onClick={(ev) => { ev.preventDefault(); go(profilePath(pr.username, y)); }}
              style={{ ...filterChip(y === year), textDecoration: 'none', display: 'inline-block' }}>{y ?? 'All time'}</a>
          ))}
        </nav>
      )}

      {nothing ? (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55 }}>
          {year ? `Nothing shared from ${year}.` : 'Nothing shared here yet.'}
        </p>
      ) : (
        <>
          {stats.length > 0 && (
            <div role="region" aria-label="Numbers" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              {stats.map((x, i) => <Stat key={x.label} n={x.n} label={x.label} tone={i === 0 ? C.accentDeep : undefined} />)}
            </div>
          )}

          {points.length > 0 && (
            <div style={{ ...mapFrame(), marginBottom: 12 }}>
              <MapSlot height={300} render={(m) => (
                <m.TripsMap points={points} height={300} dark={C.dark} renderPopup={(p) => {
                  const t = trips.find((x) => x.id === p.tripId);
                  return t ? <TripPopup trip={t} stop={p.stop} onOpen={() => document.getElementById(`trip-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} /> : null;
                }} />
              )} />
            </div>
          )}

          {trips.length > 0 && (
            <section aria-labelledby="page-trips" style={{ marginTop: 20 }}>
              <h2 id="page-trips" style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>Trips</h2>
              {trips.map((t) => (
                <article key={t.id} id={`trip-${t.id}`} style={{ ...box, padding: '12px 15px' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>{t.title}</span>
                    <span style={{ marginLeft: 'auto' }}><Stars n={t.rating} size={12.5} /></span>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.muted }}>
                    {tripWhen(t).text}
                    {t.stops.length > 0 && ` · ${[...new Set(t.stops.map((st) => st.name).filter(Boolean))].join(' → ')}`}
                  </p>
                  {t.excerpt && <p className="crm-serif" style={{ margin: '7px 0 0', fontSize: 15, lineHeight: 1.55 }}>{t.excerpt}</p>}
                  <PostActions api={api} post={page.trips.find((x) => x.id === t.id) || {}} canAct={signedIn} />
                </article>
              ))}
            </section>
          )}

          {page.outings.length > 0 && (
            <section aria-labelledby="page-outings" style={{ marginTop: 20 }}>
              <h2 id="page-outings" style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>Concerts, games and shows</h2>
              {page.outings.map((o) => (
                <article key={o.id} style={{ ...box, padding: '12px 15px' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>{o.title}</span>
                    <span style={kindChip()}>{o.kind}</span>
                    <span style={{ marginLeft: 'auto' }}><Stars n={o.rating} size={12.5} /></span>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.muted }}>{prettyDate(o.date)}</p>
                  {o.review && <p className="crm-serif" style={{ margin: '7px 0 0', fontSize: 15, lineHeight: 1.55 }}>{o.review}</p>}
                  {o.links.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                      {o.links.map((l) => (
                        <a key={l.id} href={catalogPath(l.id)} onClick={(ev) => { ev.preventDefault(); go(catalogPath(l.id)); }}
                          style={{ ...filterChip(false), padding: '3px 10px', fontSize: 12, textDecoration: 'none', display: 'inline-block' }}>{l.name}</a>
                      ))}
                    </div>
                  )}
                  <PostActions api={api} post={o} canAct={signedIn} />
                </article>
              ))}
            </section>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
        <Button onClick={copy}>Copy link to this page</Button>
        {said && <span role="status" style={{ fontSize: 13, color: C.muted, wordBreak: 'break-all' }}>{said}</span>}
      </div>
      {!signedIn && (
        <div style={{ ...box, padding: 16, marginTop: 24 }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Keep your own</p>
          <p style={{ margin: '0 0 12px', fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
            Orbit keeps the people you care about, the places you have been, and the concerts, games and shows you went to, in one place.
          </p>
          <a href={BASE} onClick={() => { track('page.join', { where: 'bottom' }); flushUsage(); }} style={{ ...solidLink(), display: 'inline-block' }}>Join Orbit</a>
        </div>
      )}
    </div>
  );
}

// A link that looks like the solid button.
const solidLink = () => ({
  font: 'inherit', fontSize: 14, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
  background: C.accent, color: C.onAccent, border: `1px solid ${C.accent}`, textDecoration: 'none',
});

// The public pages, drawn on their own, without signing in: a person's page
// or a catalog entry's (see route.js). Moving between them stays on the page.
export function PublicPage({ client, route: first }) {
  const [route, setRoute] = useState(first);
  const [signedIn, setSignedIn] = useState(false);
  // No saved theme to go by: follow the device.
  useState(() => {
    const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'orbit' : 'daylight');
    return null;
  });
  const api = useMemo(() => publicApi(client), [client]);
  useEffect(() => {
    let live = true;
    client.auth.getSession().then(({ data }) => { if (live) setSignedIn(Boolean(data?.session)); }, () => {});
    const back = () => setRoute(readRoute(window.location.pathname));
    window.addEventListener('popstate', back);
    return () => { live = false; window.removeEventListener('popstate', back); };
  }, [client]);
  useEffect(() => {
    if (route) track('page.view', { kind: route.kind, year: Boolean(route.year), signed_in: signedIn });
  }, [route, signedIn]);
  const go = useCallback((path) => {
    window.history.pushState(null, '', path);
    setRoute(readRoute(path));
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={{ background: C.ground, backgroundImage: C.sky, minHeight: '100%', color: C.ink, fontFamily: "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif" }}>
      <AppStyles />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 16px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <a href={BASE} style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ink, textDecoration: 'none', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 13 }}>
            <OrbitMark /> Orbit
          </a>
          <a href={BASE} onClick={() => { track(signedIn ? 'page.open_app' : 'page.join', { where: 'top' }); flushUsage(); }}
            style={{ ...solidLink(), marginLeft: 'auto', fontSize: 13, padding: '7px 12px' }}>{signedIn ? 'Open Orbit' : 'Join Orbit'}</a>
        </div>
        {!route ? (
          <p style={{ fontSize: 14, color: C.muted }}>That page does not exist.</p>
        ) : route.kind === 'profile' ? (
          <ProfilePage key={`${route.username}/${route.year}`} api={api} username={route.username} year={route.year} go={go} signedIn={signedIn} />
        ) : (
          <CatalogPage key={route.id} api={api} id={route.id} canAct={signedIn} onOpen={(id) => go(catalogPath(id))} onPerson={(u) => go(profilePath(u))} />
        )}
      </div>
    </div>
  );
}

/* ---------- reminders: add / edit ---------- */
const LEADS = [[0, 'On the day'], [3, '3 days'], [7, 'A week'], [14, '2 weeks'], [30, 'A month']];

function ReminderForm({ initial, fresh, people, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState(initial?.kind || 'Home');
  const [repeats, setRepeats] = useState(initial ? Boolean(repeatOf(initial)) : true);
  const [unit, setUnit] = useState(repeatOf(initial)?.unit || 'month');
  const [count, setCount] = useState(String(repeatOf(initial)?.n || 1));
  const [anchor, setAnchor] = useState(initial?.anchor === 'done' ? 'done' : 'date');
  const [next, setNext] = useState(initial?.next || addUnits(todayStr(), 'month', 1));
  const [lead, setLead] = useState(initial ? leadOf(initial) : 7);
  const [note, setNote] = useState(initial?.note || '');
  const [who, setWho] = useState(initial?.people || []);
  const [filter, setFilter] = useState('');

  const toggle = (id) => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);
  const shown = people.filter((x) =>
    !filter.trim() || x.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const n = Math.min(99, Math.max(1, Math.round(Number(count) || 1)));

  // Only a date the user actually moved re-pins the day of the month. Opening
  // a reminder pinned to the 31st while it sits on a clamped Feb 28 and
  // pressing Save would otherwise walk the whole series back to the 28th.
  const schedule = () => {
    const fresh = everyFrom(next, unit, n);
    const kept = initial && initial.next === next ? repeatOf(initial) : null;
    return kept ? { ...fresh, dom: kept.dom } : fresh;
  };

  const save = () => {
    const t = title.trim();
    if (!t || !next) return;
    onSave({
      id: initial?.id || uid(),
      addedOn: initial?.addedOn || todayStr(),
      title: t,
      kind,
      every: repeats ? schedule() : null,
      anchor: repeats ? anchor : 'date',
      next,
      lead,
      note: note.trim(),
      people: who,
      history: initial?.history || [],
      lastDone: initial?.lastDone || null,
      paused: Boolean(initial?.paused),
      done: repeats ? false : Boolean(initial?.done),
    });
  };

  // Starters and imported sheets carry intervals the preset row does not
  // list. Show the real one rather than leaving nothing selected, where any
  // corrective tap would quietly change it.
  const leadChoices = LEADS.some(([v]) => v === lead)
    ? LEADS
    : [...LEADS, [lead, `${lead} day${lead === 1 ? '' : 's'}`]].sort((a, b) => a[0] - b[0]);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <Field label="What to remember">
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Check the All-In Summit talks" />
      </Field>

      <Field label="Kind">
        <select className="crm-select" style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)}>
          {REMINDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>

      <Group label="How often">
        <div style={{ display: 'flex', gap: 8, marginBottom: repeats ? 9 : 0 }}>
          {[[false, 'Just once'], [true, 'Again and again']].map(([v, l]) => (
            <button key={l} className="crm-btn" onClick={() => setRepeats(v)} style={segment(repeats === v)}>
              {l}
            </button>
          ))}
        </div>

        {repeats && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.muted }}>Every</span>
            <input
              type="number" min="1" max="99" value={count} aria-label="How many"
              onChange={(e) => setCount(e.target.value)}
              onBlur={() => setCount(String(n))}
              style={{ ...inputStyle, width: 68, flex: '0 0 68px', minHeight: 38, fontSize: 14 }}
            />
            <select
              className="crm-select" value={unit} aria-label="Unit"
              onChange={(e) => setUnit(e.target.value)}
              style={{ ...inputStyle, width: 'auto', flex: 1, minHeight: 38, fontSize: 14 }}
            >
              {REPEAT_UNITS.map((u) => (
                <option key={u.unit} value={u.unit}>{n === 1 ? u.one : u.many}</option>
              ))}
            </select>
          </div>
        )}
      </Group>

      <Field label={repeats ? 'Next one due' : 'Due'}>
        <input type="date" style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>

      {repeats && (
        <Group label="Count the gap from">
          <div style={{ display: 'flex', gap: 8 }}>
            {[['date', 'The calendar'], ['done', 'The day I do it']].map(([v, l]) => (
              <button key={v} className="crm-btn" onClick={() => setAnchor(v)} style={segment(anchor === v)}>
                {l}
              </button>
            ))}
          </div>
          <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
            {anchor === 'date'
              ? 'Keeps its place on the calendar. A bill due on the 15th stays on the 15th whether you pay it early or late.'
              : 'Restarts the clock when you tick it off. A filter lasts three months from the day you actually changed it.'}
          </span>
        </Group>
      )}

      <Group label="Tell me ahead of time">
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {leadChoices.map(([v, l]) => (
            <button
              key={v}
              className="crm-btn"
              onClick={() => setLead(v)}
              style={{
                font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '6px 12px',
                borderRadius: 20, cursor: 'pointer',
                background: lead === v ? C.accent : 'transparent',
                border: `1px solid ${lead === v ? C.accent : C.line}`,
                color: lead === v ? C.onAccent : C.muted,
              }}
            >{l}</button>
          ))}
        </div>
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
          How long before it is due this starts nudging you. Renewals want the room.
        </span>
      </Group>

      {people.length > 0 && (
        <Group label="Anyone involved">
          {people.length > 10 && (
            <input style={{ ...inputStyle, marginBottom: 8, minHeight: 38, fontSize: 14 }}
              value={filter} onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter names" placeholder="Filter names" />
          )}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto',
            border: `1px solid ${C.line}`, borderRadius: 8, padding: 9,
          }}>
            {shown.map((x) => {
              const on = who.includes(x.id);
              return (
                <button
                  key={x.id}
                  className="crm-btn"
                  onClick={() => toggle(x.id)}
                  style={{
                    font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '5px 10px',
                    borderRadius: 20, cursor: 'pointer',
                    background: on ? C.accent : 'transparent',
                    border: `1px solid ${on ? C.accent : C.line}`,
                    color: on ? C.onAccent : C.muted,
                  }}
                >{x.name}</button>
              );
            })}
          </div>
        </Group>
      )}

      <Field label="Details">
        <textarea
          className="crm-serif"
          style={{ ...inputStyle, minHeight: 84, resize: 'vertical', lineHeight: 1.6 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything future you will want to know. The account number, the plumber's name, why this matters."
        />
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button kind="solid" onClick={save} style={{ flex: 1 }}>
          {fresh ? 'Add this reminder' : 'Save changes'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------- reminders: one card ---------- */
function ReminderCard({ r, people, onSave, onRemove, onEdit, onPerson }) {
  const [confirm, setConfirm] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const st = reminderState(r);
  const involved = (r.people || []).map((id) => people.find((x) => x.id === id)).filter(Boolean);
  const times = (r.history || []).length;
  const act = { fontSize: 12.5, padding: '6px 11px' };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: '13px 14px', marginBottom: 10, opacity: st.key === 'paused' || st.key === 'done' ? 0.72 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span style={{ width: 8, height: 8, borderRadius: 8, background: st.bar, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink }}>
          {r.title}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: st.tone, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {st.key === 'paused' ? 'Paused' : st.key === 'done' ? 'Done' : dueText(st.d)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', margin: '7px 0 0', paddingLeft: 17 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: C.muted,
          border: `1px solid ${C.line}`, borderRadius: 20, padding: '2px 8px',
        }}>{r.kind || 'Other'}</span>
        <span style={{ fontSize: 12.5, color: C.faint }}>
          {repeatText(r)}
          {repeatOf(r) && r.anchor === 'done' ? ', from when it was last done' : ''}
        </span>
        {r.next && st.key !== 'done' && (
          <span style={{ fontSize: 12.5, color: C.faint }}>· {prettyDate(r.next)}</span>
        )}
      </div>

      <div style={{ paddingLeft: 17 }}>
        {r.note && (
          <p className="crm-serif" style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.6, color: C.ink }}>
            {r.note}
          </p>
        )}

        {involved.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: C.muted }}>
            <span style={{ color: C.faint }}>With </span>
            {involved.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ', '}
                <button
                  className="crm-btn"
                  onClick={() => onPerson && onPerson(x.id)}
                  style={{
                    font: 'inherit', fontSize: 12.5, color: C.ink, background: 'transparent',
                    border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
                    textDecorationColor: C.line,
                  }}
                >{x.name}</button>
              </span>
            ))}
          </p>
        )}

        {r.lastDone && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: C.faint }}>
            Last done {prettyDate(r.lastDone)}
            {times > 1 ? ` · ${times} times logged` : ''}
          </p>
        )}

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
          {st.key === 'done' ? (
            <Button onClick={() => onSave({ ...r, done: false })} style={act}>Not done after all</Button>
          ) : st.key === 'paused' ? (
            <Button kind="solid" onClick={() => onSave({ ...r, paused: false })} style={act}>Resume</Button>
          ) : (
            <>
              <Button kind="solid" onClick={() => onSave(completeReminder(r, todayStr()))} style={act}>
                Did it today
              </Button>
              {snoozing ? (
                [[1, 'A day'], [7, 'A week'], [30, 'A month']].map(([d, l]) => (
                  <Button key={d} onClick={() => { onSave(snoozeReminder(r, d)); setSnoozing(false); }} style={act}>
                    {l}
                  </Button>
                ))
              ) : (
                <Button onClick={() => setSnoozing(true)} style={act}>Push it back</Button>
              )}
              <Button onClick={() => onSave({ ...r, paused: true })} style={act}>Pause</Button>
            </>
          )}
          <Button onClick={onEdit} style={act}>Edit</Button>
          <Button kind="danger" onClick={() => (confirm ? onRemove(r.id) : setConfirm(true))}
            style={{ fontSize: 12.5, padding: '6px 8px' }}>
            {confirm ? 'Tap again to remove' : 'Remove'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- reminders: the tab ---------- */
const BANDS = [['over', 'Late'], ['today', 'Today'], ['soon', 'Coming up'],
  ['later', 'Later'], ['paused', 'Paused'], ['done', 'Done']];

function Starters({ have, onPick }) {
  const [open, setOpen] = useState(false);
  // Nothing you already keep, so the list shrinks as you use it.
  const left = STARTERS.filter((s) => !have.has(s.title.toLowerCase()));
  if (left.length === 0) return null;
  const kinds = REMINDER_KINDS.filter((k) => left.some((s) => s.kind === k));

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, marginTop: 18, overflow: 'hidden' }}>
      <button
        className="crm-btn"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', font: 'inherit',
          textAlign: 'left', cursor: 'pointer', padding: '12px 14px',
          background: 'transparent', border: 'none',
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>
          Things worth remembering
        </span>
        <span style={{ fontSize: 11, color: C.faint }}>{open ? 'Hide' : `Show ${left.length}`}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.faint, lineHeight: 1.55 }}>
            The usual intervals, already filled in. Tap one to look it over before it is added.
          </p>
          {kinds.map((k) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <p style={{
                margin: '0 0 7px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em',
                textTransform: 'uppercase', color: C.faint,
              }}>{k}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {left.filter((s) => s.kind === k).map((s) => (
                  <button
                    key={s.title}
                    className="crm-btn"
                    onClick={() => onPick(s)}
                    style={{
                      font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '6px 11px',
                      borderRadius: 20, cursor: 'pointer', textAlign: 'left',
                      background: 'transparent', border: `1px solid ${C.line}`, color: C.ink,
                    }}
                  >
                    {s.title}
                    <span style={{ color: C.faint, fontWeight: 400 }}>
                      {` · ${s.n === 1 ? REPEAT_UNITS.find((u) => u.unit === s.unit).one
                        : `${s.n} ${REPEAT_UNITS.find((u) => u.unit === s.unit).many}`}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemindersView({ reminders, people, onAdd, onEdit, onSave, onRemove, onStarter, onPerson }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('All');

  const nameOf = (id) => people.find((x) => x.id === id)?.name || '';
  const query = q.trim().toLowerCase();
  const matches = (r) =>
    `${r.title} ${r.note || ''} ${r.kind || ''} ${(r.people || []).map(nameOf).join(' ')}`
      .toLowerCase().includes(query);

  const kindsPresent = REMINDER_KINDS.filter((k) => reminders.some((r) => (r.kind || 'Other') === k));
  const shown = reminders
    .filter((r) => kind === 'All' || (r.kind || 'Other') === kind)
    .filter((r) => !query || matches(r))
    .sort(byDue);

  const live = reminders.filter((r) => !r.paused && !r.done);
  const needing = live.filter((r) => ['over', 'today', 'soon'].includes(reminderState(r).key));
  const late = live.filter((r) => reminderState(r).key === 'over').length;
  const narrowed = Boolean(query) || kind !== 'All';
  const have = new Set(reminders.map((r) => (r.title || '').toLowerCase()));

  let head = 'Nothing to remember yet';
  let sub = 'The things that come round again: the filter, the bill, the talks posted every autumn.';
  if (reminders.length > 0) {
    if (narrowed) {
      head = `${countThings(shown.length, 'reminder', 'reminders')} ${shown.length === 1 ? 'matches' : 'match'}`;
      sub = 'Looking through everything you keep.';
    } else if (needing.length === 0) {
      head = 'Nothing due';
      sub = live.length > 0
        ? `${countThings(live.length, 'reminder is', 'reminders are')} waiting quietly.`
        : 'Everything here is paused or finished.';
    } else {
      head = `${countThings(needing.length, 'thing needs', 'things need')} you`;
      sub = late > 0
        ? `${countThings(late, 'is', 'are')} already past due. Longest overdue first.`
        : 'Nothing late yet. Soonest first.';
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>{head}</h1>
        <Button kind="solid" onClick={onAdd} style={{ marginLeft: 'auto' }}>Add a reminder</Button>
      </div>

      {reminders.length === 0 && <EmptySky />}

      <p style={{ margin: '0 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{sub}</p>

      {reminders.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              style={inputStyle}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reminders, details, people"
            />
            {query && <Button onClick={() => setQ('')}>Clear</Button>}
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 20 }}>
            <button className="crm-btn" onClick={() => setKind('All')} style={filterChip(kind === 'All')}>
              All
            </button>
            {kindsPresent.map((k) => (
              <button key={k} className="crm-btn" onClick={() => setKind(k)} style={filterChip(kind === k)}>
                {k}
              </button>
            ))}
          </div>
        </>
      )}

      {reminders.length > 0 && shown.length === 0 && (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: 0 }}>
          Nothing matches that. Try a looser search, or set the kind back to All.
        </p>
      )}

      {BANDS.map(([key, label]) => {
        const group = shown.filter((r) => reminderState(r).key === key);
        if (group.length === 0) return null;
        return (
          <div key={key}>
            <p style={{
              margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: key === 'over' ? C.overdue : C.faint,
            }}>{label}</p>
            {group.map((r) => (
              <ReminderCard key={r.id} r={r} people={people} onSave={onSave}
                onRemove={onRemove} onPerson={onPerson} onEdit={() => onEdit(r)} />
            ))}
          </div>
        );
      })}

      <Starters have={have} onPick={onStarter} />
    </div>
  );
}

/* ---------- lists: small pieces ---------- */
const STAR_PATH = 'M8 1.6 L9.9 5.6 L14.2 6.2 L11.1 9.3 L11.9 13.7 L8 11.6 L4.1 13.7 L4.9 9.3 L1.8 6.2 L6.1 5.6 Z';

// The stages differ in shape as well as colour (empty, half, ticked), so they
// still read apart for anyone who cannot tell the amber from the green.
function StageMark({ stage, size = 20 }) {
  const m = size / 2;
  const r = m - 1.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      {stage === 'done' ? (
        <>
          <circle cx={m} cy={m} r={r} fill={C.accent} />
          <path d={`M${size * 0.3} ${size * 0.52} L${size * 0.45} ${size * 0.67} L${size * 0.71} ${size * 0.37}`}
            fill="none" stroke={C.onAccent} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx={m} cy={m} r={r} fill="none" strokeWidth="1.5"
            stroke={stage === 'doing' ? C.soonBar : C.faint} />
          {stage === 'doing' && <path d={`M${m} ${m - r} A${r} ${r} 0 0 1 ${m} ${m + r} Z`} fill={C.soonBar} />}
        </>
      )}
    </svg>
  );
}

// How much of star i a rating of n fills: all, half or none.
const starFill = (n, i) => (n >= i ? 1 : n >= i - 0.5 ? 0.5 : 0);

// One star, whole, half or empty. A half star is the whole one's outline with
// its left half filled in.
function StarGlyph({ fill, size, on, off = on, stroke = 1.3 }) {
  const shape = (filled) => (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block' }}>
      <path d={STAR_PATH} fill={filled ? on : 'none'} stroke={fill ? on : off} strokeWidth={stroke} strokeLinejoin="round" />
    </svg>
  );
  return (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
      {shape(fill === 1)}
      {fill === 0.5 && (
        <span style={{ position: 'absolute', left: 0, top: 0, width: size / 2, height: size, overflow: 'hidden' }}>
          {shape(true)}
        </span>
      )}
    </span>
  );
}

function StarRow({ n, size = 11 }) {
  return (
    <span role="img" aria-label={`Rated ${n} of 5`}
      style={{ display: 'inline-flex', gap: 1, flexShrink: 0, alignSelf: 'center' }}>
      {[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} fill={starFill(n, i)} size={size} on={C.soonText} />)}
    </span>
  );
}

// How far through a list you are, as a bar and in words. The words are what
// a screen reader gets; the bar is there to be taken in at a glance.
function Progress({ c, n, thin }) {
  const total = c.items.length;
  const pct = (x) => `${total ? (x / total) * 100 : 0}%`;
  return (
    <span style={{ display: 'block', marginTop: thin ? 10 : 14 }}>
      <span aria-hidden="true" style={{
        display: 'flex', height: thin ? 4 : 6, borderRadius: 6, background: C.line, overflow: 'hidden',
      }}>
        <span style={{ width: pct(n.done), background: C.accent }} />
        <span style={{ width: pct(n.doing), background: C.soonBar }} />
      </span>
      {!thin && (
        <span style={{ display: 'block', fontSize: 12.5, color: C.faint, marginTop: 6 }}>
          {n.done} of {total} {stageLabel(c, 'done').toLowerCase()}
          {n.doing > 0 ? ` · ${n.doing} ${stageLabel(c, 'doing').toLowerCase()}` : ''}
        </span>
      )}
    </span>
  );
}

/* ---------- lists: a new list, or changing one ---------- */
// The ready-made lists offered when starting one. "Other" is not among them:
// a blank form is already that.
const LIST_TEMPLATES = COLLECTION_KINDS.filter((x) => x.kind !== 'Other');
const BLANK_LABELS = Object.freeze({ want: '', doing: '', done: '' });
const OWN_TEMPLATE_CAP = 8;

// A list's own words for each stage, as the form holds them.
const labelsOf = (c) => ({ want: stageLabel(c, 'want'), doing: c.labels?.doing || '', done: stageLabel(c, 'done') });

// The lists someone already has, offered as templates for the next one. Two
// lists set up the same way are one template, and only the first few count.
const ownTemplates = (lists) => {
  const seen = new Set();
  const out = [];
  for (const c of lists || []) {
    const l = labelsOf(c);
    const key = JSON.stringify([c.kind, c.track, c.track ? [l.want, l.doing, l.done] : [], c.detail || '']);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === OWN_TEMPLATE_CAP) break;
  }
  return out;
};

// What a template card says under its name: the stages it moves through.
const stagesPreview = (labels, track = true) =>
  (track ? STAGES.map((st) => labels[st]).filter(Boolean).join(' · ') : 'Just a list');

function TemplateCard({ title, preview, on, onPick }) {
  return (
    <button className="crm-btn" onClick={onPick} aria-pressed={on} title={title} style={{
      font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: '8px 11px', borderRadius: 9, minWidth: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      background: on ? C.accentSoft : 'transparent',
      border: `1px solid ${on ? C.accent : C.line}`, color: C.ink,
    }}>
      <span style={{
        display: 'block', maxWidth: '100%', fontSize: 13.5, fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</span>
      <span style={{ display: 'block', fontSize: 11.5, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>{preview}</span>
    </button>
  );
}

const templateGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 7 };
const linkButton = () => ({
  font: 'inherit', fontSize: 'inherit', padding: 0, border: 0, background: 'none',
  color: C.accentDeep, textDecoration: 'underline', cursor: 'pointer',
});

function CollectionForm({ initial, kind: startKind, mine, onSave, onCancel }) {
  // A new list starts blank unless it was opened from one of the templates.
  const first = kindOf(initial?.kind || startKind || 'Other');
  const blank = !initial && first.kind === 'Other';
  const [kind, setKind] = useState(first.kind);
  const [name, setName] = useState(initial ? initial.name : blank ? '' : first.name);
  const [note, setNote] = useState(initial?.note || '');
  const [track, setTrack] = useState(initial ? initial.track : true);
  // The middle stage is the only one that may be blank, meaning "skip it".
  const [labels, setLabels] = useState(initial
    ? labelsOf(initial)
    : blank ? { ...BLANK_LABELS } : { ...first.labels });
  const [detail, setDetail] = useState(initial ? initial.detail : blank ? '' : first.detail);
  const [missing, setMissing] = useState(false);
  // Which template the words came from: a built-in one by its kind, or one of
  // the owner's lists by its id. Null is a blank start.
  const [from, setFrom] = useState(blank || initial ? null : { kind: first.kind });
  // The templates take a lot of room, so once they have done their job they
  // fold down to a line. They start open, unless one was already chosen.
  const [open, setOpen] = useState(blank);
  // Taken once, when the form opens, so a sync landing mid-form cannot take
  // away the list a new one is being modelled on.
  const [yours] = useState(() => (initial ? [] : ownTemplates(mine)));

  // A template fills in every word it has, whatever was there before, so
  // switching from one to another never leaves the last one's words behind.
  // What the list is for is the owner's own, and no template touches it.
  // Every built-in template moves through stages, so it turns them on.
  const pickTemplate = (t) => {
    setFrom({ kind: t.kind });
    setKind(t.kind);
    setTrack(true);
    setName(t.name);
    setLabels({ ...t.labels });
    setDetail(t.detail);
    setMissing(false);
    setOpen(false);
  };
  // One of the owner's own lists brings its whole setup, stages or none, but
  // not its name: the new list is a different one.
  const pickOwn = (c) => {
    setFrom({ id: c.id });
    setKind(c.kind);
    setName('');
    setTrack(c.track);
    setLabels(labelsOf(c));
    setDetail(c.detail || '');
    setOpen(false);
  };
  const startBlank = () => {
    setFrom(null);
    setKind('Other');
    setTrack(true);
    setName('');
    setLabels({ ...BLANK_LABELS });
    setDetail('');
  };

  // Naming a list and moving on without picking a template means none is
  // wanted, so the templates fold away then. Not while the name is typed, which
  // would pull the box up mid-word, and not while a click is still under way:
  // the fold moves everything up, and the button being pressed would slide out
  // from under the pointer before the click lands. So a click folds once it is
  // done, and only focus that arrives from the keyboard folds straight away.
  const nameRef = useRef(null);
  const templatesRef = useRef(null);
  const pressing = useRef(false);
  const foldOnMoveOn = (e) => {
    if (initial || from || !open || !name.trim()) return;
    if (e.target === nameRef.current || templatesRef.current?.contains(e.target)) return;
    setOpen(false);
  };
  const foldOnFocus = (e) => { if (!pressing.current) foldOnMoveOn(e); };
  const foldOnClick = (e) => { pressing.current = false; foldOnMoveOn(e); };

  const fromOwn = from?.id ? yours.find((c) => c.id === from.id) : null;
  const templateValue = from?.kind ? `k:${from.kind}` : from?.id ? `l:${from.id}` : '';
  const pickByValue = (v) => {
    const t = v.startsWith('k:') && LIST_TEMPLATES.find((x) => x.kind === v.slice(2));
    const c = v.startsWith('l:') && yours.find((x) => x.id === v.slice(2));
    if (t) pickTemplate(t);
    else if (c) pickOwn(c);
    else startBlank();
  };
  const fromName = from?.kind ? from.kind : fromOwn ? `like ${fromOwn.name}` : '';

  const k = kindOf(kind);

  const save = () => {
    const n = name.trim();
    if (!n) { setMissing(true); return; }
    onSave({
      id: initial?.id || uid(),
      addedOn: initial?.addedOn || todayStr(),
      name: n,
      kind,
      note: note.trim(),
      track,
      labels: {
        want: labels.want.trim() || k.labels.want,
        doing: labels.doing.trim(),
        done: labels.done.trim() || k.labels.done,
      },
      detail: detail.trim(),
      sort: initial?.sort || 'manual',
      items: initial?.items || [],
    });
  };

  return (
    <div onPointerDown={() => { pressing.current = true; }} onPointerCancel={() => { pressing.current = false; }}
      onFocus={foldOnFocus} onClick={foldOnClick}
      style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      {/* On a phone the cards would fill the screen, so the same choice is a
          dropdown there, which opens the phone's own picker. */}
      {!initial && (
        <div className="crm-tpl-pick">
          <Field label="Start from a template">
            <select className="crm-select" style={inputStyle} value={templateValue}
              onChange={(e) => pickByValue(e.target.value)}>
              <option value="">None, start blank</option>
              <optgroup label="Templates">
                {LIST_TEMPLATES.map((t) => <option key={t.kind} value={`k:${t.kind}`}>{t.kind}</option>)}
              </optgroup>
              {yours.length > 0 && (
                <optgroup label="Like one of yours">
                  {yours.map((c) => <option key={c.id} value={`l:${c.id}`}>{c.name}</option>)}
                </optgroup>
              )}
            </select>
            <span style={hintStyle()}>Optional. It fills in the words below, and every one of them can be changed.</span>
          </Field>
        </div>
      )}
      {!initial && <div className="crm-tpl-wide">{open ? (
        <div ref={templatesRef}>
          <Group label="Start from a template">
            <div role="group" aria-label="Templates" style={templateGrid}>
              {LIST_TEMPLATES.map((t) => (
                <TemplateCard key={t.kind} title={t.kind} preview={stagesPreview(t.labels)}
                  on={from?.kind === t.kind} onPick={() => pickTemplate(t)} />
              ))}
            </div>
            {yours.length > 0 && (
              <>
                <span style={{ display: 'block', fontSize: 12, color: C.faint, margin: '12px 0 5px' }}>Like one of yours</span>
                <div role="group" aria-label="Your lists" style={templateGrid}>
                  {yours.map((c) => (
                    <TemplateCard key={c.id} title={c.name} preview={stagesPreview(labelsOf(c), c.track)}
                      on={from?.id === c.id} onPick={() => pickOwn(c)} />
                  ))}
                </div>
              </>
            )}
            <span style={hintStyle()}>
              Optional. A template fills in the words below, and every one of them can be changed.
              {from && (
                <>
                  {' '}
                  <button className="crm-btn" onClick={startBlank} style={linkButton()}>Start blank</button>
                </>
              )}
            </span>
          </Group>
        </div>
      ) : (
        <p style={{ margin: '0 0 14px', fontSize: 13, color: C.muted, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {from ? <>Template: <strong style={{ color: C.ink, fontWeight: 600 }}>{fromName}</strong></> : 'No template'}
          </span>
          <button className="crm-btn" onClick={() => setOpen(true)} style={linkButton()}>
            {from ? 'Change' : 'Use one'}
          </button>
          {from && <button className="crm-btn" onClick={startBlank} style={linkButton()}>Start blank</button>}
        </p>
      )}</div>}

      <Field label="Name">
        <input ref={nameRef} style={inputStyle} value={name} maxLength={LIST_NAME_CAP}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? 'crm-list-name-missing' : undefined}
          onChange={(e) => { setName(e.target.value); setMissing(false); }}
          placeholder={(from?.kind && k.name) || 'Gift ideas, trails to hike, records to find…'} />
      </Field>
      {/* Outside the label, or it would become part of the field's name. */}
      {missing && (
        <p id="crm-list-name-missing" style={{ margin: '-8px 0 14px', fontSize: 12, color: C.overdue }}>
          Give the list a name first.
        </p>
      )}

      <Field label="What it is for">
        <textarea
          className="crm-serif"
          style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.55 }}
          value={note}
          maxLength={LIST_NOTE_CAP}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Everything I want to try this year."
        />
      </Field>

      <Group label="Keep track of progress">
        <div style={{ display: 'flex', gap: 8, marginBottom: track ? 10 : 0 }}>
          {[[true, 'Yes, in stages'], [false, 'No, just a list']].map(([v, l]) => (
            <button key={l} className="crm-btn" onClick={() => setTrack(v)}
              aria-pressed={track === v} style={segment(track === v)}>
              {l}
            </button>
          ))}
        </div>
        {track ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[['want', 'Not started'], ['doing', 'Under way'], ['done', 'Finished']].map(([s, cap]) => (
                <div key={s} style={{ flex: '1 1 130px' }}>
                  <span style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>{cap}</span>
                  <input
                    style={{ ...inputStyle, minHeight: 38, fontSize: 14 }}
                    value={labels[s]}
                    maxLength={LABEL_CAP}
                    aria-label={`Name for the ${cap.toLowerCase()} stage`}
                    placeholder={s === 'doing' ? 'Optional' : k.labels[s]}
                    onChange={(e) => setLabels({ ...labels, [s]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <span style={hintStyle()}>
              Your own words for each stage. Leave the middle one empty when there is no in-between.
            </span>
          </>
        ) : (
          <span style={hintStyle()}>
            A plain list in the order you choose: rankings, gift ideas, the good taco places.
            Turning stages back on later brings any progress back with it.
          </span>
        )}
      </Group>

      <Field label="The line under each title">
        <input style={inputStyle} value={detail} maxLength={LABEL_CAP}
          onChange={(e) => setDetail(e.target.value)} placeholder={kind === 'Other' ? 'e.g. Author, Where, Brand' : k.detail} />
        <span style={hintStyle()}>
          What each entry notes besides its name: the author, where to watch it, the set it
          belongs to. Leave it empty to skip it.
        </span>
      </Field>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button kind="solid" onClick={save} style={{ flex: 1 }}>
          {initial ? 'Save changes' : 'Make this list'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------- lists: one entry ---------- */
// onTrip: on a Places list, starts a trip from this entry.
function ItemEditor({ c, it, people, onSave, onRemove, onCancel, onTrip }) {
  const [title, setTitle] = useState(it.title);
  const [detail, setDetail] = useState(it.detail || '');
  const [status, setStatus] = useState(stageOf(c, it));
  const [rating, setRating] = useState(it.rating || 0);
  const [from, setFrom] = useState(people.some((p) => p.id === it.from) ? it.from : '');
  const [link, setLink] = useState(it.link || '');
  const [note, setNote] = useState(it.note || '');
  const [problem, setProblem] = useState('');
  const [confirm, setConfirm] = useState(false);
  const used = stagesOf(c);
  const byName = useMemo(() => [...people].sort((a, b) => SHELF.compare(a.name, b.name)), [people]);

  const save = () => {
    const t = title.trim();
    if (!t) { setProblem('It needs a title.'); return; }
    const href = safeLink(link);
    if (link.trim() && !href) {
      setProblem('That link does not look right. Paste the whole address, starting with https://');
      return;
    }
    // Left alone, the stage and its finish date stay exactly as stored, so
    // tidying a title never stamps a finish date on something imported.
    const base = status !== stageOf(c, it) ? withStatus(it, status) : it;
    onSave({ ...base, title: t, detail: detail.trim(), rating, from: from || null, link: href, note: note.trim() });
  };

  return (
    <div className="crm-entry crm-open" style={{
      padding: '15px 15px 12px', background: C.paper, borderBottom: `1px solid ${C.line}`,
    }}>
      <Field label="Title">
        <input autoFocus style={inputStyle} value={title} maxLength={TITLE_CAP}
          onChange={(e) => { setTitle(e.target.value); setProblem(''); }} placeholder={kindOf(c.kind).ph} />
      </Field>

      {/* Decided by what is stored, not what is typed, so clearing the box
          does not make it vanish from under the cursor. */}
      {(c.detail || it.detail) && (
        <Field label={c.detail || 'Detail'}>
          <input style={inputStyle} value={detail} maxLength={TITLE_CAP} onChange={(e) => setDetail(e.target.value)} />
        </Field>
      )}

      {used.length > 0 && (
        <Group label="Where it stands">
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {used.map((s) => (
              <button key={s} className="crm-btn" onClick={() => setStatus(s)}
                aria-pressed={status === s}
                style={{ ...filterChip(status === s), display: 'flex', alignItems: 'center', gap: 6 }}>
                <StageMark stage={s} size={14} />
                {stageLabel(c, s)}
              </button>
            ))}
          </div>
        </Group>
      )}

      <StarInput label="Your rating" value={rating || null} onChange={(v) => setRating(v || 0)} />

      {people.length > 0 && (
        <Field label="Recommended by">
          <select className="crm-select" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Nobody in particular</option>
            {byName.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Link">
        <input type="url" inputMode="url" style={inputStyle} value={link} placeholder="https://"
          maxLength={LINK_CAP} onChange={(e) => { setLink(e.target.value); setProblem(''); }} />
      </Field>

      <Field label="Notes">
        <textarea
          className="crm-serif"
          style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.55 }}
          value={note}
          maxLength={NOTE_CAP}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why it is on here, who to watch it with, what it cost."
        />
      </Field>

      <p style={{ margin: '0 0 10px', fontSize: 12, color: C.faint }}>
        Added {prettyDate(it.addedOn)}
        {it.doneOn && stageOf(c, it) === 'done' ? ` · ${stageLabel(c, 'done')} ${prettyDate(it.doneOn)}` : ''}
      </p>

      {problem && <p style={{ margin: '0 0 10px', fontSize: 13, color: C.overdue }}>{problem}</p>}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Button kind="solid" onClick={save} style={small}>Save</Button>
        <Button onClick={onCancel} style={small}>Cancel</Button>
        {onTrip && (
          <Button onClick={() => onTrip({ title: title.trim() || it.title, detail: detail.trim(), done: status === 'done' })} style={small}>
            Put it on the trip map
          </Button>
        )}
        <Button kind="danger" onClick={() => (confirm ? onRemove(it.id) : setConfirm(true))}
          style={{ fontSize: 12.5, padding: '6px 8px', marginLeft: 'auto', ...(confirm ? { fontWeight: 700 } : {}) }}>
          {confirm ? 'Tap again to remove' : 'Remove'}
        </Button>
      </div>
    </div>
  );
}

const rowSide = {
  width: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
};

// Memoised, and every prop is either the entry itself or something that
// holds still while other entries change: the list's shape (kind, stages,
// words) rather than the whole list, the recommender's name rather than
// everyone, a number only when numbers show, and one action function that
// never changes. Ticking one entry off then redraws that one row, not all
// of them.
const ItemRow = memo(function ItemRow({ shape, it, from, n, first, last, reordering, act }) {
  const used = stagesOf(shape);
  const st = stageOf(shape, it);
  const meta = [it.detail, from && `from ${from}`].filter(Boolean).join(' · ');
  const host = it.link ? linkHost(it.link) : '';

  const body = (
    <>
      <span style={{
        display: 'block', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.015em',
        color: used.length > 0 && st === 'done' ? C.muted : C.ink,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{it.title}</span>
      {(meta || it.rating > 0) && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, minWidth: 0 }}>
          {it.rating > 0 && <StarRow n={it.rating} />}
          {meta && (
            <span style={{
              fontSize: 12.5, color: C.muted, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{meta}</span>
          )}
        </span>
      )}
      {it.note && !reordering && (
        <span className="crm-serif" style={{
          display: 'block', fontSize: 13.5, color: C.muted, marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{it.note}</span>
      )}
    </>
  );

  return (
    <div className="crm-entry" style={{
      display: 'flex', alignItems: 'stretch', background: C.surface, borderBottom: `1px solid ${C.line}`,
    }}>
      {n == null ? (
        <button
          className="crm-btn"
          onClick={() => act('step', it.id)}
          title={`${stageLabel(shape, st)}. Tap for ${stageLabel(shape, nextStage(shape, it))}.`}
          aria-label={`${it.title}: ${stageLabel(shape, st)}. Mark as ${stageLabel(shape, nextStage(shape, it))}`}
          style={{ ...rowSide, borderRight: `1px solid ${C.line}` }}
        >
          <StageMark stage={st} />
        </button>
      ) : (
        <span aria-hidden="true" style={{
          ...rowSide, cursor: 'default', fontSize: 12.5, fontWeight: 600, color: C.faint,
          fontVariantNumeric: 'tabular-nums',
        }}>{n}</span>
      )}

      {reordering ? (
        <div style={{ flex: 1, minWidth: 0, padding: '12px 14px' }}>{body}</div>
      ) : (
        <button className="crm-btn crm-row" onClick={() => act('edit', it.id)} style={{
          flex: 1, minWidth: 0, display: 'block', textAlign: 'left', font: 'inherit', color: C.ink,
          background: 'transparent', border: 'none', padding: '12px 14px', cursor: 'pointer',
        }}>{body}</button>
      )}

      {host && !reordering && (
        <a href={it.link} target="_blank" rel="noreferrer" title={host}
          aria-label={`Open ${it.title} on ${host}`}
          style={{ ...rowSide, width: 42, color: C.muted, borderLeft: `1px solid ${C.line}` }}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M5.5 2.5 H11.5 V8.5 M11.5 2.5 L3 11" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}

      {reordering && [[-1, 'up', first], [1, 'down', last]].map(([d, word, off]) => (
        <button
          key={word}
          className="crm-btn"
          data-move={`${it.id}:${d}`}
          disabled={off}
          onClick={() => act('move', it.id, d)}
          aria-label={`Move ${it.title} ${word}`}
          style={{
            ...rowSide, width: 44, color: C.muted, borderLeft: `1px solid ${C.line}`,
            cursor: off ? 'default' : 'pointer', opacity: off ? 0.3 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d={d < 0 ? 'M3 9 L7 5 L11 9' : 'M3 5 L7 9 L11 5'} fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
});

// Its own component so that typing redraws this box and nothing else. When
// it lived in the list, every keystroke redrew every row under it.
function QuickAdd({ label, placeholder, onAdd }) {
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState('');
  const box = useRef(null);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    const [ok, message] = onAdd(t);
    if (ok) setDraft('');
    setSaid(message);
    box.current?.focus();
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <input
          ref={box}
          style={inputStyle}
          value={draft}
          maxLength={TITLE_CAP}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); setSaid(''); }}
          onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); add(); } }}
        />
        <Button kind="solid" onClick={add}>Add</Button>
      </div>
      <p aria-live="polite" style={{ margin: '6px 0 0', minHeight: 17, fontSize: 12.5, color: C.faint }}>{said}</p>
    </>
  );
}

/* ---------- lists: sharing ---------- */
// Memoised as a whole, and each output only rebuilt when what it depends on
// changes: encoding a long list is the most expensive thing on this screen.
const SharePanel = memo(function SharePanel({ c, people, owner }) {
  const [progress, setProgress] = useState(true);
  const [notes, setNotes] = useState(false);
  const [to, setTo] = useState('');
  const [said, setSaid] = useState('');
  const [fallback, setFallback] = useState('');

  const text = useMemo(() => collectionText(c, { progress, notes }), [c, progress, notes]);
  const link = useMemo(
    () => `${window.location.origin}${window.location.pathname}#${SHARE_PREFIX}${shareCode(c, { notes, by: owner })}`,
    [c, notes, owner]);
  const mailable = useMemo(() => people.filter((p) => (p.email || '').includes('@'))
    .sort((a, b) => SHELF.compare(a.name, b.name)), [people]);
  const who = mailable.find((p) => p.id === to) || mailable[0] || null;
  const mail = useMemo(() => (who
    ? `mailto:${who.email}?subject=${encodeURIComponent(c.name)}&body=${encodeURIComponent(text)}`
    : ''), [who, c.name, text]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // The clipboard is refused outright on plain http and in some embeds, so
  // there is always a way to get at the text by hand.
  const copy = async (value, what) => {
    track('share.list', { how: /link/i.test(what) ? 'link' : 'text' });
    try {
      await navigator.clipboard.writeText(value);
      setSaid(`${what} is copied. Paste it wherever you like.`);
      setFallback('');
    } catch {
      setSaid('Copying was blocked here. Select the text below and copy it yourself.');
      setFallback(value);
    }
  };

  const sheet = async () => {
    try {
      track('share.list', { how: 'sheet' });
      await navigator.share({ title: c.name, text });
    } catch (e) {
      if (e?.name !== 'AbortError') copy(text, 'The list');
    }
  };

  return (
    <div className="crm-open" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: '15px 15px 12px', margin: '16px 0 0',
    }}>
      <p style={{ margin: '0 0 11px', fontSize: 13, fontWeight: 600, color: C.ink }}>Share this list</p>
      <Check on={progress} onChange={setProgress} label="Show progress and ratings"
        hint="In the text. An Orbit link always gives them a fresh start." />
      <Check on={notes} onChange={setNotes} label="Include my notes"
        hint="What the list is for, and the notes on each entry. Who recommended what always stays with you." />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 4 }}>
        <Button kind="solid" onClick={() => copy(text, 'The list')} style={small}>Copy as text</Button>
        {canShare && <Button onClick={sheet} style={small}>Share…</Button>}
      </div>

      {who && (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <select
            className="crm-select"
            aria-label="Who to email it to"
            value={who.id}
            onChange={(e) => setTo(e.target.value)}
            style={{ ...inputStyle, width: 'auto', flex: '1 1 170px', minHeight: 36, padding: '6px 11px', fontSize: 13 }}
          >
            {mailable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <a href={mail} className="crm-btn" style={{
            fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: C.ink, textDecoration: 'none',
            padding: '7px 11px', borderRadius: 7, border: `1px solid ${C.line}`, whiteSpace: 'nowrap',
          }}>Email it to {who.name.split(' ')[0]}</a>
        </div>
      )}
      {who && mail.length > 1900 && (
        <span style={hintStyle()}>Some mail apps cut long lists short. Copying the text is the sure way.</span>
      )}

      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 12 }}>
        <p style={{ margin: '0 0 9px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
          Sending it to someone else who uses Orbit? A link gives them their own copy to work
          through. They open it, or paste it under Add a shared list.
          {owner ? ` It tells them it is from ${owner}.` : ''}
        </p>
        <Button onClick={() => copy(link, 'The link')} style={small}>Copy Orbit link</Button>
        {link.length > 4000 && (
          <span style={hintStyle()}>
            This is a long one. Some messaging apps trim long links, so if it arrives broken, send
            the text instead.
          </span>
        )}
      </div>

      <p aria-live="polite" style={{ margin: said ? '12px 0 0' : 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
        {said}
      </p>
      {fallback && (
        <textarea
          readOnly
          aria-label="Text to copy"
          onFocus={(e) => e.target.select()}
          value={fallback}
          style={{ ...inputStyle, marginTop: 8, minHeight: 120, fontSize: 12, lineHeight: 1.45, resize: 'vertical' }}
        />
      )}
    </div>
  );
});

/* ---------- lists: one list, opened ---------- */
function CollectionDetail({ c, people, owner, onSave, onEdit, onRemove, onBack, onTrip }) {
  const [stage, setStage] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [moved, setMoved] = useState(null);

  const k = kindOf(c.kind);
  const used = stagesOf(c);
  const items = c.items;
  // A stage filter left over from before the list dropped that stage
  // would otherwise hide everything with no chip on screen to undo it.
  const on = used.includes(stage) ? stage : 'all';
  const query = q.trim().toLowerCase();
  const counts = useMemo(() => tally(c), [c]);

  // Only the parts of the list a row draws from. Saving an entry keeps these
  // same objects, so rows can tell nothing about them changed.
  const shape = useMemo(() => ({ kind: c.kind, track: c.track, labels: c.labels }), [c.kind, c.track, c.labels]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  // Sorted once per change to the list; filtering on top is all a keystroke
  // in the search box costs. Reordering works on the whole list in your
  // order, whatever the view was, so "up" means up in the order that is kept.
  const sorted = useMemo(() => sortItems(c, items), [c, items]);
  const shown = useMemo(() => (reordering ? items : sorted
    .filter((it) => on === 'all' || stageOf(c, it) === on)
    .filter((it) => !query || `${it.title} ${it.detail} ${it.note}`.toLowerCase().includes(query))),
  [reordering, items, sorted, c, on, query]);

  // Rows get one action function that never changes, reading the list as it
  // is at the moment of the tap. The layout effect keeps it current before
  // the browser can deliver another tap.
  const latest = useRef({ c, onSave });
  useLayoutEffect(() => { latest.current = { c, onSave }; });
  const act = useCallback((type, id, d) => {
    if (type === 'edit') { setEditing(id); return; }
    const { c: now, onSave: save } = latest.current;
    if (type === 'step') {
      save({ ...now, items: now.items.map((x) => (x.id === id ? withStatus(x, nextStage(now, x)) : x)) });
      return;
    }
    const i = now.items.findIndex((x) => x.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= now.items.length) return;
    const next = [...now.items];
    [next[i], next[j]] = [next[j], next[i]];
    save({ ...now, items: next });
    setMoved({ id, d });
  }, []);

  // Swapping two rows can pull the focused arrow out of the page and put it
  // back, which drops keyboard focus. Hand it back so the next press works.
  useEffect(() => {
    if (!moved) return;
    const find = (d) => document.querySelector(`[data-move="${CSS.escape(`${moved.id}:${d}`)}"]`);
    const same = find(moved.d);
    (same && !same.disabled ? same : find(-moved.d))?.focus();
  }, [moved]);

  const put = (next) => onSave({ ...c, items: next });

  // New entries land in whatever stage you are looking at, so adding to the
  // "Watched" view does not make the new entry vanish from it.
  const add = (t) => {
    if (items.length >= ITEM_CAP) return [false, `This list is full at ${ITEM_CAP}. Start another one.`];
    put([withStatus({
      id: uid(), title: t, detail: '', status: 'want', rating: 0, link: '', note: '',
      from: null, addedOn: todayStr(), doneOn: null,
    }, on === 'all' ? 'want' : on), ...items]);
    setQ('');
    return [true, `Added ${t}${on === 'all' ? '' : ` as ${stageLabel(c, on).toLowerCase()}`}.`];
  };

  const saveItem = (it) => { put(items.map((x) => (x.id === it.id ? it : x))); setEditing(null); };
  const removeItem = (id) => { put(items.filter((x) => x.id !== id)); setEditing(null); };

  // Numbers only where they mean something: a plain list's ranking, or while
  // reordering. Anywhere else a number would change on every row each time
  // one entry was added above them.
  const numbered = used.length === 0 || reordering;

  return (
    <div>
      <button className="crm-btn" onClick={onBack} style={{
        font: 'inherit', fontSize: 13, fontWeight: 600, color: C.muted, background: 'transparent',
        border: 'none', padding: '0 0 12px', cursor: 'pointer',
      }}>
        ← All lists
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{
          margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em', minWidth: 0,
          overflowWrap: 'anywhere',
        }}>{c.name}</h1>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <Button onClick={() => setSharing(!sharing)} style={small}>{sharing ? 'Done sharing' : 'Share'}</Button>
          <Button onClick={onEdit} style={small}>Edit list</Button>
        </div>
      </div>

      <p style={{ margin: '7px 0 0', fontSize: 13, color: C.muted, display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {c.kind !== 'Other' && <span style={kindChip()}>{c.kind}</span>}
        <span>{items.length} {items.length === 1 ? k.one : k.many}</span>
      </p>

      {c.note && (
        <p className="crm-serif" style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.6, color: C.ink }}>{c.note}</p>
      )}

      {used.length > 0 && items.length > 0 && <Progress c={c} n={counts} />}

      {sharing && <SharePanel c={c} people={people} owner={owner} />}

      <QuickAdd
        label={k.add}
        placeholder={on === 'all' ? k.add : `${k.add} as ${stageLabel(c, on).toLowerCase()}`}
        onAdd={add}
      />

      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 12px' }}>
          {!reordering && used.length > 0 && (
            <>
              <button className="crm-btn" onClick={() => setStage('all')} aria-pressed={on === 'all'}
                style={filterChip(on === 'all')}>
                All <span style={{ opacity: 0.7 }}>{items.length}</span>
              </button>
              {used.map((s) => (
                <button key={s} className="crm-btn" onClick={() => setStage(s)} aria-pressed={on === s}
                  style={filterChip(on === s)}>
                  {stageLabel(c, s)} <span style={{ opacity: 0.7 }}>{counts[s]}</span>
                </button>
              ))}
            </>
          )}
          <div style={{ display: 'flex', gap: 7, marginLeft: 'auto' }}>
            {!reordering && (
              <select
                className="crm-select"
                aria-label="Order"
                value={c.sort}
                onChange={(e) => onSave({ ...c, sort: e.target.value }, false)}
                style={{
                  ...inputStyle, width: 'auto', minHeight: 34, padding: '5px 11px',
                  fontSize: 12.5, fontWeight: 600, color: C.muted,
                }}
              >
                {COLLECTION_SORTS
                  .filter(([v]) => v !== 'status' || used.length > 0 || c.sort === 'status')
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            {(reordering || (c.sort === 'manual' && items.length > 1)) && (
              <Button onClick={() => { setReordering(!reordering); setEditing(null); }} style={small}>
                {reordering ? 'Done' : 'Reorder'}
              </Button>
            )}
          </div>
        </div>
      )}

      {reordering && (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
          Use the arrows to move things up and down. Press Done when it is in the order you want.
        </p>
      )}

      {!reordering && (items.length > 8 || query) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={{ ...inputStyle, minHeight: 38, fontSize: 14 }} value={q}
            aria-label={`Search ${k.many}`}
            onChange={(e) => setQ(e.target.value)} placeholder={`Search these ${k.many}`} />
          {query && <Button onClick={() => setQ('')} style={small}>Clear</Button>}
        </div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: '2px 0 0' }}>
          Nothing on it yet. Type the first {k.one} above and press Enter.
        </p>
      ) : shown.length === 0 ? (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: 0 }}>
          {query
            ? 'Nothing matches that. Try a looser search, or set it back to All.'
            : `Nothing marked ${stageLabel(c, on).toLowerCase()} yet.`}
        </p>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: C.surface }}>
          {shown.map((it, i) => (editing === it.id ? (
            <ItemEditor key={it.id} c={c} it={it} people={people}
              onSave={saveItem} onRemove={removeItem} onCancel={() => setEditing(null)}
              onTrip={c.kind === 'Places' ? onTrip : undefined} />
          ) : (
            <ItemRow key={it.id} shape={shape} it={it} from={names.get(it.from) || ''}
              n={numbered ? i + 1 : null} first={reordering && i === 0} last={reordering && i === shown.length - 1}
              reordering={reordering} act={act} />
          )))}
        </div>
      )}

      <div style={{
        marginTop: 22, borderTop: `1px solid ${C.line}`, paddingTop: 12,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ flex: 1, fontSize: 12, color: C.faint }}>Started {prettyDate(c.addedOn)}</span>
        <Button kind="danger" onClick={() => (confirm ? onRemove() : setConfirm(true))}
          style={{ fontSize: 12.5, padding: '6px 8px', ...(confirm ? { fontWeight: 700 } : {}) }}>
          {confirm ? 'Tap again to remove the list' : 'Remove this list'}
        </Button>
      </div>
    </div>
  );
}

/* ---------- lists: the tab ---------- */
const LIST_ORDERS = [['recent', 'Recently changed'], ['name', 'A to Z'], ['size', 'Biggest first']];

// One shared empty array, so a card that matched nothing keeps the same prop
// from one keystroke to the next and can skip redrawing.
const NO_MATCHES = Object.freeze([]);

const CollectionCard = memo(function CollectionCard({ c, found, onOpen }) {
  const k = kindOf(c.kind);
  const used = stagesOf(c);
  const n = c.items.length;
  const counts = tally(c);
  const peek = (found.length ? found : sortItems(c, c.items)).slice(0, 4).map((it) => it.title);
  const more = (found.length || n) - peek.length;

  // A flex column, because a button centres what is inside it, and cards in
  // a row share the tallest one's height: shorter ones would sit lower down.
  return (
    <button className="crm-btn" onClick={() => onOpen(c.id)} style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      width: '100%', textAlign: 'left', font: 'inherit', color: C.ink,
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: '14px 15px 13px', cursor: 'pointer',
    }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 16.5, fontWeight: 600, letterSpacing: '-0.02em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{c.name}</span>
        {c.kind !== 'Other' && <span style={kindChip()}>{c.kind}</span>}
      </span>
      <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 3 }}>
        {n === 0 ? 'Nothing on it yet' : `${n} ${n === 1 ? k.one : k.many}`}
        {used.length > 0 && n > 0 ? ` · ${counts.done} ${stageLabel(c, 'done').toLowerCase()}` : ''}
        {counts.doing > 0 ? ` · ${counts.doing} ${stageLabel(c, 'doing').toLowerCase()}` : ''}
      </span>
      {used.length > 0 && n > 0 && <Progress c={c} n={counts} thin />}
      {peek.length > 0 && (
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontSize: 13, color: C.muted, marginTop: 10, lineHeight: 1.45,
        }}>
          {found.length > 0 && <span style={{ color: C.faint }}>{found.length} matching: </span>}
          {peek.join(' · ')}{more > 0 ? ` and ${more} more` : ''}
        </span>
      )}
    </button>
  );
});

// look: where the search, kind and order are kept while a list is open, so
// coming back from one returns to the view you left rather than a fresh one.
function CollectionsView({ collections, look, incoming, onOpen, onNew, onTakeShared, onDropShared }) {
  const [q, setQ] = useState(look.current.q);
  const [kind, setKind] = useState(look.current.kind);
  const [order, setOrder] = useState(look.current.order);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => { look.current = { q, kind, order }; }, [look, q, kind, order]);

  const query = q.trim().toLowerCase();
  const kindsPresent = COLLECTION_KINDS.map((x) => x.kind).filter((x) => collections.some((c) => c.kind === x));
  const onKind = kindsPresent.includes(kind) ? kind : 'All';
  const narrowed = Boolean(query) || onKind !== 'All';

  // A search looks inside lists as well as at their names, and a list found
  // by what is on it shows those entries instead of its first few.
  const shown = useMemo(() => collections
    .filter((c) => onKind === 'All' || c.kind === onKind)
    .map((c) => {
      const found = query
        ? c.items.filter((it) => `${it.title} ${it.detail} ${it.note}`.toLowerCase().includes(query))
        : NO_MATCHES;
      return { c, found: found.length ? found : NO_MATCHES, named: !query || `${c.name} ${c.note}`.toLowerCase().includes(query) };
    })
    .filter((x) => x.named || x.found.length > 0)
    .sort((a, b) => {
      if (order === 'name') return SHELF.compare(a.c.name, b.c.name);
      if (order === 'size') return b.c.items.length - a.c.items.length;
      return (b.c.updatedAt || '').localeCompare(a.c.updatedAt || '');
    }), [collections, onKind, query, order]);

  const takePaste = () => {
    const got = readShared(paste);
    if (!got) {
      setProblem('That does not look like a shared list. Paste the whole link, or the code at the end of it.');
      return;
    }
    onTakeShared(got);
    setPaste('');
    setPasting(false);
    setProblem('');
  };

  let head = 'No lists yet';
  let sub = 'Shows to watch, books to read, the collection you are building. Anything worth keeping a list of.';
  if (collections.length > 0) {
    if (narrowed) {
      head = `${countThings(shown.length, 'list', 'lists')} ${shown.length === 1 ? 'matches' : 'match'}`;
      sub = query ? 'Looking through every list and everything on them.' : `Showing ${onKind} lists only.`;
    } else {
      head = `${countThings(collections.length, 'list', 'lists')} on the go`;
      sub = order === 'name' ? 'A to Z.' : order === 'size' ? 'Biggest first.' : 'Most recently changed first.';
    }
  }

  const inKind = incoming?.c ? kindOf(incoming.c.kind) : null;

  return (
    <div>
      {incoming && (
        <div className="crm-open" style={{
          background: C.accentSoft, border: `1px solid ${C.accent}`, borderRadius: 12,
          padding: '14px 15px', marginBottom: 20,
        }}>
          {incoming.broken ? (
            <>
              <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: C.ink }}>
                That shared list could not be read
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                The link may have been cut short on its way here. Ask for it again, or ask for the
                text instead.
              </p>
              <Button onClick={onDropShared} style={small}>Close</Button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 3px', fontSize: 12.5, color: C.muted }}>
                {incoming.by ? `${incoming.by} shared a list with you` : 'A list was shared with you'}
              </p>
              <p style={{ margin: '0 0 3px', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink }}>
                {incoming.c.name}
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                {incoming.c.items.length === 0
                  ? 'Nothing on it yet.'
                  : `${incoming.c.items.length} ${incoming.c.items.length === 1 ? inKind.one : inKind.many}: ${incoming.c.items.slice(0, 4).map((it) => it.title).join(', ')}${incoming.c.items.length > 4 ? ', and more' : ''}.`}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button kind="solid" onClick={() => onTakeShared(incoming)} style={small}>Add to my lists</Button>
                <Button onClick={onDropShared} style={small}>Not now</Button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>{head}</h1>
        <Button kind="solid" onClick={() => onNew(null)} style={{ marginLeft: 'auto' }}>New list</Button>
      </div>

      {collections.length === 0 && <EmptySky />}

      <p style={{ margin: '0 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{sub}</p>

      {collections.length === 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: C.faint,
          }}>Start a list of</p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {COLLECTION_KINDS.map((x) => (
              <button key={x.kind} className="crm-btn" onClick={() => onNew(x.kind)} style={filterChip(false)}>
                {x.kind === 'Other' ? 'Something else' : x.kind}
              </button>
            ))}
          </div>
        </div>
      )}

      {collections.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              style={inputStyle}
              value={q}
              aria-label="Search lists"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lists and everything on them"
            />
            {query && <Button onClick={() => setQ('')}>Clear</Button>}
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
            {kindsPresent.length > 1 && (
              <>
                <button className="crm-btn" onClick={() => setKind('All')} aria-pressed={onKind === 'All'}
                  style={filterChip(onKind === 'All')}>All</button>
                {kindsPresent.map((x) => (
                  <button key={x} className="crm-btn" onClick={() => setKind(x)} aria-pressed={onKind === x}
                    style={filterChip(onKind === x)}>{x}</button>
                ))}
              </>
            )}
            <select
              className="crm-select"
              aria-label="Order"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              style={{
                ...inputStyle, width: 'auto', marginLeft: 'auto',
                minHeight: 34, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, color: C.muted,
              }}
            >
              {LIST_ORDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </>
      )}

      {collections.length > 0 && shown.length === 0 && (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: 0 }}>
          Nothing matches that. Try a looser search, or set the kind back to All.
        </p>
      )}

      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
          {shown.map(({ c, found }) => <CollectionCard key={c.id} c={c} found={found} onOpen={onOpen} />)}
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        {pasting ? (
          <div className="crm-open" style={{
            background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 15px',
          }}>
            <Field label="Paste a shared list">
              <textarea
                autoFocus
                value={paste}
                aria-invalid={Boolean(problem) || undefined}
                aria-describedby={problem ? 'crm-paste-problem' : undefined}
                onChange={(e) => { setPaste(e.target.value); setProblem(''); }}
                placeholder="The Orbit link someone sent you, or the code at the end of it"
                style={{ ...inputStyle, minHeight: 72, fontSize: 13, lineHeight: 1.45, resize: 'vertical' }}
              />
            </Field>
            {problem && (
              <p id="crm-paste-problem" style={{ margin: '-4px 0 10px', fontSize: 13, color: C.overdue }}>{problem}</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button kind="solid" onClick={takePaste} style={small}>Add it</Button>
              <Button onClick={() => { setPasting(false); setPaste(''); setProblem(''); }} style={small}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button className="crm-btn" onClick={() => setPasting(true)} style={{
            font: 'inherit', fontSize: 13, fontWeight: 600, color: C.muted, background: 'transparent',
            border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
            textDecorationColor: C.line, textUnderlineOffset: 3,
          }}>
            Add a shared list
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- trips: maps ---------- */
// Leaflet is only fetched the first time a map is shown. A failed fetch
// (offline, say) is not remembered, so Try again really tries again.
// The country and state outlines (geo.js) load the same way, on first need.
let geoModule = null;
let geoLoading = null;
const loadGeo = () => {
  if (!geoLoading) {
    geoLoading = import('./geo.js')
      .then((m) => { geoModule = m; return m; })
      .catch((e) => { geoLoading = null; throw e; });
  }
  return geoLoading;
};

// The outlines module once loaded, else null. where(stop) → { country, state },
// or null until then (or if they cannot load, when the counts that need them
// are left out).
const useGeo = (wanted = true) => {
  const [mod, setMod] = useState(geoModule);
  useEffect(() => {
    if (mod || !wanted) return undefined;
    let live = true;
    loadGeo().then((m) => { if (live) setMod(m); }).catch(() => { /* counted without them */ });
    return () => { live = false; };
  }, [mod, wanted]);
  const where = useMemo(() => (mod ? (st) => mod.whereIs(st.lat, st.lng) : null), [mod]);
  return { geo: mod, where };
};

let mapsModule = null;
let mapsLoading = null;
const loadMaps = () => {
  if (!mapsLoading) {
    mapsLoading = import('./TripMap.jsx')
      .then((m) => { mapsModule = m; return m; })
      .catch((e) => { mapsLoading = null; throw e; });
  }
  return mapsLoading;
};

// Anything going wrong inside the map stays inside its box.
class MapBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <MapNote height={this.props.height}>
          The map ran into a problem.{' '}
          <button className="crm-btn" onClick={() => this.setState({ failed: false })} style={textButton()}>Try again</button>
        </MapNote>
      );
    }
    return this.props.children;
  }
}

function MapNote({ height, children }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      boxSizing: 'border-box', background: C.paper, textAlign: 'center',
    }}>
      <p role="status" style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

// render(module) draws the map once Leaflet has arrived.
function MapSlot({ height, render }) {
  const [mod, setMod] = useState(mapsModule);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (mod) return undefined;
    let live = true;
    loadMaps().then((m) => { if (live) setMod(m); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [mod, attempt]);
  if (failed) {
    return (
      <MapNote height={height}>
        The map could not load. Check the connection.{' '}
        <button className="crm-btn" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }} style={textButton()}>
          Try again
        </button>
      </MapNote>
    );
  }
  if (!mod) return <MapNote height={height}>Loading the map…</MapNote>;
  return <MapBoundary height={height}>{render(mod)}</MapBoundary>;
}

// A button that reads as a link in running text.
const textButton = () => ({
  font: 'inherit', fontSize: 'inherit', fontWeight: 600, color: C.ink, background: 'transparent',
  border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
  textDecorationColor: C.faint, textUnderlineOffset: 3,
});

const mapFrame = () => ({
  position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.line}`,
  // Leaflet's layers carry z-indexes in the hundreds. Isolating them keeps
  // them under the menu and anything else drawn over the page.
  isolation: 'isolate',
});

function RatingLegend({ plans = new Set() }) {
  const hollow = (st) => (
    <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden="true" style={{
        width: 18, height: 18, borderRadius: 18, background: '#fff', boxSizing: 'border-box',
        border: `${st === 'planned' ? '3px solid' : '2px dashed'} ${PLAN_COLORS[st]}`,
      }} />
      {PLAN_WORDS[st]}
    </span>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 9, fontSize: 12, color: C.muted }}>
      {['planned', 'someday'].filter((st) => plans.has(st)).map(hollow)}
      {[5, 4, 3, 2, 1, 0].map((r) => (
        <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{
            width: 18, height: 18, borderRadius: 18, background: ratingColor(r), color: '#fff',
            fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{r || ''}</span>
          {r === 5 ? '5 stars' : r ? `${r === 1 ? 0.5 : r} to ${r + 0.5} stars` : 'Not rated'}
        </span>
      ))}
    </div>
  );
}

/* ---------- trips: photos on screen ---------- */
const photoAlt = (title, i) => `${title || 'Trip'}, photo ${i + 1}`;

// An object URL for one stored photo, made when it is needed and revoked when
// the thing showing it goes away, so browsing photos does not leak memory.
const usePhotoUrl = (id, full) => {
  const [got, setGot] = useState({ id: null, url: null, missing: false });
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    let made = null;
    (full ? photoStore.get(id) : photoStore.getThumbnail(id))
      .then((blob) => {
        if (!live) return;
        if (!blob) { setGot({ id, url: null, missing: true }); return; }
        made = URL.createObjectURL(blob);
        setGot({ id, url: made, missing: false });
      })
      .catch(() => { if (live) setGot({ id, url: null, missing: true }); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, full]);
  return got.id === id ? got : { id, url: null, missing: false };
};

function PhotoThumb({ id, alt, style, empty }) {
  const { url, missing } = usePhotoUrl(id, false);
  return (
    <div style={{ background: C.line, overflow: 'hidden', position: 'relative', ...style }}>
      {url ? (
        <img src={url} alt={alt} draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : missing || !id ? (empty || (
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: C.faint, textAlign: 'center', padding: 4,
        }}>{id ? 'Photo missing' : ''}</span>
      )) : null}
    </div>
  );
}

// Full size, one at a time. Arrow keys, swipes and the buttons all move
// through them; Escape or Close ends it and puts focus back where it was.
function Lightbox({ ids, start, title, onClose }) {
  const [i, setI] = useState(Math.min(Math.max(0, start), ids.length - 1));
  const n = ids.length;
  const { url, missing } = usePhotoUrl(ids[i], true);
  const box = useRef(null);
  const closer = useRef(null);
  const swipe = useRef(null);
  const go = useCallback((d) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closer.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, []);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Tab' && box.current) {
        // Keep Tab inside the viewer while it is open.
        const all = [...box.current.querySelectorAll('button')];
        if (!all.length) return;
        const first = all[0];
        const last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, onClose]);

  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || n < 2) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
  };

  const arrow = {
    font: 'inherit', fontSize: 22, lineHeight: 1, width: 46, height: 46, borderRadius: 46, cursor: 'pointer',
    background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  };

  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={`${title || 'Trip'} photos`}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(5,8,12,0.94)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', color: '#fff' }}>
        <span aria-live="polite" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
          {n > 1 ? `${i + 1} of ${n}` : ''}
        </span>
        <button ref={closer} className="crm-btn" onClick={onClose} style={{
          font: 'inherit', fontSize: 14, fontWeight: 600, color: '#fff', background: 'transparent',
          border: '1px solid rgba(255,255,255,0.45)', borderRadius: 7, padding: '7px 13px', cursor: 'pointer',
        }}>Close</button>
      </div>
      <div
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => { swipe.current = null; }}
        style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'pan-y pinch-zoom', padding: '0 8px 16px' }}
      >
        {url ? (
          <img src={url} alt={photoAlt(title, i)} draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }} />
        ) : (
          <p style={{ color: '#ccc', fontSize: 14 }}>{missing ? 'This photo is missing from this browser.' : 'Loading…'}</p>
        )}
        {n > 1 && (
          <>
            <button className="crm-btn" aria-label="Previous photo" onClick={() => go(-1)} style={{ ...arrow, left: 10 }}>‹</button>
            <button className="crm-btn" aria-label="Next photo" onClick={() => go(1)} style={{ ...arrow, right: 10 }}>›</button>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoGrid({ ids, title, onOpen }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
      {ids.map((id, i) => (
        <button key={id} className="crm-btn" onClick={() => onOpen(i)}
          aria-label={`Open ${photoAlt(title, i)}`}
          style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', borderRadius: 8, display: 'block' }}>
          <PhotoThumb id={id} alt={photoAlt(title, i)} style={{ aspectRatio: '1 / 1', borderRadius: 8 }} />
        </button>
      ))}
    </div>
  );
}

/* ---------- trips: small pieces ---------- */
function Stars({ n, size = 13.5 }) {
  if (!n) return null;
  return (
    <span role="img" aria-label={`${n} out of 5 stars`}
      style={{ display: 'inline-flex', gap: 1.5, alignSelf: 'center', whiteSpace: 'nowrap' }}>
      {[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} fill={starFill(n, i)} size={Math.round(size * 0.92)} on={C.soonBar} />)}
    </span>
  );
}

// Ten radio buttons dressed as five stars, the left half of each star for the
// half step, so arrow keys and screen readers work the way they do on any
// other choice. "Not rated" is a choice too, and gives back null.
function StarInput({ value, onChange, label = 'Rating' }) {
  const [hover, setHover] = useState(0);
  const name = useId();
  const shown = hover || value || 0;
  return (
    <fieldset style={{ border: 'none', margin: '0 0 14px', padding: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 13, color: C.muted, marginBottom: 5, fontWeight: 500, padding: 0 }}>{label}</legend>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <span style={{ display: 'inline-flex', gap: 2 }} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} style={{ position: 'relative', display: 'inline-block', padding: '2px 3px' }}>
              <StarGlyph fill={starFill(shown, i)} size={28} on={C.soonBar} off={C.faint} stroke={1.1} />
              {[i - 0.5, i].map((v) => (
                <label key={v} className="crm-star" onMouseEnter={() => setHover(v)} style={{
                  position: 'absolute', top: 0, bottom: 0, left: v === i ? '50%' : 0, width: '50%', cursor: 'pointer',
                }}>
                  <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)}
                    className="crm-sr" aria-label={starWord(v)} />
                  <span aria-hidden="true" style={{ display: 'block', height: '100%' }} />
                </label>
              ))}
            </span>
          ))}
        </span>
        <span aria-hidden="true" style={{ fontSize: 13, color: C.muted, minWidth: 34, marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
          {shown ? `${shown} / 5` : ''}
        </span>
        <label className="crm-star" style={{ cursor: 'pointer', marginLeft: 4, position: 'relative' }}>
          <input type="radio" name={name} value="0" checked={!value} onChange={() => onChange(null)} className="crm-sr" />
          <span style={{ ...filterChip(!value), display: 'inline-block' }}>Not rated</span>
        </label>
      </div>
    </fieldset>
  );
}

const iconButton = (disabled) => ({
  font: 'inherit', fontSize: 15, lineHeight: 1, width: 36, height: 36, borderRadius: 7, flexShrink: 0,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
  background: 'transparent', color: C.ink, border: `1px solid ${C.line}`,
});

const labelText = () => ({ display: 'block', fontSize: 13, color: C.muted, marginBottom: 5, fontWeight: 500 });

/* ---------- trips: adding a place ---------- */
// Type to search. Waits for a pause in typing, and the search itself keeps a
// small gap between requests (see searchPlaces).
// initial: something to search for straight away, such as a Places list entry.
function PlaceSearch({ onPick, initial = '' }) {
  const [q, setQ] = useState(initial);
  const [found, setFound] = useState({ status: 'idle', results: [] });
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const id = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setFound({ status: 'idle', results: [] });
      return undefined;
    }
    const ctl = new AbortController();
    setFound((f) => ({ ...f, status: 'searching' }));
    const t = setTimeout(async () => {
      const r = await searchPlaces(term, { signal: ctl.signal });
      if (r.status === 'aborted' || ctl.signal.aborted) return;
      setFound(r);
      setActive(r.results.length ? 0 : -1);
      setOpen(true);
    }, 550);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, attempt]);

  const pick = (r) => {
    onPick({ name: r.name, displayAddress: r.label, lat: r.lat, lng: r.lon });
    setQ('');
    setOpen(false);
  };

  const listed = open && found.status === 'ok' && found.results.length > 0;

  const key = (e) => {
    if (e.key === 'ArrowDown' && found.results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(found.results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && found.results.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (isEnter(e)) {
      e.preventDefault();
      if (listed && found.results[active]) pick(found.results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const term = q.trim();
  const status = found.status === 'searching' ? 'Looking…'
    : found.status === 'ok' ? (listed ? `${countThings(found.results.length, 'place', 'places')} found. Pick one to add it.` : '')
    : found.status === 'none' ? 'No match. Check the spelling, or try just the town or city.'
    : found.status === 'offline' ? 'Could not reach the place search. Check the connection, or pick the spot on the map or enter coordinates instead.'
    : term ? 'Keep typing…'
    : 'A town, landmark or address.';

  return (
    <div>
      <label htmlFor={`${id}q`} style={labelText()}>Search for a place</label>
      <input
        id={`${id}q`}
        role="combobox"
        aria-expanded={listed}
        aria-controls={`${id}list`}
        aria-autocomplete="list"
        aria-activedescendant={listed && active >= 0 ? `${id}o${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={key}
        placeholder="Lisbon, Portugal"
        style={inputStyle}
      />
      {listed && (
        <ul id={`${id}list`} role="listbox" aria-label="Places found" style={{
          listStyle: 'none', margin: '6px 0 0', padding: 0, border: `1px solid ${C.line}`,
          borderRadius: 8, overflow: 'hidden', background: C.surface,
        }}>
          {found.results.map((r, i) => (
            <li
              key={`${r.lat},${r.lon},${i}`}
              id={`${id}o${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
              style={{
                padding: '9px 12px', cursor: 'pointer', fontSize: 13.5, color: C.ink,
                background: i === active ? C.rowHover : C.surface,
                borderTop: i ? `1px solid ${C.line}` : 'none',
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2, overflowWrap: 'anywhere' }}>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
      <span aria-live="polite" style={hintStyle()}>
        {status}
        {found.status === 'offline' && (
          <>
            {' '}
            <button className="crm-btn" onClick={() => setAttempt((n) => n + 1)} style={textButton()}>Try again</button>
          </>
        )}
      </span>
    </div>
  );
}

function PinDrop({ stops, onAdd }) {
  const [pending, setPending] = useState(null);
  const [name, setName] = useState('');
  const pick = useCallback((p) => setPending(p), []);
  const id = useId();

  const add = () => {
    if (!pending) return;
    onAdd({ name: name.trim() || coordText(pending.lat, pending.lng), displayAddress: '', lat: pending.lat, lng: pending.lng });
    setPending(null);
    setName('');
  };

  return (
    <div>
      <div style={mapFrame()}>
        <MapSlot height={300} render={(m) => (
          <m.PickMap stops={stops} pending={pending} onPick={pick} stopColor={RATING_COLORS[5]} pendingColor={RATING_COLORS[1]} dark={C.dark} />
        )} />
      </div>
      {pending ? (
        <div style={{ marginTop: 10 }}>
          <label htmlFor={`${id}n`} style={labelText()}>Name this place</label>
          <input id={`${id}n`} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); add(); } }}
            placeholder="The cabin by the lake" style={inputStyle} />
          <span style={hintStyle()}>
            {`Pinned at ${coordText(pending.lat, pending.lng)}. Tap the map again to move it.`}
          </span>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            <Button kind="solid" onClick={add} style={small}>Add this place</Button>
            <Button onClick={() => { setPending(null); setName(''); }} style={small}>Clear the pin</Button>
          </div>
        </div>
      ) : (
        <span style={hintStyle()}>Tap the map where you went. Zoom in for a precise spot.</span>
      )}
    </div>
  );
}

function CoordEntry({ onAdd }) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [problem, setProblem] = useState('');
  const id = useId();

  const add = () => {
    const a = toCoord(lat);
    const b = toCoord(lng);
    if (!validLat(a)) { setProblem('Latitude is a number from -90 to 90.'); return; }
    if (!validLng(b)) { setProblem('Longitude is a number from -180 to 180.'); return; }
    onAdd({ name: name.trim() || coordText(a, b), displayAddress: '', lat: a, lng: b });
    setName('');
    setLat('');
    setLng('');
    setProblem('');
  };

  const small2 = { ...inputStyle, minHeight: 40, fontSize: 14 };
  return (
    <div>
      <label htmlFor={`${id}n`} style={labelText()}>Name</label>
      <input id={`${id}n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Base camp" style={{ ...small2, marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px' }}>
          <label htmlFor={`${id}a`} style={labelText()}>Latitude</label>
          <input id={`${id}a`} type="number" step="any" min="-90" max="90" value={lat}
            onChange={(e) => setLat(e.target.value)} placeholder="38.7223" style={small2} />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label htmlFor={`${id}b`} style={labelText()}>Longitude</label>
          <input id={`${id}b`} type="number" step="any" min="-180" max="180" value={lng}
            onChange={(e) => setLng(e.target.value)} placeholder="-9.1393" style={small2} />
        </div>
      </div>
      {problem && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: C.overdue }}>{problem}</p>}
      <Button kind="solid" onClick={add} style={{ ...small, marginTop: 10 }}>Add this place</Button>
    </div>
  );
}

// Search over everyone on your lists; picked people show as chips.
function CompanionPicker({ people, value, onChange }) {
  const [q, setQ] = useState('');
  const id = useId();
  const chosen = value.map((x) => people.find((p) => p.id === x)).filter(Boolean);
  const query = q.trim().toLowerCase();
  const options = people
    .filter((p) => !value.includes(p.id)
      && (!query || `${p.name} ${(p.aka || []).join(' ')}`.toLowerCase().includes(query)))
    .sort((a, b) => SHELF.compare(a.name, b.name))
    .slice(0, 8);

  if (people.length === 0) {
    return (
      <Group label="Who went with you">
        <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Nobody on your lists yet. Trips work fine without anyone attached.</p>
      </Group>
    );
  }

  return (
    <Group label="Who went with you">
      {chosen.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {chosen.map((p) => (
            <button key={p.id} className="crm-btn" onClick={() => onChange(value.filter((x) => x !== p.id))}
              aria-label={`Remove ${p.name}`} style={{ ...filterChip(true), display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {p.name}<span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>×</span>
            </button>
          ))}
        </div>
      )}
      <input
        id={`${id}q`}
        aria-label="Find someone to add"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (isEnter(e)) {
            e.preventDefault();
            if (options[0]) { onChange([...value, options[0].id]); setQ(''); }
          }
        }}
        placeholder="Type a name"
        autoComplete="off"
        style={{ ...inputStyle, minHeight: 40, fontSize: 14 }}
      />
      {(query || chosen.length === 0) && options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {options.map((p) => (
            <button key={p.id} className="crm-btn" onClick={() => { onChange([...value, p.id]); setQ(''); }}
              style={filterChip(false)}>
              + {p.name}
            </button>
          ))}
        </div>
      )}
      {query && options.length === 0 && (
        <span style={hintStyle()}>Nobody by that name on your lists.</span>
      )}
    </Group>
  );
}

/* ---------- trips: the form ---------- */
const withKey = (s) => ({ ...s, _k: uid() });

// seed: how a new trip starts out when it comes from somewhere else, such as
// an entry on a Places list ({ title, status, query }).
function TripForm({ initial, seed, people, onSave, onCancel }) {
  // A new trip gets its id now, so its photos can be stored as they are added.
  const [id] = useState(() => initial?.id || uid());
  const [status, setStatus] = useState(() => (initial ? tripStatus(initial) : seed?.status || 'been'));
  const [title, setTitle] = useState(initial?.title || seed?.title || '');
  const [startDate, setStartDate] = useState(initial ? initial.startDate || '' : seed?.status && seed.status !== 'been' ? '' : todayStr());
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [stops, setStops] = useState(() => (initial?.stops || []).map(withKey));
  const [how, setHow] = useState('search');
  const [rating, setRating] = useState(initial?.rating || null);
  const [excerpt, setExcerpt] = useState(initial?.excerpt || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [companions, setCompanions] = useState(initial?.companions || []);
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [photoIds, setPhotoIds] = useState(initial?.photoIds || []);
  const [busy, setBusy] = useState(null);
  const [photoNotes, setPhotoNotes] = useState([]);
  const [errors, setErrors] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [said, setSaid] = useState('');
  const errorBox = useRef(null);
  const fid = useId();

  // Photos added during this edit are stored straight away. If the edit is
  // abandoned they are deleted again; photos taken off an existing trip are
  // only deleted once the change is saved, so Cancel really cancels.
  const fresh = useRef(new Set());
  const removed = useRef(new Set());
  const saved = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    const added = fresh.current;
    alive.current = true;
    return () => {
      alive.current = false;
      if (!saved.current && added.size) photoStore.deleteMany([...added]).catch(() => {});
    };
  }, []);

  const dateProblem = startDate && endDate && endDate < startDate ? 'The trip cannot end before it starts.' : '';

  const addStop = (s) => {
    if (stops.length >= STOP_CAP) { setSaid(`A trip holds up to ${STOP_CAP} places.`); return; }
    setStops((list) => [...list, withKey(s)]);
    setSaid(`Added ${s.name} as place ${stops.length + 1}.`);
  };
  const moveStop = (i, d) => setStops((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const dropStop = (i) => {
    setSaid(`Removed ${stops[i]?.name || 'that place'}.`);
    setStops((list) => list.filter((_, j) => j !== i));
  };
  const renameStop = (i, name) => setStops((list) => list.map((s, j) => (j === i ? { ...s, name } : s)));

  const addFiles = async (files) => {
    const notesOut = [];
    const room = PHOTO_CAP - photoIds.length;
    if (files.length > room) {
      notesOut.push(room <= 0
        ? `A trip holds up to ${PHOTO_CAP} photos, and this one is full.`
        : `A trip holds up to ${PHOTO_CAP} photos, so only the first ${room} of these ${files.length} were added.`);
    }
    const take = files.slice(0, Math.max(0, room));
    if (!take.length) { setPhotoNotes(notesOut); return; }
    setPhotoNotes([]);
    setBusy({ done: 0, total: take.length });
    for (let i = 0; i < take.length; i += 1) {
      const f = take[i];
      try {
        const prepared = await photoStore.processImage(f);
        const pid = `${uid()}${uid()}`;
        await photoStore.save({ id: pid, tripId: id, ...prepared });
        if (!alive.current) {
          // The form closed while this one was on its way in.
          photoStore.deleteMany([pid]).catch(() => {});
          return;
        }
        fresh.current.add(pid);
        setPhotoIds((ids) => [...ids, pid]);
      } catch (e) {
        notesOut.push(e instanceof photoStore.PhotoError ? e.message : `${f.name || 'A photo'} could not be added.`);
        if (e?.cause?.name === 'QuotaExceededError') break;
      }
      if (alive.current) setBusy({ done: i + 1, total: take.length });
    }
    if (!alive.current) return;
    setBusy(null);
    setPhotoNotes(notesOut);
  };

  const dropPhoto = (pid) => {
    setPhotoIds((ids) => ids.filter((x) => x !== pid));
    if (fresh.current.has(pid)) {
      fresh.current.delete(pid);
      photoStore.delete(pid).catch(() => {});
    } else {
      removed.current.add(pid);
    }
  };
  const coverPhoto = (pid) => setPhotoIds((ids) => [pid, ...ids.filter((x) => x !== pid)]);

  const save = () => {
    const errs = [];
    if (!title.trim()) errs.push('Give the trip a title.');
    if (status === 'been' && !startDate) errs.push('Add the day the trip started.');
    if (status === 'planned' && endDate && !startDate) errs.push('Add the day the trip starts, or leave both dates empty.');
    if (status !== 'someday' && dateProblem) errs.push(dateProblem);
    if (!stops.length) errs.push(status === 'been' ? 'Add at least one place you went.' : 'Add at least one place.');
    if (busy) errs.push('Wait for the photos to finish, then save.');
    if (errs.length) {
      setErrors(errs);
      requestAnimationFrame(() => errorBox.current?.focus());
      return;
    }
    const now = new Date().toISOString();
    const known = new Set(people.map((p) => p.id));
    const trip = cleanTrip({
      id,
      createdAt: initial?.createdAt || now,
      updatedAt: now,
      title,
      status,
      stops: stops.map(({ _k, ...s }) => s),
      startDate: startDate || null,
      endDate: endDate || null,
      rating,
      excerpt,
      notes,
      companions: companions.filter((c) => known.has(c)),
      photoIds,
      tags: splitTags(tags),
      fromEvent: initial?.fromEvent,
    });
    if (!trip) {
      setErrors(['That trip could not be saved. Check the dates and places.']);
      return;
    }
    saved.current = true;
    onSave(trip, [...removed.current]);
  };

  const section = { borderTop: `1px solid ${C.line}`, paddingTop: 14, marginTop: 4 };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, maxWidth: 720 }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>
        {initial ? 'Edit trip' : 'Add a trip'}
      </h1>

      {errors.length > 0 && (
        <div ref={errorBox} tabIndex={-1} role="alert" style={{
          margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
          color: C.ink, background: C.overdueSoft, border: `1px solid ${C.overdueBar}`,
        }}>
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <Group label="This trip is">
        <div role="group" aria-label="This trip is" style={{ display: 'flex', gap: 6, maxWidth: 420 }}>
          {[['been', 'Been'], ['planned', 'Planned'], ['someday', 'Someday']].map(([v, l]) => (
            <button key={v} className="crm-btn" aria-pressed={status === v} onClick={() => {
              // A new trip's date starts on today, which only suits one you took.
              if (!initial && v !== 'been' && startDate === todayStr() && !endDate) setStartDate('');
              if (!initial && v === 'been' && !startDate) setStartDate(todayStr());
              setStatus(v);
            }}
              style={{ ...segment(status === v), fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <span style={hintStyle()}>
          {status === 'been' ? 'A trip you took.' : status === 'planned' ? 'Booked or taking shape. Dates are optional.' : 'Somewhere you would like to go one day.'}
        </span>
      </Group>

      <Field label="Title">
        <input style={inputStyle} value={title} maxLength={TRIP_TITLE_CAP}
          onChange={(e) => setTitle(e.target.value)} placeholder={status === 'someday' ? 'See the northern lights' : 'A week in Portugal'} />
      </Field>

      {status !== 'someday' && (
        <Group label="When">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label htmlFor={`${fid}s`} style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>
                {status === 'been' ? 'Started' : 'Starts (optional)'}
              </label>
              <input id={`${fid}s`} type="date" style={inputStyle} value={startDate} required={status === 'been'}
                onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label htmlFor={`${fid}e`} style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>
                {status === 'been' ? 'Ended (optional)' : 'Ends (optional)'}
              </label>
              <input id={`${fid}e`} type="date" style={inputStyle} value={endDate} min={startDate || undefined}
                aria-invalid={Boolean(dateProblem)} aria-describedby={dateProblem ? `${fid}ed` : undefined}
                onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {dateProblem && <span id={`${fid}ed`} style={{ ...hintStyle(), color: C.overdue }}>{dateProblem}</span>}
          {!dateProblem && status === 'been' && startDate > todayStr() && (
            <span style={hintStyle()}>
              That is still to come.{' '}
              <button className="crm-btn" onClick={() => setStatus('planned')} style={textButton()}>Make it a planned trip</button>
            </span>
          )}
        </Group>
      )}

      <div style={section}>
        <Group label={status === 'been' ? 'Where you went' : 'Where'}>
          {stops.length === 0 ? (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: C.faint }}>No places yet. Add at least one below.</p>
          ) : (
            <ol style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'grid', gap: 8 }}>
              {stops.map((s, i) => (
                <li key={s._k} style={{
                  display: 'flex', gap: 9, alignItems: 'flex-start', border: `1px solid ${C.line}`,
                  borderRadius: 10, padding: '9px 10px', background: C.paper,
                }}>
                  <span aria-hidden="true" style={{
                    width: 24, height: 24, borderRadius: 24, flexShrink: 0, marginTop: 6, fontSize: 12, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: RATING_COLORS[5], color: '#fff',
                  }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input aria-label={`Name of place ${i + 1}`} value={s.name} maxLength={200}
                      onChange={(e) => renameStop(i, e.target.value)}
                      style={{ ...inputStyle, minHeight: 36, padding: '6px 9px', fontSize: 14 }} />
                    <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 4, overflowWrap: 'anywhere' }}>
                      {s.displayAddress || coordText(s.lat, s.lng)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="crm-btn" onClick={() => moveStop(i, -1)} disabled={i === 0}
                      aria-label={`Move ${s.name || `place ${i + 1}`} earlier`} style={iconButton(i === 0)}>↑</button>
                    <button className="crm-btn" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1}
                      aria-label={`Move ${s.name || `place ${i + 1}`} later`} style={iconButton(i === stops.length - 1)}>↓</button>
                    <button className="crm-btn" onClick={() => dropStop(i)}
                      aria-label={`Remove ${s.name || `place ${i + 1}`}`} style={{ ...iconButton(false), color: C.overdue }}>✕</button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
            <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: C.ink }}>
              {stops.length ? 'Add another place' : 'Add a place'}
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['search', 'Search'], ['map', 'Pick on map'], ['coords', 'Coordinates']].map(([v, l]) => (
                <button key={v} className="crm-btn" aria-pressed={how === v} onClick={() => setHow(v)}
                  style={{ ...segment(how === v), fontSize: 12.5 }}>{l}</button>
              ))}
            </div>
            {how === 'search' && <PlaceSearch onPick={addStop} initial={initial ? '' : seed?.query || ''} />}
            {how === 'map' && <PinDrop stops={stops} onAdd={addStop} />}
            {how === 'coords' && <CoordEntry onAdd={addStop} />}
          </div>
          <p aria-live="polite" className="crm-sr">{said}</p>
        </Group>
      </div>

      <div style={section}>
        {status === 'been' && <StarInput value={rating} onChange={setRating} />}

        <Field label="The highlight">
          <textarea
            className="crm-serif"
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical', lineHeight: 1.5 }}
            value={excerpt}
            maxLength={EXCERPT_CAP}
            aria-describedby={`${fid}x`}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Pastéis de nata still warm at the counter, every single morning."
          />
          <span id={`${fid}x`} style={{ ...hintStyle(), display: 'flex', gap: 8 }}>
            <span style={{ flex: 1 }}>Shows on the map and in the list.</span>
            <span>{`${excerpt.length}/${EXCERPT_CAP}`}</span>
          </span>
        </Field>

        <Field label="Notes">
          <textarea
            className="crm-serif"
            style={{ ...inputStyle, minHeight: 140, resize: 'vertical', lineHeight: 1.6 }}
            value={notes}
            maxLength={TRIP_NOTES_CAP}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write as much as you want. This is the part you will be glad you kept."
          />
        </Field>

        <CompanionPicker people={people} value={companions} onChange={setCompanions} />

        <Field label="Tags">
          <input style={inputStyle} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="beach, family, road trip" />
          <span style={hintStyle()}>Separate them with commas.</span>
        </Field>
      </div>

      <div style={section}>
        <Group label={`Photos (${photoIds.length} of ${PHOTO_CAP})`}>
          {photoIds.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginBottom: 10 }}>
              {photoIds.map((pid, i) => (
                <div key={pid} style={{ position: 'relative' }}>
                  <button className="crm-btn" onClick={() => setViewing(i)} aria-label={`View ${photoAlt(title, i)}`}
                    style={{ padding: 0, border: 'none', background: 'none', width: '100%', display: 'block', cursor: 'zoom-in', borderRadius: 8 }}>
                    <PhotoThumb id={pid} alt={photoAlt(title, i)} style={{ aspectRatio: '1 / 1', borderRadius: 8 }} />
                  </button>
                  <button className="crm-btn" onClick={() => dropPhoto(pid)} aria-label={`Remove photo ${i + 1}`} style={{
                    position: 'absolute', top: 5, right: 5, width: 30, height: 30, borderRadius: 30, cursor: 'pointer',
                    font: 'inherit', fontSize: 14, lineHeight: 1, color: '#fff', background: 'rgba(0,0,0,0.6)',
                    border: '1px solid rgba(255,255,255,0.7)',
                  }}>✕</button>
                  {i === 0 ? (
                    <span style={{ display: 'block', fontSize: 11.5, color: C.faint, padding: '5px 2px' }}>Cover photo</span>
                  ) : (
                    <button className="crm-btn" onClick={() => coverPhoto(pid)} aria-label={`Make photo ${i + 1} the cover`}
                      style={{ ...textButton(), fontSize: 11.5, fontWeight: 500, color: C.muted, padding: '5px 2px' }}>Make cover</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <label className="crm-file crm-btn" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative',
            fontSize: 14, fontWeight: 600, padding: '9px 14px', borderRadius: 7,
            border: `1px solid ${C.line}`, color: C.ink,
            cursor: busy || photoIds.length >= PHOTO_CAP ? 'default' : 'pointer',
            opacity: busy || photoIds.length >= PHOTO_CAP ? 0.55 : 1,
          }}>
            <input type="file" accept="image/*,.heic,.heif" multiple className="crm-sr"
              disabled={Boolean(busy) || photoIds.length >= PHOTO_CAP}
              onChange={(e) => {
                const files = [...(e.target.files || [])];
                e.target.value = '';
                if (files.length) addFiles(files);
              }} />
            Add photos
          </label>
          <span style={hintStyle()}>
            Resized to 1600 pixels and saved as JPEG. Where they were taken, and other camera details, are left out.
          </span>

          {busy && (
            <div role="status" style={{ marginTop: 10 }}>
              <progress value={busy.done} max={busy.total} aria-label="Preparing photos"
                style={{ width: '100%', accentColor: C.accentDeep }} />
              <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                {`Preparing photo ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…`}
              </span>
            </div>
          )}
          {photoNotes.length > 0 && (
            <div role="alert" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: C.overdue }}>
              {photoNotes.map((m, i) => <p key={i} style={{ margin: '0 0 4px' }}>{m}</p>)}
            </div>
          )}
        </Group>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button kind="solid" onClick={save} style={{ flex: 1 }} aria-disabled={Boolean(busy)}>
          {initial ? 'Save changes' : 'Save trip'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>

      {viewing !== null && photoIds.length > 0 && (
        <Lightbox ids={photoIds} start={viewing} title={title} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/* ---------- trips: one trip ---------- */
// Sent the same ways as a person's card (see PersonShare): a link, a QR code
// of it, or an .orbit file. Photos only fit in the file.
const TripSharePanel = memo(function TripSharePanel({ trip, owner }) {
  const [notes, setNotes] = useState(false);
  const [withPhotos, setWithPhotos] = useState(false);
  const [by, setBy] = useState(owner || '');
  const [said, setSaid] = useState('');
  const [fallback, setFallback] = useState('');
  const [qr, setQr] = useState(false);
  const [size, setSize] = useState(null);
  const [making, setMaking] = useState(false);
  const count = trip.photoIds.length;

  // The link is tied to the choices it was made from. Until the new one is
  // ready nothing can be sent, so notes just unticked can never go out in a
  // link made a moment before.
  const opts = useMemo(() => ({ notes, by: by.trim() }), [notes, by]);
  const [made, setMade] = useState({ trip: null, opts: null, code: '' });
  useEffect(() => {
    let live = true;
    tripSharePayload(trip, opts).then(encodeShare)
      .then((code) => { if (live) setMade({ trip, opts, code }); }, () => { if (live) setMade({ trip, opts, code: '' }); });
    return () => { live = false; };
  }, [trip, opts]);
  const ready = made.trip === trip && made.opts === opts && Boolean(made.code);
  const link = ready ? shareLink(made.code) : '';
  const tooLong = link.length > SHARE_LINK_CAP;
  const text = useMemo(() => tripText(trip, { notes }), [trip, notes]);
  const canSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const fileName = `${fileSlug(trip.title)}.orbit`;

  useEffect(() => {
    if (!withPhotos || size !== null) return undefined;
    let live = true;
    photoStore.listAll()
      .then((all) => {
        const mine = new Set(trip.photoIds);
        // Base64 writes every three bytes as four characters.
        if (live) setSize(Math.round(all.filter((p) => mine.has(p.id)).reduce((n, p) => n + p.size + p.thumbSize, 0) * 1.34));
      })
      .catch(() => { if (live) setSize(0); });
    return () => { live = false; };
  }, [withPhotos, size, trip.photoIds]);

  const copy = async (value, what) => {
    track('share.trip', { how: /link/i.test(what) ? 'link' : 'text' });
    try {
      await navigator.clipboard.writeText(value);
      setSaid(`${what} is copied. Send it however you like.`);
      setFallback('');
    } catch {
      setSaid('Copying was blocked here. Select the text below and copy it yourself.');
      setFallback(value);
    }
  };
  const sheet = async () => {
    try {
      track('share.trip', { how: 'sheet' });
      await navigator.share({ title: trip.title, text: `${opts.by || 'Someone'} shared a trip from Orbit: ${trip.title}.`, url: link });
    } catch (e) {
      if (e?.name !== 'AbortError') copy(link, 'The link');
    }
  };

  const makeFile = async () => {
    const photos = withPhotos
      ? (await Promise.all(trip.photoIds.map((id) => photoStore.getRecord(id).catch(() => null)))).filter(Boolean)
      : [];
    const payload = await tripSharePayload(trip, { ...opts, photos });
    return new File([shareFileText(payload)], fileName, { type: 'application/json' });
  };

  const saveFile = async (tryShare) => {
    track('share.trip', { how: 'file', photos: withPhotos });
    setSaid('');
    setMaking(true);
    let file;
    try {
      file = await makeFile();
    } catch {
      setMaking(false);
      setSaid('The file could not be made. Try again.');
      return;
    }
    setMaking(false);
    if (tryShare && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: trip.title });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    setSaid(downloadBlob(file.name, file)
      ? `Saved ${file.name}. They open it from Import in their Orbit.`
      : 'This browser would not save the file.');
  };

  return (
    <div className="crm-open" style={{
      background: C.paper, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 14px 12px', margin: '16px 0 0',
    }}>
      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 600, color: C.ink }}>Send a copy of this trip</p>
      <p style={{ margin: '0 0 13px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        They get their own copy to keep and change. Places, dates, rating, highlight and tags always go.
        Who went with you never does.
      </p>
      <Check on={notes} onChange={setNotes} label="Include my notes" hint="Anyone with the link can read them." />
      {count > 0 && (
        <Check on={withPhotos} onChange={setWithPhotos} label={`Include photos (${count})`}
          hint={withPhotos
            ? `Photos only travel in a file${size ? `, about ${approxBytes(size)} with these` : ''}.`
            : 'Off keeps the copy small. Photos only travel in a file.'} />
      )}

      <Field label="From">
        <input style={{ ...inputStyle, minHeight: 38 }} value={by} maxLength={60} onChange={(e) => setBy(e.target.value)}
          placeholder="Your name, so they know who sent it" />
      </Field>

      {withPhotos ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
          A link or QR code cannot carry photos, so this one goes as a file.
        </p>
      ) : tooLong ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.soonText, lineHeight: 1.5 }}>
          This is too long for a link that arrives in one piece. Save it as a file instead.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {canSheet && <Button kind="solid" onClick={() => ready && sheet()} style={small}>{ready ? 'Share…' : 'Getting it ready…'}</Button>}
          <Button kind={canSheet ? 'quiet' : 'solid'} onClick={() => ready && copy(link, 'The link')} style={small}>Copy link</Button>
          <Button onClick={() => ready && setQr(!qr)} style={small}>{qr ? 'Hide QR code' : 'QR code'}</Button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {withPhotos && canSheet && (
          <Button kind="solid" onClick={() => saveFile(true)} style={small} disabled={making}>Share the file…</Button>
        )}
        <Button kind={withPhotos && !canSheet ? 'solid' : 'quiet'} onClick={() => saveFile(false)} style={small} disabled={making}>
          {making ? 'Making the file…' : 'Save as file'}
        </Button>
        {!withPhotos && <Button onClick={() => copy(text, 'The trip')} style={small}>Copy as text</Button>}
      </div>

      {qr && ready && !tooLong && !withPhotos && (
        <div style={{ marginTop: 12 }}>
          {link.length > SHARE_QR_CAP ? (
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
              Too much for a QR code a phone can read. Untick the notes, or send the link.
            </p>
          ) : (
            <>
              <QrCode text={link} label={`QR code for the trip ${trip.title}`} />
              <p style={{ margin: '8px 0 0', fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                They point their phone’s camera at it and open the link.
              </p>
            </>
          )}
        </div>
      )}

      <p aria-live="polite" style={{ margin: said ? '10px 0 0' : 0, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{said}</p>
      {fallback && (
        <textarea readOnly aria-label="Text to copy" onFocus={(e) => e.target.select()} value={fallback}
          style={{ ...inputStyle, marginTop: 8, minHeight: 90, fontSize: 12, lineHeight: 1.45, resize: 'vertical' }} />
      )}
    </div>
  );
});

const osmLink = (s) => `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=13/${s.lat}/${s.lng}`;

const PLAN_WORDS = { planned: 'Planned', someday: 'Someday' };

function TripDetail({ trip, people, owner, onEdit, onRemove, onBack, onPerson, onWent }) {
  const [confirm, setConfirm] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewing, setViewing] = useState(null);
  const who = trip.companions.map((id) => people.find((p) => p.id === id)).filter(Boolean);
  const when = tripWhen(trip);
  const heading = { margin: '0 0 7px', fontSize: 12.5, color: C.faint };

  return (
    <div style={{ maxWidth: 720 }}>
      <button className="crm-btn" onClick={onBack} style={{ ...textButton(), textDecoration: 'none', color: C.muted, fontSize: 13, marginBottom: 14 }}>
        ← All trips
      </button>
      <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.035em' }}>{trip.title}</h1>
      <p style={{ margin: '6px 0 0', fontSize: 14, color: C.muted, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {trip.status && <span style={kindChip()}>{PLAN_WORDS[trip.status]}</span>}
        {(trip.startDate || trip.status === 'planned') && <span>{when.text}{when.days > 1 ? ` · ${when.days} days` : ''}</span>}
        <Stars n={trip.rating} size={16} />
      </p>
      {tripOverdue(trip) && (
        <div role="note" style={{
          marginTop: 14, padding: '12px 14px', borderRadius: 10, background: C.surface, border: `1px solid ${C.accent}`,
        }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, color: C.ink }}>The dates for this trip have passed. Did you go?</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="solid" onClick={onWent} style={small}>Yes, I went</Button>
            <Button onClick={onEdit} style={small}>Change the dates</Button>
          </div>
        </div>
      )}
      {trip.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {trip.tags.map((g) => <span key={g} style={kindChip()}>{g}</span>)}
        </div>
      )}

      {trip.excerpt && (
        <p className="crm-serif" style={{ margin: '16px 0 0', fontSize: 18, lineHeight: 1.5, color: C.ink }}>{trip.excerpt}</p>
      )}

      <div style={{ marginTop: 20 }}>
        <p style={heading}>{trip.stops.length === 1 ? 'Where' : `Where (${trip.stops.length} places)`}</p>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {trip.stops.map((s, i) => (
            <li key={`${i}-${s.lat}-${s.lng}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
              <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 700, color: C.faint, width: 16, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{s.name}</span>
                {s.displayAddress && s.displayAddress !== s.name && (
                  <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2, overflowWrap: 'anywhere' }}>{s.displayAddress}</span>
                )}
              </span>
              <a href={osmLink(s)} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontSize: 12, flexShrink: 0 }}>
                Map<span className="crm-sr">{` of ${s.name} (opens OpenStreetMap)`}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>

      {who.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={heading}>With</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {who.map((p) => (
              <button key={p.id} className="crm-btn" onClick={() => onPerson(p.id)} style={filterChip(false)}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {trip.photoIds.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={heading}>{`Photos (${trip.photoIds.length})`}</p>
          <PhotoGrid ids={trip.photoIds} title={trip.title} onOpen={setViewing} />
        </div>
      )}

      {trip.notes && (
        <div style={{ marginTop: 18 }}>
          <p style={heading}>Notes</p>
          <p className="crm-serif" style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: C.ink, whiteSpace: 'pre-wrap' }}>{trip.notes}</p>
        </div>
      )}

      {confirm ? (
        <div role="alert" style={{
          marginTop: 22, padding: '12px 14px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.5,
          color: C.ink, background: C.overdueSoft, border: `1px solid ${C.overdueBar}`,
        }}>
          <p style={{ margin: '0 0 10px' }}>
            {trip.photoIds.length
              ? `Delete this trip and its ${countThings(trip.photoIds.length, 'photo', 'photos').toLowerCase()}? This cannot be undone.`
              : 'Delete this trip? This cannot be undone.'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={onRemove} style={{ ...small, background: C.overdue, color: '#fff', borderColor: C.overdue }}>Delete trip</Button>
            <Button onClick={() => setConfirm(false)} style={small}>Keep it</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 22 }}>
          <Button kind="solid" onClick={onEdit}>Edit</Button>
          <Button onClick={() => setSharing(!sharing)} aria-expanded={sharing}>{sharing ? 'Hide sharing' : 'Send a copy'}</Button>
          <Button kind="danger" onClick={() => setConfirm(true)}>Delete</Button>
        </div>
      )}

      {sharing && <TripSharePanel trip={trip} owner={owner} />}

      {viewing !== null && (
        <Lightbox ids={trip.photoIds} start={viewing} title={trip.title} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/* ---------- trips: all of them ---------- */
function TripPopup({ trip, stop, onOpen }) {
  const s = trip.stops[stop] || trip.stops[0];
  return (
    <div style={{ width: 220, maxWidth: '100%' }}>
      {trip.photoIds[0] && (
        <PhotoThumb id={trip.photoIds[0]} alt={photoAlt(trip.title, 0)} style={{ height: 112, borderRadius: 6, marginBottom: 9 }} />
      )}
      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{trip.title}</div>
      {trip.stops.length > 1 && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{`Place ${stop + 1} of ${trip.stops.length}: ${s.name}`}</div>
      )}
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span>{tripWhen(trip).text}</span>
        <Stars n={trip.rating} size={12.5} />
      </div>
      {trip.excerpt && (
        <p className="crm-serif" style={{ margin: '7px 0 0', fontSize: 13.5, lineHeight: 1.45, color: C.ink }}>{trip.excerpt}</p>
      )}
      <button className="crm-btn" onClick={onOpen} style={{ ...textButton(), fontSize: 13, marginTop: 9 }}>Open trip</button>
    </div>
  );
}

// onOpen gets the trip's id. Under the map it finds the trip there instead of
// opening it, and says so to a screen reader.
const TripCard = memo(function TripCard({ trip, onOpen, onMap }) {
  const places = trip.stops.map((s) => s.name).join(' → ');
  return (
    <button className="crm-btn crm-row" onClick={() => onOpen(trip.id)} aria-description={onMap ? 'Shows it on the map' : undefined} style={{
      display: 'flex', gap: 12, width: '100%', textAlign: 'left', font: 'inherit', color: C.ink,
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10,
      cursor: 'pointer', alignItems: 'flex-start',
    }}>
      <PhotoThumb id={trip.photoIds[0]} alt={photoAlt(trip.title, 0)} style={{ width: 84, height: 84, borderRadius: 8, flexShrink: 0 }}
        empty={(
          <span aria-hidden="true" style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper,
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 28, background: trip.status ? '#fff' : ratingColor(trip.rating), color: '#fff',
              boxSizing: 'border-box', border: trip.status ? `${trip.status === 'planned' ? '4px solid' : '3px dashed'} ${PLAN_COLORS[trip.status]}` : 'none',
              fontSize: Number.isInteger(trip.rating) ? 13 : 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{trip.rating || ''}</span>
          </span>
        )} />
      <span style={{ display: 'block', minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{trip.title}</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12.5, color: C.muted, marginTop: 3 }}>
          {trip.status !== 'someday' && <span>{tripWhen(trip).text}</span>}
          {trip.status && <span style={kindChip()}>{PLAN_WORDS[trip.status]}</span>}
          {tripOverdue(trip) && <span style={{ color: C.calmText, fontWeight: 600 }}>Did you go?</span>}
          <Stars n={trip.rating} size={12.5} />
        </span>
        <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{places}</span>
        {trip.excerpt && (
          <span className="crm-serif crm-clamp" style={{ display: '-webkit-box', fontSize: 13.5, lineHeight: 1.45, marginTop: 6, color: C.ink }}>{trip.excerpt}</span>
        )}
      </span>
    </button>
  );
});

function SharedTripOffer({ incoming, onTake, onDrop }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const box = {
    background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 12, padding: '14px 15px', margin: '0 0 16px',
  };
  if (incoming.broken) {
    return (
      <div role="status" style={box}>
        <p style={{ margin: '0 0 10px', fontSize: 14, color: C.ink }}>A shared trip arrived but could not be read. Ask for the link again.</p>
        <Button onClick={onDrop} style={small}>OK</Button>
      </div>
    );
  }
  const t = incoming.trip;
  const take = async () => {
    setBusy(true);
    setProblem('');
    try {
      await onTake(incoming);
    } catch (e) {
      setProblem(e?.message || 'That trip could not be added.');
      setBusy(false);
    }
  };
  return (
    <div role="status" style={box}>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: C.muted }}>{`${incoming.by || 'Someone'} shared a trip with you`}</p>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>{t.title}</p>
      <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.muted }}>
        {`${tripWhen(t).text} · ${t.stops.map((s) => s.name).join(' → ')}`}
        {incoming.photos?.length ? ` · ${countThings(incoming.photos.length, 'photo', 'photos').toLowerCase()}` : ''}
      </p>
      {t.excerpt && <p className="crm-serif" style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 }}>{t.excerpt}</p>}
      {problem && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: C.overdue }}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button kind="solid" onClick={take} style={small} disabled={busy}>{busy ? 'Adding…' : 'Add it to my trips'}</Button>
        <Button onClick={onDrop} style={small} disabled={busy}>No thanks</Button>
      </div>
    </div>
  );
}

function EventsOffer({ events, onConvert, onDismiss }) {
  const [picked, setPicked] = useState(() => new Set(events.map((e) => e.id)));
  const toggle = (id, on) => setPicked((s) => {
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const n = events.filter((e) => picked.has(e.id)).length;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 15px 8px', margin: '0 0 16px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>
        {`${countThings(events.length, 'event has', 'events have')} a place pinned`}
      </p>
      <p style={{ margin: '0 0 11px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
        Turn them into trips to see them on the map here. The events stay on your timeline as they are.
      </p>
      <div style={{ maxHeight: 190, overflowY: 'auto', marginBottom: 8 }}>
        {events.map((e) => (
          <Check key={e.id} on={picked.has(e.id)} onChange={(v) => toggle(e.id, v)}
            label={e.title} hint={`${eventWhen(e).text}${e.place ? ` · ${e.place}` : ''}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Button kind="solid" style={small} disabled={!n} onClick={() => onConvert(events.filter((e) => picked.has(e.id)))}>
          {n === 1 ? 'Turn it into a trip' : `Turn ${n} into trips`}
        </Button>
        <Button style={small} onClick={onDismiss}>No thanks</Button>
      </div>
    </div>
  );
}

// The same box Import has, since a trip arrives the same ways anything
// shared does. Whatever is opened goes where its kind belongs. Opened from
// the button beside "Add a trip".
function AddSharedTrip({ onOpen, onClose }) {
  return (
    <div id="add-shared-trip" className="crm-open" style={{ margin: '0 0 14px', maxWidth: 560 }}>
      <OpenShared onOpen={(got) => { onClose(); onOpen(got); }} />
      <Button onClick={onClose} style={{ ...small, marginTop: -8 }}>Cancel</Button>
    </div>
  );
}

// The counts at the top of Trips. Everyone can hide them; Recap keeps the
// same numbers year by year either way.
function TripStats({ stats, onHide }) {
  const tile = { flex: '1 1 110px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 12px', minWidth: 0 };
  const num = { fontSize: 24, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, color: C.ink };
  const lab = { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.3 };
  const n = (x) => (x === null ? '…' : x);
  return (
    <section aria-label="Trip stats" style={{ margin: '0 0 14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div style={tile}><div style={num}>{n(stats.countries && stats.countries.size)}</div><div style={lab}>{stats.countries?.size === 1 ? 'country' : 'countries'}</div></div>
        {stats.states && stats.states.size > 0 && (
          <div style={tile}><div style={num}>{stats.states.size}</div><div style={lab}>{stats.states.size === 1 ? 'US state' : 'US states'}</div></div>
        )}
        <div style={tile}><div style={num}>{stats.places}</div><div style={lab}>{stats.places === 1 ? 'place' : 'places'}</div></div>
        <div style={tile}><div style={{ ...num, color: C.accentDeep }}>{stats.days}</div><div style={lab}>{`${stats.days === 1 ? 'day' : 'days'} away in ${stats.year}`}</div></div>
        {stats.top && (
          <div style={{ ...tile, flex: '2 1 190px' }}>
            <div style={{ ...num, fontSize: 19, letterSpacing: '-0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.26 }}>{stats.top.name}</div>
            <div style={lab}>{`Most visited · ${stats.top.trips} trips`}</div>
          </div>
        )}
      </div>
      <button className="crm-btn" onClick={onHide} style={{ ...textButton(), fontSize: 12, fontWeight: 500, color: C.faint, marginTop: 6 }}>
        Hide stats
      </button>
    </section>
  );
}

// The trips in their groups: coming up, been, someday. Headings show under
// the map, and in the list once there is more than one group.
function TripSections({ groups, onOpen, onMap = false, narrowed }) {
  const parts = [
    ['planned', 'Coming up', groups.planned],
    ['been', narrowed ? 'Matching trips' : 'Recent trips', groups.been],
    ['someday', 'Someday', groups.someday],
  ].filter(([, , list]) => list.length);
  const heads = onMap || parts.length > 1;
  return parts.map(([k, head, list], i) => (
    <section key={k} aria-labelledby={heads ? `trips-${k}` : undefined} aria-label={heads ? undefined : 'Trips'}
      style={{ marginTop: i ? 26 : onMap ? 26 : 0 }}>
      {heads && (
        <h2 id={`trips-${k}`} style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {head}
          <span style={{ fontSize: 13, fontWeight: 500, color: C.faint, marginLeft: 8 }}>{list.length}</span>
        </h2>
      )}
      {onMap && i === 0 && <p style={{ margin: '-6px 0 10px', fontSize: 13, color: C.muted }}>Tap one to find it on the map.</p>}
      <TripCards trips={list} onOpen={onOpen} onMap={onMap} />
    </section>
  ));
}

// The trips as cards: under the map, or on their own as the list.
function TripCards({ trips, onOpen, onMap = false }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 10 }}>
      {trips.map((t) => <TripCard key={t.id} trip={t} onOpen={onOpen} onMap={onMap} />)}
    </div>
  );
}

function TripsView({
  trips, people, look, incoming, offer, notice, statsHidden, onStatsHidden,
  onOpen, onNew, onTakeShared, onOpenShared, onDropShared, onConvert, onDismissOffer, onDismissNotice, onBackup, signedIn,
}) {
  const [mode, setMode] = useState(look.current.mode);
  const [f, setF] = useState(look.current.filter);
  const [addingShared, setAddingShared] = useState(false);
  const { geo, where } = useGeo();
  const [shade, setShade] = useState(Boolean(look.current.shade));
  const stats = useMemo(() => tripStats(trips, where, new Date().getFullYear()), [trips, where]);
  // A card tapped under the map: the map brings that trip into view.
  const [focus, setFocus] = useState(null);
  const mapBox = useRef(null);
  const showOnMap = useCallback((tripId) => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    mapBox.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    setFocus({ tripId });
  }, []);
  useEffect(() => { look.current = { mode, filter: f, shade }; }, [look, mode, f, shade]);

  const opts = useMemo(() => tripFilterOptions(trips), [trips]);
  const plans = useMemo(() => new Set(trips.map((t) => t.status).filter(Boolean)), [trips]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  // A filter left pointing at something no longer there (a tag nobody has
  // now, a person deleted) is quietly dropped rather than hiding everything.
  const live = useMemo(() => ({
    year: opts.years.includes(Number(f.year)) ? f.year : '',
    minRating: f.minRating,
    status: plans.has(f.status) || (f.status === 'been' && plans.size > 0) ? f.status : '',
    companion: opts.companions.includes(f.companion) && names.has(f.companion) ? f.companion : '',
    tag: opts.tags.find((g) => g.toLowerCase() === (f.tag || '').toLowerCase()) || '',
  }), [f, opts, names, plans]);
  const narrowed = Boolean(live.status || live.year || live.minRating || live.companion || live.tag);
  const shown = useMemo(() => sortTrips(filterTrips(trips, live)), [trips, live]);
  const groups = useMemo(() => tripGroups(shown), [shown]);
  const been = useMemo(() => trips.filter((t) => !t.status), [trips]);
  const byId = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);
  const points = useMemo(() => tripPoints(shown), [shown]);
  // The countries (and US states) of the trips shown, to shade on the map.
  const shaded = useMemo(() => {
    if (!shade || !geo || !where) return null;
    const { countries, states } = whereAll(shown, where);
    return geo.shapesNamed(countries, states);
  }, [shade, geo, where, shown]);

  const set = (k, v) => setF({ ...live, [k]: v });
  const pick = { ...inputStyle, width: 'auto', flex: '1 1 140px', minHeight: 36, padding: '6px 11px', fontSize: 13 };
  const companionOptions = opts.companions.filter((id) => names.has(id))
    .sort((a, b) => SHELF.compare(names.get(a), names.get(b)));
  const mapHeight = 'min(62vh, 560px)';

  let head = 'No trips yet';
  let sub = 'The places you have been, when, who with, and what made them worth remembering.';
  if (trips.length) {
    head = narrowed
      ? `${countThings(shown.length, 'trip', 'trips')} of ${trips.length}`
      : been.length
        ? `${countThings(been.length, 'trip', 'trips')}, ${countThings(stats.places, 'place', 'places').toLowerCase()}`
        : `${countThings(trips.length, 'trip', 'trips')} to come`;
    sub = mode === 'map'
      ? 'Tap a pin for the trip, or scroll down for your latest. Pins close together gather into a circle; tap it to zoom in.'
      : 'Newest first.';
  }

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.035em' }}>{head}</h1>
      <p style={{ margin: '8px 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        {sub}
        {statsHidden && stats.trips > 0 && (
          <>
            {' '}
            <button className="crm-btn" onClick={() => onStatsHidden(false)} style={{ ...textButton(), fontSize: 13, fontWeight: 500, color: C.muted }}>
              Show stats
            </button>
          </>
        )}
      </p>

      {!statsHidden && stats.trips > 0 && <TripStats stats={stats} onHide={() => onStatsHidden(true)} />}

      {notice && (
        <div role="note" style={{
          background: C.surface, border: `1px solid ${C.soonBar}`, borderRadius: 12, padding: '13px 15px', margin: '0 0 16px',
        }}>
          <p style={{ margin: '0 0 10px', fontSize: 13.5, color: C.ink, lineHeight: 1.55 }}>
            {signedIn
              ? 'Trips are saved to your account, but their photos are kept in this browser, on this device only. '
                + 'Photos are not uploaded, so clearing this site\'s data, or losing the device, loses them. '
              : 'Trips and their photos are kept in this browser, on this device only. Nothing is uploaded, so '
                + 'clearing this site\'s data, or losing the device, loses them. '}
            Download a backup file every so often and keep it somewhere safe.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="solid" onClick={onBackup} style={small}>Back up now</Button>
            <Button onClick={onDismissNotice} style={small}>Got it</Button>
          </div>
        </div>
      )}

      {incoming && <SharedTripOffer incoming={incoming} onTake={onTakeShared} onDrop={onDropShared} />}
      {offer.length > 0 && <EventsOffer events={offer} onConvert={onConvert} onDismiss={onDismissOffer} />}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        {trips.length > 0 && (
          <div role="group" aria-label="Show trips as" style={{ display: 'flex', gap: 6, flex: '0 1 220px' }}>
            {[['map', 'Map'], ['list', 'List']].map(([v, l]) => (
              <button key={v} className="crm-btn" aria-pressed={mode === v} onClick={() => { setMode(v); setFocus(null); }} style={segment(mode === v)}>{l}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <Button onClick={() => setAddingShared((o) => !o)} aria-expanded={addingShared} aria-controls="add-shared-trip">
            Add a shared trip
          </Button>
          <Button kind="solid" onClick={onNew}>Add a trip</Button>
        </div>
      </div>

      {addingShared && <AddSharedTrip onOpen={onOpenShared} onClose={() => setAddingShared(false)} />}

      {trips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
          {plans.size > 0 && (
            <select className="crm-select" aria-label="Show" value={live.status} onChange={(e) => set('status', e.target.value)} style={pick}>
              <option value="">Every trip</option>
              <option value="been">Been</option>
              {plans.has('planned') && <option value="planned">Planned</option>}
              {plans.has('someday') && <option value="someday">Someday</option>}
            </select>
          )}
          <select className="crm-select" aria-label="Year" value={live.year} onChange={(e) => set('year', e.target.value)} style={pick}>
            <option value="">Any year</option>
            {opts.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="crm-select" aria-label="Rating" value={live.minRating} onChange={(e) => set('minRating', Number(e.target.value))} style={pick}>
            <option value={0}>Any rating</option>
            {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].map((r) => <option key={r} value={r}>{`${starWord(r)} and up`}</option>)}
            <option value={5}>5 stars only</option>
          </select>
          {companionOptions.length > 0 && (
            <select className="crm-select" aria-label="Went with" value={live.companion} onChange={(e) => set('companion', e.target.value)} style={pick}>
              <option value="">With anyone</option>
              {companionOptions.map((id) => <option key={id} value={id}>{`With ${names.get(id)}`}</option>)}
            </select>
          )}
          {opts.tags.length > 0 && (
            <select className="crm-select" aria-label="Tag" value={live.tag} onChange={(e) => set('tag', e.target.value)} style={pick}>
              <option value="">Any tag</option>
              {opts.tags.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {narrowed && <Button onClick={() => setF(NO_TRIP_FILTER)} style={small}>Clear filters</Button>}
        </div>
      )}

      {(mode === 'map' || trips.length === 0) ? (
        <>
          <div ref={mapBox} style={mapFrame()}>
            <MapSlot height={mapHeight} render={(m) => (
              <m.TripsMap
                points={points}
                height={mapHeight}
                dark={C.dark}
                focus={focus}
                shade={shaded}
                renderPopup={(p) => {
                  const t = byId.get(p.tripId);
                  return t ? <TripPopup trip={t} stop={p.stop} onOpen={() => onOpen(t.id)} /> : null;
                }}
              />
            )} />
            {shown.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none', zIndex: 1000 }}>
                <div style={{
                  pointerEvents: 'auto', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
                  padding: '16px 18px', maxWidth: 300, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                }}>
                  {trips.length === 0 ? (
                    <>
                      <p style={{ margin: '0 0 12px', fontSize: 14, color: C.ink, lineHeight: 1.5 }}>
                        Add the first place you have been, and it lands on the map.
                      </p>
                      <Button kind="solid" onClick={onNew}>Add your first trip</Button>
                    </>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 12px', fontSize: 14, color: C.ink }}>No trips match these filters.</p>
                      <Button onClick={() => setF(NO_TRIP_FILTER)} style={small}>Clear filters</Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          {trips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px 14px' }}>
              <div style={{ flex: '1 1 300px' }}><RatingLegend plans={plans} /></div>
              {stats.trips > 0 && (
                <button className="crm-btn" aria-pressed={shade} onClick={() => setShade((v) => !v)}
                  style={{ ...filterChip(shade), marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{
                    width: 12, height: 12, borderRadius: 3, background: shade ? C.onAccent : C.accent, opacity: shade ? 0.6 : 1,
                  }} />
                  Shade countries I have been to
                </button>
              )}
            </div>
          )}
          {shown.length > 0 && <TripSections groups={groups} onOpen={showOnMap} onMap narrowed={narrowed} />}
        </>
      ) : shown.length === 0 ? (
        <div style={{ padding: '18px 16px', border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, color: C.muted }}>No trips match these filters.</p>
          <Button onClick={() => setF(NO_TRIP_FILTER)} style={small}>Clear filters</Button>
        </div>
      ) : (
        <TripSections groups={groups} onOpen={onOpen} narrowed={narrowed} />
      )}
    </div>
  );
}

/* ---------- backup file ---------- */
// The one copy that holds everything, photos included. The pasted backup
// under People still works, but has no room for photos.
function BackupView({ people, events, reminders, collections, trips, lastBackup, signedIn, onDownloaded, onRestore, onClose }) {
  const [plan, setPlan] = useState(null);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(null);
  const [note, setNote] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let live = true;
    photoStore.estimate().then((u) => { if (live) setUsage(u); });
    return () => { live = false; };
  }, [restored]);

  const records = () => ({
    kind: 'orbit-backup', version: 1, exportedAt: new Date().toISOString(),
    people, events, reminders, collections, trips,
  });

  const size = async () => {
    setStage('sizing');
    setNote('');
    const all = await photoStore.listAll().catch(() => []);
    const wanted = new Set(trips.flatMap((t) => t.photoIds));
    const mine = all.filter((p) => wanted.has(p.id));
    const bytes = JSON.stringify(records()).length + mine.reduce((n, p) => n + p.size + p.thumbSize + 300, 0);
    setPlan({ bytes, photos: mine });
    setStage('ready');
  };

  const build = async () => {
    setStage('building');
    setProgress({ done: 0, total: plan.photos.length });
    try {
      const m = { ...records(), photos: plan.photos.map((p) => ({ id: p.id, tripId: p.tripId })) };
      const blob = await packZip(m, (id) => photoStore.getRecord(id), (done, total) => setProgress({ done, total }));
      const name = `orbit-backup-${todayStr()}.zip`;
      if (downloadBlob(name, blob)) {
        setNote(`Saved ${name} (${approxBytes(blob.size)}). Keep it somewhere other than this device.`);
        onDownloaded();
      } else {
        setNote('The download was blocked here.');
      }
    } catch {
      setNote('The backup file could not be made. There may not be enough memory or space; close other tabs and try again.');
    } finally {
      setStage('');
      setPlan(null);
      setProgress(null);
    }
  };

  const restore = async (file) => {
    setRestoring(true);
    setRestored(null);
    try {
      setRestored({ ok: true, text: await onRestore(file) });
    } catch (e) {
      setRestored({ ok: false, text: e?.message || 'That backup could not be restored.' });
    } finally {
      setRestoring(false);
    }
  };

  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '15px 15px 14px', marginBottom: 12 };
  const photoCount = trips.reduce((n, t) => n + t.photoIds.length, 0);

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Backup file</h1>
        <Button onClick={onClose} style={{ marginLeft: 'auto' }}>Done</Button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        Everything Orbit keeps, photos included, in one file.
        {signedIn
          ? ' Your account keeps everything but trip photos, which stay on this device; this file is the copy of them that survives losing it.'
          : ' Orbit only lives in this browser, so this file is the copy that survives losing it.'}
      </p>

      <div style={box}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: C.ink }}>Download a backup</p>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
          {lastBackup ? `Your last backup file from here was made ${prettyDate(lastBackup)}.` : 'No backup file has been made from this browser yet.'}
        </p>
        {stage === 'ready' && plan ? (
          <div role="status">
            <p style={{ margin: '0 0 10px', fontSize: 13.5, color: C.ink, lineHeight: 1.5 }}>
              {`The file will be about ${approxBytes(plan.bytes)}`}
              {plan.photos.length ? `, most of it your ${countThings(plan.photos.length, 'photo', 'photos').toLowerCase()}.` : '.'}
              {plan.bytes > 150e6 ? ' That is a big file: make sure there is room for it, and keep this tab open while it is made.' : ''}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button kind="solid" onClick={build} style={small}>Download it</Button>
              <Button onClick={() => { setStage(''); setPlan(null); }} style={small}>Cancel</Button>
            </div>
          </div>
        ) : stage === 'building' ? (
          <div role="status">
            <progress value={progress?.done || 0} max={progress?.total || 1} aria-label="Making the backup file" style={{ width: '100%', accentColor: C.accentDeep }} />
            <span style={hintStyle()}>
              {progress?.total ? `Adding photo ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Making the file…'}
            </span>
          </div>
        ) : (
          <Button kind="solid" onClick={size} style={small} disabled={stage === 'sizing'}>
            {stage === 'sizing' ? 'Working out the size…' : 'Make a backup file'}
          </Button>
        )}
        {note && <p aria-live="polite" style={{ margin: '10px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{note}</p>}
      </div>

      <div style={box}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: C.ink }}>Restore from a backup file</p>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
          Adds anything missing here, and brings trips and lists up to date where the file has a newer
          version. Nothing here is deleted, and restoring the same file twice adds nothing twice.
        </p>
        <label className="crm-file crm-btn" style={{
          ...small, display: 'inline-flex', alignItems: 'center', position: 'relative', fontWeight: 600,
          borderRadius: 7, border: `1px solid ${C.line}`, color: C.ink, cursor: restoring ? 'default' : 'pointer',
          opacity: restoring ? 0.55 : 1,
        }}>
          <input type="file" accept=".zip,.json,application/zip,application/json" className="crm-sr" disabled={restoring}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
          {restoring ? 'Restoring…' : 'Choose a backup file'}
        </label>
        {restored && (
          <p role={restored.ok ? 'status' : 'alert'} style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: restored.ok ? C.ink : C.overdue }}>
            {restored.text}
          </p>
        )}
      </div>

      <div style={box}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: C.ink }}>Space used</p>
        <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          {usage
            ? `Orbit is using about ${approxBytes(usage.usage)} of this browser's storage${usage.quota ? `, out of roughly ${approxBytes(usage.quota)} it allows` : ''}.`
            : 'This browser does not say how much space Orbit is using.'}
          {photoCount ? ` That includes ${countThings(photoCount, 'photo', 'photos').toLowerCase()}.` : ''}
        </p>
      </div>
    </div>
  );
}

/* ---------- settings ---------- */

const settingsCard = () => ({
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '15px 15px 14px', marginBottom: 16,
});
const settingsHead = { margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' };
const settingsRow = { display: 'flex', gap: 12, alignItems: 'baseline', padding: '7px 0', borderBottom: `1px solid ${C.line}`, fontSize: 14 };

// One detail of the account, with its own Change button that opens a small
// form in place. Only one opens at a time.
function AccountRow({ label, value, open, onOpen, children, action = 'Change' }) {
  return (
    <div style={{ ...settingsRow, flexWrap: 'wrap', borderBottomColor: C.line }}>
      <span style={{ width: 110, flexShrink: 0, color: C.faint, fontSize: 13 }}>{label}</span>
      <span style={{ flex: '1 1 160px', minWidth: 0, color: C.ink, overflowWrap: 'anywhere' }}>{value}</span>
      {onOpen && !open && (
        <button className="crm-btn" onClick={onOpen} aria-label={action === 'Change' ? `Change ${label.toLowerCase()}` : action} style={{
          font: 'inherit', fontSize: 13, fontWeight: 600, color: C.muted, background: 'transparent',
          border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
        }}>{action}</button>
      )}
      {open && <div style={{ flexBasis: '100%', paddingTop: 8 }}>{children}</div>}
    </div>
  );
}

function AccountSettings({ account }) {
  const pr = account.profile;
  const [open, setOpen] = useState('');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const start = (key, value) => { setOpen(key); setDraft({ [key]: value }); setProblem(''); setSaid(''); };
  const close = () => { setOpen(''); setProblem(''); };
  const run = async (fn, done) => {
    setBusy(true);
    setProblem('');
    try {
      await fn();
      setSaid(done);
      setOpen('');
    } catch (err) {
      setProblem(err?.message || 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const saveProfile = (key, check, field) => {
    const v = draft[key];
    const wrong = check(v);
    if (wrong) { setProblem(wrong); return; }
    run(async () => {
      if (key === 'username' && cleanUsername(v) !== pr.username && !(await account.checkUsername(v))) {
        throw new Error('That username is taken.');
      }
      await account.updateProfile({ [field]: v });
    }, 'Saved.');
  };
  const actions = (onSave, label = 'Save') => (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <Button kind="solid" onClick={busy ? undefined : onSave} style={small}>{busy ? 'Saving…' : label}</Button>
      <Button onClick={close} style={small}>Cancel</Button>
    </div>
  );
  const text = (key, props = {}) => (
    <input aria-label={props.label} style={{ ...inputStyle, minHeight: 38 }} value={draft[key] ?? ''}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props.input} />
  );
  const password = account.providers.includes('email');
  const google = account.providers.includes('google');
  const wantDelete = pr?.username || 'delete';

  return (
    <div>
      <div style={settingsCard()}>
        <p style={settingsHead}>Your account</p>
        {!pr && (
          <p style={{ margin: '0 0 10px', fontSize: 13, color: C.soonText, lineHeight: 1.5 }}>
            Your username, name and birthday are not set up on the server yet, so only your email shows here.
          </p>
        )}
        {pr && (
          <>
            <AccountRow label="Name" value={pr.display_name} open={open === 'name'} onOpen={() => start('name', pr.display_name)}>
              {text('name', { label: 'Your name', input: { maxLength: 60, autoComplete: 'name' } })}
              <span style={hintStyle()}>What friends see.</span>
              {actions(() => saveProfile('name', displayNameProblem, 'displayName'))}
            </AccountRow>
            <AccountRow label="Username" value={`@${pr.username}`} open={open === 'username'} onOpen={() => start('username', pr.username)}>
              {text('username', { label: 'Username', input: { autoCapitalize: 'none', spellCheck: false, maxLength: 21 } })}
              <span style={hintStyle()}>How friends find you. Letters, numbers, dots and underscores; your old one becomes free for anyone.</span>
              {actions(() => saveProfile('username', usernameProblem, 'username'))}
            </AccountRow>
            <AccountRow label="Birthday" value={`${prettyDate(pr.birthday)} · only you`} open={open === 'birthday'} onOpen={() => start('birthday', pr.birthday)}>
              {text('birthday', { label: 'Birthday', input: { type: 'date', min: '1900-01-01' } })}
              {actions(() => saveProfile('birthday', (v) => birthdayProblem(v), 'birthday'))}
            </AccountRow>
          </>
        )}
        <AccountRow label="Email" value={`${account.email} · only you`} open={open === 'email'}
          onOpen={password || !google ? () => start('email', account.email) : null}>
          {text('email', { label: 'New email', input: { type: 'email', inputMode: 'email', autoComplete: 'email' } })}
          <span style={hintStyle()}>We send a link to the new address (and a note to the old one). The change happens when you open it.</span>
          {actions(() => {
            const wrong = emailProblem(draft.email);
            if (wrong) { setProblem(wrong); return; }
            run(() => account.changeEmail(draft.email), `Check ${draft.email.trim()} for a link to confirm the change.`);
          }, 'Send the link')}
        </AccountRow>
        <AccountRow label="Password" value={password ? '••••••••' : 'Not set'} open={open === 'password'}
          action={password ? 'Change' : 'Set a password'} onOpen={() => start('password', '')}>
          <input aria-label="New password" type="password" autoComplete="new-password" style={{ ...inputStyle, minHeight: 38 }}
            value={draft.password ?? ''} onChange={(e) => setDraft({ password: e.target.value })} />
          <span style={hintStyle()}>At least {MIN_PASSWORD} characters.</span>
          {actions(() => {
            const wrong = passwordProblem(draft.password);
            if (wrong) { setProblem(wrong); return; }
            run(() => account.changePassword(draft.password), 'Your password is saved.');
          })}
        </AccountRow>
        <AccountRow label="Signs in with" value={[password && 'Email', google && 'Google'].filter(Boolean).join(' and ') || 'Email link'} />
        {problem && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>}
        <p aria-live="polite" style={{ margin: said ? '10px 0 0' : 0, fontSize: 13, color: C.calmText, lineHeight: 1.5 }}>{said}</p>
        <div style={{ marginTop: 14 }}>
          <Button onClick={account.signOut}>Sign out</Button>
        </div>
      </div>

      <div style={settingsCard()}>
        <p style={settingsHead}>Delete account</p>
        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
          This removes your account and everything saved in it, on every device, for good. Back up first if you
          might want any of it.
        </p>
        <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 6 }}>
          Type <strong style={{ color: C.ink }}>{wantDelete}</strong> to confirm
          <input style={{ ...inputStyle, minHeight: 38, marginTop: 6 }} value={confirmDelete} autoCapitalize="none"
            onChange={(e) => setConfirmDelete(e.target.value)} />
        </label>
        <Button kind="danger" style={{ border: `1px solid ${C.overdue}`, opacity: confirmDelete.trim().toLowerCase() === wantDelete ? 1 : 0.5 }}
          onClick={() => {
            if (confirmDelete.trim().toLowerCase() !== wantDelete) { setProblem(`Type ${wantDelete} first.`); return; }
            run(() => account.deleteAccount(), '');
          }}>Delete my account</Button>
      </div>
    </div>
  );
}

/* ---------- friends: how a profile looks ---------- */
// A link to someone's social profile from the handle they gave. The handle
// is someone else's text, so it only ever goes into the path of a known site.
const socialHref = (key, value) => {
  const v = String(value || '').trim();
  if (key === 'linkedin' && /^https?:\/\//i.test(v)) return safeLink(v);
  const h = encodeURIComponent(handle(v));
  return {
    instagram: `https://instagram.com/${h}`, x: `https://x.com/${h}`, tiktok: `https://tiktok.com/@${h}`,
    snapchat: `https://snapchat.com/add/${h}`, linkedin: `https://linkedin.com/in/${h}`,
  }[key] || '';
};

// One profile, showing whatever the viewer was allowed to receive.
function ProfileCard({ pv, children }) {
  const socials = SOCIAL_KEYS.filter(([k]) => pv.socials?.[k]);
  const site = pv.website ? safeLink(pv.website) : '';
  const facts = [
    pv.location && ['Lives in', pv.location],
    isDay(pv.birthday) && ['Birthday', prettyBirthday(pv.birthday)],
    pv.phone && ['Phone', pv.phone],
    pv.contact_email && ['Email', pv.contact_email],
  ].filter(Boolean);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '15px 15px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', color: C.ink, overflowWrap: 'anywhere' }}>{pv.display_name}</span>
        {pv.pronouns && <span style={{ fontSize: 13, color: C.faint }}>{pv.pronouns}</span>}
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>@{pv.username}</div>
      {pv.bio && <p className="crm-serif" style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.55, color: C.ink, overflowWrap: 'anywhere' }}>{pv.bio}</p>}
      {facts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {facts.map(([l, v]) => (
            <p key={l} style={{ margin: '0 0 4px', fontSize: 13, lineHeight: 1.5, color: C.ink, overflowWrap: 'anywhere' }}>
              <span style={{ color: C.faint }}>{l} </span>{v}
            </p>
          ))}
        </div>
      )}
      {(site || socials.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
          {site && <a href={site} target="_blank" rel="noreferrer noopener" style={linkStyle}><span style={{ color: C.faint }}>Website </span>{linkHost(site)}</a>}
          {socials.map(([k, label]) => {
            const href = socialHref(k, pv.socials[k]);
            return href ? (
              <a key={k} href={href} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                <span style={{ color: C.faint }}>{label} </span>{handle(String(pv.socials[k])).slice(0, 60)}
              </a>
            ) : null;
          })}
        </div>
      )}
      {children}
    </div>
  );
}

function VisibilityPick({ value, onChange, label }) {
  return (
    <select className="crm-select" aria-label={`Who sees ${label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: 'auto', minHeight: 34, padding: '4px 30px 4px 10px', fontSize: 12.5, flexShrink: 0 }}>
      {VISIBILITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function ProfileSettings({ account }) {
  const pr = account.profile;
  const ready = pr && 'visibility' in pr;
  const start = () => ({
    pronouns: pr?.pronouns || '', bio: pr?.bio || '', location: pr?.location || '', phone: pr?.phone || '',
    contact_email: pr?.contact_email || '', website: pr?.website || '', socials: { ...(pr?.socials || {}) },
    visibility: {
      ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, visibilityOf(pr, f.key)])),
      trips: pr?.visibility?.trips || 'me',
    },
    searchable: pr?.searchable !== false,
    publicPage: pr?.public_page === true,
  });
  const [draft, setDraft] = useState(start);
  const [as, setAs] = useState('none');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');
  if (!pr) return <p style={{ fontSize: 14, color: C.muted }}>Your profile is not set up on the server yet.</p>;
  if (!ready) {
    return (
      <p style={{ fontSize: 14, color: C.soonText, lineHeight: 1.5 }}>
        Profiles and friends are not switched on yet. Run the updated setup script in Supabase, then come back.
      </p>
    );
  }
  const set = (k, v) => { setDraft({ ...draft, [k]: v }); setSaid(''); };
  const setVis = (k, v) => set('visibility', { ...draft.visibility, [k]: v });
  const save = async () => {
    setProblem('');
    const site = draft.website.trim() ? safeLink(draft.website) : '';
    if (draft.website.trim() && !site) { setProblem('The website needs to be a web address, like https://example.com.'); return; }
    if (draft.contact_email.trim() && emailProblem(draft.contact_email)) { setProblem('The email for friends does not look like an email address.'); return; }
    const socials = Object.fromEntries(SOCIAL_KEYS.map(([k]) => [k, handle(draft.socials[k] || '').slice(0, 100)]).filter(([, v]) => v));
    setBusy(true);
    try {
      await account.updateProfile({
        pronouns: draft.pronouns, bio: draft.bio, location: draft.location, phone: draft.phone,
        contactEmail: draft.contact_email, website: site, socials, visibility: draft.visibility, searchable: draft.searchable,
        // Only once the server has pages (schema part 5).
        ...('public_page' in pr ? { publicPage: draft.publicPage } : {}),
      });
      track('profile.save', { public_page: draft.publicPage, trips: draft.visibility.trips, searchable: draft.searchable });
      setDraft({ ...draft, website: site, socials });
      setSaid('Your profile is saved.');
    } catch (err) {
      setProblem(err?.message || 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const preview = seenAs({ ...pr, ...draft }, as);
  const pages = 'public_page' in pr;
  const myPage = pageUrl(profilePath(pr.username));

  return (
    <div>
      <div style={settingsCard()}>
        <p style={settingsHead}>Your page</p>
        {!pages ? (
          <p style={{ margin: 0, fontSize: 13, color: C.soonText, lineHeight: 1.5 }}>
            Pages are not switched on yet. Run the updated setup script in Supabase, then come back.
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
              Everything you share, in one place: the concerts, games and shows you set to Everyone or Friends, and your trips if you show them.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <a href={profilePath(pr.username)} style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, wordBreak: 'break-all' }}>{myPage.replace(/^https?:\/\//, '')}</a>
              <Button style={{ fontSize: 12.5, padding: '5px 10px' }} onClick={async () => {
                try { await navigator.clipboard.writeText(myPage); setSaid('Your page’s link is copied.'); } catch { setSaid(myPage); }
              }}>Copy link</Button>
            </div>
            <div style={{ padding: '10px 0', borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Trips you have taken</span>
                <VisibilityPick label="Trips" value={draft.visibility.trips} onChange={(v) => setVis('trips', v)} />
              </div>
              <span style={hintStyle()}>
                Their titles, dates, ratings, highlights and places, to about a kilometre. Never who went, notes, photos, or trips still to come.
              </span>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <Check on={draft.publicPage} onChange={(v) => set('publicPage', v)} label="Anyone with the link can see it"
                hint="On: anyone on the web, without an Orbit account, sees what you set to Everyone. Off: only people signed in to Orbit." />
            </div>
            <span style={hintStyle()}>Saved with your profile, below.</span>
          </>
        )}
      </div>

      <div style={settingsCard()}>
        <p style={settingsHead}>What people see</p>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          Your name (<strong style={{ color: C.ink }}>{pr.display_name}</strong>) and username (<strong style={{ color: C.ink }}>@{pr.username}</strong>)
          are always visible, so people can find you. Choose who sees everything else. Everyone means everyone signed in to Orbit, and anyone on the web too if your page is open to anyone. The email you sign in with is never shown.
        </p>
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} style={{ padding: '10px 0', borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: f.fromAccount ? 0 : 7 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{f.label}</span>
              <VisibilityPick label={f.label} value={draft.visibility[f.key]} onChange={(v) => setVis(f.key, v)} />
            </div>
            {f.fromAccount ? (
              <span style={hintStyle()}>{prettyDate(pr.birthday)}. Change it under Account.</span>
            ) : f.key === 'socials' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
                {SOCIAL_KEYS.map(([k, label]) => (
                  <label key={k} style={{ display: 'block', fontSize: 12, color: C.faint }}>
                    {label}
                    <input placeholder={k === 'linkedin' ? 'profile URL or handle' : '@handle'} maxLength={100}
                      style={{ ...inputStyle, minHeight: 36, fontSize: 14, marginTop: 3 }}
                      value={draft.socials[k] || ''} onChange={(e) => set('socials', { ...draft.socials, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
            ) : f.long ? (
              <textarea aria-label={f.label} placeholder={f.ph} maxLength={f.max} rows={3} value={draft[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                style={{ ...inputStyle, fontSize: 14, lineHeight: 1.5, resize: 'vertical' }} />
            ) : (
              <input aria-label={f.label} placeholder={f.ph} maxLength={f.max} value={draft[f.key]}
                type={f.key === 'contact_email' ? 'email' : f.key === 'phone' ? 'tel' : f.key === 'website' ? 'url' : 'text'}
                onChange={(e) => set(f.key, e.target.value)} style={{ ...inputStyle, minHeight: 38, fontSize: 14 }} />
            )}
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <Check on={draft.searchable} onChange={(v) => set('searchable', v)} label="Show me in search"
            hint="Off: people can only add you from your QR code or link." />
        </div>
        {problem && <p role="alert" style={{ margin: '4px 0 10px', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>}
        <Button kind="solid" onClick={busy ? undefined : save}>{busy ? 'Saving…' : 'Save profile'}</Button>
        <p aria-live="polite" style={{ margin: said ? '10px 0 0' : 0, fontSize: 13, color: C.calmText }}>{said}</p>
      </div>

      <div style={settingsCard()}>
        <p style={settingsHead}>Preview</p>
        <div role="group" aria-label="See your profile as" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['none', 'Someone new'], ['friends', 'A friend']].map(([v, l]) => (
            <button key={v} className="crm-btn" aria-pressed={as === v} onClick={() => setAs(v)} style={segment(as === v)}>{l}</button>
          ))}
        </div>
        <ProfileCard pv={preview} />
        <span style={hintStyle()}>Unsaved changes show here too.</span>
      </div>
    </div>
  );
}

/* ---------- friends ---------- */
// A friend's profile as a person to keep in Orbit. It goes through the same
// checks and the same preview as anything shared, so it can be merged with
// someone already here rather than duplicated.
const profileToPerson = (pv) => cleanSharedPerson({
  n: pv.display_name,
  ph: pv.phone,
  e: pv.contact_email,
  ad: pv.location,
  b: pv.birthday,
  so: pv.socials,
  no: [pv.pronouns && `Pronouns: ${pv.pronouns}`, pv.bio, pv.website && safeLink(pv.website)].filter(Boolean).join('\n'),
});

const RELATION_WORDS = { friends: 'Friends', sent: 'Request sent', received: 'Wants to be friends', none: '', self: 'You' };

function FriendRow({ pv, onOpen, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
      <button className="crm-btn" onClick={onOpen} style={{
        flex: 1, minWidth: 0, textAlign: 'left', font: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: C.ink, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pv.display_name}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>@{pv.username}{RELATION_WORDS[pv.relation] ? ` · ${RELATION_WORDS[pv.relation]}` : ''}</span>
      </button>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function FriendsView({ account, startWith, onStarted, onSaveToPeople, onCount, onClose }) {
  const api = account.friends;
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', rows: [] });
  const [open, setOpen] = useState(null);
  const [code, setCode] = useState(false);
  const [blocks, setBlocks] = useState(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');

  const reload = useCallback(async () => {
    try {
      const rows = await api.list();
      setList(rows);
      onCount(rows.filter((r) => r.relation === 'received').length);
    } catch (err) {
      setList([]);
      setProblem(err.message);
    }
  }, [api, onCount]);
  useEffect(() => { reload(); }, [reload]);

  // Someone's code or link, opened: their profile, ready to add.
  useEffect(() => {
    if (!startWith) return;
    let live = true;
    api.get(startWith).then((pv) => {
      if (!live) return;
      if (pv) setOpen(pv); else setProblem(`No one called @${startWith} could be found.`);
      onStarted();
    }, (err) => { if (live) { setProblem(err.message); onStarted(); } });
    return () => { live = false; };
  }, [api, startWith, onStarted]);

  const term = q.trim().replace(/^@/, '');
  useEffect(() => {
    if (term.length < 2) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.search(term).then((rows) => { if (live) setFound({ q: term, rows }); }, (err) => { if (live) setProblem(err.message); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [api, term]);
  const results = term.length >= 2 && found.q === term ? found.rows : null;

  // Every change answers with how the two of you now stand; the list, the
  // results and the open profile all follow it.
  const act = async (pv, fn, done) => {
    setProblem('');
    setSaid('');
    try {
      const rel = await fn();
      const relation = typeof rel === 'string' ? rel : 'none';
      setFound((f) => ({ ...f, rows: f.rows.map((r) => (r.id === pv.id ? { ...r, relation } : r)) }));
      if (open?.id === pv.id) {
        // Becoming friends can show more of them, so their profile is read again.
        const fresh = relation === 'friends' || relation === 'none' ? await api.get(pv.username).catch(() => null) : null;
        setOpen(fresh || { ...open, relation });
      }
      if (done) setSaid(done);
      await reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const actions = (pv, full) => {
    const b = (label, fn, kind = 'quiet', done) => (
      <Button key={label} kind={kind} style={small} onClick={() => act(pv, fn, done)}>{label}</Button>
    );
    if (pv.relation === 'none') return [b('Add friend', () => api.send(pv.id), 'solid', `Asked ${pv.display_name} to be friends.`)];
    if (pv.relation === 'sent') return [b(full ? 'Cancel request' : 'Cancel', () => api.remove(pv.id))];
    if (pv.relation === 'received') {
      return [b('Accept', () => api.respond(pv.id, true), 'solid', `You and ${pv.display_name} are friends.`), b('Decline', () => api.respond(pv.id, false))];
    }
    if (pv.relation === 'friends' && full) return [b('Remove friend', () => api.remove(pv.id))];
    return [];
  };

  const received = (list || []).filter((r) => r.relation === 'received');
  const friends = (list || []).filter((r) => r.relation === 'friends');
  const sent = (list || []).filter((r) => r.relation === 'sent');
  const section = (title, rows, empty) => (
    <div style={{ marginBottom: 20 }}>
      <p style={settingsHead}>{title}{rows.length ? ` · ${rows.length}` : ''}</p>
      {rows.length === 0 && empty && <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{empty}</p>}
      {rows.map((pv) => <FriendRow key={pv.id} pv={pv} onOpen={() => { setOpen(pv); setConfirmBlock(false); }}>{actions(pv, false)}</FriendRow>)}
    </div>
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Friends</h1>
      <Button onClick={onClose} style={{ marginLeft: 'auto' }}>Done</Button>
    </div>
  );
  const notes = (
    <>
      {problem && <p role="alert" style={{ margin: '0 0 12px', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>}
      <p aria-live="polite" style={{ margin: said ? '0 0 12px' : 0, fontSize: 13, color: C.calmText, lineHeight: 1.5 }}>{said}</p>
    </>
  );

  if (open) {
    return (
      <div style={{ maxWidth: 620 }}>
        <button className="crm-btn" onClick={() => { setOpen(null); setSaid(''); setProblem(''); }} style={{
          font: 'inherit', fontSize: 13, fontWeight: 600, color: C.muted, background: 'transparent', border: 'none', padding: '0 0 12px', cursor: 'pointer',
        }}>← Friends</button>
        {notes}
        <ProfileCard pv={open}>
          {RELATION_WORDS[open.relation] && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: C.faint }}>{RELATION_WORDS[open.relation]}</p>}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
            {actions(open, true)}
            {open.relation !== 'self' && (
              <Button style={small} onClick={() => onSaveToPeople(open)}>Save to my People</Button>
            )}
          </div>
          {open.relation !== 'friends' && open.relation !== 'self' && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: C.faint, lineHeight: 1.5 }}>You see what they share with everyone. Friends may see more.</p>
          )}
          {open.relation !== 'self' && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 10 }}>
              {confirmBlock ? (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
                    Block @{open.username}? You will not be friends, and neither of you will find the other. They are not told.
                  </p>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <Button kind="danger" style={{ ...small, border: `1px solid ${C.overdue}` }} onClick={async () => {
                      await act(open, async () => { await api.block(open.id); return 'none'; });
                      setOpen(null);
                      setSaid(`Blocked @${open.username}.`);
                    }}>Block</Button>
                    <Button style={small} onClick={() => setConfirmBlock(false)}>Cancel</Button>
                  </div>
                </>
              ) : (
                <Button kind="danger" style={small} onClick={() => setConfirmBlock(true)}>Block</Button>
              )}
            </div>
          )}
        </ProfileCard>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620 }}>
      {header}
      {notes}
      <div style={{ ...settingsCard(), marginBottom: 20 }}>
        <p style={settingsHead}>Find people</p>
        <input aria-label="Search by username or name" placeholder="Search by username or name" value={q} autoCapitalize="none" spellCheck={false}
          onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, minHeight: 40 }} />
        {term.length === 1 && <span style={hintStyle()}>Keep typing: at least two letters.</span>}
        {results && results.length === 0 && <p style={{ margin: '10px 0 0', fontSize: 13.5, color: C.muted }}>No one found for “{term}”.</p>}
        {results && results.map((pv) => (
          <FriendRow key={pv.id} pv={pv} onOpen={() => { setOpen(pv); setConfirmBlock(false); }}>{actions(pv, false)}</FriendRow>
        ))}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => setCode(!code)} style={small}>{code ? 'Hide my code' : 'My friend code'}</Button>
          <span style={{ fontSize: 12.5, color: C.faint }}>Let someone scan it to add you.</span>
        </div>
        {code && account.addLink && (
          <div style={{ marginTop: 12 }}>
            <QrCode text={account.addLink} label={`QR code to add @${account.profile.username} as a friend`} />
            <p style={{ margin: '8px 0 6px', fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
              @{account.profile.username}. They point their phone’s camera at it, or open the link.
            </p>
            <Button style={small} onClick={async () => {
              try { await navigator.clipboard.writeText(account.addLink); setSaid('Your link is copied.'); } catch { setProblem(account.addLink); }
            }}>Copy my link</Button>
          </div>
        )}
      </div>

      {list === null ? <p style={{ fontSize: 13.5, color: C.muted }}>Loading your friends…</p> : (
        <>
          {received.length > 0 && section('Requests', received)}
          {section('Friends', friends, 'No friends yet. Search for someone above, or share your code.')}
          {sent.length > 0 && section('Sent', sent)}
        </>
      )}

      <details onToggle={(e) => { if (e.target.open && blocks === null) api.blocks().then(setBlocks, () => setBlocks([])); }}
        style={{ fontSize: 13, color: C.muted }}>
        <summary style={{ cursor: 'pointer' }}>Blocked people</summary>
        {blocks === null ? <p style={{ margin: '8px 0 0' }}>Loading…</p> : blocks.length === 0 ? <p style={{ margin: '8px 0 0' }}>No one.</p> : blocks.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
            <span style={{ flex: 1, color: C.ink }}>{b.display_name} <span style={{ color: C.faint }}>@{b.username}</span></span>
            <Button style={small} onClick={async () => {
              try { await api.unblock(b.id); setBlocks(blocks.filter((x) => x.id !== b.id)); } catch (err) { setProblem(err.message); }
            }}>Unblock</Button>
          </div>
        ))}
      </details>
    </div>
  );
}

/* ---------- settings: preferences ---------- */
const START_KEY = 'crm-start-v1';
const START_VIEWS = [['list', 'People'], ['feed', 'Feed'], ['events', 'Events'], ['reminders', 'Reminders'], ['collections', 'Lists'], ['trips', 'Trips'], ['recap', 'Recap']];
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const HOURS = Array.from({ length: 24 }, (_, h) => [h, hourLabel(h)]);
const BIRTHDAY_LEADS = [[0, 'On the day'], [1, 'The day before'], [3, '3 days before'], [7, 'A week before'], [14, 'Two weeks before']];

const PUSH_WHY = {
  unset: 'Push is not set up for Orbit yet.',
  unsupported: 'This browser cannot get push notifications. Try Chrome, Edge, Firefox or Safari.',
  install: 'On iPhone and iPad, add Orbit to your Home Screen first: tap Share, then Add to Home Screen, and open Orbit from there.',
  denied: 'Notifications are blocked for Orbit in this browser. Allow them in the browser’s site settings, then come back.',
};

// Whether this person shares which parts of Orbit they use (usage.js). Only
// with an account whose server counts usage (schema part 8).
function UsageChoice({ account }) {
  const pr = account?.profile;
  const [on, setOn] = useState(pr?.share_usage !== false);
  const [said, setSaid] = useState('');
  if (!pr || !('share_usage' in pr)) return null;
  const change = async (v) => {
    setOn(v);
    setSaid('');
    try {
      await account.updateProfile({ shareUsage: v });
      setSaid(v ? 'Thanks. That helps decide what to build.' : 'Nothing more is counted from you.');
    } catch (err) {
      setOn(!v);
      setSaid(err?.message || 'That did not save.');
    }
  };
  return (
    <div style={settingsCard()}>
      <p style={settingsHead}>Usage counts</p>
      <Check on={on} onChange={change} label="Share which parts of Orbit I use"
        hint="Counts of what you do, like “added an event” or “opened the feed”, so what gets built next follows what people use. Never what you write: no names, titles, notes or places." />
      {said && <p aria-live="polite" style={{ margin: 0, fontSize: 13, color: C.muted }}>{said}</p>}
    </div>
  );
}

function PreferencesSettings({ account, theme, onTheme, start, onStart }) {
  const api = account?.notifications;
  const [prefs, setPrefs] = useState(null);
  const [device, setDevice] = useState(null);
  const [support] = useState(() => pushSupport());
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');
  const here = deviceTimeZone();

  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    api.load().then((p) => { if (live) setPrefs(p); }, (err) => { if (live) { setPrefs(false); setProblem(err.message); } });
    api.deviceOn().then((on) => { if (live) setDevice(on); }, () => { if (live) setDevice(false); });
    return () => { live = false; };
  }, [api]);

  const set = (k, v) => { setPrefs({ ...prefs, [k]: v }); setSaid(''); };
  const doing = async (what, fn, done) => {
    setBusy(what);
    setProblem('');
    setSaid('');
    try {
      await fn();
      if (done) setSaid(done);
    } catch (err) {
      setProblem(err?.message || 'That did not work. Try again.');
    } finally {
      setBusy('');
    }
  };
  const save = (next = prefs, done = 'Saved.') => doing('save', () => api.save(next), done);

  const site = (
    <div style={settingsCard()}>
      <p style={settingsHead}>This site</p>
      <Group label="Theme">
        <div style={{ display: 'flex', gap: 8 }}>
          {[['daylight', 'Daylight'], ['orbit', 'Orbit']].map(([v, l]) => (
            <button key={v} className="crm-btn" aria-pressed={theme === v} onClick={() => onTheme(v)} style={segment(theme === v)}>{l}</button>
          ))}
        </div>
      </Group>
      <Field label="Open Orbit on">
        <select className="crm-select" value={start} onChange={(e) => onStart(e.target.value)} style={{ ...inputStyle, minHeight: 38, fontSize: 14 }}>
          {START_VIEWS.filter(([v]) => v !== 'feed' || account?.profile).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
    </div>
  );
  if (!api) return site;

  const notes = (
    <>
      {problem && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>}
      <p aria-live="polite" style={{ margin: said ? '10px 0 0' : 0, fontSize: 13, color: C.calmText, lineHeight: 1.5 }}>{said}</p>
    </>
  );
  if (prefs === null) return <>{site}<p style={{ fontSize: 13.5, color: C.muted }}>Loading your notification settings…</p></>;
  if (prefs === false) return <>{site}<div style={settingsCard()}><p style={settingsHead}>Notifications</p>{notes}</div></>;

  const sel = (label, value, options, onChange) => (
    <select className="crm-select" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: 'auto', minHeight: 36, padding: '5px 30px 5px 10px', fontSize: 13.5 }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const quietOn = prefs.quiet_start != null && prefs.quiet_end != null;

  return (
    <div>
      {site}
      <div style={settingsCard()}>
        <p style={settingsHead}>Notifications</p>

        <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: C.ink }}>Push on this device</p>
        {!support.ok ? (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{PUSH_WHY[support.why]}</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: device ? C.calmText : C.muted }}>{device === null ? 'Checking…' : device ? 'On for this device.' : 'Off for this device.'}</span>
            {device ? (
              <>
                <Button style={small} onClick={() => doing('test', async () => { await api.test(); }, 'Sent. It should appear in a moment.')}>
                  {busy === 'test' ? 'Sending…' : 'Send a test'}
                </Button>
                <Button style={small} onClick={() => doing('off', async () => { await api.disableDevice(); setDevice(false); }, 'Push is off for this device.')}>Turn off</Button>
              </>
            ) : (
              <Button kind="solid" style={small} onClick={() => doing('on', async () => {
                await api.enableDevice();
                setDevice(true);
                const next = { ...prefs, push: true, time_zone: prefs.time_zone === 'UTC' ? here : prefs.time_zone };
                setPrefs(next);
                await api.save(next);
              }, 'Push is on for this device.')}>{busy === 'on' ? 'Turning on…' : 'Turn on'}</Button>
            )}
          </div>
        )}
        {device !== null && (
          <Check on={prefs.push} onChange={(v) => set('push', v)} label="Send push notifications"
            hint="To every device where you turned them on. Off pauses them everywhere." />
        )}

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 }}>
          <Check on={prefs.email} onChange={(v) => set('email', v)} label={`Email me a digest at ${account.email}`}
            hint="A list of what is coming up. Only sent when there is something in it." />
          {prefs.email && (
            <div style={{ margin: '-4px 0 12px 26px' }}>
              {sel('How often', prefs.email_every, [['daily', 'Every day'], ['weekly', 'Every Monday, for the week ahead']], (v) => set('email_every', v))}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: C.ink }}>What to hear about</p>
          {KINDS.map(([k, label, hint]) => (
            <div key={k}>
              <Check on={prefs.kinds[k] !== false} onChange={(v) => set('kinds', { ...prefs.kinds, [k]: v })} label={label} hint={hint} />
              {k === 'birthdays' && prefs.kinds.birthdays !== false && (
                <div style={{ margin: '-4px 0 12px 26px' }}>
                  {sel('When to hear about birthdays', prefs.birthday_days, BIRTHDAY_LEADS, (v) => set('birthday_days', Number(v)))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: C.ink }}>When</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5, color: C.ink, marginBottom: 10 }}>
            Each day at {sel('Time of day', prefs.send_hour, HOURS, (v) => set('send_hour', Number(v)))}
          </div>
          <Check on={quietOn} onChange={(v) => setPrefs({ ...prefs, quiet_start: v ? 22 : null, quiet_end: v ? 7 : null })}
            label="Quiet hours" hint="No friend request pushes in this window; they wait until it ends." />
          {quietOn && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '-4px 0 12px 26px', fontSize: 13, color: C.muted }}>
              From {sel('Quiet from', prefs.quiet_start, HOURS, (v) => set('quiet_start', Number(v)))}
              to {sel('Quiet until', prefs.quiet_end, HOURS, (v) => set('quiet_end', Number(v)))}
            </div>
          )}
          <p style={{ margin: 0, fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
            Times are in {prefs.time_zone}.{' '}
            {prefs.time_zone !== here && (
              <button className="crm-btn" onClick={() => set('time_zone', here)} style={{
                font: 'inherit', color: C.muted, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
              }}>Use {here}, where this device is</button>
            )}
          </p>
        </div>

        <div style={{ marginTop: 14 }}>
          <Button kind="solid" onClick={busy ? undefined : () => save()}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        </div>
        {notes}
      </div>
    </div>
  );
}

// How much of this browser's storage Orbit is using. Trip photos are most of
// it, and they only live here, so the way to a backup file is beside it.
function StorageSettings({ onBackup }) {
  const [usage, setUsage] = useState(undefined);
  const [photos, setPhotos] = useState(null);
  useEffect(() => {
    let live = true;
    photoStore.estimate().then((u) => { if (live) setUsage(u); });
    photoStore.listAll().then((all) => { if (live) setPhotos(all.length); }, () => { if (live) setPhotos(null); });
    return () => { live = false; };
  }, []);
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 20, paddingTop: 16 }}>
      <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: C.ink }}>Storage on this device</p>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
        {usage === undefined ? 'Checking…'
          : usage ? `Orbit is using about ${approxBytes(usage.usage)} of this browser's storage${usage.quota ? `, out of roughly ${approxBytes(usage.quota)} it allows` : ''}.`
          : 'This browser does not say how much space Orbit is using.'}
        {photos ? ` Most of that is ${countThings(photos, 'trip photo', 'trip photos').toLowerCase()}, which are only kept here.` : ''}
      </p>
      <Button onClick={onBackup} style={small}>Backup file</Button>
    </div>
  );
}

function SettingsView({ account, theme, onTheme, start, onStart, onBackup, onClose }) {
  const [tab, setTab] = useState('account');
  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Settings</h1>
        <Button onClick={onClose} style={{ marginLeft: 'auto' }}>Done</Button>
      </div>
      {account && (
        <div role="group" aria-label="Settings section" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['account', 'Account'], ['profile', 'Profile'], ['prefs', 'Preferences']].map(([v, l]) => (
            <button key={v} className="crm-btn" aria-pressed={tab === v} onClick={() => setTab(v)} style={filterChip(tab === v)}>{l}</button>
          ))}
        </div>
      )}
      {!account && (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
          This copy of Orbit has no accounts switched on, so everything is saved in this browser only.
        </p>
      )}
      {account && tab === 'account' && <AccountSettings account={account} />}
      {account && tab === 'profile' && <ProfileSettings account={account} />}
      {(!account || tab === 'prefs') && <PreferencesSettings account={account} theme={theme} onTheme={onTheme} start={start} onStart={onStart} />}
      {account && tab === 'prefs' && <UsageChoice account={account} />}
      {(!account || tab === 'prefs') && <StorageSettings onBackup={onBackup} />}
    </div>
  );
}

/* ---------- import / export screens ---------- */
const COL_GROUPS = [
  ['contact', 'Contact details'],
  ['links', 'Partner, kids, families, groups'],
  ['cadence', 'Check-in settings'],
  ['dates', 'Dates to remember'],
  ['notes', 'Hobbies and notes'],
];

function Check({ on, onChange, label, hint }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, width: 16, height: 16, accentColor: C.accentDeep, flexShrink: 0 }} />
      <span>
        <span style={{ fontSize: 14, color: C.ink }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}

function ExportView({ people, events, reminders, collections, onClose }) {
  const [what, setWhat] = useState({ people: true, events: true, reminders: true, lists: true, log: false });
  const [circle, setCircle] = useState('all');
  const [withPaused, setWithPaused] = useState(true);
  const [groups, setGroups] = useState(
    Object.fromEntries(COL_GROUPS.map(([k]) => [k, true])));
  const [preview, setPreview] = useState('');
  const [note, setNote] = useState('');

  const chosen = people
    .filter((p) => circle === 'all' || (circle === 'vip' ? p.vip : (p.circle || 'friend') === circle))
    .filter((p) => withPaused || !p.paused);

  const cols = PERSON_COLS.filter((c) => c.g === 'basics' || groups[c.g]);

  const build = () => {
    const parts = [];
    if (what.people) parts.push(['people', toCsv(cols, chosen)]);
    if (what.events) parts.push(['events', toCsv(EVENT_COLS, events)]);
    if (what.reminders) parts.push(['reminders', toCsv(REMINDER_COLS, reminders)]);
    if (what.lists) parts.push(['lists', toCsv(ITEM_COLS, flattenCollections(collections))]);
    if (what.log) {
      const rows = [];
      chosen.forEach((p) => (p.log || []).forEach((e) => rows.push({ p, e })));
      rows.sort((a, b) => (a.e.date < b.e.date ? 1 : -1));
      parts.push(['catch-ups', Papa.unparse({
        fields: ['Person', 'Date', 'What came up'],
        data: rows.map((r) => [r.p.name, r.e.date, r.e.text || '']),
      }, { escapeFormulae: FORMULA_START })]);
    }
    return parts;
  };

  const run = () => {
    const parts = build();
    if (parts.length === 0) { setNote('Pick at least one thing to export.'); return; }
    const stamp = todayStr();
    let saved = 0;
    parts.forEach(([name, csv]) => { if (downloadCsv(`orbit-${name}-${stamp}.csv`, csv)) saved += 1; });
    track('data.export', { files: parts.length });
    setPreview(parts.map(([name, csv]) => `### ${name}\n${csv}`).join('\n\n'));
    setNote(saved === parts.length
      ? `Downloaded ${saved} file${saved === 1 ? '' : 's'}. The text is below too, in case the download was blocked.`
      : 'The sandbox blocked the download. Select the text below and copy it into a .csv file.');
  };

  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: '15px 15px 6px', marginBottom: 12 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Export</h1>
        <Button onClick={onClose} style={{ marginLeft: 'auto' }}>Done</Button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        Spreadsheet-ready CSV. One file per kind of record.
      </p>

      <div style={box}>
        <p style={{ margin: '0 0 11px', fontSize: 13, fontWeight: 600, color: C.ink }}>What to export</p>
        <Check on={what.people} onChange={(v) => setWhat({ ...what, people: v })}
          label={`People (${chosen.length})`} />
        <Check on={what.events} onChange={(v) => setWhat({ ...what, events: v })}
          label={`Events (${events.length})`} />
        <Check on={what.reminders} onChange={(v) => setWhat({ ...what, reminders: v })}
          label={`Reminders (${reminders.length})`} />
        <Check on={what.lists} onChange={(v) => setWhat({ ...what, lists: v })}
          label={`Lists (${collections.length})`} hint="One row per entry, with the list it is on" />
        <Check on={what.log} onChange={(v) => setWhat({ ...what, log: v })}
          label="Catch-up log" hint="Every logged catch-up as its own row" />
      </div>

      {what.people && (
        <>
          <div style={box}>
            <p style={{ margin: '0 0 11px', fontSize: 13, fontWeight: 600, color: C.ink }}>Which people</p>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
              {[['all', 'Everyone'], ['friend', 'Personal'], ['work', 'Professional'], ['vip', 'VIP']].map(([v, l]) => (
                <button key={v} className="crm-btn" onClick={() => setCircle(v)} style={{
                  font: 'inherit', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 20,
                  cursor: 'pointer',
                  background: circle === v ? C.accent : 'transparent',
                  border: `1px solid ${circle === v ? C.accent : C.line}`,
                  color: circle === v ? C.onAccent : C.muted,
                }}>{l}</button>
              ))}
            </div>
            <Check on={withPaused} onChange={setWithPaused} label="Include paused people" />
          </div>

          <div style={box}>
            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: C.ink }}>Which columns</p>
            <p style={{ margin: '0 0 11px', fontSize: 12, color: C.faint, lineHeight: 1.45 }}>
              Names, list, closeness, role, company and birthday are always included.
            </p>
            {COL_GROUPS.map(([k, l]) => (
              <Check key={k} on={groups[k]} onChange={(v) => setGroups({ ...groups, [k]: v })} label={l} />
            ))}
          </div>
        </>
      )}

      <Button kind="solid" onClick={run} style={{ width: '100%' }}>Export CSV</Button>

      {note && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{note}</p>
      )}
      {preview && (
        <textarea
          readOnly
          onFocus={(e) => e.target.select()}
          value={preview}
          style={{ ...inputStyle, marginTop: 10, minHeight: 160, fontSize: 12, lineHeight: 1.45, resize: 'vertical' }}
        />
      )}
    </div>
  );
}

function ImportView({ people, events, reminders, collections, onPeople, onEvents, onReminders, onCollections, onShared, onClose }) {
  const [over, setOver] = useState(false);
  const [found, setFound] = useState(null);
  const [problem, setProblem] = useState('');
  const [mode, setMode] = useState('add');
  const picker = useRef(null);

  const read = (file) => {
    setProblem('');
    setFound(null);
    if (!file) return;
    // A share file dropped here opens the same as from the box above.
    if (/\.orbit$/i.test(file.name)) {
      file.text().then(readAnyShare).then((got) => (got ? onShared(got) : setProblem('That .orbit file could not be read.')),
        () => setProblem('The file could not be read.'));
      return;
    }
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text/i.test(file.type)) {
      setProblem('That does not look like a CSV. Export one from a spreadsheet first.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setProblem('The file could not be read.');
    reader.onload = () => {
      const parsed = Papa.parse(String(reader.result || ''), {
        header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      });
      const rows = parsed.data || [];
      if (rows.length === 0) { setProblem('No rows in that file.'); return; }

      const headers = Object.keys(rows[0] || {}).map(norm);
      // Reminders and events both have a Title, so test for the column only
      // reminders carry before falling through to the event shape.
      const looksLikeReminders = headers.includes('nextdue')
        || headers.includes('repeatevery') || headers.includes('noticedays');
      const looksLikeEvents = headers.includes('title') && (headers.includes('start') || headers.includes('date'));
      // People sheets have a List column too, and a hand-edited one may add a
      // Title (a job title), but a lists sheet never has a Name.
      const looksLikeLists = headers.includes('title') && headers.includes('list') && !headers.includes('name');

      if (looksLikeReminders) {
        const { out, skipped } = fromCsv(REMINDER_COLS, rows, () => ({
          id: uid(), addedOn: todayStr(), kind: 'Other', anchor: 'date',
          title: '', next: '', every: null, lead: 7, note: '', people: [],
          history: [], lastDone: null, paused: false, done: false,
        }));
        // A sheet that named an interval but no day to pin it to gets one from
        // the date it is due. A sheet that did name one keeps it.
        const good = out.filter((r) => r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.next))
          .map((r) => (r.every && !r.every.dom
            ? { ...r, every: { ...r.every, dom: everyFrom(r.next).dom } }
            : r));
        setFound({ kind: 'reminders', rows: good, skipped: skipped + (out.length - good.length), file: file.name });
      } else if (looksLikeLists) {
        const { out, skipped } = fromCsv(ITEM_COLS, rows, () => ({
          list: '', kind: '', title: '', detail: '', status: '', rating: 0,
          link: '', note: '', addedOn: '', doneOn: '',
        }));
        const good = out.filter((r) => r.title);
        const opts = {
          fallback: file.name.replace(/\.csv$/i, '').trim() || 'Imported list',
          statusColumn: headers.includes('status'),
        };
        // Kept as rows too: adding to lists you already keep reads stages in
        // those lists' own words, which is only known once Add is chosen.
        const lists = gatherCollections(good, opts);
        const kept = lists.reduce((n, c) => n + c.items.length, 0);
        setFound({
          kind: 'lists', rows: lists, raw: good, opts, lost: good.length - kept,
          skipped: skipped + (out.length - good.length), file: file.name,
        });
      } else if (looksLikeEvents) {
        const { out, skipped } = fromCsv(EVENT_COLS, rows, () => ({
          id: uid(), addedOn: todayStr(), kind: 'Other', people: [],
          title: '', date: '', endDate: null, note: '', place: '', lat: null, lon: null,
        }));
        const good = out.filter((e) => e.title && e.date);
        setFound({ kind: 'events', rows: good, skipped: skipped + (out.length - good.length), file: file.name });
      } else {
        const { out, skipped } = fromCsv(PERSON_COLS, rows, () => ({
          id: uid(), addedOn: todayStr(), circle: 'friend', tier: 'friend', cadence: 90,
          name: '', aka: [], kids: [], families: [], groups: [], dates: [],
          socials: {}, log: [], lastContact: null, paused: false,
        }));
        const good = out.filter((p) => p.name && p.name.trim());
        setFound({ kind: 'people', rows: good, skipped: skipped + (out.length - good.length), file: file.name });
      }
    };
    reader.readAsText(file);
  };

  const commit = () => {
    if (!found) return;
    track('data.import', { kind: found.kind, rows: found.rows.length, mode });
    if (found.kind === 'people') {
      onPeople(mode === 'replace' ? found.rows : [...people, ...found.rows]);
    } else if (found.kind === 'reminders') {
      onReminders(mode === 'replace' ? found.rows : [...reminders, ...found.rows]);
    } else if (found.kind === 'lists') {
      onCollections(mode === 'replace' ? found.rows
        : mergeCollections(collections, gatherCollections(found.raw, { ...found.opts, have: collections })));
    } else {
      onEvents(mode === 'replace' ? found.rows : [...events, ...found.rows]);
    }
    onClose();
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>Import</h1>
        <Button onClick={onClose} style={{ marginLeft: 'auto' }}>Done</Button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        Drop in a CSV. People, events, reminders and lists are detected automatically, and a
        plain sheet of names and emails works fine.
      </p>

      <OpenShared onOpen={onShared} />

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]); }}
        onClick={() => picker.current && picker.current.click()}
        style={{
          border: `2px dashed ${over ? C.accent : C.line}`,
          background: over ? C.accentSoft : C.surface,
          borderRadius: 14, padding: '34px 20px', textAlign: 'center', cursor: 'pointer',
        }}
      >
        <EmptySky width={104} />
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.ink }}>
          {over ? 'Let go to read it' : 'Drop a CSV here'}
        </p>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: C.muted }}>or tap to choose a file</p>
        <input
          ref={picker}
          type="file"
          aria-label="CSV file"
          accept=".csv,text/csv"
          onChange={(e) => read(e.target.files[0])}
          style={{ display: 'none' }}
        />
      </div>

      {problem && (
        <p style={{ margin: '14px 0 0', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>{problem}</p>
      )}

      {found && (
        <div style={{
          marginTop: 16, background: C.surface, border: `1px solid ${C.line}`,
          borderRadius: 12, padding: '15px 15px 6px',
        }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: C.ink }}>
            {found.rows.length} {found.kind} ready
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
            From {found.file}
            {found.skipped > 0 && `, ${found.skipped} row${found.skipped === 1 ? '' : 's'} skipped for having no ${found.kind === 'people' ? 'name' : found.kind === 'lists' ? 'title' : 'title or date'}`}
          </p>

          {found.rows.length > 0 && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 12.5, color: C.muted }}>
                First few: {found.rows.slice(0, 4)
                  .map((r) => (found.kind === 'lists' ? `${r.name} (${r.items.length})` : r.name || r.title)).join(', ')}
              </p>
              <Check on={mode === 'add'} onChange={() => setMode('add')}
                label="Add to what I already have"
                hint={found.kind === 'lists' ? 'Entries for a list you already keep join that list' : undefined} />
              <Check on={mode === 'replace'} onChange={() => setMode('replace')}
                label="Replace everything"
                hint={`Removes your current ${found.kind}`} />
              {found.kind === 'lists' && found.lost + importOverflow(collections, found.rows, mode) > 0 && (
                <p style={{ margin: '0 0 12px', fontSize: 13, color: C.overdue, lineHeight: 1.5 }}>
                  {`${countThings(found.lost + importOverflow(collections, found.rows, mode), 'entry', 'entries')} will not fit. A list holds at most ${ITEM_CAP.toLocaleString()}.`}
                </p>
              )}
              <Button kind="solid" onClick={commit} style={{ width: '100%', marginBottom: 10 }}>
                {mode === 'replace' ? 'Replace' : 'Add'} {found.rows.length} {found.kind}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- app ---------- */
// account is { email, signOut } when Orbit is signed in to (see Account.jsx),
// and null when it saves only in this browser.
export default function PersonalCRM({ account = null } = {}) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [circleTab, setCircleTab] = useState('friend');
  const [tagFilter, setTagFilter] = useState(null);
  const [tab, setTab] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState('daylight');
  const [owner, setOwner] = useState('');
  const [namingOwner, setNamingOwner] = useState(false);
  const [view, setView] = useState('list');
  // Where Orbit opens, as chosen in Settings.
  const [startView, setStartView] = useState('list');
  const [events, setEvents] = useState([]);
  // Whether the saved events were read. Until they are, nothing is shared
  // from them: an events list that failed to load is not an empty one.
  const eventsRead = useRef(false);
  const tripsLoaded = useRef(false);
  // Explore: the catalog entries opened, in order, so Back goes to the last.
  const [explore, setExplore] = useState([]);
  const [eventDraft, setEventDraft] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [reminderDraft, setReminderDraft] = useState(null);
  const [collections, setCollections] = useState([]);
  const [collectionOpen, setCollectionOpen] = useState(null);
  const [collectionDraft, setCollectionDraft] = useState(null);
  const [incoming, setIncoming] = useState(null);
  // People someone shared, waiting to be looked at on the Receive screen.
  const [received, setReceived] = useState(null);
  // Friend requests waiting for an answer, shown on the menu.
  const [friendCount, setFriendCount] = useState(0);
  // A username from a friend's code or link, to open on the Friends screen.
  const [addTarget, setAddTarget] = useState('');
  const friendsOn = Boolean(account?.friends && account.profile && 'visibility' in account.profile);
  const listsLook = useRef({ q: '', kind: 'All', order: 'recent' });
  const [trips, setTrips] = useState([]);
  const [tripOpen, setTripOpen] = useState(null);
  const [tripDraft, setTripDraft] = useState(null);
  const [incomingTrip, setIncomingTrip] = useState(null);
  const tripsLook = useRef({ mode: 'map', filter: NO_TRIP_FILTER });
  // Flags read from storage: whether the device-only notice and the offer to
  // turn pinned events into trips have been answered. Both start answered so
  // neither flashes up before storage has been read.
  const [tripNoticeSeen, setTripNoticeSeen] = useState(true);
  const [tripStatsHidden, setTripStatsHidden] = useState(false);
  const [tripOfferDone, setTripOfferDone] = useState(true);
  const [lastBackup, setLastBackup] = useState('');
  // Saved lists that could not be read as they were: their original text,
  // shown in a warning with a way to download it.
  const [setAsideText, setSetAsideText] = useState(null);
  // Lists whose original could not even be set aside (no room). These are
  // never saved over for the rest of the visit.
  const heldBack = useRef(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  // The calendar year, kept current: when it turns over while Orbit is open
  // (or on coming back to it), Recap moves on to the new year too, unless
  // an older year is being looked at on purpose.
  const [thisYear, setThisYear] = useState(() => new Date().getFullYear());
  const thisYearSeen = useRef(thisYear);
  useEffect(() => {
    const check = () => {
      const now = new Date().getFullYear();
      if (now === thisYearSeen.current) return;
      const was = thisYearSeen.current;
      thisYearSeen.current = now;
      setThisYear(now);
      setYear((y) => (y === was ? now : y));
    };
    const tick = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  const [backup, setBackup] = useState('');
  const [paste, setPaste] = useState('');

  useEffect(() => {
    (async () => {
      // Each list is read on its own. One that cannot be used exactly as it
      // was saved is set aside first, and what could be read still loads.
      const aside = {};
      const load = async (key, cleanList, byIdentity, apply) => {
        try {
          const r = await window.storage.get(key);
          if (key === EVENTS_KEY) eventsRead.current = true;
          if (key === TRIPS_KEY) tripsLoaded.current = true;
          if (!r?.value) return;
          const { list, damaged } = readSaved(r.value, cleanList, byIdentity);
          if (damaged) {
            aside[key] = r.value;
            try { await setAside(key, r.value); } catch { heldBack.current.add(key); }
          }
          apply(list);
        } catch {
          /* nothing saved yet, or storage is out of reach */
        }
      };
      await load(STORE_KEY, (a) => cleanAll(a, cleanPerson), true, (list) => setPeople(list.map((x) => {
        if (x.addedOn) return x;
        const dates = (x.log || []).map((e) => e.date).filter(Boolean).sort();
        return { ...x, addedOn: dates[0] || null };
      })));
      await load(EVENTS_KEY, (a) => cleanAll(a, cleanEvent), true, setEvents);
      await load(REMINDERS_KEY, (a) => cleanAll(a, cleanReminder), true, setReminders);
      // Lists are rebuilt by their own cleaner, so only a list that would not
      // parse or lost records counts as damaged.
      await load(COLLECTIONS_KEY, cleanCollections, false, setCollections);
      // Trips are rebuilt by their own cleaner, like lists.
      let tripsRead = null;
      await load(TRIPS_KEY, cleanTrips, false, (list) => { tripsRead = list; setTrips(list); });
      if (Object.keys(aside).length) setSetAsideText(aside);
      // Photos no trip refers to any more (a trip deleted while its photos
      // could not be, a form closed mid-upload) are cleared away, but only
      // when the saved trips were read exactly as saved, and only photos
      // older than a day, so an upload in progress in another tab is safe.
      if (tripsRead && !aside[TRIPS_KEY]) {
        const keep = new Set(tripsRead.flatMap((t) => t.photoIds));
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        photoStore.listAll()
          .then((all) => photoStore.deleteMany(all.filter((x) => !keep.has(x.id) && (x.savedAt || '') < cutoff).map((x) => x.id)))
          .catch(() => { /* the photo store is out of reach; nothing to tidy */ });
      }
      try {
        const [seen, offered, backedUp, statsOff] = await Promise.all([
          window.storage.get(TRIPS_NOTICE_KEY), window.storage.get(TRIPS_OFFER_KEY), window.storage.get(BACKUP_AT_KEY),
          window.storage.get(TRIP_STATS_KEY),
        ]);
        setTripNoticeSeen(Boolean(seen?.value));
        setTripStatsHidden(statsOff?.value === 'hidden');
        setTripOfferDone(Boolean(offered?.value));
        if (backedUp?.value) setLastBackup(backedUp.value);
      } catch {
        /* storage is out of reach; leave the notices unshown */
      }
      try {
        const t = await window.storage.get(THEME_KEY);
        if (t?.value && THEMES[t.value]) { applyTheme(t.value); setTheme(t.value); }
      } catch {
        /* default theme is fine */
      }
      try {
        const o = await window.storage.get(OWNER_KEY);
        if (o?.value) setOwner(o.value);
      } catch {
        /* first run — nothing saved yet */
      }
      try {
        const st = await window.storage.get(START_KEY);
        // The Map tab became Trips; a start saved as the map opens there.
        const start = st?.value === 'map' ? 'trips' : st?.value;
        if (start && START_VIEWS.some(([v]) => v === start)) {
          setStartView(start);
          // Only if nothing else (a shared link, a friend code) has opened a screen.
          setView((v) => (v === 'list' ? start : v));
        }
      } catch {
        /* People, as always */
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const shut = () => setMenuOpen(false);
    document.addEventListener('click', shut);
    return () => document.removeEventListener('click', shut);
  }, [menuOpen]);

  // Someone opened a shared list's link. Nothing is added until they say so,
  // and the link is taken out of the address bar straight away, so a reload
  // or a bookmark does not offer the same list again.
  //
  // Arriving with a link goes straight to the offer, since nothing can be
  // open yet. A link pasted into the address bar later only raises a notice
  // (see sharedWaiting), so a half-filled form is never thrown away for it.
  useEffect(() => {
    const look = async (arriving) => {
      const hash = window.location.hash;
      // A friend's code: their profile, on the Friends screen.
      const add = hash.match(/^#add=@?([A-Za-z0-9._]{3,20})$/);
      if (add) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setAddTarget(add[1].toLowerCase());
        setView('friends');
        return;
      }
      if (!hash.startsWith(`#${SHARE_PREFIX}`)) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const got = await readAnyShare(hash);
      if (got?.type === 'trip') {
        setIncomingTrip(got);
        if (arriving) setView('trips');
        return;
      }
      // A link that will not read is reported where its kind would have
      // gone: newer shares on the Receive screen, lists with the lists.
      if (got?.type === 'people' || (!got && hash.startsWith(`#${SHARE_PREFIX}${SHARE_V2}`))) {
        setReceived(got || { broken: true });
        if (arriving) setView('receive');
        return;
      }
      setIncoming(got || { broken: true });
      if (arriving) setView('collections');
    };
    look(true);
    const later = () => look(false);
    window.addEventListener('hashchange', later);
    return () => window.removeEventListener('hashchange', later);
  }, []);

  // A list whose unreadable original could not be set aside is not saved
  // over: the change shows, and the error says why it was not kept.
  const holdBack = (key) => {
    if (!heldBack.current.has(key)) return false;
    setError('That change is showing here but was not saved, so the unreadable copy described above is not lost.');
    return true;
  };

  const persist = async (next) => {
    trackChanges('people', people, next);
    setPeople(next);
    if (holdBack(STORE_KEY)) return false;
    try {
      await window.storage.set(STORE_KEY, JSON.stringify(next));
      setError('');
      return true;
    } catch {
      setError('That change is showing here but did not save. Try again.');
      return false;
    }
  };

  const upsert = (person) => {
    const exists = people.some((p) => p.id === person.id);
    persist(exists ? people.map((p) => (p.id === person.id ? person : p)) : [...people, person]);
    setCircleTab((c) => (c === 'all' || c === 'vip' ? c : person.circle));
    setAdding(false);
    setEditing(null);
    setOpenId(person.id);
  };

  // Something shared, opened from Import: people go to the Receive screen,
  // a list to the lists, the same as arriving by link.
  const openShare = (got) => {
    if (got.type === 'trip') { setIncomingTrip(got); setView('trips'); setTripOpen(null); setTripDraft(null); return; }
    if (got.type === 'list') { setIncoming(got); setView('collections'); setCollectionOpen(null); setCollectionDraft(null); return; }
    setReceived(got);
    setView('receive');
  };

  const saveReceived = async (next, focus) => {
    await persist(next);
    setReceived(null);
    setView('list');
    const shown = next.find((x) => x.id === focus);
    if (shown) {
      setCircleTab((c) => (c === 'all' || c === 'vip' ? c : shown.circle));
      setTagFilter(null);
      setQ('');
      setOpenId(shown.id);
    }
  };

  const clearVia = (id) => {
    persist(people.map((x) => {
      if (x.id !== id) return x;
      const { via: _via, ...rest } = x;
      return rest;
    }));
  };

  // Outings shared to the catalog follow the events. The whole set goes each
  // time it changes (the server replaces what it had), and a fingerprint of
  // the last set sent is kept on this device so an unchanged set is not sent
  // again. A failure is quiet: the next change, or the next visit, tries again.
  const catalogOn = Boolean(account?.catalog && account.profile);
  const sharedOutings = useMemo(() => JSON.stringify(outingsToShare(events, OUTING_KINDS, todayStr())), [events]);
  useEffect(() => {
    if (!catalogOn || loading || !eventsRead.current) return undefined;
    const key = `orbit-outings-sent:${account.profile.id}`;
    const print = fingerprint(sharedOutings);
    let last = null;
    try { last = localStorage.getItem(key); } catch { /* sent again, harmlessly */ }
    if (last === print) return undefined;
    const t = setTimeout(() => {
      account.catalog.sync(JSON.parse(sharedOutings)).then(() => {
        try { localStorage.setItem(key, print); } catch { /* sent again next time */ }
      }, () => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [catalogOn, loading, sharedOutings, account]);

  // Trips shown on your page follow the trips in the same way, once you have
  // chosen to show them (Settings → Profile). While they are kept to you, an
  // empty set goes, once, so no copy is left behind. Countries and states are
  // worked out here, so the outlines load only when trips are shown.
  const tripsShown = account?.profile?.visibility?.trips || 'me';
  const showingTrips = catalogOn && tripsShown !== 'me' && 'public_page' in (account?.profile || {});
  const { where: tripWhere } = useGeo(showingTrips && trips.length > 0);
  const sharedTrips = useMemo(() => {
    if (!showingTrips) return '[]';
    if (trips.length && !tripWhere) return null;
    return JSON.stringify(tripsToShare(trips, tripWhere, todayStr()));
  }, [showingTrips, trips, tripWhere]);
  useEffect(() => {
    if (!catalogOn || !('public_page' in account.profile) || loading || !tripsLoaded.current || sharedTrips === null) return undefined;
    const key = `orbit-trips-sent:${account.profile.id}`;
    const print = fingerprint(`${tripsShown}|${sharedTrips}`);
    let last = null;
    try { last = localStorage.getItem(key); } catch { /* sent again, harmlessly */ }
    if (last === print) return undefined;
    const t = setTimeout(() => {
      account.catalog.syncTrips(JSON.parse(sharedTrips)).then(() => {
        try { localStorage.setItem(key, print); } catch { /* sent again next time */ }
      }, () => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [catalogOn, loading, sharedTrips, tripsShown, account]);

  // The feed: whether friends have shared anything since you last looked.
  // The newest item's time is read when Orbit opens, and the time of the
  // newest you have seen is kept on this device.
  const [feedNewest, setFeedNewest] = useState(null);
  const [feedSeen, setFeedSeen] = useState(() => {
    try { return account?.profile ? localStorage.getItem(`orbit-feed-seen:${account.profile.id}`) : null; } catch { return null; }
  });
  useEffect(() => {
    if (!catalogOn) return undefined;
    let live = true;
    account.catalog.feed(null, 1).then((rows) => { if (live && rows[0]) setFeedNewest(rows[0].at); }, () => {});
    return () => { live = false; };
  }, [catalogOn, account]);
  const feedFresh = Boolean(feedNewest && (!feedSeen || feedNewest > feedSeen));
  const sawFeed = useCallback((at) => {
    if (!at || !account?.profile) return;
    setFeedNewest((n) => (n && n > at ? n : at));
    setFeedSeen((was) => {
      const next = was && was > at ? was : at;
      try { localStorage.setItem(`orbit-feed-seen:${account.profile.id}`, next); } catch { /* the dot shows again next time */ }
      return next;
    });
  }, [account]);
  // A start view of Feed, where there is no feed (signed out, no username).
  useEffect(() => {
    if (!loading && view === 'feed' && !catalogOn) setView('list');
  }, [loading, view, catalogOn]);

  // Usage: whether this person shares it, when Orbit opens (with how much is
  // in it, as numbers), and each tab opened.
  const shareUsage = account?.profile?.share_usage !== false;
  useEffect(() => { usageShare(shareUsage); }, [shareUsage]);
  const opened = useRef(false);
  useEffect(() => {
    if (loading || opened.current) return;
    opened.current = true;
    track('app.open', {
      ...deviceKind(), signed_in: Boolean(account), view,
      people: people.length, events: events.length, reminders: reminders.length, lists: collections.length, trips: trips.length,
    });
  }, [loading, account, view, people.length, events.length, reminders.length, collections.length, trips.length]);
  useEffect(() => {
    if (!loading) track('view.open', { view });
  }, [loading, view]);

  // Whether this person is on Orbit's team and may see the usage report.
  const [usageAdmin, setUsageAdmin] = useState(false);
  useEffect(() => {
    if (!account?.usage || !account.profile) return undefined;
    let live = true;
    account.usage.isAdmin().then((yes) => { if (live) setUsageAdmin(yes); }, () => {});
    return () => { live = false; };
  }, [account]);

  // How many friend requests wait, read once when Orbit opens.
  useEffect(() => {
    if (!friendsOn) return undefined;
    let live = true;
    account.friends.list().then((rows) => {
      if (live) setFriendCount(rows.filter((r) => r.relation === 'received').length);
    }, () => {});
    return () => { live = false; };
  }, [friendsOn, account]);

  const clearAddTarget = useCallback(() => setAddTarget(''), []);

  const saveFriendToPeople = (pv) => {
    const person = profileToPerson(pv);
    if (person) openShare({ type: 'people', by: `@${pv.username}`, on: todayStr(), people: [person] });
  };

  const toggleVip = (id) => {
    persist(people.map((p) => (p.id === id ? { ...p, vip: !p.vip } : p)));
  };

  const quickLog = (id) => {
    persist(people.map((p) => (p.id === id
      ? withLog(p, [{ date: todayStr(), text: '' }, ...(p.log || [])])
      : p)));
  };

  const editLog = (id, i, patch) => {
    persist(people.map((p) => (p.id === id
      ? withLog(p, (p.log || []).map((e, j) => (j === i ? { ...e, ...patch } : e)))
      : p)));
  };

  const removeLog = (id, i) => {
    persist(people.map((p) => (p.id === id
      ? withLog(p, (p.log || []).filter((_, j) => j !== i))
      : p)));
  };

  // The rows' actions, made once, so memoised rows are not all redrawn just
  // because this component was. They call the current quickLog and toggleVip,
  // which the layout effect keeps up to date before another tap can arrive.
  const rowActs = useRef(null);
  useLayoutEffect(() => { rowActs.current = { quickLog, toggleVip }; });
  const openRow = useCallback((id) => { setOpenId(id); setEditing(null); setAdding(false); }, []);
  const quickLogRow = useCallback((id) => rowActs.current.quickLog(id), []);
  const starRow = useCallback((id) => rowActs.current.toggleVip(id), []);

  const logTouch = (id, date, text) => {
    persist(people.map((p) => (p.id === id
      ? withLog(p, [{ date, text }, ...(p.log || [])])
      : p)));
  };

  const persistEvents = async (next) => {
    trackChanges('events', events, next);
    setEvents(next);
    if (holdBack(EVENTS_KEY)) return false;
    try {
      await window.storage.set(EVENTS_KEY, JSON.stringify(next));
      setError('');
      return true;
    } catch {
      setError('That event is showing here but did not save. Try again.');
      return false;
    }
  };

  const saveEvent = (ev) => {
    const exists = events.some((x) => x.id === ev.id);
    persistEvents(exists ? events.map((x) => (x.id === ev.id ? ev : x)) : [...events, ev]);
    setEventDraft(null);
  };

  const persistReminders = async (next) => {
    trackChanges('reminders', reminders, next);
    setReminders(next);
    if (holdBack(REMINDERS_KEY)) return false;
    try {
      await window.storage.set(REMINDERS_KEY, JSON.stringify(next));
      setError('');
      return true;
    } catch {
      setError('That reminder is showing here but did not save. Try again.');
      return false;
    }
  };

  // Ticking one off from its card should not also close the form you happen
  // to have open, so only saving from the form clears the draft.
  const putReminder = (r) => {
    const exists = reminders.some((x) => x.id === r.id);
    persistReminders(exists ? reminders.map((x) => (x.id === r.id ? r : x)) : [...reminders, r]);
  };

  const saveReminder = (r) => {
    putReminder(r);
    setReminderDraft(null);
  };

  const persistCollections = async (next) => {
    trackChanges('lists', collections, next);
    setCollections(next);
    if (holdBack(COLLECTIONS_KEY)) return false;
    try {
      await window.storage.set(COLLECTIONS_KEY, JSON.stringify(next));
      setError('');
      return true;
    } catch {
      setError('That list is showing here but did not save. Try again.');
      return false;
    }
  };

  // Choosing a different order is how you look at a list, not a change to
  // it, so it does not move the list up "Recently changed".
  const putCollection = (c, touch = true) => {
    const next = touch ? { ...c, updatedAt: new Date().toISOString() } : c;
    const exists = collections.some((x) => x.id === c.id);
    persistCollections(exists ? collections.map((x) => (x.id === c.id ? next : x)) : [...collections, next]);
  };

  // Stable, so list cards (memoised) are not redrawn just because this
  // component was.
  const openCollectionById = useCallback((id) => {
    setCollectionOpen(id);
    setCollectionDraft(null);
    window.scrollTo(0, 0);
  }, []);

  const saveCollection = (c) => {
    putCollection(c);
    openCollectionById(c.id);
  };

  // A list with the same name is not overwritten; the new one says where it
  // came from instead.
  const takeShared = ({ c, by }) => {
    const clash = collections.some((x) => x.name.toLowerCase() === c.name.toLowerCase());
    const named = clash ? { ...c, name: `${c.name} (from ${by || 'a friend'})`.slice(0, 120) } : c;
    putCollection(named);
    setIncoming(null);
    openCollectionById(named.id);
  };

  const persistTrips = async (next) => {
    trackChanges('trips', trips, next);
    setTrips(next);
    if (holdBack(TRIPS_KEY)) return false;
    try {
      await window.storage.set(TRIPS_KEY, JSON.stringify(next));
      setError('');
      return true;
    } catch {
      setError('That trip is showing here but did not save. Try again.');
      return false;
    }
  };

  const openTripById = useCallback((id) => {
    setTripOpen(id);
    setTripDraft(null);
    window.scrollTo(0, 0);
  }, []);

  // removedPhotos: photos taken off the trip in the form, deleted only now
  // that the change has been kept.
  const saveTrip = async (t, removedPhotos = []) => {
    const exists = trips.some((x) => x.id === t.id);
    const ok = await persistTrips(exists ? trips.map((x) => (x.id === t.id ? t : x)) : [...trips, t]);
    openTripById(t.id);
    if (ok && removedPhotos.length) photoStore.deleteMany(removedPhotos).catch(() => {});
  };

  // The trip goes first. Its photos are only deleted once that has saved,
  // so a failed save never leaves a trip pointing at photos that are gone.
  const removeTrip = async (t) => {
    const ok = await persistTrips(trips.filter((x) => x.id !== t.id));
    setTripOpen(null);
    if (!ok) return;
    try {
      await photoStore.deleteMany(t.photoIds);
      await photoStore.deleteForTrip(t.id);
    } catch {
      /* anything left behind is tidied away on a later visit */
    }
  };

  // A trip someone shared: always a new trip here, with new ids for it and
  // its photos, so taking the same one twice never overwrites anything.
  const takeSharedTrip = async ({ trip, by, photos = [] }) => {
    const id = uid();
    const kept = [];
    let problem = '';
    for (const ph of photos.slice(0, PHOTO_CAP)) {
      const pid = `${uid()}${uid()}`;
      try {
        await photoStore.save({ id: pid, tripId: id, blob: ph.blob, thumb: ph.thumb, width: ph.width, height: ph.height });
        kept.push(pid);
      } catch (e) {
        problem = e instanceof photoStore.PhotoError ? e.message : 'Some of its photos could not be kept.';
        break;
      }
    }
    const now = new Date().toISOString();
    const clash = trips.some((x) => x.startDate === trip.startDate && x.title.toLowerCase() === trip.title.toLowerCase());
    const t = {
      ...trip, id, createdAt: now, updatedAt: now, companions: [], photoIds: kept,
      title: clash ? `${trip.title} (from ${by || 'a friend'})`.slice(0, TRIP_TITLE_CAP) : trip.title,
    };
    await persistTrips([...trips, t]);
    setIncomingTrip(null);
    setView('trips');
    openTripById(id);
    if (problem) setError(`${problem} The trip itself was added.`);
  };

  const convertEvents = async (list) => {
    const made = list.map(eventToTrip).filter(Boolean);
    await persistTrips([...trips, ...made]);
    dismissTripOffer();
  };

  const dismissTripOffer = () => {
    setTripOfferDone(true);
    window.storage.set(TRIPS_OFFER_KEY, todayStr()).catch(() => { /* asked again next visit */ });
  };

  const dismissTripNotice = () => {
    setTripNoticeSeen(true);
    window.storage.set(TRIPS_NOTICE_KEY, todayStr()).catch(() => { /* shown again next visit */ });
  };

  const backedUp = () => {
    track('data.backup', {});
    const today = todayStr();
    setLastBackup(today);
    dismissTripNotice();
    window.storage.set(BACKUP_AT_KEY, today).catch(() => { /* not fatal */ });
  };

  // A backup file is merged in rather than replacing anything: records are
  // matched by id (see mergeById), and photos are added only when missing.
  // Photos go in before the trips that point at them.
  const restoreFile = async (file) => {
    track('data.restore', {});
    const { parts, photos } = await readBackupFile(file);
    const P = mergeById(people, parts.people);
    const E = mergeById(events, parts.events);
    const R = mergeById(reminders, parts.reminders);
    const L = mergeById(collections, parts.collections, (c) => c.updatedAt || '');
    const T = mergeById(trips, parts.trips, (t) => t.updatedAt || '');
    const ownerOf = new Map();
    T.list.forEach((t) => t.photoIds.forEach((pid) => ownerOf.set(pid, t.id)));
    let put = 0;
    let photoProblem = '';
    for (const ph of photos) {
      if (!ownerOf.has(ph.id)) continue;
      try {
        if (await photoStore.has(ph.id)) continue;
        await photoStore.save({ ...ph, tripId: ownerOf.get(ph.id) });
        put += 1;
      } catch (e) {
        photoProblem = e instanceof photoStore.PhotoError ? e.message : 'Some photos could not be stored.';
        break;
      }
    }
    const changed = (m) => m.added + m.updated > 0;
    const writes = [];
    if (changed(P)) writes.push(persist(P.list));
    if (changed(E)) writes.push(persistEvents(E.list));
    if (changed(R)) writes.push(persistReminders(R.list));
    if (changed(L)) writes.push(persistCollections(L.list));
    if (changed(T)) writes.push(persistTrips(T.list));
    const saved = await Promise.all(writes);
    const said = [
      [T, 'trip', 'trips'], [P, 'person', 'people'], [E, 'event', 'events'],
      [R, 'reminder', 'reminders'], [L, 'list', 'lists'],
    ].filter(([m]) => changed(m)).map(([m, one, many]) => `${m.added + m.updated} ${m.added + m.updated === 1 ? one : many}`
      + (m.updated ? ` (${m.updated} updated)` : ''));
    if (put) said.push(`${put} photo${put === 1 ? '' : 's'}`);
    if (!saved.every(Boolean)) throw new Error('Part of that backup is showing here but did not save. Try again.');
    const head = said.length ? `Restored ${said.join(', ')}.` : 'Everything in that backup is already here.';
    return photoProblem ? `${head} ${photoProblem}` : head;
  };

  const restore = async () => {
    let parts;
    // A pasted backup from before trips existed leaves trips alone. It has no
    // photos either way, so replacing trips with nothing would lose them.
    let hasTrips;
    try {
      const parsed = JSON.parse(paste);
      // Older backups were a bare array of people.
      if (!Array.isArray(Array.isArray(parsed) ? parsed : parsed.people)) throw new Error('not a backup');
      // The same records are kept as ever; each is then repaired, so one
      // field of the wrong shape cannot take the app down.
      parts = backupParts(parsed);
      hasTrips = !Array.isArray(parsed) && Array.isArray(parsed.trips);
      // Someone can keep lists and nobody on them, so an empty people list is
      // only a bad backup when there is nothing else in it either.
      if (Object.values(parts).every((x) => x.length === 0)) throw new Error('nothing in it');
    } catch {
      setError('That backup could not be read. Paste the whole thing, exactly as it was copied.');
      return;
    }
    // Writing is kept out of the block above so a storage failure is never
    // reported as an unreadable backup. Each write clears the error on its
    // own success, so the verdict has to be settled once they are all in --
    // otherwise a list that saved would wipe the warning about one that did
    // not, and the restore would look complete when it was partial.
    const saved = await Promise.all([
      persist(parts.people), persistEvents(parts.events), persistReminders(parts.reminders),
      persistCollections(parts.collections), ...(hasTrips ? [persistTrips(parts.trips)] : []),
    ]);
    setBackup('');
    setPaste('');
    setError(saved.every(Boolean)
      ? ''
      : 'Your lists are showing here but part of that backup did not save. Try again.');
  };

  const remove = (id) => {
    persist(people.filter((p) => p.id !== id));
    setOpenId(null);
    setEditing(null);
  };

  const ofCircle = (circle) =>
    circle === 'all' ? people
      : circle === 'vip' ? people.filter((p) => p.vip)
      : people.filter((p) => (p.circle || 'friend') === circle);

  const inCircle = useMemo(() => ofCircle(circleTab), [people, circleTab]);
  // Passed to the memoised rows so they still move on at midnight.
  const today = todayStr();
  // How many have gone quiet in each circle, for the chips: one pass over
  // everyone, rather than one per chip, and only when the chips are drawn.
  let overdueByCircle = null;
  const overdueCount = (circle) => {
    if (!overdueByCircle) {
      overdueByCircle = { all: 0, vip: 0, friend: 0, work: 0 };
      people.forEach((p) => {
        if (!status(p).over) return;
        overdueByCircle.all += 1;
        if (p.vip) overdueByCircle.vip += 1;
        const c = p.circle || 'friend';
        if (c === 'friend' || c === 'work') overdueByCircle[c] += 1;
      });
    }
    return overdueByCircle[circle];
  };
  const totalCount = (circle) => ofCircle(circle).length;

  const pickTheme = async (name) => {
    track('settings.theme', { theme: name });
    applyTheme(name);
    setTheme(name);
    try { await window.storage.set(THEME_KEY, name); } catch { /* not fatal */ }
  };

  const pickStart = async (v) => {
    track('settings.start', { view: v });
    setStartView(v);
    try { await window.storage.set(START_KEY, v); } catch { /* not fatal */ }
  };

  const saveOwner = async (v) => {
    const name = v.trim();
    setOwner(name);
    setNamingOwner(false);
    try { await window.storage.set(OWNER_KEY, name); } catch { /* not fatal */ }
  };

  const sorted = useMemo(() => byRank(inCircle), [inCircle]);
  const quiet = useMemo(() => sorted.filter((p) => status(p).over), [sorted]);

  const soonest = useMemo(() => {
    const upcoming = inCircle
      .filter((p) => {
        const st = status(p);
        return !st.over && !st.always && !st.paused && !st.child;
      })
      .map((p) => ({ p, left: p.cadence - daysSince(p.lastContact) }))
      .sort((a, b) => a.left - b.left);
    return upcoming[0] || null;
  }, [inCircle]);


  const query = q.trim().toLowerCase();
  const searching = query.length > 0;

  const matches = (p) =>
    `${p.name} ${p.role} ${p.company || ''} ${p.note} ${p.hobbies || ''} ${(p.aka || []).join(' ')} ${(p.kids || []).join(' ')} ${p.email || ''} ${(p.families || []).join(' ')} ${(p.groups || []).join(' ')} ${p.relation || ''} ${p.partner?.name || ''} ${p.phone || ''} ${p.address || ''} ${tierLabel(p.tier)} ${Object.values(p.socials || {}).join(' ')}`
      .toLowerCase()
      .includes(query);

  const everyone = useMemo(() => byRank(people), [people]);

  const families = useMemo(
    () => [...new Set(people.flatMap((p) => p.families || []))].sort(),
    [people]
  );
  const years = useMemo(() => {
    const found = new Set([thisYear]);
    trips.forEach((t) => { if (!t.status) tripYears(t).forEach((y) => { if (y <= thisYear) found.add(y); }); });
    people.forEach((p) => {
      if (p.addedOn) found.add(Number(p.addedOn.slice(0, 4)));
      (p.log || []).forEach((e) => e.date && found.add(Number(e.date.slice(0, 4))));
    });
    reminders.forEach((r) => (r.history || []).forEach((h) =>
      h?.date && found.add(Number(h.date.slice(0, 4)))));
    collections.forEach((c) => c.items.forEach((it) =>
      it.doneOn && stageOf(c, it) === 'done' && found.add(Number(it.doneOn.slice(0, 4)))));
    return [...found].sort((a, b) => b - a);
  }, [people, reminders, collections, trips, thisYear]);

  const companies = useMemo(
    () => [...new Set(people.map((p) => p.company).filter(Boolean))].sort(),
    [people]
  );
  const allGroups = useMemo(
    () => [...new Set(people.flatMap((p) => p.groups || []))].sort(),
    [people]
  );
  const filtering = Boolean(tagFilter);

  const selectedPerson = people.find((x) => x.id === (editing || openId)) || null;
  const panelOpen = Boolean(adding || editing || openId);

  const openCollection = collections.find((x) => x.id === collectionOpen) || null;
  const selectedId = selectedPerson?.id;
  const myRecs = useMemo(() => (selectedId
    ? collections.flatMap((c) => c.items.filter((it) => it.from === selectedId).map((it) => ({ c, it })))
    : []), [collections, selectedId]);

  // A link that arrived while something else was on screen waits here until
  // asked for, rather than pulling the page out from under an open form.
  const sharedWaiting = Boolean(incoming)
    && !(view === 'collections' && !collectionDraft && !openCollection);

  const openTrip = trips.find((x) => x.id === tripOpen) || null;
  const tripWaiting = Boolean(incomingTrip) && !(view === 'trips' && !tripDraft && !openTrip);
  // Pinned events not yet made into trips, for the one-time offer.
  const pinnedEvents = useMemo(() => {
    if (tripOfferDone) return [];
    const done = new Set(trips.map((t) => t.fromEvent).filter(Boolean));
    return events.filter((e) => typeof e.lat === 'number' && typeof e.lon === 'number' && !done.has(e.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [tripOfferDone, trips, events]);
  const selectedTripsId = selectedPerson?.id;
  const myTrips = useMemo(() => (selectedTripsId
    ? sortTrips(trips.filter((t) => t.companions.includes(selectedTripsId)))
    : []), [trips, selectedTripsId]);


  const list = filtering
    ? everyone.filter((p) =>
        tagFilter.kind === 'family'
          ? (p.families || []).includes(tagFilter.value)
          : tagFilter.kind === 'company'
          ? p.company === tagFilter.value
          : (p.groups || []).includes(tagFilter.value)
      )
    : searching
    ? everyone.filter(matches)
    : tab === 'quiet'
    ? quiet
    : sorted;

  const showList = !loading && people.length > 0 && (searching || filtering || inCircle.length > 0);

  /* headline */
  let head = 'Opening your list';
  let sub = '';
  if (!loading) {
    if (filtering) {
      head = tagFilter.value;
      sub = `${countPhrase(list.length)} tagged, across both lists.`;
    } else if (searching) {
      head = `${countPhrase(list.length)} ${list.length === 1 || list.length === 0 ? 'matches' : 'match'}`;
      sub = 'Looking through both lists.';
    } else if (inCircle.length === 0) {
      head = circleTab === 'vip' ? 'No VIPs yet'
        : circleTab === 'work' ? 'No contacts here yet'
        : 'No one here yet';
      sub = circleTab === 'vip'
        ? 'Tap the star beside anyone to keep them at the top of every list.'
        : circleTab === 'work'
        ? 'Add the contacts worth staying in front of.'
        : 'Add the handful of people you actually want to keep up with.';
    } else if (quiet.length === 0) {
      head = "Everyone's current";
      sub = soonest ? `${soonest.p.name} comes up again ${countdown(Math.max(0, soonest.left))}.` : '';
    } else {
      head = `${countPhrase(quiet.length)} ${quiet.length === 1 ? 'has' : 'have'} gone quiet`;
      sub = tab === 'all'
        ? 'Closest first, then whoever has waited longest.'
        : 'Sorted by who has waited longest.';
    }
  }

  return (
    <div style={{ background: C.ground, backgroundImage: C.sky, minHeight: '100%', color: C.ink, fontFamily: "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif" }}>
      <AppStyles />

      <div className="crm-shell">
        <div className="crm-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <OrbitMark />
          {namingOwner ? (
            <input
              autoFocus
              defaultValue={owner}
              placeholder="Your name"
              onBlur={(e) => saveOwner(e.target.value)}
              onKeyDown={(e) => { if (isEnter(e)) saveOwner(e.target.value); }}
              style={{ ...inputStyle, width: 170, minHeight: 32, padding: '5px 9px', fontSize: 14 }}
            />
          ) : (
            <button
              className="crm-btn"
              onClick={() => setNamingOwner(true)}
              title="Set your name"
              style={{
                font: 'inherit', fontSize: 14, fontWeight: 600, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: C.ink, background: 'transparent',
                border: 'none', padding: 0, cursor: 'pointer',
              }}
            >
              {owner ? `${owner}${/s$/i.test(owner) ? "'" : "'s"} Orbit` : 'Orbit'}
            </button>
          )}
          {!loading && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {[['list', 'People'], ...(catalogOn ? [['feed', 'Feed']] : []), ['events', 'Events'], ['reminders', 'Reminders'],
                ['collections', 'Lists'], ['trips', 'Trips'], ['recap', 'Recap']].map(([v, l]) => {
                const on = view === v;
                const fresh = v === 'feed' && feedFresh && !on;
                return (
                  <button
                    key={v}
                    className="crm-btn"
                    onClick={() => {
                      setView(v); setEventDraft(null); setReminderDraft(null);
                      setCollectionDraft(null); setCollectionOpen(null);
                      setTripDraft(null); setTripOpen(null);
                    }}
                    style={{
                      font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                      color: on ? C.onAccent : C.muted,
                      background: on ? C.accent : 'transparent',
                      border: `1px solid ${on ? C.accent : C.line}`,
                      padding: '5px 11px', borderRadius: 20, position: 'relative',
                    }}
                    aria-label={fresh ? `${l}, new from friends` : undefined}
                  >{l}{fresh && (
                    <span aria-hidden="true" style={{
                      position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 8, background: C.overdueBar,
                    }} />
                  )}</button>
                );
              })}

              <div style={{ position: 'relative' }}>
                <button
                  className="crm-btn"
                  aria-label={friendCount ? `More, ${friendCount} friend ${friendCount === 1 ? 'request' : 'requests'}` : 'More'}
                  aria-expanded={menuOpen}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  style={{
                    font: 'inherit', cursor: 'pointer', color: C.muted,
                    background: menuOpen ? C.accentSoft : 'transparent',
                    border: `1px solid ${menuOpen ? C.accent : C.line}`,
                    padding: '5px 9px', borderRadius: 20, lineHeight: 1,
                  }}
                >
                  <svg width="4" height="15" viewBox="0 0 4 15" aria-hidden="true">
                    <circle cx="2" cy="2.5" r="1.6" fill="currentColor" />
                    <circle cx="2" cy="7.5" r="1.6" fill="currentColor" />
                    <circle cx="2" cy="12.5" r="1.6" fill="currentColor" />
                  </svg>
                  {friendCount > 0 && (
                    <span aria-hidden="true" style={{
                      position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 9,
                      background: C.overdueBar, border: `2px solid ${C.ground}`,
                    }} />
                  )}
                </button>

                {menuOpen && (
                  <div
                    className="crm-open"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
                      minWidth: 148, background: C.surface, border: `1px solid ${C.line}`,
                      borderRadius: 10, overflow: 'hidden',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    }}
                  >
                    {[...(friendsOn ? [['friends', friendCount ? `Friends (${friendCount})` : 'Friends']] : []), ['settings', 'Settings'], ['import', 'Import'], ['export', 'Export'], ['backup', 'Backup file'], ...(usageAdmin ? [['usage', 'Usage']] : [])].map(([v, l], i) => (
                      <button
                        key={v}
                        className="crm-btn"
                        onClick={() => {
                          setView(v); setMenuOpen(false); setEventDraft(null); setReminderDraft(null);
                          setCollectionDraft(null); setTripDraft(null);
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                          fontSize: 13.5, fontWeight: 600, color: C.ink, cursor: 'pointer',
                          padding: '10px 13px', background: 'transparent', border: 'none',
                          borderTop: i ? `1px solid ${C.line}` : 'none',
                        }}
                      >{l}</button>
                    ))}
                    {account && (
                      <div style={{ borderTop: `1px solid ${C.line}` }}>
                        <p style={{
                          margin: 0, padding: '9px 13px 0', fontSize: 12, color: C.muted,
                          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={account.email}>{account.profile ? `@${account.profile.username}` : account.email || 'Signed in'}</p>
                        {account.profile && (
                          <a href={profilePath(account.profile.username)} onClick={() => setMenuOpen(false)} style={{
                            display: 'block', padding: '4px 13px 0', fontSize: 13.5, fontWeight: 600, color: C.ink, textDecoration: 'none',
                          }}>Your page</a>
                        )}
                        <button
                          className="crm-btn"
                          onClick={() => { setMenuOpen(false); account.signOut(); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                            fontSize: 13.5, fontWeight: 600, color: C.ink, cursor: 'pointer',
                            padding: '4px 13px 10px', background: 'transparent', border: 'none',
                          }}
                        >Sign out</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {view === 'list' && !loading && (
          <Switcher
            value={circleTab}
            quietIn={overdueCount}
            onChange={(v) => { setCircleTab(v); setOpenId(null); setEditing(null); setQ(''); setTagFilter(null); }}
          />
        )}

        {view === 'list' && (<>
        <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.035em', maxWidth: '13ch' }}>
          {head}
        </h1>
        {sub && <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{sub}</p>}

        {view === 'list' && !loading && !searching && !filtering && (
          <Upcoming
            people={inCircle}
            events={events}
            reminders={reminders}
            quiet={tab === 'all' ? quiet.length : 0}
            onShowQuiet={() => { setTab('quiet'); setOpenId(null); }}
            onPerson={(id) => { setOpenId(id); setEditing(null); setAdding(false); }}
            onReminder={() => { setView('reminders'); setReminderDraft(null); }}
          />
        )}

        </>)}

        {error && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: C.overdue }}>{error}</p>
        )}
        {setAsideText && (() => {
          const names = { [STORE_KEY]: 'people', [EVENTS_KEY]: 'events', [REMINDERS_KEY]: 'reminders', [COLLECTIONS_KEY]: 'lists', [TRIPS_KEY]: 'trips' };
          const which = Object.keys(setAsideText).map((k) => names[k]).join(', ');
          const held = Object.keys(setAsideText).filter((k) => heldBack.current.has(k)).map((k) => names[k]).join(', ');
          return (
            <div role="status" style={{
              margin: '12px 0 0', padding: '12px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
              color: C.ink, background: C.overdueSoft, border: `1px solid ${C.overdueBar}`,
            }}>
              <p style={{ margin: '0 0 8px' }}>
                {`Some saved ${which} could not be read exactly as saved. What could be read is showing, `
                  + 'and the original has been set aside, not deleted.'}
                {held ? ` There was no room to keep that copy, so to keep the original safe, changes to your ${held} are not being saved. Download it to keep a copy.` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button style={small} onClick={() => downloadCsv('orbit-set-aside.json', JSON.stringify(setAsideText, null, 2), 'application/json')}>
                  Download the original
                </Button>
                <Button style={small} onClick={() => setSetAsideText(null)}>OK</Button>
              </div>
            </div>
          );
        })()}
        {received && view !== 'receive' && (
          <p role="status" style={{ margin: '12px 0 0', fontSize: 13, color: C.ink, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {received.broken
              ? 'Something shared with you arrived but could not be read.'
              : `${received.by || 'Someone'} shared ${received.people.length === 1 ? `a contact with you: ${received.people[0].name}` : `${received.people.length} contacts with you`}.`}
            <button className="crm-btn" onClick={() => setView('receive')}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 600, color: C.ink, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              See it
            </button>
          </p>
        )}
        {sharedWaiting && (
          <p role="status" style={{ margin: '12px 0 0', fontSize: 13, color: C.ink, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {incoming.broken
              ? 'A shared list arrived but could not be read.'
              : `${incoming.by || 'Someone'} shared a list with you: ${incoming.c.name}.`}
            <button className="crm-btn" onClick={() => { setView('collections'); setCollectionOpen(null); setCollectionDraft(null); }}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 600, color: C.ink, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              See it
            </button>
          </p>
        )}
        {tripWaiting && (
          <p role="status" style={{ margin: '12px 0 0', fontSize: 13, color: C.ink, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {incomingTrip.broken
              ? 'A shared trip arrived but could not be read.'
              : `${incomingTrip.by || 'Someone'} shared a trip with you: ${incomingTrip.trip.title}.`}
            <button className="crm-btn" onClick={() => { setView('trips'); setTripOpen(null); setTripDraft(null); }}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 600, color: C.ink, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              See it
            </button>
          </p>
        )}
        </div>

        {view === 'events' && (
          <div className="crm-full">
            {eventDraft ? (
              <EventForm
                initial={eventDraft.id ? eventDraft : null}
                people={people}
                catalog={catalogOn ? account.catalog : null}
                onSave={saveEvent}
                onCancel={() => setEventDraft(null)}
              />
            ) : (
              <EventsView
                events={events}
                people={people}
                onAdd={() => setEventDraft({})}
                onEdit={(e) => setEventDraft(e)}
                onRemove={(id) => persistEvents(events.filter((x) => x.id !== id))}
                onCatalog={catalogOn ? (id) => { setExplore([id]); setView('explore'); } : null}
                onExplore={catalogOn ? () => { setExplore([]); setView('explore'); } : null}
              />
            )}
          </div>
        )}

        {view === 'usage' && usageAdmin && (
          <div className="crm-full">
            <UsageView api={account.usage} />
          </div>
        )}

        {view === 'feed' && catalogOn && (
          <div className="crm-full">
            <FeedView api={account.catalog} onSeen={sawFeed}
              onCatalog={(id) => { setExplore([id]); setView('explore'); }}
              onFriends={friendsOn ? () => setView('friends') : null} />
          </div>
        )}

        {view === 'explore' && catalogOn && (
          <div className="crm-full">
            <ExploreView api={account.catalog} trail={explore}
              onOpen={(id) => setExplore([...explore, id])}
              onBack={() => (explore.length ? setExplore(explore.slice(0, -1)) : setView('events'))} />
          </div>
        )}

        {view === 'reminders' && (
          <div className="crm-full">
            {reminderDraft ? (
              <ReminderForm
                initial={reminderDraft.r}
                fresh={reminderDraft.fresh}
                people={people}
                onSave={saveReminder}
                onCancel={() => setReminderDraft(null)}
              />
            ) : (
              <RemindersView
                reminders={reminders}
                people={people}
                onAdd={() => setReminderDraft({ r: null, fresh: true })}
                onEdit={(r) => setReminderDraft({ r, fresh: false })}
                onStarter={(st) => setReminderDraft({ r: fromStarter(st), fresh: true })}
                onSave={putReminder}
                onRemove={(id) => persistReminders(reminders.filter((x) => x.id !== id))}
                onPerson={(id) => {
                  setView('list'); setCircleTab('all'); setOpenId(id);
                  setEditing(null); setAdding(false); setQ(''); setTagFilter(null);
                }}
              />
            )}
          </div>
        )}

        {view === 'collections' && (
          // Keyed on the theme: rows and cards here are memoised, and the
          // theme lives in C rather than in their props, so a theme change
          // must start them afresh or they would keep the old colours.
          <div className="crm-full" key={theme}>
            {loading ? (
              <p style={{ fontSize: 14, color: C.muted }}>One moment.</p>
            ) : collectionDraft ? (
              <CollectionForm
                initial={collectionDraft.c}
                kind={collectionDraft.kind}
                mine={collections}
                onSave={saveCollection}
                onCancel={() => setCollectionDraft(null)}
              />
            ) : openCollection ? (
              <CollectionDetail
                key={openCollection.id}
                c={openCollection}
                people={people}
                owner={owner}
                onSave={putCollection}
                onEdit={() => setCollectionDraft({ c: openCollection })}
                onRemove={() => {
                  persistCollections(collections.filter((x) => x.id !== openCollection.id));
                  setCollectionOpen(null);
                }}
                onBack={() => setCollectionOpen(null)}
                onTrip={({ title, detail, done }) => {
                  // A place already been to becomes a trip you took; one
                  // still wanted becomes a someday trip. Its place is searched for.
                  setTripDraft({ trip: null, seed: { title, status: done ? 'been' : 'someday', query: [title, detail].filter(Boolean).join(', ') } });
                  setTripOpen(null);
                  setView('trips');
                  window.scrollTo(0, 0);
                }}
              />
            ) : (
              <CollectionsView
                collections={collections}
                look={listsLook}
                incoming={incoming}
                onOpen={openCollectionById}
                onNew={(kind) => setCollectionDraft({ c: null, kind })}
                onTakeShared={takeShared}
                onDropShared={() => setIncoming(null)}
              />
            )}
          </div>
        )}

        {view === 'friends' && (
          <div className="crm-full">
            {friendsOn ? (
              <FriendsView
                account={account}
                startWith={addTarget}
                onStarted={clearAddTarget}
                onSaveToPeople={saveFriendToPeople}
                onCount={setFriendCount}
                onClose={() => setView('list')}
              />
            ) : (
              <p style={{ fontSize: 14, color: C.muted }}>Friends need an account with a username.</p>
            )}
          </div>
        )}

        {view === 'settings' && (
          <div className="crm-full">
            <SettingsView account={account} theme={theme} onTheme={pickTheme} start={startView} onStart={pickStart}
              onBackup={() => setView('backup')} onClose={() => setView('list')} />
          </div>
        )}

        {view === 'receive' && received && !loading && (
          <div className="crm-full">
            <ReceiveView
              key={received.on + (received.by || '') + (received.people?.length || 0)}
              share={received}
              people={people}
              onSave={saveReceived}
              onClose={() => { setReceived(null); setView('list'); }}
            />
          </div>
        )}

        {view === 'import' && (
          <div className="crm-full">
            <ImportView
              people={people}
              events={events}
              reminders={reminders}
              collections={collections}
              onPeople={persist}
              onEvents={persistEvents}
              onReminders={persistReminders}
              onCollections={persistCollections}
              onShared={openShare}
              onClose={() => setView('list')}
            />
          </div>
        )}

        {view === 'export' && (
          <div className="crm-full">
            <ExportView people={people} events={events} reminders={reminders} collections={collections}
              onClose={() => setView('list')} />
          </div>
        )}

        {view === 'trips' && (
          <div className="crm-full">
            {loading ? (
              <p style={{ fontSize: 14, color: C.muted }}>One moment.</p>
            ) : tripDraft ? (
              <TripForm
                initial={tripDraft.trip}
                seed={tripDraft.seed}
                people={people}
                onSave={saveTrip}
                onCancel={() => setTripDraft(null)}
              />
            ) : openTrip ? (
              <TripDetail
                key={openTrip.id}
                trip={openTrip}
                people={people}
                owner={owner}
                onEdit={() => { setTripDraft({ trip: openTrip }); window.scrollTo(0, 0); }}
                onRemove={() => removeTrip(openTrip)}
                onWent={() => {
                  const went = cleanTrip({ ...openTrip, status: 'been', updatedAt: new Date().toISOString() });
                  if (went) saveTrip(went);
                }}
                onBack={() => setTripOpen(null)}
                onPerson={(id) => {
                  setView('list'); setCircleTab('all'); setOpenId(id);
                  setEditing(null); setAdding(false); setQ(''); setTagFilter(null);
                }}
              />
            ) : (
              <TripsView
                trips={trips}
                people={people}
                look={tripsLook}
                incoming={incomingTrip}
                offer={pinnedEvents}
                notice={!tripNoticeSeen}
                statsHidden={tripStatsHidden}
                onStatsHidden={(hide) => {
                  setTripStatsHidden(hide);
                  window.storage.set(TRIP_STATS_KEY, hide ? 'hidden' : 'shown').catch(() => { /* asked again next visit */ });
                }}
                onOpen={openTripById}
                onNew={() => { setTripDraft({ trip: null }); window.scrollTo(0, 0); }}
                onTakeShared={takeSharedTrip}
                onOpenShared={openShare}
                signedIn={Boolean(account)}
                onDropShared={() => setIncomingTrip(null)}
                onConvert={convertEvents}
                onDismissOffer={dismissTripOffer}
                onDismissNotice={dismissTripNotice}
                onBackup={() => setView('backup')}
              />
            )}
          </div>
        )}

        {view === 'backup' && (
          <div className="crm-full">
            <BackupView
              people={people}
              events={events}
              reminders={reminders}
              collections={collections}
              trips={trips}
              lastBackup={lastBackup}
              signedIn={Boolean(account)}
              onDownloaded={backedUp}
              onRestore={restoreFile}
              onClose={() => setView('list')}
            />
          </div>
        )}

        {view === 'recap' && (
          <div className="crm-full">
            <Recap people={people} year={year} years={years} onYear={setYear}
              trips={trips}
              onTrip={(id) => { setView('trips'); openTripById(id); }}
              events={events}
              onEvent={(e) => { setView('events'); setEventDraft(e); }}
              owner={owner}
              pageFor={account?.profile ? (y) => pageUrl(profilePath(account.profile.username, y)) : null}
              eventCount={events.filter((e) => Number(e.date.slice(0, 4)) === year).length}
              reminderCount={reminders.reduce((n, r) => n + (r.history || [])
                .filter((h) => h?.date && Number(h.date.slice(0, 4)) === year).length, 0)}
              listCount={collections.reduce((n, c) => n + c.items
                .filter((it) => it.doneOn && stageOf(c, it) === 'done' && Number(it.doneOn.slice(0, 4)) === year)
                .length, 0)} />
          </div>
        )}

        {view === 'list' && (<div className={`crm-main${panelOpen ? ' is-hidden' : ''}`}>
        {!loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '20px 0 14px' }}>
            {!searching && !filtering && inCircle.length > 0 && (
              <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2 }}>
                {[['all', `All (${inCircle.length})`], ['quiet', `Quiet ${quiet.length ? `(${quiet.length})` : ''}`]].map(([v, l]) => (
                  <button
                    key={v}
                    className="crm-btn"
                    onClick={() => setTab(v)}
                    style={{
                      font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 11px', borderRadius: 6,
                      border: 'none', cursor: 'pointer',
                      background: tab === v ? C.accent : 'transparent',
                      color: tab === v ? C.onAccent : C.muted,
                    }}
                  >
                    {l.trim()}
                  </button>
                ))}
              </div>
            )}
            <Button
              kind="solid"
              onClick={() => { setAdding(true); setEditing(null); }}
              style={inCircle.length === 0 && !searching && !filtering ? { flex: 1 } : { marginLeft: 'auto' }}
            >
              Add someone
            </Button>
          </div>
        )}

        {!loading && people.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              style={inputStyle}
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpenId(null); setTagFilter(null); }}
              placeholder="Search everyone by name, note, or handle"
            />
            {(searching || filtering) && (
              <Button onClick={() => { setQ(''); setTagFilter(null); }}>Clear</Button>
            )}
          </div>
        )}

        {loading && <p style={{ fontSize: 14, color: C.muted }}>One moment.</p>}

        {showList && list.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'flex-end', padding: '0 0 7px',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: C.faint, lineHeight: 1.15,
          }}>
            <span style={{ width: 4, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10, padding: '0 15px' }}>
              <span style={{ flex: 1, minWidth: 0 }}>Name</span>
              <span style={{ flexShrink: 0, maxWidth: 116, textAlign: 'right' }}>Reach out</span>
            </span>
            <span style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>VIP</span>
            <span style={{ width: 48, flexShrink: 0, textAlign: 'center' }}>Caught up</span>
          </div>
        )}

        {showList && (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: C.surface }}>
            {list.length === 0 && (
              <p style={{ padding: '18px 16px', margin: 0, fontSize: 14, color: C.muted }}>
                {q.trim() ? 'No match for that.' : 'Nobody is overdue right now.'}
              </p>
            )}
            {list.map((p) => (
              <PersonRow
                key={p.id}
                p={p}
                selected={openId === p.id}
                showCircle={circleTab === 'all' || circleTab === 'vip' || searching || filtering}
                onOpen={openRow}
                onQuickLog={quickLogRow}
                onStar={starRow}
                today={today}
                theme={theme}
              />
            ))}
          </div>
        )}

        {!loading && people.length + events.length + reminders.length + collections.length + trips.length > 0 && (
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
            <p style={{ fontSize: 12, color: C.faint, margin: '0 0 10px', lineHeight: 1.5 }}>
              Saved locally, in this browser on this device. Only you can see it. It will not
              follow you to another browser or computer — back up before you switch.
            </p>

            <p style={{ fontSize: 12, color: C.faint, margin: '0 0 7px' }}>Theme</p>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
              {[['daylight', 'Daylight'], ['orbit', 'Orbit']].map(([v, l]) => (
                <button
                  key={v}
                  className="crm-btn"
                  onClick={() => pickTheme(v)}
                  style={{
                    font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 13px',
                    borderRadius: 7, cursor: 'pointer',
                    background: theme === v ? C.accent : 'transparent',
                    border: `1px solid ${theme === v ? C.accent : C.line}`,
                    color: theme === v ? C.onAccent : C.muted,
                  }}
                >{l}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => { setBackup(backup === 'out' ? '' : 'out'); setPaste(''); }}>
                {backup === 'out' ? 'Hide backup' : 'Back up'}
              </Button>
              <Button onClick={() => { setBackup(backup === 'in' ? '' : 'in'); setPaste(''); }}>
                {backup === 'in' ? 'Cancel restore' : 'Restore'}
              </Button>
              <Button onClick={() => setView('backup')}>Backup file, with photos</Button>
            </div>
            <p style={{ ...hintStyle(), marginTop: 8 }}>
              {lastBackup ? `Last backup file made ${prettyDate(lastBackup)}. ` : ''}
              Back up and Restore copy text without photos. The backup file keeps everything.
            </p>

            {backup === 'out' && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px' }}>
                  Select all and copy. Paste it somewhere safe.
                </p>
                <textarea
                  readOnly
                  onFocus={(e) => e.target.select()}
                  value={JSON.stringify({ people, events, reminders, collections, trips })}
                  style={{ ...inputStyle, minHeight: 92, fontSize: 12, lineHeight: 1.4, resize: 'vertical' }}
                />
              </div>
            )}

            {backup === 'in' && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px' }}>
                  Paste a backup. This replaces everything saved here now: people, events,
                  reminders, lists and trips. Photos are not in a pasted backup; the ones already
                  here stay with their trips.
                </p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Paste here"
                  style={{ ...inputStyle, minHeight: 92, fontSize: 12, lineHeight: 1.4, resize: 'vertical' }}
                />
                <Button kind="solid" onClick={restore} style={{ marginTop: 8 }}>Replace my lists</Button>
              </div>
            )}
          </div>
        )}
        </div>)}

        {view === 'list' && (<div className={`crm-detail${panelOpen ? ' is-open' : ''}`}>
          {adding && (
            <PersonForm
              defaultCircle={circleTab === 'all' || circleTab === 'vip' ? 'friend' : circleTab}
              families={families}
              allGroups={allGroups}
              companies={companies}
              onSave={upsert}
              onCancel={() => setAdding(false)}
            />
          )}

          {editing && selectedPerson && (
            <PersonForm
              initial={selectedPerson}
              families={families}
              allGroups={allGroups}
              companies={companies}
              onSave={upsert}
              onCancel={() => setEditing(null)}
            />
          )}

          {!adding && !editing && selectedPerson && (
            // Keyed on the person, so a half-finished action (an armed
            // Remove, an open catch-up edit) never carries over to whoever
            // is opened next.
            <PersonDetail
              key={selectedPerson.id}
              p={selectedPerson}
              myEvents={events
                .filter((e) => (e.people || []).includes(selectedPerson.id))
                .sort((a, b) => (a.date < b.date ? 1 : -1))}
              myReminders={reminders
                .filter((r) => (r.people || []).includes(selectedPerson.id))
                .sort(byDue)}
              myRecs={myRecs}
              myTrips={myTrips}
              onTrip={(id) => { setView('trips'); openTripById(id); }}
              onList={(id) => { setView('collections'); openCollectionById(id); }}
              onLog={logTouch}
              onEditLog={editLog}
              onRemoveLog={removeLog}
              onEdit={() => setEditing(selectedPerson.id)}
              onRemove={() => remove(selectedPerson.id)}
              onTag={(kind, value) => { setTagFilter({ kind, value }); setQ(''); setOpenId(null); }}
              owner={owner || account?.profile?.display_name || ''}
              onClearVia={() => clearVia(selectedPerson.id)}
              onClose={() => setOpenId(null)}
            />
          )}

          {!panelOpen && !loading && people.length > 0 && (
            <p className="crm-idle" style={{
              fontSize: 13, color: C.faint, lineHeight: 1.55, margin: 0,
              border: `1px dashed ${C.line}`, borderRadius: 12, padding: '18px 16px',
            }}>
              Pick someone from the list to see their details here.
            </p>
          )}
        </div>)}
      </div>
    </div>
  );
}
