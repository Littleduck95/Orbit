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
const newPage = async ({ signedIn = false, local = {}, rows = {}, profile = signedIn ? PROFILE : null, taken = ['bea'], others = [] } = {}) => {
  const db = {
    rows: new Map(Object.entries(rows).map(([u, kv]) => [u, new Map(Object.entries(kv))])), down: false, calls: [], profile, taken: new Set(taken),
    // Other people, as the friends functions hand them out: each with how
    // this user stands with them.
    others: others.map((o) => ({ ...o })), blocked: [],
  };
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
    if (u.pathname.startsWith('/rest/v1/rpc/') && ['search_profiles', 'get_profile', 'my_friends', 'send_friend_request',
      'respond_friend_request', 'remove_friend', 'block_user', 'unblock_user', 'my_blocks'].includes(u.pathname.slice(13))) {
      const fn = u.pathname.slice(13);
      const a = JSON.parse(req.postData() || '{}');
      const one = (id) => db.others.find((o) => o.id === id);
      const reply = (v) => r.fulfill({ status: 200, headers, body: JSON.stringify(v) });
      db.calls.push(`rpc ${fn} ${JSON.stringify(a)}`);
      if (fn === 'search_profiles') {
        const q = a.q.toLowerCase().replace(/^@/, '');
        return reply(db.others.filter((o) => o.username.startsWith(q) || o.display_name.toLowerCase().includes(q)));
      }
      if (fn === 'get_profile') return reply(db.others.find((o) => o.username === a.uname) || null);
      if (fn === 'my_friends') return reply(db.others.filter((o) => o.relation !== 'none'));
      if (fn === 'send_friend_request') { const o = one(a.target); o.relation = o.relation === 'received' ? 'friends' : 'sent'; return reply(o.relation); }
      if (fn === 'respond_friend_request') { const o = one(a.other); o.relation = a.accept ? 'friends' : 'none'; return reply(o.relation); }
      if (fn === 'remove_friend') { one(a.other).relation = 'none'; return reply('none'); }
      if (fn === 'block_user') {
        const o = one(a.other);
        db.blocked.push(o);
        db.others = db.others.filter((x) => x !== o);
        return reply(null);
      }
      if (fn === 'unblock_user') { db.blocked = db.blocked.filter((x) => x.id !== a.other); return reply(null); }
      if (fn === 'my_blocks') return reply(db.blocked.map(({ id, username, display_name }) => ({ id, username, display_name })));
    }
    if (u.pathname === '/rest/v1/notification_prefs') {
      if (req.method() === 'GET') return r.fulfill({ status: 200, headers, body: JSON.stringify(db.prefs ? [db.prefs] : []) });
      db.prefs = JSON.parse(req.postData());
      return r.fulfill({ status: 201, headers, body: '' });
    }
    if (u.pathname === '/rest/v1/push_subscriptions') {
      if (req.method() === 'POST') { db.subs = [...(db.subs || []), JSON.parse(req.postData())]; return r.fulfill({ status: 201, headers, body: '' }); }
      if (req.method() === 'DELETE') { db.subsDeleted = u.searchParams.get('endpoint'); db.subs = []; return r.fulfill({ status: 204, headers }); }
      return r.fulfill({ status: 200, headers, body: JSON.stringify(db.subs || []) });
    }
    if (u.pathname === '/functions/v1/notify') {
      db.notifyCalls = [...(db.notifyCalls || []), { auth: req.headers().authorization, body: JSON.parse(req.postData() || '{}') }];
      return r.fulfill({ status: 200, headers, body: JSON.stringify({ sent: (db.subs || []).length }) });
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

  async 'friends'() {
    const FULL = { ...PROFILE, pronouns: '', bio: '', location: '', phone: '', contact_email: '', website: '', socials: {}, visibility: {}, searchable: true };
    const others = [
      { id: 'b', username: 'bea', display_name: 'Bea Cho', relation: 'received', bio: 'Reads a lot' },
      { id: 'd', username: 'dora', display_name: 'Dora Diaz', relation: 'none', bio: 'Climbs' },
      { id: 'e', username: 'eli', display_name: 'Eli Park', relation: 'friends', phone: '816-555-0199', location: 'Kansas City', birthday: '1990-03-04',
        socials: { instagram: 'elipark' }, website: 'javascript:alert(1)' },
    ];
    const { page, db, mine, problems, close } = await newPage({ signedIn: true, profile: FULL, others, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    await page.goto(url);
    await shown(page.getByText("Sam's Orbit"));
    check('the menu button says a friend request is waiting', await shown(page.getByRole('button', { name: 'More, 1 friend request' })));
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Friends (1)' }).click();
    check('the Friends screen lists requests and friends', await shown(page.getByRole('heading', { name: 'Friends' }))
      && await page.getByText('Requests · 1').isVisible() && await page.getByText('Friends · 1').isVisible());

    await page.getByRole('button', { name: 'Accept' }).click();
    check('accepting a request makes them a friend', await shown(page.getByText('You and Bea Cho are friends.'))
      && db.others.find((o) => o.id === 'b').relation === 'friends' && await shown(page.getByText('Friends · 2')));
    check('and the menu stops counting it', !(await page.getByRole('button', { name: /friend request/ }).count()));

    const search = page.getByLabel('Search by username or name');
    await search.fill('d');
    check('search waits for two letters', await page.getByText('Keep typing: at least two letters.').isVisible());
    await search.fill('do');
    await shown(page.getByText('@dora'));
    await page.getByRole('button', { name: 'Add friend' }).click();
    check('a request can be sent from search', await shown(page.getByText('Asked Dora Diaz to be friends.')) && db.others.find((o) => o.id === 'd').relation === 'sent');
    check('and shows as sent', await shown(page.getByText('Sent · 1')));
    await search.fill('zz');
    check('a search with no one says so', await shown(page.getByText('No one found for “zz”.')));

    await page.getByRole('button', { name: 'My friend code' }).click();
    check('my friend code is a QR code', await shown(page.getByRole('img', { name: 'QR code to add @sam as a friend' })));

    await search.fill('');
    await page.getByRole('button', { name: /^Eli Park/ }).click();
    check('a friend\'s profile shows what they let friends see', await shown(page.getByText('816-555-0199'))
      && await page.getByText('Kansas City').isVisible() && await page.getByRole('link', { name: /Instagram elipark/ }).isVisible());
    check('a script posing as a website is never a link', !(await page.getByRole('link', { name: /Website/ }).count()));
    check('the Instagram link goes to Instagram', (await page.getByRole('link', { name: /Instagram/ }).getAttribute('href')) === 'https://instagram.com/elipark');
    await page.getByRole('button', { name: 'Save to my People' }).click();
    check('saving a friend opens the usual preview', await shown(page.getByRole('heading', { name: 'Eli Park' }))
      && await page.getByText('@eli sent you a contact', { exact: false }).isVisible());
    await page.getByRole('button', { name: 'Add Eli' }).click();
    await shown(page.getByText('From @eli'));
    const saved = JSON.parse(mine().get('crm-people-v1') || '[]');
    check('and adds them to People, with where they came from', saved.length === 1 && saved[0].name === 'Eli Park' && saved[0].phone === '816-555-0199'
      && saved[0].address === 'Kansas City' && saved[0].via?.by === '@eli' && !saved[0].note, saved);

    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Friends', exact: true }).click();
    await page.getByRole('button', { name: /^Dora Diaz/ }).click();
    await page.getByRole('button', { name: 'Cancel request' }).waitFor();
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    check('blocking asks first, and says what it does', await page.getByText('Block @dora? You will not be friends', { exact: false }).isVisible());
    await page.getByRole('button', { name: 'Block', exact: true }).first().click();
    check('then blocks them', await shown(page.getByText('Blocked @dora.')) && db.blocked.some((o) => o.id === 'd'));
    await page.getByText('Blocked people').click();
    await shown(page.getByText('@dora'));
    await page.getByRole('button', { name: 'Unblock' }).click();
    await page.waitForTimeout(200);
    check('and can unblock them', db.blocked.length === 0);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'opening a friend code'() {
    const FULL = { ...PROFILE, pronouns: '', bio: '', location: '', phone: '', contact_email: '', website: '', socials: {}, visibility: {}, searchable: true };
    const { page, db, close } = await newPage({
      signedIn: true, profile: FULL, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } },
      others: [{ id: 'd', username: 'dora', display_name: 'Dora Diaz', relation: 'none', bio: 'Climbs' }],
    });
    await page.goto(`${url}#add=dora`);
    check('opens their profile, ready to add', await shown(page.getByText('Climbs')) && await page.getByRole('button', { name: 'Add friend' }).isVisible());
    check('and takes the code out of the address', (await page.evaluate(() => window.location.hash)) === '');
    await page.getByRole('button', { name: 'Add friend' }).click();
    check('adding from there sends the request', await shown(page.getByText('Asked Dora Diaz to be friends.')) && db.others[0].relation === 'sent');
    await page.goto(`${url}?again#add=nobody`);
    check('an unknown code says so', await shown(page.getByText('No one called @nobody could be found.')));
    await close();
  },

  async 'a friend code opened while signed out'() {
    const { page, close } = await newPage();
    await page.goto(`${url}#add=dora`);
    await shown(page.getByRole('heading', { name: 'Welcome back' }));
    check('is held through sign-in', (await page.evaluate(() => localStorage.getItem('orbit-pending-share'))) === '#add=dora');
    await close();
  },

  async 'profile settings'() {
    const FULL = { ...PROFILE, pronouns: '', bio: '', location: 'Kansas City', phone: '', contact_email: '', website: '', socials: {}, visibility: {}, searchable: true };
    const { page, db, problems, close } = await newPage({ signedIn: true, profile: FULL, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    await page.goto(url);
    await shown(page.getByText("Sam's Orbit"));
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    check('says name and username always show, and the sign-in email never does', await shown(page.getByText('are always visible, so people can find you', { exact: false }))
      && await page.getByText('The email you sign in with is never shown.', { exact: false }).isVisible());
    check('private things start private', (await page.getByLabel('Who sees phone').inputValue()) === 'me'
      && (await page.getByLabel('Who sees email for friends').inputValue()) === 'me' && (await page.getByLabel('Who sees birthday').inputValue()) === 'friends');

    await page.getByLabel('About', { exact: true }).fill('Collects vinyl');
    await page.getByLabel('Phone', { exact: true }).fill('816-555-0123');
    await page.getByLabel('Instagram', { exact: true }).fill('@samspins');
    const preview = page.locator('div', { has: page.getByText('Preview', { exact: true }) }).last();
    check('the preview shows what someone new sees', await preview.getByText('Collects vinyl').isVisible()
      && !(await preview.getByText('Kansas City').isVisible()) && !(await preview.getByText('816-555-0123').isVisible()));
    await page.getByRole('button', { name: 'A friend', exact: true }).click();
    check('and what a friend sees', await preview.getByText('Kansas City').isVisible() && !(await preview.getByText('816-555-0123').isVisible()));

    await page.getByLabel('Website', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save profile' }).click();
    check('a website must be a web address', await shown(page.getByRole('alert').getByText('The website needs to be a web address', { exact: false })) && !db.profile.bio);
    await page.getByLabel('Website', { exact: true }).fill('sam.example.com');
    await page.getByLabel('Who sees phone').selectOption('friends');
    await page.getByRole('checkbox', { name: /Show me in search/ }).uncheck();
    await page.getByRole('button', { name: 'Save profile' }).click();
    check('saves', await shown(page.getByText('Your profile is saved.')));
    check('with each detail and who sees it', db.profile.bio === 'Collects vinyl' && db.profile.phone === '816-555-0123'
      && db.profile.website === 'https://sam.example.com/' && db.profile.socials?.instagram === 'samspins'
      && db.profile.visibility?.phone === 'friends' && db.profile.visibility?.bio === 'everyone' && db.profile.searchable === false, db.profile);
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'preferences and notifications'() {
    const FULL = { ...PROFILE, pronouns: '', bio: '', location: '', phone: '', contact_email: '', website: '', socials: {}, visibility: {}, searchable: true };
    const { page, db, mine, problems, close } = await newPage({ signedIn: true, profile: FULL, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    // A push service is out of reach here, so the browser's own sign-up for
    // push is stood in for: it hands back a device address and keys, as
    // Chrome's does, and everything around it is real.
    // Headless Chromium always says notifications are denied, so the
    // permission prompt is stood in for too: undecided, then allowed.
    await page.addInitScript(() => {
      let perm = 'default';
      window.Notification = class Notification {
        static get permission() { return perm; }
        static async requestPermission() { perm = 'granted'; window.__asked = true; return perm; }
      };
      let sub = null;
      const make = () => ({
        endpoint: 'https://push.example/device-1',
        toJSON: () => ({ endpoint: 'https://push.example/device-1', keys: { p256dh: 'BPUBKEY', auth: 'AUTHSECRET' } }),
        unsubscribe: async () => { sub = null; return true; },
      });
      PushManager.prototype.subscribe = async function subscribe(opts) {
        window.__pushOpts = { userVisibleOnly: opts.userVisibleOnly, keyLength: opts.applicationServerKey.length };
        sub = make();
        return sub;
      };
      PushManager.prototype.getSubscription = async () => sub;
    });
    await page.goto(url);
    await shown(page.getByText("Sam's Orbit"));
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Preferences' }).click();
    check('shows push as off for this device', await shown(page.getByText('Off for this device.')));

    await page.getByRole('button', { name: 'Turn on', exact: true }).click();
    check('turning it on asks the browser\'s permission and says so', await shown(page.getByText('Push is on for this device.'))
      && await page.evaluate(() => window.__asked === true));
    check('signs up with the site\'s public key, for visible notifications only', await page.evaluate(() => window.__pushOpts?.userVisibleOnly === true && window.__pushOpts?.keyLength === 65));
    const sub = db.subs?.[0];
    check('saves the device', sub?.endpoint === 'https://push.example/device-1' && sub?.p256dh === 'BPUBKEY' && sub?.auth === 'AUTHSECRET'
      && sub?.user_id === USER.id && /on /.test(sub?.device || ''), sub);
    check('and turns push on in their settings, in this device\'s time zone', db.prefs?.push === true && db.prefs?.time_zone === 'America/Chicago', db.prefs);

    await page.getByRole('button', { name: 'Send a test' }).click();
    check('a test goes to the notify function as the signed-in person', await shown(page.getByText('Sent. It should appear in a moment.'))
      && db.notifyCalls?.[0]?.body?.action === 'test' && db.notifyCalls[0].auth === 'Bearer test-access', db.notifyCalls);

    await page.getByRole('checkbox', { name: /Email me a digest/ }).check();
    await page.getByLabel('How often').selectOption('weekly');
    await page.getByRole('checkbox', { name: /^Check-ins/ }).uncheck();
    await page.getByLabel('When to hear about birthdays').selectOption('7');
    await page.getByLabel('Time of day').selectOption('8');
    await page.getByLabel('Quiet from').selectOption('21');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await shown(page.getByText('Saved.'));
    const pr = db.prefs;
    check('saves what, when and how', pr.email === true && pr.email_every === 'weekly' && pr.kinds.checkins === false && pr.kinds.birthdays === true
      && pr.birthday_days === 7 && pr.send_hour === 8 && pr.quiet_start === 21 && pr.quiet_end === 7, pr);

    await page.getByRole('button', { name: 'Turn off' }).click();
    check('turning it off forgets the device', await shown(page.getByText('Push is off for this device.')) && db.subsDeleted === 'eq.https://push.example/device-1', db.subsDeleted);

    await page.getByRole('button', { name: 'Orbit', exact: true }).click();
    await page.getByLabel('Open Orbit on').selectOption('reminders');
    await page.waitForTimeout(300);
    check('the theme and where Orbit opens are kept', mine().get('crm-theme-v1') === 'orbit' && mine().get('crm-start-v1') === 'reminders');
    await page.reload();
    check('and Orbit opens there next time', await shown(page.getByRole('heading', { name: 'Nothing to remember yet' })));
    check('no page errors', problems.length === 0, problems);
    await close();
  },

  async 'push on an iPhone outside the Home Screen'() {
    const FULL = { ...PROFILE, visibility: {}, socials: {} };
    const { page, close } = await newPage({ signedIn: true, profile: FULL, rows: { [USER.id]: { 'crm-owner-v1': 'Sam' } } });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
    });
    await page.goto(url);
    await shown(page.getByText("Sam's Orbit"));
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Preferences' }).click();
    check('explains adding Orbit to the Home Screen first', await shown(page.getByText('add Orbit to your Home Screen first', { exact: false }))
      && !(await page.getByRole('button', { name: 'Turn on', exact: true }).count()));
    await close();
  },

  async 'a push arriving at the service worker'() {
    // The headless shell cannot show notifications, so this uses the full
    // Chromium Playwright ships, and delivers a push through its DevTools.
    const full = await pw.chromium.launch({ channel: 'chromium' }).catch(() => null);
    if (!full) { check('full Chromium is available for this check', false); return; }
    try {
      const ctx = await full.newContext();
      await ctx.grantPermissions(['notifications'], { origin: new URL(url).origin });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
      await page.route(`${SB}/**`, (r) => r.abort());
      await page.goto(url);
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
      const cdp = await ctx.newCDPSession(page);
      const regs = [];
      cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
      await cdp.send('ServiceWorker.enable');
      await page.waitForTimeout(500);
      const push = (data) => cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(url).origin, registrationId: regs.find((r) => !r.isDeleted).registrationId, data });
      const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
        .map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: n.icon, url: n.data?.url })));
      await push(JSON.stringify({ title: 'Orbit: 2 things coming up', body: "Dana's birthday is tomorrow", tag: 'orbit-digest', url: 'https://elsewhere.example/' }));
      await page.waitForTimeout(800);
      const [n] = await shown();
      check('a push is shown as a notification', n?.title === 'Orbit: 2 things coming up' && n?.body === "Dana's birthday is tomorrow", n);
      check('with Orbit\'s icon', n?.icon === `${url}icon-192.png`, n?.icon);
      check('and tapping it only ever opens Orbit, whatever the push says', n?.url === url, n?.url);
      await push('not json at all');
      await page.waitForTimeout(800);
      check('a push that is not JSON still shows, as text', (await shown()).some((x) => x.title === 'Orbit' && x.body === 'not json at all'));
    } finally {
      await full.close();
    }
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
