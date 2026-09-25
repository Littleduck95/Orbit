// Browser characterization tests: drive the real app and pin down what it
// does today. Run with `npm run test:browser`.
//
// Needs Playwright with Chromium. Playwright is not a dependency of this
// project; this finds it wherever it is installed (the project, then the
// global npm root) and says so plainly when it is missing.
//
// Every scenario gets a fresh browser context: an empty localStorage, the
// clock started at the same instant, one timezone and one locale, so dates in
// the app come out the same on every run.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

const findPlaywright = () => {
  try { return require('playwright'); } catch { /* not in the project */ }
  try {
    return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch { /* not global either */ }
  return null;
};

// Tuesday 22 September 2026, noon, Chicago.
export const NOW = new Date('2026-09-22T12:00:00-05:00');
export const TODAY = '2026-09-22';

// A 1x1 light grey PNG.
const BLANK_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC', 'base64');

const pw = findPlaywright();
if (!pw) {
  console.error('Playwright is not installed. Install it (npm i -D playwright) or globally, then run again.');
  process.exit(2);
}

const only = process.argv.slice(2);
const files = fs.readdirSync(here).filter((f) => f.endsWith('.scenario.mjs'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o))).sort();

// These drive Orbit as it saves in the browser, with no account. An empty
// value outranks .env, which switches sign-in off (see src/supabase.js).
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await pw.chromium.launch();
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-shots-'));

const results = [];
let current = '';

const check = (name, cond, extra = '') => {
  results.push({ scenario: current, name, ok: Boolean(cond), extra });
  if (!cond) console.log(`  FAIL  ${name}${extra !== '' ? `  — ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`);
};

// A fresh page. seed: storage keys (without the orbit: prefix) to values,
// written once before the app first loads.
const newPage = async ({ seed = {}, width = 1200, height = 900, clipboard = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Chicago', locale: 'en-US' });
  if (clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    // Fonts and the place-search request are outside calls that fail here.
    if (/fonts\.googleapis|ERR_|Failed to load resource/.test(t)) return;
    problems.push(`${m.type()}: ${t}`);
  });
  // Place search calls an outside service; make it fail the same way every
  // run. A scenario that wants answers routes it again (the newest route wins).
  await page.route('https://api.stadiamaps.com/geocoding/**', (r) => r.abort());
  // Map tiles: a blank tile, so maps draw without reaching the internet.
  await page.route('https://tiles.stadiamaps.com/**', (r) => r.fulfill({ contentType: 'image/png', body: BLANK_TILE }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  if (Object.keys(seed).length) {
    await page.addInitScript((s) => {
      if (localStorage.getItem('orbit:__seeded')) return;
      Object.entries(s).forEach(([k, v]) => localStorage.setItem(`orbit:${k}`, typeof v === 'string' ? v : JSON.stringify(v)));
      localStorage.setItem('orbit:__seeded', '1');
    }, seed);
  }
  const open = async () => { await page.goto(url); await page.waitForSelector('button:has-text("Recap")'); };
  const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`orbit:${k}`) || 'null'), key);
  // allow: a pattern for errors a scenario expects, such as a crash it is
  // there to record. Anything else logged still fails the scenario.
  const done = async ({ allow } = {}) => {
    const unexpected = problems.filter((p) => !(allow && allow.test(p)));
    check('no console errors or React warnings', unexpected.length === 0, unexpected.join(' | '));
    await ctx.close();
  };
  return { ctx, page, problems, open, stored, done, url, shots };
};

const tab = (page, name) => page.getByRole('button', { name, exact: true }).first().click();

try {
  for (const f of files) {
    current = f.replace('.scenario.mjs', '');
    const before = results.length;
    const started = Date.now();
    try {
      const mod = await import(path.join(here, f));
      await mod.default({ newPage, check, tab, TODAY, NOW, url, shots });
    } catch (e) {
      check('scenario ran to the end', false, e.message.split('\n')[0]);
    }
    const mine = results.slice(before);
    const failed = mine.filter((r) => !r.ok).length;
    console.log(`${failed ? 'FAIL' : 'ok  '}  ${current}: ${mine.length - failed}/${mine.length} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
