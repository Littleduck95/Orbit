import { useState, useEffect, useMemo, useRef } from 'react';
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
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
  const [cadence, setCadence] = useState(initial?.cadence || 90);
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

      <Field label="Circle">
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
      </Field>

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

function PersonDetail({ p, myEvents, onLog, onEditLog, onRemoveLog, onEdit, onRemove, onTag, onClose }) {
  const [logging, setLogging] = useState(false);
  const [logDate, setLogDate] = useState(todayStr());
  const [logText, setLogText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editLog, setEditLog] = useState(null);
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
                editLog === i ? (
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
                        onClick={() => { onEditLog(p.id, i, draft); setEditLog(null); }}>Save</Button>
                      <Button style={{ fontSize: 12.5, padding: '6px 11px' }}
                        onClick={() => setEditLog(null)}>Cancel</Button>
                      <Button kind="danger" style={{ fontSize: 12.5, padding: '6px 9px' }}
                        onClick={() => { onRemoveLog(p.id, i); setEditLog(null); }}>Delete</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={i}
                    className="crm-btn"
                    onClick={() => { setEditLog(i); setDraft({ date: e.date, text: e.text || '' }); }}
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

const norm = (h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const toCsv = (cols, rows, extra) =>
  Papa.unparse({
    fields: cols.map((c) => c.h).concat(extra ? extra.fields : []),
    data: rows.map((r) => cols.map((c) => c.get(r)).concat(extra ? extra.row(r) : [])),
  });

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
      if (!col || value == null || String(value).trim() === '') return;
      col.set(obj, String(value).trim());
      touched = true;
    });
    if (touched) out.push(obj); else skipped += 1;
  });
  return { out, skipped };
};

const downloadCsv = (name, text) => {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
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
const buildUpcoming = (people, events) => {
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

  return out.sort((a, b) => a.d - b.d);
};

function Upcoming({ people, events, quiet, onShowQuiet, onPerson }) {
  const [open, setOpen] = useState(true);
  const items = buildUpcoming(people, events);
  const total = items.length + (quiet > 0 ? 1 : 0);
  if (total === 0) return null;

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
          background: quiet > 0 ? C.overdue : C.accent,
          color: quiet > 0 ? C.paper : C.onAccent,
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
              onClick={() => it.person && onPerson(it.person.id)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 9, width: '100%',
                font: 'inherit', textAlign: 'left',
                cursor: it.person ? 'pointer' : 'default',
                padding: '9px 0', background: 'transparent', border: 'none',
                borderTop: `1px solid ${C.line}`,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: 7, flexShrink: 0,
                background: it.tone === 'soon' ? C.soonBar : C.accent,
              }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink }}>
                {it.what}
                {it.detail && <span style={{ color: C.faint }}>{`, ${it.detail}`}</span>}
              </span>
              <span style={{ fontSize: 12, color: C.muted, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {countdown(it.d)}
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

function Recap({ people, year, years, onYear, eventCount }) {
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

      {r.total === 0 && r.added === 0 && !eventCount ? (
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
    initial?.lat != null ? { lat: initial.lat, lon: initial.lon } : null);
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

      <Field label="When">
        <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
          {[[false, 'One day'], [true, 'Over several days']].map(([v, l]) => (
            <button
              key={l}
              className="crm-btn"
              onClick={() => setSpans(v)}
              style={{
                flex: 1, font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 0',
                borderRadius: 7, cursor: 'pointer',
                background: spans === v ? C.accent : 'transparent',
                border: `1px solid ${spans === v ? C.accent : C.line}`,
                color: spans === v ? C.onAccent : C.muted,
              }}
            >{l}</button>
          ))}
        </div>

        {spans ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 138px' }}>
              <span style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>Started</span>
              <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 138px' }}>
              <span style={{ display: 'block', fontSize: 12, color: C.faint, marginBottom: 4 }}>Ended</span>
              <input type="date" style={inputStyle} value={endDate} min={date}
                onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        ) : (
          <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
        )}
      </Field>

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
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findPlace(); } }}
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

  const chipStyle = (on) => ({
    font: 'inherit', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em',
    padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
    background: on ? C.accent : 'transparent',
    border: `1px solid ${on ? C.accent : C.line}`,
    color: on ? C.onAccent : C.muted,
  });

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
            <button className="crm-btn" onClick={() => setKind('All')} style={chipStyle(kind === 'All')}>
              All
            </button>
            {kindsPresent.map((k) => (
              <button key={k} className="crm-btn" onClick={() => setKind(k)} style={chipStyle(kind === k)}>
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

function ExportView({ people, events, onClose }) {
  const [what, setWhat] = useState({ people: true, events: true, log: false });
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

function ImportView({ people, events, onPeople, onEvents, onClose }) {
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
      const looksLikeEvents = headers.includes('title') && (headers.includes('start') || headers.includes('date'));

      if (looksLikeEvents) {
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
        Drop in a CSV. People and events are detected automatically, and a plain sheet
        of names and emails works fine.
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
            {found.rows.length} {found.kind === 'people' ? 'people' : 'events'} ready
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
            From {found.file}
            {found.skipped > 0 && `, ${found.skipped} row${found.skipped === 1 ? '' : 's'} skipped for having no ${found.kind === 'people' ? 'name' : 'title or date'}`}
          </p>

          {found.rows.length > 0 && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 12.5, color: C.muted }}>
                First few: {found.rows.slice(0, 4).map((r) => r.name || r.title).join(', ')}
              </p>
              <Check on={mode === 'add'} onChange={() => setMode('add')}
                label="Add to what I already have" />
              <Check on={mode === 'replace'} onChange={() => setMode('replace')}
                label="Replace everything"
                hint={`Removes your current ${found.kind}`} />
              <Button kind="solid" onClick={commit} style={{ width: '100%', marginBottom: 10 }}>
                {mode === 'replace' ? 'Replace' : 'Add'} {found.rows.length} {found.kind === 'people' ? 'people' : 'events'}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [backup, setBackup] = useState('');
  const [paste, setPaste] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORE_KEY);
        if (r?.value) {
          const loaded = JSON.parse(r.value).map((x) => {
            if (x.addedOn) return x;
            const dates = (x.log || []).map((e) => e.date).filter(Boolean).sort();
            return { ...x, addedOn: dates[0] || null };
          });
          setPeople(loaded);
        }
      } catch {
        /* first run — nothing saved yet */
      }
      try {
        const ev = await window.storage.get(EVENTS_KEY);
        if (ev?.value) setEvents(JSON.parse(ev.value));
      } catch {
        /* no events yet */
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
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const shut = () => setMenuOpen(false);
    document.addEventListener('click', shut);
    return () => document.removeEventListener('click', shut);
  }, [menuOpen]);

  const persist = async (next) => {
    setPeople(next);
    try {
      await window.storage.set(STORE_KEY, JSON.stringify(next));
      setError('');
    } catch {
      setError('That change is showing here but did not save. Try again.');
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
    try {
      await window.storage.set(EVENTS_KEY, JSON.stringify(next));
      setError('');
    } catch {
      setError('That event is showing here but did not save. Try again.');
    }
  };

  const saveEvent = (ev) => {
    const exists = events.some((x) => x.id === ev.id);
    persistEvents(exists ? events.map((x) => (x.id === ev.id ? ev : x)) : [...events, ev]);
    setEventDraft(null);
  };

  const restore = () => {
    try {
      const parsed = JSON.parse(paste);
      // Older backups were a bare array of people.
      const rawPeople = Array.isArray(parsed) ? parsed : parsed.people;
      const rawEvents = Array.isArray(parsed) ? [] : parsed.events || [];
      if (!Array.isArray(rawPeople)) throw new Error('not a backup');
      const clean = rawPeople.filter((r) => r && typeof r.name === 'string' && r.name.trim());
      if (clean.length === 0) throw new Error('nobody in it');
      persist(clean.map((r) => ({ ...r, id: r.id || uid() })));
      persistEvents(rawEvents.filter((e) => e && e.title && e.date));
      setBackup('');
      setPaste('');
      setError('');
    } catch {
      setError("That backup could not be read. Paste the whole thing, starting with [ and ending with ].");
    }
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
    return [...found].sort((a, b) => b - a);
  }, [people]);

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
        .crm-person:last-child { border-bottom: none !important; }
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
              onKeyDown={(e) => { if (e.key === 'Enter') saveOwner(e.target.value); }}
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
              {[['list', 'People'], ['events', 'Events'], ['map', 'Map'], ['recap', 'Recap']].map(([v, l]) => {
                const on = view === v;
                return (
                  <button
                    key={v}
                    className="crm-btn"
                    onClick={() => { setView(v); setEventDraft(null); }}
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
                        onClick={() => { setView(v); setMenuOpen(false); setEventDraft(null); }}
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
            quiet={tab === 'all' ? quiet.length : 0}
            onShowQuiet={() => { setTab('quiet'); setOpenId(null); }}
            onPerson={(id) => { setOpenId(id); setEditing(null); setAdding(false); }}
          />
        )}

        </>)}

        {error && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: C.overdue }}>{error}</p>
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

        {view === 'import' && (
          <div className="crm-full">
            <ImportView
              people={people}
              events={events}
              onPeople={persist}
              onEvents={persistEvents}
              onClose={() => setView('list')}
            />
          </div>
        )}

        {view === 'export' && (
          <div className="crm-full">
            <ExportView people={people} events={events} onClose={() => setView('list')} />
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
              eventCount={events.filter((e) => Number(e.date.slice(0, 4)) === year).length} />
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

        {!loading && people.length > 0 && (
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
                  value={JSON.stringify({ people, events })}
                  style={{ ...inputStyle, minHeight: 92, fontSize: 12, lineHeight: 1.4, resize: 'vertical' }}
                />
              </div>
            )}

            {backup === 'in' && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 6px' }}>
                  Paste a backup. This replaces everyone currently on your lists.
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
            <PersonDetail
              p={selectedPerson}
              myEvents={events
                .filter((e) => (e.people || []).includes(selectedPerson.id))
                .sort((a, b) => (a.date < b.date ? 1 : -1))}
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
