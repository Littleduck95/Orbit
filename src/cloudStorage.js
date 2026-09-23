/*
 * window.storage for a signed-in account, backed by Supabase.
 *
 * The app's contract is the same one src/storage.js keeps:
 *
 *   await get(key)        -> { value: string } when set, null when not
 *   await set(key, value) -> resolves once saved, throws when it was not
 *   await delete(key)
 *
 * Each of the app's keys is one row in the orbit_data table, owned by the
 * user (see supabase/schema.sql). Everything is read once when the account
 * opens, so the app's reads cost nothing, and every write goes straight to
 * the account. A write is only reported as saved once the account has it,
 * so the app's "did not save" message stays honest when the network is down.
 *
 * A copy of the account is kept in localStorage under orbit:@<user id>: so
 * Orbit still opens without a connection. It is only a copy: it is refreshed
 * whenever the account is read, and removed on sign out.
 */

export const TABLE = 'orbit_data';
const PREFIX = 'orbit:';
const SYNCED = '__synced';

const cachePrefix = (userId) => `${PREFIX}@${userId}:`;
// Data from before sign-in that the person chose not to bring into their
// account. Kept rather than deleted; see parkLocal.
const PARKED = `${PREFIX}parked:`;

const keysOf = (store) => {
  const out = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k !== null) out.push(k);
  }
  return out;
};

/*
 * What this browser saved before anyone signed in: the plain orbit: keys the
 * local-only version writes. Account copies (orbit:@id:) and parked data
 * (orbit:parked:) both have a ":" after the prefix, so they are not included.
 */
export function localEntries(store) {
  const out = {};
  for (const k of keysOf(store)) {
    if (!k.startsWith(PREFIX)) continue;
    const key = k.slice(PREFIX.length);
    if (!key || key.includes(':') || key.startsWith('__')) continue;
    out[key] = store.getItem(k);
  }
  return out;
}

const readCache = (store, userId) => {
  const p = cachePrefix(userId);
  if (store.getItem(p + SYNCED) === null) return null;
  const out = {};
  for (const k of keysOf(store)) {
    if (k.startsWith(p) && k !== p + SYNCED) out[k.slice(p.length)] = store.getItem(k);
  }
  return out;
};

// The copy is a convenience. A full or blocked localStorage must never turn a
// save the account accepted into a reported failure, so errors stop here.
const quietly = (fn) => { try { fn(); } catch { /* the account still has it */ } };

const writeCache = (store, userId, entries) => quietly(() => {
  const p = cachePrefix(userId);
  for (const k of keysOf(store)) if (k.startsWith(p)) store.removeItem(k);
  for (const [k, v] of Object.entries(entries)) store.setItem(p + k, v);
  store.setItem(p + SYNCED, new Date().toISOString());
});

export function clearCache(store, userId) {
  quietly(() => {
    const p = cachePrefix(userId);
    for (const k of keysOf(store)) if (k.startsWith(p)) store.removeItem(k);
  });
}

// supabase-js reports most failures in { error }, but a request that never
// leaves the browser can also throw. Both come out as a thrown Error.
const run = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message || 'The request to your account failed');
  return data;
};

const readAccount = async (client, userId) => {
  const rows = await run(client.from(TABLE).select('key, value').eq('user_id', userId));
  const out = {};
  for (const r of rows || []) out[r.key] = r.value;
  return out;
};

const upsert = (client, userId, entries) => {
  const now = new Date().toISOString();
  const rows = Object.entries(entries).map(([key, value]) => ({ user_id: userId, key, value, updated_at: now }));
  return run(client.from(TABLE).upsert(rows, { onConflict: 'user_id,key' }));
};

/*
 * Reads the account and says what to do with anything this browser saved
 * before signing in:
 *
 *   { entries, local, offline, conflict }
 *
 * - An empty account takes the browser's data as it is (moved: true), and the
 *   browser's own copy is then removed, so the next person to sign in on this
 *   computer does not inherit it.
 * - An account that already has data is never mixed with the browser's:
 *   conflict is true and the caller asks which to keep (keepAccount or
 *   replaceAccount).
 * - With no connection, the last copy of the account is used (offline: true).
 *   With no copy either, this throws, rather than showing an empty Orbit that
 *   the next save would write over the account with.
 */
export async function readAccountState({ client, userId, store }) {
  let entries;
  try {
    entries = await readAccount(client, userId);
  } catch (err) {
    const cached = readCache(store, userId);
    if (!cached) throw err;
    return { entries: cached, offline: true, conflict: false, moved: false };
  }
  const local = localEntries(store);
  const hasLocal = Object.keys(local).length > 0;
  if (hasLocal && Object.keys(entries).length === 0) {
    await upsert(client, userId, local);
    quietly(() => { for (const k of Object.keys(local)) store.removeItem(PREFIX + k); });
    entries = { ...local };
    writeCache(store, userId, entries);
    return { entries, offline: false, conflict: false, moved: true };
  }
  writeCache(store, userId, entries);
  return { entries, offline: false, conflict: hasLocal, moved: false };
}

// Keeps the account as it is. The browser's older data is moved under
// orbit:parked: rather than deleted, so it is out of the way but not gone.
export function parkLocal(store) {
  const local = localEntries(store);
  for (const [k, v] of Object.entries(local)) {
    store.setItem(PARKED + k, v);
    store.removeItem(PREFIX + k);
  }
}

// Makes the account exactly what this browser had: its keys are written, and
// any account key the browser did not have is removed, so the two are never
// mixed.
export async function replaceAccount({ client, userId, store }) {
  const local = localEntries(store);
  const keys = Object.keys(local);
  await upsert(client, userId, local);
  const current = await readAccount(client, userId);
  const stale = Object.keys(current).filter((k) => !keys.includes(k));
  if (stale.length) await run(client.from(TABLE).delete().eq('user_id', userId).in('key', stale));
  quietly(() => { for (const k of keys) store.removeItem(PREFIX + k); });
  writeCache(store, userId, local);
  return local;
}

// The window.storage object the app talks to, over entries already read.
export function cloudStorage({ client, userId, store, entries }) {
  const mem = new Map(Object.entries(entries));
  const p = cachePrefix(userId);
  return {
    async get(key) {
      return mem.has(key) ? { value: mem.get(key) } : null;
    },
    async set(key, value) {
      const v = String(value);
      await upsert(client, userId, { [key]: v });
      mem.set(key, v);
      quietly(() => store.setItem(p + key, v));
    },
    async delete(key) {
      await run(client.from(TABLE).delete().eq('user_id', userId).eq('key', key));
      mem.delete(key);
      quietly(() => store.removeItem(p + key));
    },
  };
}
