/*
 * Accounts: the rules for what a new account needs, and the calls that read
 * and write a person's profile in Supabase (see supabase/schema.sql).
 *
 * The rules are checked here, as the person types, and again by the
 * database, so a hand-made request cannot get round them.
 */
import { track } from './usage.js';

export const MIN_AGE = 13;
export const MIN_PASSWORD = 8;

// Lowercase letters, numbers, dots and underscores, starting with a letter.
// Stored lowercase, so "Brock" and "brock" are the same name.
export const USERNAME_RE = /^[a-z][a-z0-9._]{2,19}$/;
const RESERVED = new Set(['admin', 'administrator', 'orbit', 'support', 'help', 'root', 'system', 'moderator', 'staff', 'official']);

export const cleanUsername = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase();

// What is wrong with a username, in words, or '' when it is fine.
export function usernameProblem(raw) {
  const u = cleanUsername(raw);
  if (!u) return 'Pick a username.';
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 20) return 'At most 20 characters.';
  if (!/^[a-z]/.test(u)) return 'Start with a letter.';
  if (!USERNAME_RE.test(u)) return 'Only letters, numbers, dots and underscores.';
  if (/[._]{2}/.test(u) || /[._]$/.test(u)) return 'No dots or underscores together or at the end.';
  if (RESERVED.has(u)) return 'That one is reserved.';
  return '';
}

export function passwordProblem(p) {
  const s = String(p || '');
  if (s.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters.`;
  if (s.length > 72) return 'At most 72 characters.';
  if (/^\s|\s$/.test(s)) return 'No spaces at the start or end.';
  return '';
}

export function emailProblem(e) {
  const s = String(e || '').trim();
  if (!s) return 'Enter your email.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'That does not look like an email address.';
  return '';
}

export function displayNameProblem(n) {
  const s = String(n || '').trim();
  if (!s) return 'Enter the name friends will see.';
  if (s.length > 60) return 'At most 60 characters.';
  return '';
}

// Whole years old on a given day, from a YYYY-MM-DD birthday.
export function ageOn(birthday, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age;
}

export function birthdayProblem(b, today = new Date()) {
  if (!b) return 'Enter your birthday.';
  const age = ageOn(b, today);
  if (age === null || Number(String(b).slice(0, 4)) < 1900) return 'That date does not look right.';
  if (age < 0) return 'That date is in the future.';
  if (age < MIN_AGE) return `Orbit is for people ${MIN_AGE} and older.`;
  return '';
}

// Every problem with a sign-up form, by field. Empty when it can be sent.
export function signUpProblems({ displayName, username, email, password, birthday }, today = new Date()) {
  const out = {
    displayName: displayNameProblem(displayName),
    username: usernameProblem(username),
    email: emailProblem(email),
    password: passwordProblem(password),
    birthday: birthdayProblem(birthday, today),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

// Supabase's own messages, in the words the rest of Orbit uses.
export function authMessage(error) {
  const m = String(error?.message || error || '');
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent when you signed up.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'There is already an account with that email. Log in instead, or reset the password.';
  if (/database error saving new user/i.test(m)) return 'The account could not be created. The username may have just been taken; try another.';
  if (/duplicate key|profiles_username_key|unique/i.test(m)) return 'That username is taken.';
  if (/13 and older/i.test(m)) return `Orbit is for people ${MIN_AGE} and older.`;
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a few minutes and try again.';
  if (/password should be|weak password/i.test(m)) return `Choose a longer password: at least ${MIN_PASSWORD} characters.`;
  if (/failed to fetch|network/i.test(m)) return 'Orbit could not reach the server. Check your connection.';
  return m || 'Something went wrong. Try again.';
}

/* ---------- calls ---------- */

// Every column, so a profile still reads before and after the friends part
// of the schema has been run.
const PROFILE_COLS = '*';

// The signed-in person's profile. { profile } when there is one, { profile:
// null } when there is not yet, and { missing: true } when the table itself
// is not there (the setup script has not been run), so Orbit still opens.
export async function loadProfile(client, userId) {
  const { data, error } = await client.from('profiles').select(PROFILE_COLS).eq('id', userId).limit(1);
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message || '')) {
      return { missing: true, profile: null };
    }
    throw new Error(error.message || 'The profile could not be read');
  }
  return { profile: data?.[0] || null };
}

export async function usernameAvailable(client, name) {
  const { data, error } = await client.rpc('username_available', { name: cleanUsername(name) });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function createProfile(client, userId, { username, displayName, birthday }) {
  const row = { id: userId, username: cleanUsername(username), display_name: displayName.trim(), birthday };
  const { data, error } = await client.from('profiles').insert(row).select(PROFILE_COLS);
  if (error) throw new Error(authMessage(error));
  return data?.[0] || row;
}

export async function updateProfile(client, userId, changes) {
  const row = {};
  if ('username' in changes) row.username = cleanUsername(changes.username);
  if ('displayName' in changes) row.display_name = changes.displayName.trim();
  if ('birthday' in changes) row.birthday = changes.birthday;
  for (const [from, to] of [['pronouns', 'pronouns'], ['bio', 'bio'], ['location', 'location'], ['phone', 'phone'],
    ['contactEmail', 'contact_email'], ['website', 'website'], ['socials', 'socials'], ['visibility', 'visibility'],
    ['searchable', 'searchable'], ['publicPage', 'public_page'], ['shareUsage', 'share_usage']]) {
    if (from in changes) row[to] = typeof changes[from] === 'string' ? changes[from].trim() : changes[from];
  }
  const { data, error } = await client.from('profiles').update(row).eq('id', userId).select(PROFILE_COLS);
  if (error) throw new Error(authMessage(error));
  return data?.[0];
}

export async function signUp(client, form, redirectTo) {
  const { data, error } = await client.auth.signUp({
    email: form.email.trim(),
    password: form.password,
    options: {
      emailRedirectTo: redirectTo,
      // Read by the database when the account is made, which creates the
      // profile in the same step (see handle_new_user in the schema).
      data: { username: cleanUsername(form.username), display_name: form.displayName.trim(), birthday: form.birthday },
    },
  });
  if (error) throw new Error(authMessage(error));
  // With email confirmation on, Supabase answers a repeat sign-up for an
  // existing address with a user that has no identities, rather than an
  // error, so nobody can test which emails have accounts.
  return { needsConfirm: !data.session, user: data.user };
}

export async function logIn(client, email, password) {
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authMessage(error));
}

export async function sendReset(client, email, redirectTo) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(authMessage(error));
}

export async function setPassword(client, password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(authMessage(error));
}

export async function changeEmail(client, email, redirectTo) {
  const { error } = await client.auth.updateUser({ email: email.trim() }, { emailRedirectTo: redirectTo });
  if (error) throw new Error(authMessage(error));
}

export async function deleteAccount(client) {
  const { error } = await client.rpc('delete_my_account');
  if (error) throw new Error(authMessage(error));
}

/* ---------- what others can see ---------- */

export const VISIBILITY = [['everyone', 'Everyone'], ['friends', 'Friends'], ['me', 'Only me']];

// The details a profile can show, in the order they are shown, with who sees
// each one until its owner chooses otherwise. Username and name are always
// visible, so people can be found.
export const PROFILE_FIELDS = [
  { key: 'pronouns', label: 'Pronouns', max: 30, start: 'everyone', ph: 'she/her' },
  { key: 'bio', label: 'About', max: 300, start: 'everyone', long: true, ph: 'A line or two about you' },
  { key: 'location', label: 'Where you live', max: 80, start: 'friends', ph: 'Kansas City' },
  { key: 'birthday', label: 'Birthday', start: 'friends', fromAccount: true },
  { key: 'phone', label: 'Phone', max: 40, start: 'me', ph: '+1 816 555 0100' },
  { key: 'contact_email', label: 'Email for friends', max: 200, start: 'me', ph: 'Can differ from the one you sign in with' },
  { key: 'website', label: 'Website', max: 300, start: 'everyone', ph: 'https://' },
  { key: 'socials', label: 'Socials', start: 'friends' },
];

export const SOCIAL_KEYS = [['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['snapchat', 'Snapchat'], ['linkedin', 'LinkedIn']];

export const visibilityOf = (profile, key) => profile?.visibility?.[key]
  || PROFILE_FIELDS.find((f) => f.key === key)?.start || 'me';

// What someone standing this way sees of a profile: the same rule the
// database applies, used for the preview in Settings.
export function seenAs(profile, as) {
  const out = { username: profile.username, display_name: profile.display_name };
  PROFILE_FIELDS.forEach(({ key }) => {
    const lvl = visibilityOf(profile, key);
    const v = profile[key];
    const empty = v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
    if (!empty && (as === 'me' || lvl === 'everyone' || (lvl === 'friends' && as === 'friends'))) out[key] = v;
  });
  return out;
}

/* ---------- friends ---------- */

const rpc = async (client, fn, args) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(/could not find the function|PGRST202/i.test(error.message || '') ? 'Friends are not set up on the server yet.' : authMessage(error));
  return data;
};

// Each call that changes something is also counted (see usage.js).
const counted = (name, props, promise) => promise.then((v) => { track(name, props); return v; });

export const friendsApi = (client) => ({
  search: async (q) => (await rpc(client, 'search_profiles', { q })) || [],
  get: (username) => rpc(client, 'get_profile', { uname: username }),
  list: async () => (await rpc(client, 'my_friends')) || [],
  send: (id) => counted('friends.request', {}, rpc(client, 'send_friend_request', { target: id })),
  respond: (id, accept) => counted(accept ? 'friends.accept' : 'friends.decline', {}, rpc(client, 'respond_friend_request', { other: id, accept })),
  remove: (id) => counted('friends.remove', {}, rpc(client, 'remove_friend', { other: id })),
  block: (id) => counted('friends.block', {}, rpc(client, 'block_user', { other: id })),
  unblock: (id) => rpc(client, 'unblock_user', { other: id }),
  blocks: async () => (await rpc(client, 'my_blocks')) || [],
});

/* ---------- the shared catalog ---------- */

const catalogRpc = async (client, fn, args) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(/could not find the function|PGRST202/i.test(error.message || '') ? 'The catalog is not set up on the server yet.' : authMessage(error));
  return data;
};

// Likes and comments on a post ({ owner, post, ref }: whose, 'outing' or
// 'trip', and which), schema part 7. Signed in only.
const postApi = (client) => ({
  like: (p, on) => catalogRpc(client, 'like_post', { p_owner: p.owner, p_kind: p.post, p_ref: p.ref, p_on: on }),
  comment: (p, body) => catalogRpc(client, 'comment_post', { p_owner: p.owner, p_kind: p.post, p_ref: p.ref, p_body: body }),
  uncomment: (id) => catalogRpc(client, 'delete_comment', { p_id: id }),
  thread: (p) => catalogRpc(client, 'post_thread', { p_owner: p.owner, p_kind: p.post, p_ref: p.ref }),
});

// See supabase/schema.sql, part 4. entry: { kind, name, about, source,
// source_id } as Wikidata or the form gives it.
export const catalogApi = (client) => ({
  ...postApi(client),
  search: async (q, kind = null) => (await catalogRpc(client, 'catalog_search', { q, p_kind: kind })) || [],
  add: (entry) => catalogRpc(client, 'catalog_add', {
    p_kind: entry.kind, p_name: entry.name, p_about: entry.about || '', p_source: entry.source, p_source_id: entry.source_id || null,
  }),
  page: (id) => catalogRpc(client, 'catalog_page', { p_id: id }),
  sync: (items) => catalogRpc(client, 'sync_outings', { items }),
  syncTrips: (items) => catalogRpc(client, 'sync_trips', { items }),
  // Friends' outings and trips, newest first (friend_feed, schema part 6).
  // after: the last item of the page before, to carry on from it.
  feed: async (after = null, lim = 30) => (await catalogRpc(client, 'friend_feed', {
    p_before_at: after?.at || null, p_before_id: after?.id || null, lim,
  })) || [],
});

// What anyone, signed in or not, can ask for: a person's page (see
// public_profile in the schema, part 5) and a catalog entry's.
export const publicApi = (client) => ({
  ...postApi(client),
  profile: (username, year = null) => catalogRpc(client, 'public_profile', { uname: username, p_year: year }),
  page: (id) => catalogRpc(client, 'catalog_page', { p_id: id }),
});

// Usage counts for Orbit's team (schema part 8): whether this person may see
// the report, and the report for the last so many days.
export const usageApi = (client) => ({
  isAdmin: async () => {
    const { data, error } = await client.rpc('is_usage_admin');
    return !error && data === true;
  },
  report: (days) => catalogRpc(client, 'usage_report', { p_days: days }),
});
