// Performance profile of the app, for before/after comparisons.
//
//   node tests/perf/run.mjs            timings on a production build
//   node tests/perf/run.mjs --profile  also attribute CPU time to functions
//                                      (uses an unminified build so names survive)
//
// Data is generated from a fixed seed, at three sizes, so runs compare like for
// like. Each timing is the median of several runs of the same interaction,
// measured from the input event to the next painted frame. Needs Playwright,
// found the same way as the browser tests.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const pw = (() => {
  try { return require('playwright'); } catch { /* not in the project */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { return null; }
})();
if (!pw) { console.error('Playwright is not installed.'); process.exit(2); }

const PROFILE = process.argv.includes('--profile');
const REPEATS = 7;

// ---- deterministic data ----
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const day = (offset) => {
  const d = new Date(2026, 8, 22 + offset, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const makeData = ({ people: nPeople, logs, events: nEvents, reminders: nReminders, lists, items }) => {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const first = ['Ann', 'Bea', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kai', 'Lea', 'Max', 'Nia', 'Oli', 'Pam'];
  const last = ['Boyer', 'Cho', 'Diaz', 'Ellis', 'Fox', 'Gold', 'Hart', 'Ito', 'Jones', 'Kerr', 'Lopez', 'Moss'];
  const people = Array.from({ length: nPeople }, (_, i) => {
    const log = Array.from({ length: logs }, () => ({ date: day(-Math.floor(r() * 900)), text: r() < 0.5 ? 'Coffee and a walk' : '' }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      id: `p${i}`, name: `${pick(first)} ${pick(last)} ${i}`, circle: r() < 0.7 ? 'friend' : 'work', tier: pick(['family', 'bestie', 'friend', 'acquaintance']),
      role: pick(['', 'Ops lead', 'From climbing']), company: r() < 0.3 ? pick(['Ardent', 'Blue Co', 'Cobalt']) : '',
      cadence: pick([0, 7, 14, 30, 90, 182, 365]), vip: r() < 0.05, paused: r() < 0.05,
      birthday: r() < 0.6 ? `19${60 + Math.floor(r() * 40)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` : null,
      families: r() < 0.3 ? [pick(['Boyer family', 'Cho family', 'Diaz family'])] : [], groups: r() < 0.3 ? ['Climbing crew'] : [],
      aka: [], kids: [], dates: r() < 0.2 ? [{ kind: 'Moved', label: '', date: day(-Math.floor(r() * 3000)) }] : [],
      email: `p${i}@example.com`, phone: '', address: '', socials: {}, note: r() < 0.3 ? 'Ask about the new job.' : '', hobbies: '',
      addedOn: day(-Math.floor(r() * 900)), log, lastContact: log[0]?.date || null,
    };
  });
  const events = Array.from({ length: nEvents }, (_, i) => ({
    id: `e${i}`, title: `Event ${i} ${pick(['trip', 'wedding', 'move'])}`, date: day(-Math.floor(r() * 1500)),
    endDate: r() < 0.3 ? day(-Math.floor(r() * 10)) : null, kind: pick(['Milestone', 'Trip', 'Celebration', 'Work']),
    place: r() < 0.5 ? 'Denver' : '', lat: r() < 0.3 ? 39.7 : null, lon: r() < 0.3 ? -104.9 : null, note: 'A note', addedOn: day(-5),
    people: nPeople ? [`p${Math.floor(r() * nPeople)}`] : [],
  })).map((e) => (e.endDate && e.endDate < e.date ? { ...e, endDate: null } : e)).map((e) => (e.lat == null ? { ...e, lon: null } : { ...e, lon: -104.9 }));
  const reminders = Array.from({ length: nReminders }, (_, i) => ({
    id: `r${i}`, title: `Reminder ${i}`, kind: pick(['Home', 'Money', 'Health']), next: day(Math.floor(r() * 120) - 20),
    every: { unit: pick(['week', 'month', 'year']), n: 1, dom: 15 }, anchor: pick(['date', 'done']), lead: 7,
    history: [{ date: day(-30) }], people: [], note: '', lastDone: day(-30), paused: false, done: false,
  }));
  const collections = Array.from({ length: lists }, (_, l) => ({
    id: `l${l}`, name: `List ${l}`, kind: 'Books', track: true, labels: { want: 'Want to read', doing: 'Reading', done: 'Read' },
    detail: 'Author', sort: 'manual', addedOn: day(-100), updatedAt: new Date(2026, 8, 1 + l).toISOString(),
    items: Array.from({ length: items }, (_, i) => ({ id: `l${l}i${i}`, title: `Book ${i}`, detail: 'Somebody', status: pick(['want', 'doing', 'done']), rating: 0, link: '', note: '', from: null, addedOn: day(-50), doneOn: null })),
  }));
  return { people, events, reminders, collections };
};

const SIZES = {
  empty: { people: 0, logs: 0, events: 0, reminders: 0, lists: 0, items: 0 },
  typical: { people: 60, logs: 15, events: 40, reminders: 15, lists: 3, items: 50 },
  heavy: { people: 500, logs: 40, events: 300, reminders: 60, lists: 10, items: 200 },
};

// ---- build and serve ----
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-perf-'));
// These drive Orbit as it saves in the browser, with no account. An empty
// value outranks .env, which switches sign-in off (see src/supabase.js).
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
await build({ root, logLevel: 'error', build: { outDir, emptyOutDir: true, minify: !PROFILE } });
const server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await pw.chromium.launch();
const bundle = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
  .reduce((n, f) => n + fs.statSync(path.join(outDir, 'assets', f)).size, 0);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const pageWith = async (data) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await ctx.newPage();
  // No fake clock here: it also replaces performance.now and
  // requestAnimationFrame, which would make every timing coarse and unreal.
  // The data is dated around NOW, and a day or two of drift does not change
  // the cost of anything measured.
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.addInitScript((d) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('orbit:crm-people-v1', JSON.stringify(d.people));
    localStorage.setItem('orbit:crm-events-v1', JSON.stringify(d.events));
    localStorage.setItem('orbit:crm-reminders-v1', JSON.stringify(d.reminders));
    localStorage.setItem('orbit:crm-collections-v1', JSON.stringify(d.collections));
  }, data);
  return { ctx, page };
};

// From the input to the next painted frame.
const timeAction = (page, src) => page.evaluate(async (code) => {
  const run = new Function(code);
  const t = performance.now();
  run();
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return performance.now() - t;
}, src);

const typeInto = (selector, value) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));`;
const clickFirst = (selector) => `document.querySelector(${JSON.stringify(selector)}).click();`;
const clickText = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})).click();`;

// Self time by function, over a CDP CPU profile of one action.
const profileAction = async (page, src, label) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  for (let i = 0; i < 3; i += 1) await timeAction(page, typeof src === 'function' ? src(i) : src);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const name = `${f.functionName || '(anonymous)'} ${f.url ? `${path.basename(f.url).replace(/-[\w-]{8}\.js/, '.js')}:${f.lineNumber + 1}` : ''}`.trim();
    self.set(name, (self.get(name) || 0) + (dt[i] || 0) / 1000);
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\n  profile: ${label} (3 runs, ${total.toFixed(0)} ms sampled)`);
  top.forEach(([k, v]) => console.log(`    ${v.toFixed(1).padStart(7)} ms  ${k}`));
  await cdp.detach();
};

const results = {};
const record = (size, name, ms) => { results[`${size} | ${name}`] = ms; console.log(`  ${name.padEnd(46)} ${ms.toFixed(1).padStart(7)} ms`); };

try {
  console.log(`bundle: ${(bundle / 1024).toFixed(1)} KB of JavaScript${PROFILE ? ' (unminified for profiling)' : ''}`);
  for (const [size, shape] of Object.entries(SIZES)) {
    const data = makeData(shape);
    const bytes = JSON.stringify(data).length;
    console.log(`\n== ${size}: ${shape.people} people x ${shape.logs} catch-ups, ${shape.events} events, ${shape.reminders} reminders, ${shape.lists} lists x ${shape.items} (${(bytes / 1024).toFixed(0)} KB stored)`);

    // Load: navigation start to the tabs appearing (they wait for storage).
    const loads = [];
    for (let i = 0; i < 5; i += 1) {
      const { ctx, page } = await pageWith(data);
      await page.goto(url);
      await page.waitForSelector('button:has-text("Recap")');
      loads.push(await page.evaluate(() => performance.now()));
      await ctx.close();
    }
    record(size, 'load to ready', median(loads));
    if (shape.people === 0) continue;

    const { ctx, page } = await pageWith(data);
    await page.goto(url);
    await page.waitForSelector('button:has-text("Recap")');
    const search = 'input[placeholder="Search everyone by name, note, or handle"]';
    const t = async (name, setup, action, reset) => {
      const xs = [];
      for (let i = 0; i < REPEATS; i += 1) {
        if (setup) await page.evaluate(new Function(setup));
        xs.push(await timeAction(page, typeof action === 'function' ? action(i) : action));
        if (reset) await page.evaluate(new Function(reset));
      }
      record(size, name, median(xs));
    };

    await page.evaluate(new Function(clickText('Everyone')));
    await t('people: keystroke in search', null, (i) => typeInto(search, i % 2 ? 'an' : 'a'), null);
    await page.evaluate(new Function(typeInto(search, '')));
    await t('people: tap the catch-up tick (saves)', null, clickFirst('button[aria-label^="Log a catch-up with"]'), null);
    await t('people: tap the VIP star (saves)', null, clickFirst('button[aria-label*="VIP"]'), null);
    await t('people: open a person', null, clickFirst('.crm-person .crm-row'), null);
    await t('people: switch Personal / Everyone', null, (i) => clickText(i % 2 ? 'Everyone' : 'Personal'), null);
    const persist = await page.evaluate(() => {
      const raw = localStorage.getItem('orbit:crm-people-v1');
      const xs = [];
      for (let i = 0; i < 7; i += 1) {
        const t0 = performance.now();
        localStorage.setItem('orbit:perf-probe', JSON.stringify(JSON.parse(raw)));
        xs.push(performance.now() - t0);
      }
      localStorage.removeItem('orbit:perf-probe');
      return xs.sort((a, b) => a - b)[3];
    });
    record(size, 'storage: write all people once', persist);
    if (PROFILE && size === 'heavy') {
      await profileAction(page, (i) => typeInto(search, i % 2 ? 'an' : 'a'), 'people search keystroke');
      await page.evaluate(new Function(typeInto(search, '')));
      await profileAction(page, clickFirst('button[aria-label^="Log a catch-up with"]'), 'catch-up tick');
    }

    await page.evaluate(new Function(clickText('Events')));
    await t('events: keystroke in search', null, (i) => typeInto('input[placeholder="Search titles, notes, places, people"]', i % 2 ? 'ev' : 'e'), null);
    if (PROFILE && size === 'heavy') {
      await profileAction(page, (i) => typeInto('input[placeholder="Search titles, notes, places, people"]', i % 2 ? 'ev' : 'e'), 'events search keystroke');
    }

    await t('tab switch to Reminders', null, clickText('Reminders'), clickText('Events'));
    await page.evaluate(new Function(clickText('Reminders')));
    await t('reminders: tap "Did it today" (saves)', null, clickText('Did it today'), null);
    await t('tab switch to Recap', null, clickText('Recap'), clickText('Reminders'));
    await t('tab switch to People', null, clickText('People'), clickText('Reminders'));
    if (PROFILE && size === 'heavy') {
      await profileAction(page, clickText('Recap'), 'switch to Recap');
      await profileAction(page, (i) => clickText(i % 2 ? 'Reminders' : 'People'), 'switch to People and back');
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(os.tmpdir(), `orbit-perf-${PROFILE ? 'profile' : 'timings'}.json`), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  fs.rmSync(outDir, { recursive: true, force: true });
}
