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
  const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
  const first = psql(schema);
  check('the schema runs', first.ok, first.err);
  const again = psql(schema);
  check('and runs again without harm, as its header promises', again.ok, again.err);

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
