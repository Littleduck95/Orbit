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

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'sam@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { providers: ['email'] } };
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
const PROFILE = { id: USER.id, username: 'sam', display_name: 'Sam', birthday: '1994-05-06' };
const PASSWORD = 'correct-horse';
const session = () => ({
  access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
});

/*
 * profile is the signed-in person's row in profiles: PROFILE by default when
 * signed in, null for an account that has none yet. taken lists usernames
 * already in use. Sign-ups, password logins, resets and profile changes are
 * all recorded on db for the checks to look at.
 */
const newPage = async ({ signedIn = false, local = {}, rows = {}, profile = signedIn ? PROFILE : null, taken = ['bea'] } = {}) => {
  const db = { rows: new Map(Object.entries(rows).map(([u, kv]) => [u, new Map(Object.entries(kv))])), down: false, calls: [], profile, taken: new Set(taken) };
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
    if (u.pathname === '/auth/v1/user' && req.method() === 'PUT') {
      db.userUpdate = JSON.parse(req.postData());
      return r.fulfill({ status: 200, headers, body: JSON.stringify(USER) });
    }
    if (u.pathname === '/auth/v1/user') return r.fulfill({ status: 200, headers, body: JSON.stringify(USER) });
    if (u.pathname === '/auth/v1/signup') {
      db.signup = { body: JSON.parse(req.postData()), redirect: u.searchParams.get('redirect_to') };
      // Email confirmation is on: a user comes back, but no session.
      return r.fulfill({ status: 200, headers, body: JSON.stringify({ ...USER, email: db.signup.body.email, identities: [{}] }) });
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      const body = JSON.parse(req.postData());
      db.login = body;
      if (body.password !== PASSWORD) {
        return r.fulfill({ status: 400, headers, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
      }
      return r.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
    }
    if (u.pathname === '/auth/v1/recover') {
      db.recover = { body: JSON.parse(req.postData()), redirect: u.searchParams.get('redirect_to') };
      return r.fulfill({ status: 200, headers, body: '{}' });
    }
    if (u.pathname === '/rest/v1/rpc/username_available') {
      const { name } = JSON.parse(req.postData());
      return r.fulfill({ status: 200, headers, body: JSON.stringify(!db.taken.has(name) && name !== db.profile?.username) });
    }
    if (u.pathname === '/rest/v1/rpc/delete_my_account') {
      db.deleted = true;
      db.rows.delete(USER.id);
      db.profile = null;
      return r.fulfill({ status: 204, headers });
    }
    if (u.pathname === '/rest/v1/profiles') {
      if (db.down) return r.abort('internetdisconnected');
      if (req.method() === 'GET') return r.fulfill({ status: 200, headers, body: JSON.stringify(db.profile ? [db.profile] : []) });
      const body = JSON.parse(req.postData());
      const row = Array.isArray(body) ? body[0] : body;
      if (row.username && (db.taken.has(row.username))) {
        return r.fulfill({ status: 409, headers, body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' }) });
      }
      db.profile = { ...(db.profile || {}), ...row, id: USER.id };
      return r.fulfill({ status: req.method() === 'POST' ? 201 : 200, headers, body: JSON.stringify([db.profile]) });
    }
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
    check('asks to log in before showing anything', await shown(page.getByRole('heading', { name: 'Welcome back' })));
    check('the app is not drawn', !(await page.getByText("Sam's Orbit").isVisible()));
    check('holds a shared-list link for after sign-in',
      (await page.evaluate(() => localStorage.getItem('orbit-pending-share'))) === '#share=abc123');
    check('offers Google', await page.getByRole('button', { name: 'Continue with Google' }).isVisible());
    check('offers logging in or creating an account', await page.getByRole('button', { name: 'Log in', exact: true }).first().isVisible()
      && await page.getByRole('button', { name: 'Create account' }).isVisible());

    await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
    check('an empty address is caught before sending', await shown(page.getByText('Enter your email.')));
    check('and nothing is sent', !db.otp);

    await page.getByLabel('Email').fill('  sam@example.com ');
    await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
    check('says the link is on its way', await shown(page.getByRole('heading', { name: 'Check your email' })));
    check('sends the trimmed address, only to an account that exists', db.otp?.body?.email === 'sam@example.com' && db.otp?.body?.create_user === false, db.otp);
    check('the link comes back to this page', db.otp?.redirect === url, db.otp?.redirect);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'an expired sign-in link'() {
    const { page, close } = await newPage();
    await page.goto(`${url}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    check('says why the link failed',
      await shown(page.getByRole('alert').getByText('That link did not work: Email link is invalid or has expired')));
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
    check('the menu shows who is signed in', await page.getByText('@sam', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Sign out' }).click();
    check('goes back to the sign-in screen', await shown(page.getByRole('heading', { name: 'Welcome back' })));
    check('tells Supabase', db.calls.includes('POST /auth/v1/logout'), db.calls);
    const keys = await localKeys(page);
    check('leaves none of the account on this device', keys.every((k) => !k.startsWith(`orbit:@${USER.id}`)), keys);
    check('and no session', (await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)) === null);
    await page.reload();
    check('still signed out after a reload', await shown(page.getByRole('heading', { name: 'Welcome back' })));
    await close();
  },

  async 'creating an account'() {
    const { page, db, problems, close } = await newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Create account' }).click();
    check('asks for a name, username, email, password and birthday', await shown(page.getByRole('heading', { name: 'Create your Orbit' }))
      && await page.getByLabel('Your name').isVisible() && await page.getByLabel('Username').isVisible()
      && await page.getByLabel('Email').isVisible() && await page.getByLabel('Password', { exact: true }).isVisible()
      && await page.getByLabel('Birthday').isVisible());
    await page.getByRole('button', { name: 'Create account' }).last().click();
    check('an empty form says what each field needs', await page.getByText('Enter the name friends will see.').isVisible()
      && await page.getByText('Pick a username.').isVisible() && await page.getByText('Enter your email.').isVisible()
      && await page.getByText('At least 8 characters.').isVisible() && await page.getByText('Enter your birthday.').isVisible());
    check('and sends nothing', !db.signup);

    await page.getByLabel('Your name').fill('Bea Cho');
    await page.getByLabel('Username').fill('Bea');
    check('a taken username is caught as it is typed', await shown(page.getByText('That username is taken.')));
    await page.getByLabel('Username').fill('Bea_Cho');
    check('a free one says so', await shown(page.getByText('@bea_cho is free.')));
    await page.getByLabel('Email').fill('bea@example.com');
    await page.getByLabel('Password', { exact: true }).fill('short');
    check('a short password is caught', await page.getByText('At least 8 characters.').isVisible());
    await page.getByRole('button', { name: 'Show password' }).click();
    check('the password can be shown while typing', (await page.getByLabel('Password', { exact: true }).getAttribute('type')) === 'text');
    await page.getByLabel('Password', { exact: true }).fill('long enough pass');
    const twelve = new Date(); twelve.setFullYear(twelve.getFullYear() - 12);
    await page.getByLabel('Birthday').fill(twelve.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Create account' }).last().click();
    check('under 13 cannot sign up', await page.getByText('Orbit is for people 13 and older.').isVisible() && !db.signup);

    await page.getByLabel('Birthday').fill('2000-02-29');
    await page.getByRole('button', { name: 'Create account' }).last().click();
    check('asks them to confirm their email', await shown(page.getByRole('heading', { name: 'Confirm your email' }))
      && await page.getByText('bea@example.com').isVisible());
    const b = db.signup?.body;
    check('sends the account with its username (lowercase), name and birthday', b?.email === 'bea@example.com' && b?.password === 'long enough pass'
      && b?.data?.username === 'bea_cho' && b?.data?.display_name === 'Bea Cho' && b?.data?.birthday === '2000-02-29', b);
    check('and the confirmation link comes back here', db.signup?.redirect === url, db.signup?.redirect);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'logging in with a password'() {
    const { page, db, problems, close } = await newPage({ profile: PROFILE, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    await page.goto(url);
    await page.getByLabel('Email').fill('sam@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
    check('a wrong password says so plainly', await shown(page.getByRole('alert').getByText('That email and password do not match an account.')));
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
    check('the right one opens Orbit', await shown(page.getByText("Sam's Orbit")));
    check('with the email and password sent', db.login?.email === 'sam@example.com' && db.login?.password === PASSWORD);
    await page.getByRole('button', { name: 'More' }).click();
    check('the menu shows their username', await page.getByText('@sam').isVisible());
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'forgetting a password'() {
    const { page, db, close } = await newPage({ profile: PROFILE, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    await page.goto(url);
    await page.getByLabel('Email').fill('sam@example.com');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    check('the reset screen starts with the email already typed', await shown(page.getByRole('heading', { name: 'Reset your password' }))
      && (await page.getByLabel('Email').inputValue()) === 'sam@example.com');
    await page.getByRole('button', { name: 'Send the link' }).click();
    check('sends the reset link, back to this page', await shown(page.getByRole('heading', { name: 'Check your email' }))
      && db.recover?.body?.email === 'sam@example.com' && db.recover?.redirect === url, db.recover);
    check('without saying whether the account exists', await page.getByText('If there is an account for').isVisible());

    // Opening the link from the email.
    await page.goto(`${url}?fresh#access_token=test-access&refresh_token=test-refresh&expires_in=3600&expires_at=${Math.floor(Date.now() / 1000) + 3600}&token_type=bearer&type=recovery`);
    check('the link asks for a new password', await shown(page.getByRole('heading', { name: 'Choose a new password' })));
    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Save password' }).click();
    check('a short one is refused', await page.getByText('At least 8 characters.').isVisible() && !db.userUpdate);
    await page.getByLabel('New password').fill('a much better one');
    await page.getByRole('button', { name: 'Save password' }).click();
    check('a good one is saved and Orbit opens', await shown(page.getByText("Sam's Orbit")) && db.userUpdate?.password === 'a much better one', db.userUpdate);
    await close();
  },

  async 'an account with no username yet'() {
    const { page, db, problems, close } = await newPage({ signedIn: true, profile: null, rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } } });
    await page.goto(url);
    check('is asked for one before Orbit opens', await shown(page.getByRole('heading', { name: 'One more step' }))
      && !(await page.getByText("Robin's Orbit").isVisible()));
    check('with a username suggested from the email', (await page.getByLabel('Username').inputValue()) === 'sam');
    await page.getByLabel('Your name').fill('Sam Lee');
    await page.getByRole('button', { name: 'Continue' }).click();
    check('a birthday is still needed', await page.getByText('Enter your birthday.').isVisible() && !db.profile);
    await page.getByLabel('Birthday').fill('1994-05-06');
    await page.getByRole('button', { name: 'Continue' }).click();
    check('then Orbit opens', await shown(page.getByText("Robin's Orbit")));
    check('with the profile saved', db.profile?.username === 'sam' && db.profile?.display_name === 'Sam Lee' && db.profile?.birthday === '1994-05-06', db.profile);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'without the profiles table'() {
    // The app deployed before the setup script was run: Orbit still opens.
    const { page, close } = await newPage({ signedIn: true, rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } } });
    await page.route(`${SB}/rest/v1/profiles**`, (r) => r.fulfill({
      status: 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" }),
    }));
    await page.goto(url);
    check('Orbit opens without asking for a username', await shown(page.getByText("Robin's Orbit")));
    await close();
  },

  async 'account settings'() {
    const { page, db, problems, close } = await newPage({ signedIn: true, rows: { [USER.id]: { 'crm-owner-v1': 'Robin' } } });
    await page.goto(url);
    await shown(page.getByText("Robin's Orbit"));
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    check('shows the account', await shown(page.getByRole('heading', { name: 'Settings' }))
      && await page.getByText('@sam', { exact: true }).isVisible() && await page.getByText('sam@example.com · only you').isVisible()
      && await page.getByText('May 6, 1994 · only you').isVisible());

    await page.getByRole('button', { name: 'Change name' }).click();
    await page.getByLabel('Your name').fill('Sam Lee');
    await page.getByRole('button', { name: 'Save' }).click();
    check('the name can be changed', await shown(page.getByText('Sam Lee', { exact: true })) && db.profile.display_name === 'Sam Lee');

    await page.getByRole('button', { name: 'Change username' }).click();
    await page.getByLabel('Username').fill('bea');
    await page.getByRole('button', { name: 'Save' }).click();
    check('a taken username is refused', await shown(page.getByRole('alert').getByText('That username is taken.')) && db.profile.username === 'sam');
    await page.getByLabel('Username').fill('Sam.Lee');
    await page.getByRole('button', { name: 'Save' }).click();
    check('a free one is saved, lowercase', await shown(page.getByText('@sam.lee', { exact: true })) && db.profile.username === 'sam.lee');

    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Save' }).click();
    check('a short password is refused', await page.getByRole('alert').getByText('At least 8 characters.').isVisible() && !db.userUpdate);
    await page.getByLabel('New password').fill('a new long one');
    await page.getByRole('button', { name: 'Save' }).click();
    check('a good one is saved', await shown(page.getByText('Your password is saved.')) && db.userUpdate?.password === 'a new long one');

    await page.getByRole('button', { name: 'Change email' }).click();
    await page.getByLabel('New email').fill('sam@new.example.com');
    await page.getByRole('button', { name: 'Send the link' }).click();
    check('an email change sends a confirmation link', await shown(page.getByText('Check sam@new.example.com for a link'))
      && db.userUpdate?.email === 'sam@new.example.com');

    await page.getByRole('button', { name: 'Delete my account' }).click();
    check('deleting needs the username typed first', await page.getByRole('alert').getByText('Type sam.lee first.').isVisible() && !db.deleted);
    await page.getByLabel('Type sam.lee to confirm').fill('SAM.LEE');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    check('then deletes the account and signs out', await shown(page.getByRole('heading', { name: 'Welcome back' })) && db.deleted === true);
    const keys = await localKeys(page);
    check('leaving none of it on this device', keys.every((k) => !k.startsWith(`orbit:@${USER.id}`)), keys);
    check('no page errors', problems.length === 0, problems);
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
    check(`ran to the end (${err.message.split('\n').slice(0, 3).join(' / ')})`, false);
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
