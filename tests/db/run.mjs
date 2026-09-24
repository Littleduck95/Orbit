// Runs supabase/schema.sql against a real, throwaway PostgreSQL and checks
// the rules that keep each person's data their own. Run with `npm run test:db`.
//
// Needs PostgreSQL's own programs (initdb, pg_ctl, psql). It finds them on
// the PATH or under /usr/lib/postgresql, and says plainly when they are not
// there. The database lives in a temporary folder and is removed afterwards.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const findBin = () => {
  const onPath = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).stdout.trim();
  if (onPath) return path.dirname(onPath);
  const base = '/usr/lib/postgresql';
  if (!fs.existsSync(base)) return null;
  const v = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))[0];
  return v ? path.join(base, v, 'bin') : null;
};
const BIN = findBin();
if (!BIN) {
  console.error('PostgreSQL is not installed (initdb, pg_ctl, psql). Install it, then run again.');
  process.exit(2);
}

// PostgreSQL refuses to run as root, so as root the cluster belongs to the
// postgres user and every command runs as them.
const asRoot = process.getuid?.() === 0;
const dir = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'orbit-db-'));
if (asRoot) execFileSync('chown', ['postgres', dir]);
const run = (cmd, args, opts = {}) => (asRoot
  ? spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', [cmd, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')], { encoding: 'utf8', ...opts })
  : spawnSync(cmd, args, { encoding: 'utf8', ...opts }));
const PORT = String(5400 + Math.floor(Math.random() * 500));
const data = path.join(dir, 'data');
const must = (r, what) => { if (r.status !== 0) { console.error(`${what} failed:\n${r.stderr || r.stdout}`); process.exit(1); } };
must(run(path.join(BIN, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres']), 'initdb');
must(run(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-l', path.join(dir, 'log'), '-o', `-k ${dir} -p ${PORT} -c listen_addresses=`, 'start']), 'starting PostgreSQL');

const psql = (sql) => {
  const file = path.join(dir, `q-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
  if (asRoot) execFileSync('chown', ['postgres', file]);
  const r = run(path.join(BIN, 'psql'), ['-h', dir, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', file]);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
// Runs as a signed-in person (uid), a signed-out visitor ('anon'), or the
// database owner (no role), inside one transaction that is kept.
const as = (who, sql) => psql(who
  ? `begin;\nset local role ${who === 'anon' ? 'anon' : 'authenticated'};\n${who === 'anon' ? '' : `set local request.jwt.claim.sub = '${who}';\n`}${sql}\ncommit;`
  : sql);

const results = [];
const check = (name, cond, extra = '') => {
  results.push(Boolean(cond));
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond || !extra ? '' : `  — ${extra}`}`);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const meta = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const signUp = (id, m) => psql(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', '${id.slice(0, 4)}@example.com', ${meta(m)});`);

try {
  const stub = psql(fs.readFileSync(path.join(here, 'supabase-stub.sql'), 'utf8'));
  if (!stub.ok) throw new Error(`loading the Supabase stand-in failed: ${stub.err}`);
  // ORBIT_SCHEMA points at another copy, to check the tests catch a planted bug.
  const schema = fs.readFileSync(process.env.ORBIT_SCHEMA || path.join(root, 'supabase', 'schema.sql'), 'utf8');
  // supabase/check.sql, the read-only setup check: on an empty database,
  // then after each run below, it has to tell the truth.
  const checkSql = fs.readFileSync(path.join(root, 'supabase', 'check.sql'), 'utf8');
  const report = () => {
    const r = psql(checkSql);
    return r.ok ? r.out.split('\n').map((l) => l.split('|')) : [['check.sql failed', r.err]];
  };
  const before = report();
  check('the setup check runs on an empty database and reports everything missing',
    before.length === 18 && before.every(([, st]) => st.startsWith('MISSING')), before);
  // Part 1 alone, as it was merged, before friends existed.
  const partOne = schema.slice(0, schema.indexOf('-- Profiles as others see them.'));
  if (partOne.length < schema.length) {
    psql(`${partOne}\n`);
    const mid = report();
    check('after part 1 only, it reports part 1 OK and the rest missing',
      mid.slice(0, 8).every(([, st]) => st === 'OK') && mid.slice(8).every(([, st]) => st.startsWith('MISSING')), mid);
  }
  const first = psql(schema);
  check('the schema runs', first.ok, first.err);
  const again = psql(schema);
  check('and runs again without harm, as its header promises', again.ok, again.err);
  const after = report();
  check('after the whole schema, the setup check says OK to everything', after.length === 18 && after.every(([, st]) => st === 'OK'), after);

  // ---- signing up ----
  check('a password sign-up makes the profile in the same step',
    signUp(A, { username: 'Brock_B', display_name: '  Brock  ', birthday: '1998-04-02' }).ok
      && psql(`select username || '|' || display_name from public.profiles where id = '${A}'`).out === 'brock_b|Brock');
  check('a Google or email-link sign-in makes no profile, so Orbit can ask',
    signUp(C, { full_name: 'Casey' }).ok && psql(`select count(*) from public.profiles where id = '${C}'`).out === '0');
  const young = new Date(); young.setFullYear(young.getFullYear() - 12);
  const kid = signUp('44444444-4444-4444-8444-444444444444', { username: 'kiddo', display_name: 'Kid', birthday: young.toISOString().slice(0, 10) });
  check('under 13 cannot sign up, whatever the app sends', !kid.ok && /13 and older/.test(kid.err), kid.err);
  check('and no sign-in is left behind for them', psql("select count(*) from auth.users where id = '44444444-4444-4444-8444-444444444444'").out === '0');
  const taken = signUp('55555555-5555-4555-8555-555555555555', { username: 'BROCK_B', display_name: 'Other', birthday: '1990-01-01' });
  check('a username is taken whatever its case', !taken.ok && /duplicate key|unique/.test(taken.err), taken.err);
  const bad = signUp('66666666-6666-4666-8666-666666666666', { username: 'no spaces', display_name: 'X', birthday: '1990-01-01' });
  check('a malformed username is refused by the database too', !bad.ok);
  check('B signs up', signUp(B, { username: 'bea', display_name: 'Bea', birthday: '2000-01-01' }).ok);

  // ---- username lookups ----
  const avail = (who, name) => as(who, `select public.username_available('${name}');`).out.split('\n').pop();
  check('anyone can ask whether a username is free', avail('anon', 'newname') === 't' && avail('anon', 'Brock_B') === 'f' && avail(A, 'bea') === 'f');

  // ---- reading and changing profiles ----
  check('a person reads their own profile', as(A, 'select username from public.profiles;').out.split('\n').pop() === 'brock_b');
  check('and only their own', as(A, 'select count(*) from public.profiles;').out.split('\n').pop() === '1');
  const anonRead = as('anon', 'select * from public.profiles;');
  check('signed-out visitors cannot read profiles at all', !anonRead.ok && /permission denied/.test(anonRead.err), anonRead.err);
  as(A, `update public.profiles set display_name = 'Hacked' where id = '${B}';`);
  check('nobody can change someone else\'s profile', psql(`select display_name from public.profiles where id = '${B}'`).out === 'Bea');
  const forge = as(A, `insert into public.profiles (id, username, display_name, birthday) values ('${C}', 'forged', 'F', '1990-01-01');`);
  check('nobody can make a profile for someone else', !forge.ok && /row-level security/.test(forge.err), forge.err);
  check('a person without one can make their own', as(C, `insert into public.profiles (id, username, display_name, birthday) values ('${C}', 'casey', 'Casey', '1995-05-05');`).ok);
  check('and change their own username and name', as(A, `update public.profiles set username = 'brock', display_name = 'Brock B' where id = '${A}';`).ok
    && psql(`select username from public.profiles where id = '${A}'`).out === 'brock');
  const younger = as(A, `update public.profiles set birthday = current_date - interval '5 years' where id = '${A}';`);
  check('a birthday cannot be changed to under 13', !younger.ok && /13 and older/.test(younger.err), younger.err);
  const steal = as(C, "update public.profiles set username = 'bea' where id = (select auth.uid());");
  check('nobody can take a username in use', !steal.ok && /duplicate key/.test(steal.err), steal.err);

  // ---- saved data ----
  as(A, `insert into public.orbit_data (user_id, key, value) values ('${A}', 'crm-people-v1', '[1]');`);
  as(B, `insert into public.orbit_data (user_id, key, value) values ('${B}', 'crm-people-v1', '[2]');`);
  check('saved data stays with its owner', as(A, 'select value from public.orbit_data;').out.split('\n').pop() === '[1]');
  const plant = as(A, `insert into public.orbit_data (user_id, key, value) values ('${B}', 'crm-events-v1', '[]');`);
  check('nobody can write into someone else\'s data', !plant.ok, plant.err);

  // ---- profiles as others see them, and friends ----
  // B is 'bea', C is 'casey'. D (dora) is a stranger to everyone.
  const D = '77777777-7777-4777-8777-777777777777';
  check('D signs up', signUp(D, { username: 'dora', display_name: 'Dora Diaz', birthday: '1992-02-02' }).ok);
  const vis = { pronouns: 'everyone', bio: 'everyone', location: 'friends', birthday: 'friends', phone: 'me', contact_email: 'friends', socials: 'everyone', website: 'bogus' };
  check('a person fills in their profile and chooses who sees each part', as(B, `update public.profiles set pronouns = 'she/her', bio = 'Reads a lot', location = 'Kansas City',
    phone = '816-555-0100', contact_email = 'bea@contact.example', website = 'https://bea.example',
    socials = '{"instagram":"beareads","myspace":"tom","x":42}'::jsonb, visibility = '${JSON.stringify(vis)}'::jsonb where id = '${B}';`).ok);
  check('unknown socials and settings are dropped on the way in',
    psql(`select socials::text || '|' || (visibility ? 'website')::text from public.profiles where id = '${B}'`).out === '{"instagram": "beareads"}|false');
  const badSite = as(B, `update public.profiles set website = 'javascript:alert(1)' where id = '${B}';`);
  check('a website has to be a web link', !badSite.ok, badSite.err);

  const view = (who, name) => JSON.parse(as(who, `select public.get_profile('${name}');`).out.split('\n').pop() || 'null');
  const stranger = view(D, 'bea');
  check('a stranger sees the username, name and what is set to everyone', stranger.username === 'bea' && stranger.display_name === 'Bea'
    && stranger.bio === 'Reads a lot' && stranger.pronouns === 'she/her' && stranger.socials?.instagram === 'beareads' && stranger.relation === 'none');
  check('and nothing set to friends or only me', !('location' in stranger) && !('birthday' in stranger) && !('contact_email' in stranger)
    && !('phone' in stranger), stranger);
  check('a setting that is not there counts as only me', !('website' in stranger));
  check('the sign-in email is never part of a profile', !JSON.stringify(stranger).includes('@example.com'));

  // ---- search ----
  const search = (who, q) => as(who, `select public.search_profiles('${q}');`).out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l).username);
  check('search finds usernames by their start, and names by any part', search(D, 'be').join() === 'bea' && search(D, 'cas').join() === 'casey'
    && search(D, 'ey').join() === 'casey' && search(D, '@BE').join() === 'bea', [search(D, 'be'), search(D, 'ey')]);
  check('search needs at least two letters', search(D, 'b').length === 0);
  check('search never shows yourself', !search(B, 'bea').includes('bea'));
  check('a % or _ in a search is taken literally', search(D, '%%').length === 0 && search(D, '__').length === 0);
  as(C, `update public.profiles set searchable = false where id = '${C}';`);
  check('someone hidden from search is not found', search(D, 'cas').length === 0);
  check('but still opens from their exact username, as their QR code does', view(D, 'casey')?.username === 'casey');
  const anonSearch = as('anon', "select public.search_profiles('be');");
  check('signed-out visitors cannot search', !anonSearch.ok, anonSearch.err);

  // ---- requests ----
  const call = (who, fn) => as(who, `select public.${fn};`);
  const rel = (who, other) => view(who, other)?.relation;
  check('asking to be friends leaves a request', call(D, `send_friend_request('${B}')`).out.endsWith('sent')
    && rel(D, 'bea') === 'sent' && rel(B, 'dora') === 'received');
  check('asking again changes nothing', call(D, `send_friend_request('${B}')`).out.endsWith('sent')
    && psql(`select count(*) from public.friendships`).out === '1');
  check('a request is not yet friendship', !('location' in view(D, 'bea')));
  check('nobody can ask themselves', !call(D, `send_friend_request('${D}')`).ok);
  const list = (who) => as(who, 'select public.my_friends();').out.split('\n').filter((l) => l.startsWith('{')).map(JSON.parse);
  check('both see the request in their list', list(B).some((f) => f.username === 'dora' && f.relation === 'received')
    && list(D).some((f) => f.username === 'bea' && f.relation === 'sent'));
  check('accepting makes them friends', call(B, `respond_friend_request('${D}', true)`).out.endsWith('friends') && rel(D, 'bea') === 'friends');
  const friendView = view(D, 'bea');
  check('a friend sees what is set to friends', friendView.location === 'Kansas City' && friendView.birthday === '2000-01-01'
    && friendView.contact_email === 'bea@contact.example', friendView);
  check('but still not what is set to only me', !('phone' in friendView));
  check('a person always sees all of their own', view(B, 'bea').phone === '816-555-0100');

  check('if they already asked you, asking back accepts', call(C, `send_friend_request('${D}')`).ok
    && call(D, `send_friend_request('${C}')`).out.endsWith('friends'));
  check('declining a request removes it quietly', call(B, `send_friend_request('${C}')`).ok && call(C, `respond_friend_request('${B}', false)`).out.endsWith('none')
    && rel(B, 'casey') === 'none');
  check('a sent request can be taken back', call(B, `send_friend_request('${C}')`).ok && call(B, `remove_friend('${C}')`).ok && rel(C, 'bea') === 'none');
  check('only the person asked can accept', call(B, `send_friend_request('${C}')`).ok && call(B, `respond_friend_request('${C}', true)`).ok
    && rel(B, 'casey') === 'sent');
  check('unfriending ends it for both', call(C, `remove_friend('${D}')`).ok && rel(D, 'casey') === 'none' && rel(C, 'dora') === 'none');

  // ---- blocking ----
  check('blocking ends a friendship', call(B, `block_user('${D}')`).ok && psql(`select count(*) from public.friendships where '${D}' in (requester, addressee) and '${B}' in (requester, addressee)`).out === '0');
  check('and hides each from the other, both ways', view(D, 'bea') === null && view(B, 'dora') === null && search(D, 'be').length === 0 && search(B, 'do').length === 0);
  check('a blocked person cannot ask again', !call(D, `send_friend_request('${B}')`).ok);
  check('the blocker sees who they blocked', as(B, 'select public.my_blocks();').out.includes('"dora"'));
  check('unblocking lets them find each other again', call(B, `unblock_user('${D}')`).ok && view(D, 'bea')?.username === 'bea');

  // ---- no way round the functions ----
  const direct = as(B, 'select * from public.friendships;');
  check('friendships cannot be read directly', !direct.ok && /permission denied/.test(direct.err), direct.err);
  const forged = as(D, `insert into public.friendships (requester, addressee, status) values ('${D}', '${B}', 'accepted');`);
  check('nor made directly', !forged.ok, forged.err);
  const peek = as(D, `select phone from public.profiles where id = '${B}';`);
  check('nor can another profile be read around its settings', peek.ok && peek.out.split('\n').pop() !== '816-555-0100', peek.out);
  const inner = as(D, `select public.profile_for(p, '${B}') from public.profiles p;`);
  check('and the function that decides what shows cannot be called with someone else as the viewer', !inner.ok, inner.err);

  // ---- notifications ----
  check('a person saves their notification settings', as(B, `insert into public.notification_prefs (user_id, push, send_hour, time_zone, kinds)
    values ('${B}', true, 8, 'America/Chicago', '{"birthdays": false, "junk": true, "events": "yes"}'::jsonb);`).ok);
  check('only the known kinds are kept, each on or off', psql(`select kinds::text from public.notification_prefs where user_id = '${B}'`).out
    === '{"events": true, "checkins": true, "birthdays": false, "reminders": true, "friend_requests": true}');
  const hour = as(B, `update public.notification_prefs set send_hour = 25 where user_id = '${B}';`);
  check('a send hour must be a real hour', !hour.ok);
  check('nobody reads someone else\'s settings', as(D, 'select count(*) from public.notification_prefs;').out.split('\n').pop() === '0');
  const forgePrefs = as(D, `insert into public.notification_prefs (user_id, email) values ('${B}', true);`);
  check('nor makes them', !forgePrefs.ok && /row-level security/.test(forgePrefs.err), forgePrefs.err);
  check('a device turns push on', as(B, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/abc', 'key', 'secret');`).ok
    && psql(`select user_id from public.push_subscriptions`).out === B);
  const httpSub = as(B, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('http://push.example/x', 'k', 's');`);
  check('a push address must be https', !httpSub.ok);
  check('nobody sees someone else\'s devices', as(D, 'select count(*) from public.push_subscriptions;').out.split('\n').pop() === '0');
  const stealSub = as(D, `update public.push_subscriptions set user_id = '${D}' where endpoint = 'https://push.example/abc';`);
  check('nor takes them over', stealSub.ok && psql(`select user_id from public.push_subscriptions`).out === B);
  const readLog = as(B, 'select * from public.notification_log;');
  check('the sent log is not for reading', !readLog.ok && /permission denied/.test(readLog.err), readLog.err);
  check('turning push off removes the device', as(B, "delete from public.push_subscriptions where endpoint = 'https://push.example/abc';").ok
    && psql('select count(*) from public.push_subscriptions').out === '0');

  // ---- deleting an account ----
  const anonDel = as('anon', 'select public.delete_my_account();');
  check('a signed-out visitor cannot delete anything', !anonDel.ok, anonDel.err);
  check('a person can delete their own account', as(A, 'select public.delete_my_account();').ok);
  check('which removes their sign-in, profile and saved data', psql(`select (select count(*) from auth.users where id = '${A}') + (select count(*) from public.profiles where id = '${A}') + (select count(*) from public.orbit_data where user_id = '${A}')`).out === '0');
  check('and nobody else\'s', psql(`select (select count(*) from public.profiles where id = '${B}') + (select count(*) from public.orbit_data where user_id = '${B}')`).out === '2');
} finally {
  run(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} database checks passed`);
process.exit(failed ? 1 : 0);
