// Browser tests for signing in: drive the real app with accounts switched on,
// against a stand-in for Supabase that answers the same requests. Nothing
// here reaches a real project. Run with `npm run test:account`.
//
// Needs Playwright with Chromium, found the same way as tests/browser/run.mjs.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
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
const pw = findPlaywright();
if (!pw) {
  console.error('Playwright is not installed. Install it (npm i -D playwright) or globally, then run again.');
  process.exit(2);
}

// A made-up project, so a slip in the stand-in can never touch the real one.
// These outrank .env (see src/supabase.js).
const SB = 'https://orbit-test.supabase.co';
process.env.VITE_SUPABASE_URL = SB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
const TOKEN_KEY = 'sb-orbit-test-auth-token';

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await pw.chromium.launch();

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'sam@example.com', aud: 'authenticated', role: 'authenticated' };
const OTHER = '22222222-2222-4222-8222-222222222222';

const results = [];
let current = '';
const check = (name, cond, extra = '') => {
  results.push({ scenario: current, name, ok: Boolean(cond) });
  if (!cond) console.log(`  FAIL  ${name}${extra !== '' ? `  — ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`);
};

/*
 * A page with its own stand-in Supabase. rows is the orbit_data table, as
 * user id -> Map(key -> value). down makes every data request fail the way a
 * dropped connection does. local is written to localStorage once, before the
 * first load; signedIn stores a session the way supabase-js does.
 */
const newPage = async ({ signedIn = false, local = {}, rows = {} } = {}) => {
  const db = { rows: new Map(Object.entries(rows).map(([u, kv]) => [u, new Map(Object.entries(kv))])), down: false, calls: [] };
  const mine = () => {
    if (!db.rows.has(USER.id)) db.rows.set(USER.id, new Map());
    return db.rows.get(USER.id);
  };
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 }, timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('https://api.anthropic.com/**', (r) => r.abort());
  await page.route(`${SB}/**`, async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const headers = {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*', 'content-type': 'application/json',
    };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    db.calls.push(`${req.method()} ${u.pathname}`);
    if (u.pathname === '/auth/v1/otp') {
      db.otp = { body: JSON.parse(req.postData()), redirect: u.searchParams.get('redirect_to') };
      return r.fulfill({ status: 200, headers, body: '{}' });
    }
    if (u.pathname === '/auth/v1/logout') return r.fulfill({ status: 204, headers });
    if (u.pathname === '/auth/v1/user') return r.fulfill({ status: 200, headers, body: JSON.stringify(USER) });
    if (u.pathname === '/rest/v1/orbit_data') {
      if (db.down) return r.abort('internetdisconnected');
      // Row-level security: whatever the request says, only this user's rows.
      if (req.method() === 'GET') {
        return r.fulfill({ status: 200, headers, body: JSON.stringify([...mine()].map(([key, value]) => ({ key, value }))) });
      }
      if (req.method() === 'POST') {
        for (const row of JSON.parse(req.postData())) {
          if (row.user_id !== USER.id) return r.fulfill({ status: 403, headers, body: '{"message":"row-level security"}' });
          mine().set(row.key, row.value);
        }
        return r.fulfill({ status: 201, headers, body: '' });
      }
      if (req.method() === 'DELETE') {
        const inList = u.searchParams.get('key')?.match(/^in\.\((.*)\)$/);
        const eq = u.searchParams.get('key')?.match(/^eq\.(.*)$/);
        const keys = inList ? inList[1].split(',').map((k) => k.replace(/^"|"$/g, '')) : eq ? [eq[1]] : [];
        for (const k of keys) mine().delete(k);
        return r.fulfill({ status: 204, headers });
      }
    }
    return r.fulfill({ status: 404, headers, body: '{"message":"not in the stand-in"}' });
  });
  await page.addInitScript(([seed, session, tokenKey]) => {
    if (localStorage.getItem('test:seeded')) return;
    localStorage.setItem('test:seeded', '1');
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    if (session) {
      localStorage.setItem(tokenKey, JSON.stringify({
        access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: session,
      }));
    }
  }, [local, signedIn ? USER : null, TOKEN_KEY]);
  return { page, db, mine, problems, close: () => ctx.close() };
};

const localKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('orbit')).sort());
const shown = (loc) => loc.waitFor({ timeout: 8000 }).then(() => true, () => false);

const scenarios = {
  async 'signed out'() {
    const { page, db, problems, close } = await newPage({ local: { 'orbit:crm-owner-v1': 'Sam' } });
    await page.goto(`${url}#share=abc123`);
    check('asks to sign in before showing anything', await shown(page.getByRole('heading', { name: 'Sign in to Orbit' })));
    check('the app is not drawn', !(await page.getByText("Sam's Orbit").isVisible()));
    check('holds a shared-list link for after sign-in',
      (await page.evaluate(() => localStorage.getItem('orbit-pending-share'))) === '#share=abc123');
    check('offers Google', await page.getByRole('button', { name: 'Continue with Google' }).isVisible());

    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    check('an empty address is caught before sending', await shown(page.getByRole('alert').getByText('Type your email address first.')));
    check('and nothing is sent', !db.otp);

    await page.getByLabel('Email').fill('  sam@example.com ');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    check('says the link is on its way', await shown(page.getByRole('heading', { name: 'Check your email' })));
    check('sends the trimmed address', db.otp?.body?.email === 'sam@example.com', db.otp);
    check('the link comes back to this page', db.otp?.redirect === url, db.otp?.redirect);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'an expired sign-in link'() {
    const { page, close } = await newPage();
    await page.goto(`${url}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    check('says why the link failed',
      await shown(page.getByRole('alert').getByText('That sign-in link did not work: Email link is invalid or has expired')));
    check('clears the reason from the address', (await page.evaluate(() => window.location.hash)) === '');
    await close();
  },

  async 'first sign-in moves this browser\'s data into the account'() {
    const { page, mine, problems, close } = await newPage({
      signedIn: true,
      local: { 'orbit:crm-owner-v1': 'Sam', 'orbit:crm-theme-v1': 'dusk' },
    });
    await page.goto(url);
    check('opens Orbit with the browser\'s data', await shown(page.getByText("Sam's Orbit")));
    check('says it moved', await shown(page.getByRole('status').getByText('Everything this browser had saved is now in your account.')));
    check('the account has it', mine().get('crm-owner-v1') === 'Sam' && mine().get('crm-theme-v1') === 'dusk', [...mine()]);
    const keys = await localKeys(page);
    check('the browser\'s own copy is gone', !keys.includes('orbit:crm-owner-v1'), keys);
    check('an offline copy is kept for this account', keys.includes(`orbit:@${USER.id}:crm-owner-v1`), keys);
    await page.getByRole('button', { name: 'OK' }).click();
    check('the notice can be put away', !(await page.getByRole('status').isVisible()));
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'a returning account'() {
    const { page, mine, db, problems, close } = await newPage({
      signedIn: true,
      rows: { [USER.id]: { 'crm-owner-v1': 'Robin' }, [OTHER]: { 'crm-owner-v1': 'Someone else' } },
    });
    await page.goto(url);
    check('opens with the account\'s data', await shown(page.getByText("Robin's Orbit")));
    check('never someone else\'s', !(await page.getByText('Someone else').isVisible()));
    check('no notice when nothing moved', !(await page.getByRole('status').isVisible()));

    await page.getByRole('button', { name: "Robin's Orbit" }).click();
    const name = page.getByPlaceholder('Your name');
    await name.fill('Lee');
    await name.press('Enter');
    check('a change shows', await shown(page.getByText("Lee's Orbit")));
    await page.waitForTimeout(300);
    check('and is saved to the account', mine().get('crm-owner-v1') === 'Lee', [...mine()]);
    check('only this account is written', db.rows.get(OTHER).get('crm-owner-v1') === 'Someone else');

    await page.reload();
    check('it is still there after a reload', await shown(page.getByText("Lee's Orbit")));
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'a shared-list link survives sign-in'() {
    const { page, close } = await newPage({
      signedIn: true,
      local: { 'orbit-pending-share': '#share=not-a-real-list' },
      rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } },
    });
    await page.goto(url);
    await shown(page.getByText("Robin's Orbit"));
    await page.waitForTimeout(300);
    check('the held link is used once', (await page.evaluate(() => localStorage.getItem('orbit-pending-share'))) === null);
    check('and handed to the app, which takes it out of the address', (await page.evaluate(() => window.location.hash)) === '');
    await close();
  },

  async 'account and browser both have data: keep the account\'s'() {
    const { page, mine, close } = await newPage({
      signedIn: true,
      local: { 'orbit:crm-owner-v1': 'Sam' },
      rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } },
    });
    await page.goto(url);
    check('asks which to keep', await shown(page.getByRole('heading', { name: 'Which Orbit do you want?' })));
    check('the app is not drawn yet', !(await page.getByText("Robin's Orbit").isVisible()));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download this browser’s copy first' }).click(),
    ]);
    check('offers the browser\'s copy as a download', download.suggestedFilename() === 'orbit-this-browser.json');
    await page.getByRole('button', { name: 'Keep my account’s' }).click();
    check('opens the account\'s', await shown(page.getByText("Robin's Orbit")));
    check('the account is unchanged', mine().get('crm-owner-v1') === 'Robin');
    const keys = await localKeys(page);
    check('the browser\'s data is moved aside, not deleted',
      keys.includes('orbit:parked:crm-owner-v1') && !keys.includes('orbit:crm-owner-v1'), keys);
    await page.reload();
    check('and is not asked about again', await shown(page.getByText("Robin's Orbit")));
    await close();
  },

  async 'account and browser both have data: use the browser\'s'() {
    const { page, mine, close } = await newPage({
      signedIn: true,
      local: { 'orbit:crm-owner-v1': 'Sam' },
      rows: { [USER.id]: { 'crm-owner-v1': 'Robin', 'crm-theme-v1': 'dusk' } },
    });
    await page.goto(url);
    await shown(page.getByRole('heading', { name: 'Which Orbit do you want?' }));
    await page.getByRole('button', { name: 'Replace my account with this browser’s' }).click();
    check('opens the browser\'s', await shown(page.getByText("Sam's Orbit")));
    check('the account is exactly the browser\'s', JSON.stringify([...mine()]) === JSON.stringify([['crm-owner-v1', 'Sam']]), [...mine()]);
    await close();
  },

  async 'offline'() {
    const { page, db, close } = await newPage({ signedIn: true, rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } } });
    db.down = true;
    await page.goto(url);
    check('with no copy yet, says it cannot reach the account', await shown(page.getByRole('heading', { name: 'Orbit could not reach your account' })));
    check('rather than opening empty', !(await page.getByText('Orbit', { exact: true }).isVisible()));
    db.down = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    check('Try again opens it once the connection is back', await shown(page.getByText("Robin's Orbit")));

    db.down = true;
    await page.reload();
    check('with a copy, opens from it', await shown(page.getByText("Robin's Orbit")));
    check('and says it is offline', await shown(page.getByRole('status').getByText(/You are offline/)));
    await close();
  },

  async 'sign out'() {
    const { page, db, close } = await newPage({ signedIn: true, rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } } });
    await page.goto(url);
    await shown(page.getByText("Robin's Orbit"));
    await page.getByRole('button', { name: 'More' }).click();
    check('the menu shows who is signed in', await page.getByText(USER.email).isVisible());
    await page.getByRole('button', { name: 'Sign out' }).click();
    check('goes back to the sign-in screen', await shown(page.getByRole('heading', { name: 'Sign in to Orbit' })));
    check('tells Supabase', db.calls.includes('POST /auth/v1/logout'), db.calls);
    const keys = await localKeys(page);
    check('leaves none of the account on this device', keys.every((k) => !k.startsWith(`orbit:@${USER.id}`)), keys);
    check('and no session', (await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)) === null);
    await page.reload();
    check('still signed out after a reload', await shown(page.getByRole('heading', { name: 'Sign in to Orbit' })));
    await close();
  },
};

const only = process.argv.slice(2);
for (const [name, run] of Object.entries(scenarios)) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  current = name;
  const before = results.length;
  try {
    await run();
  } catch (err) {
    check(`ran to the end (${err.message.split('\n')[0]})`, false);
  }
  const mineRes = results.slice(before);
  const passed = mineRes.filter((r) => r.ok).length;
  console.log(`${passed === mineRes.length ? 'ok  ' : 'FAIL'}  ${name}: ${passed}/${mineRes.length}`);
}

await browser.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} account checks passed`);
process.exit(failed ? 1 : 0);
