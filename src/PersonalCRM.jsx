import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react';
import Papa from 'papaparse';

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

const prettyDate = (s) =>
  parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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

const prettyBirthday = (s) =>
  parseDate(s).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

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


function Button({ children, onClick, kind = 'quiet', style }) {
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
    <button className="crm-btn" style={{ ...base, ...kinds[kind] }} onClick={onClick}>
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

      <Field label="Dates to remember">
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
                  style={{ ...inputStyle, width: 'auto', flex: '1 1 150px', minHeight: 38, fontSize: 14 }}
                  value={d.kind}
                  onChange={(e) => set({ kind: e.target.value })}
                >
                  {DATE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input
                  type="date"
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
      </Field>

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
function PersonRow({ p, selected, onOpen, onQuickLog, onStar, showCircle }) {
  const st = status(p);
  const [justLogged, setJustLogged] = useState(false);

  const quick = () => {
    onQuickLog(p.id);
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 1600);
  };
  return (
    <div className="crm-person" style={{
      display: 'flex',
      background: selected ? C.accentSoft : C.surface,
      borderBottom: `1px solid ${C.line}`,
    }}>
      <div style={{ width: 4, background: st.bar, flexShrink: 0, opacity: st.over || selected ? 1 : 0.6 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="crm-row"
          onClick={onOpen}
          style={{ padding: '14px 15px', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 10 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{
                fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{p.name}</span>
              {ageOf(p) !== null && (
                <span style={{ fontSize: 13, color: C.faint, flexShrink: 0 }}>{ageOf(p)}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[
                showCircle ? (p.circle === 'work' ? 'Professional' : 'Personal') : '',
                p.circle === 'friend' ? (p.relation || tierLabel(p.tier)) : '',
                p.role,
                p.circle === 'work' ? p.company : '',
              ].filter(Boolean).join(', ') ||
                (p.circle === 'work' ? 'Professional' : 'Personal')}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, maxWidth: 116, whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: st.tone, letterSpacing: '-0.01em' }}>
              {st.paused ? 'paused'
                : st.child ? (st.days === null ? '—' : elapsed(st.days))
                : st.always ? 'in touch'
                : st.days === null ? 'no log' : elapsed(st.days)}
            </div>
            <div style={{
              fontSize: 12, color: C.faint, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {p.child ? 'child' : CADENCES.find((c) => c.days === Number(p.cadence))?.short || 'monthly'}
            </div>
          </div>
        </div>
      </div>

      <button
        className="crm-btn"
        onClick={onStar}
        title={p.vip ? 'Remove from VIPs' : 'Mark as VIP'}
        aria-label={p.vip ? `Remove ${p.name} from VIPs` : `Mark ${p.name} as a VIP`}
        aria-pressed={Boolean(p.vip)}
        style={{
          width: 40, flexShrink: 0, cursor: 'pointer', background: 'transparent',
          border: 'none', borderLeft: `1px solid ${C.line}`,
          color: p.vip ? C.soonBar : C.faint,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
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
        className="crm-btn"
        onClick={quick}
        title="Caught up with them today"
        aria-label={`Log a catch-up with ${p.name} today`}
        style={{
          width: 48, flexShrink: 0, cursor: 'pointer',
          background: justLogged ? C.accent : 'transparent',
          border: 'none', borderLeft: `1px solid ${C.line}`,
          color: justLogged ? C.onAccent : C.faint,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
          <path d="M3.5 9 L7 12.5 L13.5 5" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function PersonDetail({ p, myEvents, myReminders, myRecs, onLog, onEditLog, onRemoveLog, onEdit, onRemove, onTag, onList, onClose }) {
  const [logging, setLogging] = useState(false);
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
              <Button
                kind="danger"
                onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
                style={confirmRemove ? { fontWeight: 700 } : undefined}
              >
                {confirmRemove ? 'Tap again to remove' : 'Remove'}
              </Button>
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
    rating: Math.min(5, Math.max(0, Math.round(Number(raw.rating) || 0))),
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

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

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
];

const EVENT_FIXES = [
  ['title', fixNeeded], ['date', fixNeeded],
  ...['endDate', 'kind', 'place', 'note', 'addedOn'].map((k) => [k, fixText]),
  ['people', fixTextList],
  ['lat', fixNumber], ['lon', fixNumber],
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

function Recap({ people, year, years, onYear, eventCount, reminderCount, listCount }) {
  const r = buildRecap(people, year);
  const maxMonth = Math.max(1, ...r.months);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>
          {year} in review
        </h1>
        {years.length > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            {years.map((y) => (
              <button
                key={y}
                className="crm-btn"
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
          </div>
        )}
      </div>

      {r.total === 0 && r.added === 0 && !eventCount && !reminderCount && !listCount ? (
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: 0 }}>
          Nothing logged in {year} yet. Every catch-up you record builds this page, so it
          gets more interesting the longer you use it.
        </p>
      ) : (
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

          <div style={{
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
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- place lookup ---------- */
// The artifact sandbox blocks every external host except cdnjs, so ordinary
// geocoding APIs are unreachable. api.anthropic.com is the one permitted
// exception, and Claude handles misspellings and abbreviations better anyway.
const searchPlaces = async (raw) => {
  const prompt =
    `Give coordinates for this place: "${raw}"\n\n` +
    `Correct obvious misspellings (Cincinatti means Cincinnati). Expand ` +
    `abbreviations (DR means Dominican Republic, MO means Missouri).\n` +
    `Return ONLY a JSON array, up to 4 candidates, most likely first, each ` +
    `{"label":"City, Region, Country","lat":number,"lon":number}. ` +
    `No prose, no markdown fences. If it is not a real place, return [].`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return { status: 'offline', results: [] };
    const data = await res.json();
    const text = (data.content || [])
      .filter((i) => i.type === 'text').map((i) => i.text).join('');
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf('['), clean.lastIndexOf(']') + 1));
    const good = parsed.filter(
      (r) => r && typeof r.lat === 'number' && typeof r.lon === 'number' && r.label
        && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);
    return good.length ? { status: 'ok', results: good.slice(0, 4) } : { status: 'none', results: [] };
  } catch {
    return { status: 'offline', results: [] };
  }
};

/* ---------- events ---------- */
const EVENTS_KEY = 'crm-events-v1';
const EVENT_KINDS = ['Milestone', 'Trip', 'Celebration', 'Work', 'Loss', 'Other'];

const eventYear = (e) => Number(e.date.slice(0, 4));

// One date, or a span. Collapses the repeated parts: "Jun 3–10, 2026".
const eventWhen = (e) => {
  const end = e.endDate && e.endDate !== e.date ? e.endDate : null;
  if (!end) return { text: prettyDate(e.date), days: 1 };

  const a = parseDate(e.date);
  const b = parseDate(end);
  const days = Math.round((b - a) / 86400000) + 1;
  const md = { month: 'short', day: 'numeric' };
  const full = { month: 'short', day: 'numeric', year: 'numeric' };

  let text;
  if (a.getFullYear() !== b.getFullYear()) {
    text = `${a.toLocaleDateString(undefined, full)} – ${b.toLocaleDateString(undefined, full)}`;
  } else if (a.getMonth() === b.getMonth()) {
    text = `${a.toLocaleDateString(undefined, md)}–${b.getDate()}, ${a.getFullYear()}`;
  } else {
    text = `${a.toLocaleDateString(undefined, md)} – ${b.toLocaleDateString(undefined, md)}, ${a.getFullYear()}`;
  }
  return { text, days };
};

function EventForm({ initial, people, onSave, onCancel }) {
  const [date, setDate] = useState(initial?.date || todayStr());
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [spans, setSpans] = useState(Boolean(initial?.endDate && initial.endDate !== initial.date));
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState(initial?.kind || 'Milestone');
  const [note, setNote] = useState(initial?.note || '');
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
            : looking === 'offline' ? 'Could not reach either lookup service from here. Enter the coordinates below instead.'
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

      <Field label="Who was there">
        {people.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: C.faint }}>
            Nobody on your lists yet. Events work fine without people attached.
          </p>
        ) : (
          <>
            {people.length > 10 && (
              <input style={{ ...inputStyle, marginBottom: 8, minHeight: 38, fontSize: 14 }}
                value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter names" />
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
      </Field>

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

function EventCard({ e, people, onPerson, onEdit, onRemove }) {
  const [confirm, setConfirm] = useState(false);
  const attended = (e.people || []).map((id) => people.find((x) => x.id === id)).filter(Boolean);

  return (
    <div style={{ display: 'flex', gap: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: C.accent, marginTop: 6 }} />
        <span style={{ flex: 1, width: 1, background: C.line, marginTop: 4 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: C.faint }}>{eventWhen(e).text}</span>
          {eventWhen(e).days > 1 && (
            <span style={{ fontSize: 12, color: C.faint }}>{eventWhen(e).days} days</span>
          )}
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

function EventsView({ events, people, onAdd, onEdit, onRemove }) {
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
        <Button kind="solid" onClick={onAdd} style={{ marginLeft: 'auto' }}>Add an event</Button>
      </div>

      {events.length === 0 && <EmptySky />}

      <p style={{ margin: '0 0 18px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        {events.length === 0
          ? 'Weddings, moves, births, losses, the trip you never want to forget.'
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
            <EventCard key={e.id} e={e} people={people} onPerson={(n) => setQ(n)}
              onEdit={() => onEdit(e)} onRemove={() => onRemove(e.id)} />
          ))
        : years.map((y) => (
            <div key={y}>
              <p style={{
                margin: '0 0 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: C.faint,
              }}>{y}</p>
              {sorted.filter((e) => eventYear(e) === y).map((e) => (
                <EventCard key={e.id} e={e} people={people} onPerson={(n) => setQ(n)}
                  onEdit={() => onEdit(e)} onRemove={() => onRemove(e.id)} />
              ))}
            </div>
          ))}
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

function StarRow({ n, size = 11 }) {
  return (
    <span role="img" aria-label={`Rated ${n} of 5`}
      style={{ display: 'inline-flex', gap: 1, color: C.soonText, flexShrink: 0 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
          <path d={STAR_PATH} fill={i <= n ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          className="crm-btn"
          onClick={() => onChange(i === value ? 0 : i)}
          aria-label={`${i} out of 5`}
          aria-pressed={i === value}
          style={{
            background: 'transparent', border: 'none', padding: 5, cursor: 'pointer', lineHeight: 0,
            color: i <= value ? C.soonText : C.faint,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
            <path d={STAR_PATH} fill={i <= value ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
      <span style={{ fontSize: 12, color: C.faint, marginLeft: 8 }}>
        {value ? 'Tap the same star again to clear it.' : 'Not rated.'}
      </span>
    </div>
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
function CollectionForm({ initial, kind: startKind, onSave, onCancel }) {
  const first = kindOf(initial?.kind || startKind || 'Shows');
  const [kind, setKind] = useState(first.kind);
  const [name, setName] = useState(initial ? initial.name : first.name);
  const [note, setNote] = useState(initial?.note || '');
  const [track, setTrack] = useState(initial ? initial.track : true);
  // The middle stage is the only one that may be blank, meaning "skip it".
  const [labels, setLabels] = useState(initial
    ? { want: stageLabel(initial, 'want'), doing: initial.labels?.doing || '', done: stageLabel(initial, 'done') }
    : { ...first.labels });
  const [detail, setDetail] = useState(initial ? initial.detail : first.detail);
  const [missing, setMissing] = useState(false);

  // A new kind brings its own words, but only into fields still holding the
  // old kind's words. Anything typed in by hand stays as it was.
  const pickKind = (k) => {
    const was = kindOf(kind);
    const now = kindOf(k);
    setKind(now.kind);
    if (!name.trim() || name === was.name) setName(now.name);
    if (STAGES.every((s) => (labels[s] || '') === was.labels[s])) setLabels({ ...now.labels });
    if (!detail.trim() || detail === was.detail) setDetail(now.detail);
  };

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
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <Group label="What kind of list">
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {COLLECTION_KINDS.map((x) => (
            <button key={x.kind} className="crm-btn" onClick={() => pickKind(x.kind)}
              aria-pressed={kind === x.kind} style={filterChip(kind === x.kind)}>
              {x.kind}
            </button>
          ))}
        </div>
        <span style={hintStyle()}>Sets the starting words below. Every one of them can be changed.</span>
      </Group>

      <Field label="Name">
        <input style={inputStyle} value={name} maxLength={LIST_NAME_CAP}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? 'crm-list-name-missing' : undefined}
          onChange={(e) => { setName(e.target.value); setMissing(false); }}
          placeholder={k.name || 'Gift ideas for Mom'} />
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
          placeholder="Everything people keep telling me to watch."
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
                    placeholder={s === 'doing' ? 'Empty skips it' : k.labels[s]}
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
          onChange={(e) => setDetail(e.target.value)} placeholder={k.detail} />
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
function ItemEditor({ c, it, people, onSave, onRemove, onCancel }) {
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

      <Group label="Your rating">
        <StarPicker value={rating} onChange={setRating} />
      </Group>

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
function CollectionDetail({ c, people, owner, onSave, onEdit, onRemove, onBack }) {
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
        <span style={kindChip()}>{c.kind}</span>
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
              onSave={saveItem} onRemove={removeItem} onCancel={() => setEditing(null)} />
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
        <span style={kindChip()}>{c.kind}</span>
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

/* ---------- map ---------- */
// No basemap here on purpose: tile servers are outside the sandbox allowlist,
// so Leaflet would load and then render an empty grey square. The pins live
// here; the Travel Log renders them.
function MapView({ events, people }) {
  const [copying, setCopying] = useState(false);
  const pins = [...events]
    .filter((e) => e.lat != null && e.lon != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const payload = JSON.stringify(
    pins.map((e) => ({
      title: e.title,
      place: e.place || '',
      lat: e.lat,
      lon: e.lon,
      start: e.date,
      end: e.endDate || e.date,
      kind: e.kind || '',
      notes: e.note || '',
      people: (e.people || [])
        .map((id) => people.find((x) => x.id === id))
        .filter(Boolean)
        .map((x) => x.name),
    })),
    null,
    2
  );

  return (
    <div>
      <h1 style={{ margin: '0 0 6px', fontSize: 27, fontWeight: 600, letterSpacing: '-0.035em' }}>
        {pins.length === 0 ? 'Nothing pinned yet' : `${countThings(pins.length, 'place', 'places')} pinned`}
      </h1>
      {pins.length === 0 && <EmptySky />}

      <p style={{ margin: '0 0 20px', fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        {pins.length === 0
          ? 'Add a place to an event and hit Find to pin it here.'
          : 'Newest first. Send these to the Travel Log to see them on a map.'}
      </p>

      {pins.map((e) => (
        <div key={e.id} style={{
          display: 'flex', gap: 11, alignItems: 'baseline',
          padding: '12px 0', borderBottom: `1px solid ${C.line}`,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, letterSpacing: '-0.02em' }}>
              {e.title}
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
              {e.place || 'Unnamed place'}
              <span style={{ color: C.faint }}>
                {'  '}{e.lat.toFixed(3)}, {e.lon.toFixed(3)}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 12.5, color: C.faint, flexShrink: 0 }}>{eventWhen(e).text}</span>
        </div>
      ))}

      {pins.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Button kind="solid" onClick={() => setCopying(!copying)}>
            {copying ? 'Hide the export' : 'Export for the Travel Log'}
          </Button>
          {copying && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 6px', lineHeight: 1.5 }}>
                Select all and copy, then paste into the Travel Log. Field names may need
                mapping to match that file.
              </p>
              <textarea
                readOnly
                onFocus={(e) => e.target.select()}
                value={payload}
                style={{ ...inputStyle, minHeight: 150, fontSize: 12, lineHeight: 1.45, resize: 'vertical' }}
              />
            </div>
          )}
        </div>
      )}
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
      })]);
    }
    return parts;
  };

  const run = () => {
    const parts = build();
    if (parts.length === 0) { setNote('Pick at least one thing to export.'); return; }
    const stamp = todayStr();
    let saved = 0;
    parts.forEach(([name, csv]) => { if (downloadCsv(`orbit-${name}-${stamp}.csv`, csv)) saved += 1; });
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

function ImportView({ people, events, reminders, collections, onPeople, onEvents, onReminders, onCollections, onClose }) {
  const [over, setOver] = useState(false);
  const [found, setFound] = useState(null);
  const [problem, setProblem] = useState('');
  const [mode, setMode] = useState('add');
  const picker = useRef(null);

  const read = (file) => {
    setProblem('');
    setFound(null);
    if (!file) return;
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
export default function PersonalCRM() {
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
  const [events, setEvents] = useState([]);
  const [eventDraft, setEventDraft] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [reminderDraft, setReminderDraft] = useState(null);
  const [collections, setCollections] = useState([]);
  const [collectionOpen, setCollectionOpen] = useState(null);
  const [collectionDraft, setCollectionDraft] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const listsLook = useRef({ q: '', kind: 'All', order: 'recent' });
  // Saved lists that could not be read as they were: their original text,
  // shown in a warning with a way to download it.
  const [setAsideText, setSetAsideText] = useState(null);
  // Lists whose original could not even be set aside (no room). These are
  // never saved over for the rest of the visit.
  const heldBack = useRef(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
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
      if (Object.keys(aside).length) setSetAsideText(aside);
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
    const look = (arriving) => {
      if (!window.location.hash.startsWith(`#${SHARE_PREFIX}`)) return;
      const got = readShared(window.location.hash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
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

  const logTouch = (id, date, text) => {
    persist(people.map((p) => (p.id === id
      ? withLog(p, [{ date, text }, ...(p.log || [])])
      : p)));
  };

  const persistEvents = async (next) => {
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

  const restore = async () => {
    let parts;
    try {
      const parsed = JSON.parse(paste);
      // Older backups were a bare array of people.
      const rawPeople = Array.isArray(parsed) ? parsed : parsed.people;
      const rawEvents = Array.isArray(parsed) ? [] : parsed.events || [];
      const rawReminders = Array.isArray(parsed) ? [] : parsed.reminders || [];
      const rawCollections = Array.isArray(parsed) ? [] : parsed.collections || [];
      if (!Array.isArray(rawPeople)) throw new Error('not a backup');
      // The same records are kept as ever; each is then repaired, so one
      // field of the wrong shape cannot take the app down.
      const clean = cleanAll(rawPeople.filter((r) => r && typeof r.name === 'string' && r.name.trim()), cleanPerson);
      parts = {
        people: clean.map((r) => ({ ...r, id: r.id || uid() })),
        events: cleanAll((Array.isArray(rawEvents) ? rawEvents : []).filter((e) => e && e.title && e.date), cleanEvent),
        reminders: cleanAll((Array.isArray(rawReminders) ? rawReminders : []).filter((r) => r && r.title && r.next), cleanReminder)
          .map((r) => ({ ...r, id: r.id || uid() })),
        collections: cleanCollections(rawCollections),
      };
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
      persistCollections(parts.collections),
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
  const overdueCount = (circle) => ofCircle(circle).filter((p) => status(p).over).length;
  const totalCount = (circle) => ofCircle(circle).length;

  const pickTheme = async (name) => {
    applyTheme(name);
    setTheme(name);
    try { await window.storage.set(THEME_KEY, name); } catch { /* not fatal */ }
  };

  const saveOwner = async (v) => {
    const name = v.trim();
    setOwner(name);
    setNamingOwner(false);
    try { await window.storage.set(OWNER_KEY, name); } catch { /* not fatal */ }
  };

  const sorted = useMemo(
    () => [...inCircle].sort((a, b) => rank(b) - rank(a)),
    [inCircle]
  );
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

  const everyone = useMemo(
    () => [...people].sort((a, b) => rank(b) - rank(a)),
    [people]
  );

  const families = useMemo(
    () => [...new Set(people.flatMap((p) => p.families || []))].sort(),
    [people]
  );
  const years = useMemo(() => {
    const found = new Set([new Date().getFullYear()]);
    people.forEach((p) => {
      if (p.addedOn) found.add(Number(p.addedOn.slice(0, 4)));
      (p.log || []).forEach((e) => e.date && found.add(Number(e.date.slice(0, 4))));
    });
    reminders.forEach((r) => (r.history || []).forEach((h) =>
      h?.date && found.add(Number(h.date.slice(0, 4)))));
    collections.forEach((c) => c.items.forEach((it) =>
      it.doneOn && stageOf(c, it) === 'done' && found.add(Number(it.doneOn.slice(0, 4)))));
    return [...found].sort((a, b) => b - a);
  }, [people, reminders, collections]);

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
        }
        .crm-person:last-child, .crm-entry:last-child { border-bottom: none !important; }
        /* A list can hold thousands of entries. Rows off screen are skipped
           until scrolled to, which is most of what a keystroke costs on a long
           list. Still found by find-in-page and screen readers. */
        .crm-entry { content-visibility: auto; contain-intrinsic-size: auto 62px; }
        /* That also clips painting to each row, which would cut off a focus
           ring drawn outside a button that fills the row, so rings go inside. */
        .crm-entry .crm-btn:focus-visible, .crm-entry a:focus-visible { outline-offset: -3px; }
        .crm-select {
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 4.5 L6 8 L9.5 4.5' fill='none' stroke='${encodeURIComponent(C.muted)}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
          background-repeat: no-repeat; background-position: right 11px center; background-size: 12px;
          padding-right: 32px;
        }
        .crm-open { animation: crmIn .16s ease-out; }
        @keyframes crmIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .crm-open { animation: none; } }
      `}</style>

      <div className="crm-shell">
        <div className="crm-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <svg width="19" height="19" viewBox="0 0 19 19" style={{ flexShrink: 0, overflow: 'visible' }}>
            <ellipse cx="9.5" cy="9.5" rx="9" ry="4.4" fill="none"
              stroke={C.accent} strokeWidth="1.1" opacity="0.65"
              transform="rotate(-28 9.5 9.5)" />
            <circle cx="9.5" cy="9.5" r="3.1" fill={C.accent} />
            <circle cx="17.2" cy="5.7" r="1.7" fill={C.accent} />
          </svg>
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
              {[['list', 'People'], ['events', 'Events'], ['reminders', 'Reminders'],
                ['collections', 'Lists'], ['map', 'Map'], ['recap', 'Recap']].map(([v, l]) => {
                const on = view === v;
                return (
                  <button
                    key={v}
                    className="crm-btn"
                    onClick={() => {
                      setView(v); setEventDraft(null); setReminderDraft(null);
                      setCollectionDraft(null); setCollectionOpen(null);
                    }}
                    style={{
                      font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                      color: on ? C.onAccent : C.muted,
                      background: on ? C.accent : 'transparent',
                      border: `1px solid ${on ? C.accent : C.line}`,
                      padding: '5px 11px', borderRadius: 20,
                    }}
                  >{l}</button>
                );
              })}

              <div style={{ position: 'relative' }}>
                <button
                  className="crm-btn"
                  aria-label="More"
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
                    {[['import', 'Import'], ['export', 'Export']].map(([v, l], i) => (
                      <button
                        key={v}
                        className="crm-btn"
                        onClick={() => {
                          setView(v); setMenuOpen(false); setEventDraft(null); setReminderDraft(null);
                          setCollectionDraft(null);
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                          fontSize: 13.5, fontWeight: 600, color: C.ink, cursor: 'pointer',
                          padding: '10px 13px', background: 'transparent', border: 'none',
                          borderTop: i ? `1px solid ${C.line}` : 'none',
                        }}
                      >{l}</button>
                    ))}
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
          const names = { [STORE_KEY]: 'people', [EVENTS_KEY]: 'events', [REMINDERS_KEY]: 'reminders', [COLLECTIONS_KEY]: 'lists' };
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
                {held ? ` There was no room to keep that copy, so your ${held} will not be saved over until you have downloaded it.` : ''}
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
        </div>

        {view === 'events' && (
          <div className="crm-full">
            {eventDraft ? (
              <EventForm
                initial={eventDraft.id ? eventDraft : null}
                people={people}
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
              />
            )}
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

        {view === 'map' && (
          <div className="crm-full">
            <MapView events={events} people={people} />
          </div>
        )}

        {view === 'recap' && (
          <div className="crm-full">
            <Recap people={people} year={year} years={years} onYear={setYear}
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
                onOpen={() => { setOpenId(p.id); setEditing(null); setAdding(false); }}
                onQuickLog={quickLog}
                onStar={() => toggleVip(p.id)}
              />
            ))}
          </div>
        )}

        {!loading && people.length + events.length + reminders.length + collections.length > 0 && (
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
            </div>

            {backup === 'out' && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px' }}>
                  Select all and copy. Paste it somewhere safe.
                </p>
                <textarea
                  readOnly
                  onFocus={(e) => e.target.select()}
                  value={JSON.stringify({ people, events, reminders, collections })}
                  style={{ ...inputStyle, minHeight: 92, fontSize: 12, lineHeight: 1.4, resize: 'vertical' }}
                />
              </div>
            )}

            {backup === 'in' && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px' }}>
                  Paste a backup. This replaces everything saved here now: people, events,
                  reminders and lists.
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
              onList={(id) => { setView('collections'); openCollectionById(id); }}
              onLog={logTouch}
              onEditLog={editLog}
              onRemoveLog={removeLog}
              onEdit={() => setEditing(selectedPerson.id)}
              onRemove={() => remove(selectedPerson.id)}
              onTag={(kind, value) => { setTagFilter({ kind, value }); setQ(''); setOpenId(null); }}
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
