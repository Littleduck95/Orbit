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
    before.length === 27 && before.every(([, st]) => st.startsWith('MISSING')), before);
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
  check('after the whole schema, the setup check says OK to everything', after.length === 27 && after.every(([, st]) => st === 'OK'), after);

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
    === '{"events": true, "checkins": true, "birthdays": false, "reminders": true, "likes_comments": true, "friend_activity": true, "friend_requests": true}',
    psql(`select kinds::text from public.notification_prefs where user_id = '${B}'`).out);
  check('friends\' activity, likes and comments start on', psql("select column_default from information_schema.columns where table_name = 'notification_prefs' and column_name = 'kinds'").out.includes('"friend_activity": true')
    && psql("select column_default from information_schema.columns where table_name = 'notification_prefs' and column_name = 'kinds'").out.includes('"likes_comments": true'));
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

  // ---- the shared catalog ----
  const one = (who, sql) => { const r = as(who, sql); return r.ok ? JSON.parse(r.out.split('\n').pop() || 'null') : { error: r.err }; };
  const add = (who, kind, name, source, sid, about = '') => one(who, `select public.catalog_add('${kind}', '${name}', '${about}', '${source}', ${sid === null ? 'null' : `'${sid}'`});`);
  const anonAdd = as('anon', "select public.catalog_add('team', 'X', '', 'orbit', null);");
  check('signed-out visitors cannot add to the catalog', !anonAdd.ok, anonAdd.err);
  for (const fn of ["catalog_search('ch')", "sync_outings('[]'::jsonb)"]) {
    check(`nor call ${fn.split('(')[0]}`, !as('anon', `select public.${fn};`).ok);
  }
  const chiefs = add(A, 'team', 'Kansas City Chiefs', 'wikidata', 'Q223455', 'NFL team in Kansas City');
  const arrowhead = add(A, 'venue', 'Arrowhead Stadium', 'wikidata', 'Q1128848');
  check('an entry from Wikidata is added', chiefs.id && chiefs.name === 'Kansas City Chiefs' && chiefs.about === 'NFL team in Kansas City', chiefs);
  check('and never says who added it', !JSON.stringify(chiefs).includes(A) && !('created_by' in chiefs));
  const again2 = add(B, 'team', 'Renamed Chiefs', 'wikidata', 'Q223455');
  check('the same Wikidata item is the same entry for everyone, and keeps its name', again2.id === chiefs.id && again2.name === 'Kansas City Chiefs', again2);
  check('a made-up Wikidata id is refused', /not a Wikidata item/.test(add(A, 'team', 'X', 'wikidata', 'Q0; drop').error || ''));
  check('as is an unknown kind', /Unknown kind/.test(add(A, 'car', 'X', 'orbit', null).error || ''));
  check('and a blank name', /needs a name/.test(add(A, 'team', '   ', 'orbit', null).error || ''));
  const rackets = add(A, 'performer', 'The Rackets', 'orbit', 'ignored');
  const rackets2 = add(B, 'performer', '  the   RACKETS ', 'orbit', null);
  check('an entry made in Orbit is matched by kind and name, whatever the case or spacing', rackets.id && rackets2.id === rackets.id && rackets.source_id === 'performer:the rackets', [rackets, rackets2]);
  check('but the same name as another kind is another entry', add(A, 'venue', 'The Rackets', 'orbit', null).id !== rackets.id);

  const readCat = as(D, 'select * from public.catalog;');
  check('the catalog cannot be read directly', !readCat.ok && /permission denied/.test(readCat.err), readCat.err);
  const plantOuting = as(D, `insert into public.outings (user_id, event_id, kind, title, on_date, visibility) values ('${A}', 'x', 'Sports', 'x', '2026-01-01', 'everyone');`);
  check('nor can outings be written directly', !plantOuting.ok && /permission denied/.test(plantOuting.err), plantOuting.err);

  // A and B are friends; D is a stranger to A.
  check('A and B become friends', call(A, `send_friend_request('${B}')`).ok && call(B, `respond_friend_request('${A}', true)`).out.endsWith('friends'));
  const items = [
    { event_id: 'e1', kind: 'Sports', title: 'Chiefs vs Broncos', date: '2026-01-05', rating: 4.5, review: 'Loud', visibility: 'everyone', links: [chiefs.id, arrowhead.id] },
    { event_id: 'e2', kind: 'Concert', title: 'Rackets at the Record Bar', date: '2026-02-01', rating: 3, review: 'Tight set', visibility: 'friends', links: [rackets.id] },
    { event_id: 'e3', kind: 'Sports', title: 'Next season', date: '2099-09-01', visibility: 'everyone', links: [chiefs.id] },
    { event_id: 'e4', kind: 'Sports', title: 'No links', date: '2026-01-01', visibility: 'everyone', links: [] },
    { event_id: 'e5', kind: 'Sports', title: 'Odd rating', date: '2026-01-01', rating: 3.3, visibility: 'everyone', links: [chiefs.id] },
    { event_id: 'e6', kind: 'Sports', title: 'Bad link', date: '2026-01-01', visibility: 'everyone', links: ['not-a-uuid', D] },
    { event_id: 'e7', kind: 'Sports', title: 'Private', date: '2026-01-01', visibility: 'me', links: [chiefs.id] },
    { event_id: 'e8', kind: 'Birthday', title: 'Not an outing', date: '2026-01-01', visibility: 'everyone', links: [chiefs.id] },
  ];
  const sync = (who, list) => as(who, `select public.sync_outings('${JSON.stringify(list).replace(/'/g, "''")}'::jsonb);`);
  const synced = sync(A, items);
  check('sharing keeps only well-formed outings that have happened and link to something known', synced.ok && synced.out.split('\n').pop() === '2', synced.out || synced.err);
  const page = (who, id) => one(who, `select public.catalog_page('${id}');`);
  const seenD = page(D, chiefs.id);
  check('a stranger sees an outing shared with everyone, and who logged it', seenD.outings.length === 1
    && seenD.outings[0].by.username === 'brock' && seenD.outings[0].review === 'Loud' && seenD.outings[0].rating === 4.5, seenD);
  check('with what else it links to, but not the page itself', seenD.outings[0].links.map((l) => l.name).join() === 'Arrowhead Stadium');
  check('and the rating counts towards the average and the spread', seenD.ratings === 1 && seenD.average === 4.5 && seenD.spread[8] === 1 && seenD.spread.length === 10, seenD);
  const racketsD = page(D, rackets.id);
  check('a stranger sees nothing shared with friends only', racketsD.outings.length === 0 && racketsD.ratings === 0 && racketsD.average === null, racketsD);
  const racketsB = page(B, rackets.id);
  check('a friend does', racketsB.outings.length === 1 && racketsB.outings[0].by.relation === 'friends', racketsB);
  check('but a friends-only rating never counts towards the public average', racketsB.ratings === 0 && racketsB.average === null);
  check('the owner sees their own as "self"', page(A, rackets.id).outings[0]?.by.relation === 'self');
  const findCat = (who, q, kind = null) => as(who, `select public.catalog_search('${q}', ${kind ? `'${kind}'` : 'null'});`).out.split('\n').filter((l) => l.startsWith('{')).map(JSON.parse);
  const found = findCat(D, 'chie');
  check('search finds entries by any part of the name, with how many outings and the average', found.length === 1 && found[0].outings === 1 && found[0].average === 4.5, found);
  check('search counts only the outings this viewer may see', findCat(D, 'rack', 'performer')[0]?.outings === 0 && findCat(B, 'rack', 'performer')[0]?.outings === 1);
  check('search can be narrowed to one kind', findCat(D, 'rack', 'venue').every((e) => e.kind === 'venue') && findCat(D, 'rack', 'venue').length === 1);
  check('a % in a catalog search is taken literally', findCat(D, '%%').length === 0);
  check('A blocks D', call(D, `block_user('${A}')`).ok);
  const blockedPage = page(D, chiefs.id);
  check('a block hides outings and their ratings, both ways', blockedPage.outings.length === 0 && blockedPage.ratings === 0, blockedPage);
  check('D unblocks', call(D, `unblock_user('${A}')`).ok);
  check('sharing again replaces what was there', sync(A, [items[1]]).out.split('\n').pop() === '1' && page(D, chiefs.id).outings.length === 0);
  const noProfile = '88888888-8888-4888-8888-888888888888';
  signUp(noProfile, { full_name: 'No Name' });
  const early = sync(noProfile, [items[0]]);
  check('sharing needs a username first', !early.ok && /username/.test(early.err), early.err);
  check('share one with everyone again', sync(A, items).ok);

  // ---- public pages ----
  const pub = (who, name, year = null) => one(who, `select public.public_profile('${name}', ${year === null ? 'null' : year});`);
  const hiddenPage = pub('anon', 'brock');
  check('a signed-out visitor sees only the name of a page that is not public', hiddenPage.hidden === true
    && JSON.stringify(Object.keys(hiddenPage.profile).sort()) === '["display_name","username"]' && !('outings' in hiddenPage), hiddenPage);
  const anonCat = page('anon', chiefs.id);
  check('nor its outings on a catalog page, even those shared with everyone', anonCat.outings.length === 0 && anonCat.ratings === 0, anonCat);
  check('an unknown username has no page', pub(D, 'nobody_here') === null && pub('anon', 'nobody_here') === null);

  const tripItems = [
    { trip_id: 't1', title: 'Lisbon', start: '2025-05-10', end: '2025-05-17', rating: 4.5, highlight: 'Tram 28',
      stops: [{ name: 'Lisbon', lat: 38.72231, lng: -9.13934, country: 'Portugal', state: '' }, { name: 'Bad', lat: 999, lng: 0 }] },
    { trip_id: 't2', title: 'Later', start: '2099-01-01', stops: [] },
    { trip_id: 't4', title: 'Still away', start: '2020-01-01', end: '2099-01-01', stops: [] },
    { trip_id: 't3', title: 'Bad dates', start: '2025-05-10', end: '2025-05-01', stops: [] },
  ];
  const syncTrips = (who, list) => as(who, `select public.sync_trips('${JSON.stringify(list).replace(/'/g, "''")}'::jsonb);`);
  check('trips set to only me are never kept', syncTrips(A, tripItems).out.split('\n').pop() === '0'
    && psql(`select count(*) from public.shared_trips where user_id = '${A}'`).out === '0');
  check('A shows trips to friends', as(A, `update public.profiles set visibility = visibility || '{"trips":"friends"}'::jsonb where id = '${A}';`).ok);
  check('then trips that are over are kept; ones still going, to come, or malformed are not', syncTrips(A, tripItems).out.split('\n').pop() === '1');
  check('each stop keeps a position rounded to about a kilometre, and bad stops are dropped',
    psql(`select stops::text from public.shared_trips where user_id = '${A}'`).out === '[{"lat": 38.72, "lng": -9.14, "name": "Lisbon", "state": "", "country": "Portugal"}]',
    psql(`select stops::text from public.shared_trips where user_id = '${A}'`).out);
  const byFriend = pub(B, 'brock');
  check('a friend sees the trips and every outing they may see', byFriend.trips.length === 1 && byFriend.trips[0].highlight === 'Tram 28'
    && byFriend.outings.length === 2 && byFriend.profile.relation === 'friends', byFriend);
  check('with the years there is anything in', JSON.stringify(byFriend.years) === '[2026,2025]', byFriend.years);
  check('outings carry what they link to', byFriend.outings.find((o) => o.id === 'e1')?.links.map((l) => l.name).sort().join() === 'Arrowhead Stadium,Kansas City Chiefs');
  const year = pub(B, 'brock', 2025);
  check('one year shows only that year', year.trips.length === 1 && year.outings.length === 0 && year.year === 2025, year);
  const byStranger = pub(D, 'brock');
  check('a stranger sees outings shared with everyone, not trips shown to friends', byStranger.outings.length === 1 && byStranger.trips.length === 0, byStranger);
  check('and the owner sees all of their own', pub(A, 'brock').outings.length === 2 && pub(A, 'brock').trips.length === 1);

  check('A opens the page to the web', as(A, `update public.profiles set public_page = true where id = '${A}';`).ok);
  const open = pub('anon', 'brock');
  check('now a signed-out visitor sees what is shared with everyone', open.hidden === false && open.outings.length === 1 && open.outings[0].id === 'e1'
    && open.trips.length === 0, open);
  check('and the profile details set to everyone only', open.profile.username === 'brock' && !('birthday' in open.profile) && open.profile.relation === 'none', open.profile);
  const anonCat2 = page('anon', chiefs.id);
  check('and the outing on the catalog page, counted in the average', anonCat2.outings.length === 1 && anonCat2.ratings === 1 && anonCat2.outings[0].by.relation === 'none', anonCat2);
  check('trips shown to everyone reach signed-out visitors too', as(A, `update public.profiles set visibility = visibility || '{"trips":"everyone"}'::jsonb where id = '${A}';`).ok
    && pub('anon', 'brock').trips.length === 1);
  check('A blocks D', call(A, `block_user('${D}')`).ok);
  check('a block hides the page both ways', pub(D, 'brock') === null && pub(A, 'dora') === null);
  check('A unblocks D', call(A, `unblock_user('${D}')`).ok);
  check('A sets trips back to only me', as(A, `update public.profiles set visibility = visibility || '{"trips":"me"}'::jsonb where id = '${A}';`).ok);
  check('then nobody else sees them, even before the next sync', pub(B, 'brock').trips.length === 0 && pub('anon', 'brock').trips.length === 0);
  check('and the next sync clears them', syncTrips(A, tripItems).out.split('\n').pop() === '0' && psql(`select count(*) from public.shared_trips where user_id = '${A}'`).out === '0');
  check('signed-out visitors cannot share trips', !as('anon', "select public.sync_trips('[]'::jsonb);").ok);
  const readTrips = as(B, 'select * from public.shared_trips;');
  check('shared trips cannot be read directly', !readTrips.ok && /permission denied/.test(readTrips.err), readTrips.err);
  check('an unknown visibility setting is still dropped', as(A, `update public.profiles set visibility = visibility || '{"trips":"nope"}'::jsonb where id = '${A}';`).ok
    && psql(`select visibility ? 'trips' from public.profiles where id = '${A}'`).out === 'f');
  check('show trips to friends again, for deleting below', as(A, `update public.profiles set visibility = visibility || '{"trips":"friends"}'::jsonb where id = '${A}';`).ok
    && syncTrips(A, tripItems).out.split('\n').pop() === '1');

  // ---- the friends feed ----
  const feed = (who, lim = 30, cursor = null) => {
    const r = as(who, `select public.friend_feed(${cursor ? `'${cursor.at}'` : 'null'}, ${cursor ? `'${cursor.id}'` : 'null'}, ${lim});`);
    return r.ok ? r.out.split('\n').filter((l) => l.startsWith('{')).map(JSON.parse) : { error: r.err };
  };
  check('signed-out visitors have no feed', !as('anon', 'select public.friend_feed();').ok);
  check('A shares one outing with everyone, one with friends, and a trip with friends', sync(A, items).ok && syncTrips(A, tripItems).ok);
  const fb = feed(B);
  check('a friend\'s feed has their outings, both kinds, and trips shown to friends', fb.length === 3
    && fb.filter((x) => x.type === 'outing').map((x) => x.title).sort().join('|') === 'Chiefs vs Broncos|Rackets at the Record Bar'
    && fb.some((x) => x.type === 'trip' && x.title === 'Lisbon' && x.highlight === 'Tram 28'), fb);
  check('each says who and when, and what an outing links to', fb.every((x) => x.by.username === 'brock' && x.by.display_name && x.at && x.id)
    && fb.find((x) => x.title === 'Chiefs vs Broncos').links.length === 2, fb);
  check('a stranger\'s feed is empty, even of what is shared with everyone', feed(D).length === 0);
  check('your own things are not in your feed', feed(A).length === 0);
  const stamp = () => psql(`select created_at || '|' || updated_at from public.outings where user_id = '${A}' and event_id = 'e1'`).out;
  const firstStamp = stamp();
  check('sharing the same set again keeps when each was first shared, and when it last changed', sync(A, items).ok && stamp() === firstStamp, [firstStamp, stamp()]);
  const changed = items.map((x) => (x.event_id === 'e1' ? { ...x, rating: 5 } : x));
  check('a change moves only when it last changed', sync(A, changed).ok && stamp().split('|')[0] === firstStamp.split('|')[0]
    && stamp().split('|')[1] !== firstStamp.split('|')[1], [firstStamp, stamp()]);
  const broken = items.map((x) => (x.event_id === 'e1' ? { ...x, rating: 3.3 } : x));
  check('an outing that goes wrong on a later sync is taken down, not left as it was', sync(A, broken).ok
    && psql(`select count(*) from public.outings where user_id = '${A}' and event_id = 'e1'`).out === '0');
  check('and comes back with the next good sync', sync(A, items).ok && feed(B).length === 3);
  const tripStamp = () => psql(`select created_at from public.shared_trips where user_id = '${A}' and trip_id = 't1'`).out;
  const t0 = tripStamp();
  check('trips keep when they were first shown too', syncTrips(A, tripItems).ok && tripStamp() === t0);

  const p1 = feed(B, 2);
  const p2 = feed(B, 2, p1[1]);
  check('the feed comes a page at a time, carrying on where it left off', p1.length === 2 && p2.length === 1
    && new Set([...p1, ...p2].map((x) => x.id)).size === 3, [p1.map((x) => x.id), p2.map((x) => x.id)]);
  const ordered = feed(B);
  check('newest first', ordered.every((x, i) => i === 0 || x.at <= ordered[i - 1].at));
  check('trips kept to only me leave the feed at once', as(A, `update public.profiles set visibility = visibility || '{"trips":"me"}'::jsonb where id = '${A}';`).ok
    && feed(B).every((x) => x.type !== 'trip'));
  as(A, `update public.profiles set visibility = visibility || '{"trips":"friends"}'::jsonb where id = '${A}';`);
  check('a block ends the friendship, and with it the feed', call(B, `block_user('${A}')`).ok && feed(B).length === 0);
  check('B unblocks A', call(B, `unblock_user('${A}')`).ok);

  // ---- likes and comments ----
  const like = (who, owner, kind, ref, on = true) => one(who, `select public.like_post('${owner}', '${kind}', '${ref}', ${on});`);
  const comment = (who, owner, kind, ref, body) => one(who, `select public.comment_post('${owner}', '${kind}', '${ref}', '${body.replace(/'/g, "''")}');`);
  const thread = (who, owner, kind, ref) => one(who, `select public.post_thread('${owner}', '${kind}', '${ref}');`);
  check('A and B are friends again (the block above ended it)', call(A, `send_friend_request('${B}')`).ok
    && call(B, `respond_friend_request('${A}', true)`).out.endsWith('friends'));
  check('A shares again: e1 with everyone, e2 with friends, and a trip with friends', sync(A, items).ok && syncTrips(A, tripItems).ok);
  const dl = like(D, A, 'outing', 'e1');
  check('a stranger can like what is shared with everyone', dl.likes === 1 && dl.liked === true, dl);
  check('but not what is shared with friends', /not there/.test(like(D, A, 'outing', 'e2').error || '') && /not there/.test(like(D, A, 'trip', 't1').error || ''));
  check('a friend can like both', like(B, A, 'outing', 'e2').likes === 1 && like(B, A, 'trip', 't1').likes === 1);
  check('liking twice is still one like', like(D, A, 'outing', 'e1').likes === 1);
  check('and a like can be taken back', like(D, A, 'outing', 'e1', false).likes === 0 && like(D, A, 'outing', 'e1').likes === 1);
  check('signed-out visitors cannot like or comment', !as('anon', `select public.like_post('${A}', 'outing', 'e1', true);`).ok
    && !as('anon', `select public.comment_post('${A}', 'outing', 'e1', 'hi');`).ok);
  const c1 = comment(B, A, 'outing', 'e1', 'Great game!');
  check('a comment says who wrote it', c1.body === 'Great game!' && c1.by.username === 'bea' && c1.mine === true, c1);
  check('an empty or overlong comment is refused', /1 to 1000/.test(comment(B, A, 'outing', 'e1', '   ').error || '')
    && /1 to 1000/.test(comment(B, A, 'outing', 'e1', 'x'.repeat(1001)).error || ''));
  check('nobody comments on what they cannot see', /not there/.test(comment(D, A, 'outing', 'e2', 'hm').error || ''));
  const byOwner = thread(A, A, 'outing', 'e1');
  check('the owner sees the thread, and may take any comment down', byOwner.thread.length === 1 && byOwner.thread[0].can_delete === true
    && byOwner.thread[0].mine === false && byOwner.likers.map((l) => l.username).join() === 'dora', byOwner);
  const threadD = thread(D, A, 'outing', 'e1');
  check('others see it, but may only take down their own', threadD.thread[0].can_delete === false && threadD.liked === true);
  check('nobody gets the thread of what they cannot see', thread(D, A, 'outing', 'e2') === null);
  check('signed-out visitors get no thread', !as('anon', `select public.post_thread('${A}', 'outing', 'e1');`).ok);
  const inFeed = feed(B).find((x) => x.ref === 'e1');
  check('the feed carries whose post it is, and its likes and comments', inFeed?.owner === A && inFeed.post === 'outing' && inFeed.likes === 1
    && inFeed.comments === 1 && inFeed.liked === false, inFeed);
  check('as does a page', pub(B, 'brock').trips[0]?.likes === 1 && pub(B, 'brock').trips[0]?.liked === true);
  check('and a catalog page', page(D, chiefs.id).outings[0]?.comments === 1 && page(D, chiefs.id).outings[0]?.liked === true);
  check('signed-out visitors see the counts', pub('anon', 'brock').outings.find((o) => o.ref === 'e1')?.likes === 1);
  check('D blocks B', call(D, `block_user('${B}')`).ok);
  const blockedThread = thread(D, A, 'outing', 'e1');
  check('a block hides their comments and likes, both ways', blockedThread.thread.length === 0 && blockedThread.comments === 0, blockedThread);
  check('D unblocks B', call(D, `unblock_user('${B}')`).ok);
  as(D, `select public.delete_comment('${c1.id}');`);
  check('someone else\'s comment cannot be taken down by a third person', thread(A, A, 'outing', 'e1').thread.length === 1);
  check('the owner can', as(A, `select public.delete_comment('${c1.id}');`).ok && thread(A, A, 'outing', 'e1').thread.length === 0);
  comment(B, A, 'outing', 'e1', 'Again!');
  check('a post taken down takes its likes and comments with it', sync(A, items.filter((x) => x.event_id !== 'e1')).ok
    && psql(`select (select count(*) from public.post_likes where ref = 'e1') + (select count(*) from public.post_comments where ref = 'e1')`).out === '0');
  const readLikes = as(B, 'select * from public.post_comments;');
  check('likes and comments cannot be read directly', !readLikes.ok && /permission denied/.test(readLikes.err), readLikes.err);
  check('A shares e1 again, and B likes and comments for the deletion checks', sync(A, items).ok && like(B, A, 'outing', 'e1').likes === 1
    && comment(B, A, 'outing', 'e1', 'Still great').id);

  // ---- usage counts ----
  const track = (who, events, session = 'visit-abcdef12') => {
    const r = as(who, `select public.track_usage('${JSON.stringify(events).replace(/'/g, "''")}'::jsonb, '${session}');`);
    return r.ok ? Number(r.out.split('\n').pop()) : r.err;
  };
  check('a signed-out visitor\'s page view is counted, and malformed ones are not', track('anon', [
    { name: 'page.view', props: { kind: 'profile', long: 'x'.repeat(200), nested: { a: 1 }, 'Bad Key': 1, n: 3, yes: true } },
    { name: 'Bad Name' }, { name: 'nodot' }, 'not an object',
  ]) === 1);
  const row = JSON.parse(psql("select row_to_json(u) from public.usage_events u where name = 'page.view' order by id desc limit 1").out);
  check('with no one attached, and only short plain details kept', row.user_id === null && row.props.long.length === 100 && !('nested' in row.props)
    && !('Bad Key' in row.props) && row.props.n === 3 && row.props.yes === true && row.props.kind === 'profile', row);
  check('a visit needs an id', track('anon', [{ name: 'page.view' }], 'short') === 0);
  check('a signed-in action is counted against them', track(A, [{ name: 'event.add', props: { kind: 'Concert', rated: true } }, { name: 'view.open', props: { view: 'feed' } }]) === 2
    && psql(`select count(*) from public.usage_events where user_id = '${A}'`).out === '2');
  check('at most 50 at once', track(A, Array.from({ length: 60 }, () => ({ name: 'feed.scroll' }))) === 50);
  check('and nothing claims to be from more than an hour ago, or the future',
    track(A, [{ name: 'app.old', ago_ms: 7200000 }, { name: 'app.future', ago_ms: -50000 }]) === 2
    && psql("select (select at > now() - interval '61 minutes' from public.usage_events where name = 'app.old') and (select at <= now() from public.usage_events where name = 'app.future')").out === 't');
  check('someone who turned it off is not counted, whatever their app sends', as(B, `update public.profiles set share_usage = false where id = '${B}';`).ok
    && track(B, [{ name: 'event.add' }]) === 0 && psql(`select count(*) from public.usage_events where user_id = '${B}'`).out === '0');
  const readUsage = as(A, 'select * from public.usage_events;');
  check('nobody reads the rows directly', !readUsage.ok && /permission denied/.test(readUsage.err), readUsage.err);
  const notAdmin = as(A, 'select public.usage_report(30);');
  check('the usage is only for the team', !notAdmin.ok && /team/.test(notAdmin.err) && as(A, 'select public.is_usage_admin();').out.endsWith('f'), notAdmin.err);
  check('and never for signed-out visitors', !as('anon', 'select public.usage_report(30);').ok && !as('anon', 'select public.is_usage_admin();').ok);
  check('A is added to the team by hand', psql(`insert into public.usage_admins select id from public.profiles where username = 'brock';`).ok
    && as(A, 'select public.is_usage_admin();').out.endsWith('t'));
  const usage = one(A, 'select public.usage_report(30);');
  check('the report counts who is active, and each part of the app', usage.totals.active >= 1 && usage.totals.visits >= 1
    && usage.areas.some((x) => x.area === 'event' && x.people === 1 && x.share === 100) && usage.actions.some((x) => x.name === 'event.add' && x.count === 1), usage.totals);
  check('by day, by tab, by depth, heavy against light, by week joined, and the public page funnel', usage.daily.length === 30
    && usage.views.some((x) => x.view === 'feed') && usage.depth['1'] >= 1 && Array.isArray(usage.heavy.areas)
    && usage.cohorts.length >= 1 && usage.public.visitors === 1 && usage.public.views === 1, usage);
  check('a window can be chosen, within reason', one(A, 'select public.usage_report(7);').daily.length === 7 && one(A, 'select public.usage_report(9999);').days === 365);
  check('nothing anyone wrote is in it', !JSON.stringify(usage).includes('xxxxx'));

  // ---- deleting an account ----
  const anonDel = as('anon', 'select public.delete_my_account();');
  check('a signed-out visitor cannot delete anything', !anonDel.ok, anonDel.err);
  check('a person can delete their own account', as(A, 'select public.delete_my_account();').ok);
  check('which removes their sign-in, profile and saved data', psql(`select (select count(*) from auth.users where id = '${A}') + (select count(*) from public.profiles where id = '${A}') + (select count(*) from public.orbit_data where user_id = '${A}')`).out === '0');
  check('their shared outings go with it, and the entries they added stay, without their name', psql(`select (select count(*) from public.outings where user_id = '${A}') + (select count(*) from public.outing_links where user_id = '${A}') + (select count(*) from public.shared_trips where user_id = '${A}') + (select count(*) from public.post_likes where owner = '${A}') + (select count(*) from public.post_comments where owner = '${A}') + (select count(*) from public.usage_events where user_id = '${A}') + (select count(*) from public.usage_admins where user_id = '${A}')`).out === '0'
    && psql(`select count(*) || '|' || count(created_by) from public.catalog where source_id = 'Q223455'`).out === '1|0');
  check('and nobody else\'s', psql(`select (select count(*) from public.profiles where id = '${B}') + (select count(*) from public.orbit_data where user_id = '${B}')`).out === '2');
} finally {
  run(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} database checks passed`);
process.exit(failed ? 1 : 0);
