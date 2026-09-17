/*
 * Orbit's app code was written against the artifact runtime, where the host
 * page provides an async `window.storage` key/value store. A plain browser has
 * no such thing, so we install an equivalent backed by localStorage before the
 * app mounts. The contract the app relies on:
 *
 *   await window.storage.get(key)  -> { value: string } when set, null when not
 *   await window.storage.set(key, value) -> resolves on success, throws on failure
 *
 * Failures are allowed to reject: the app already catches them and tells the
 * user their change did not save, which is the honest outcome when the browser
 * refuses to persist (private mode, quota exceeded, blocked site data).
 */

const PREFIX = 'orbit:';

function backing() {
  // Touching localStorage can throw outright when site data is blocked, so
  // every access goes through here rather than being captured once at load.
  const store = window.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  return store;
}

export function installStorage(target = window) {
  if (target.storage) return target.storage;

  const storage = {
    async get(key) {
      const value = backing().getItem(PREFIX + key);
      return value === null ? null : { value };
    },
    async set(key, value) {
      backing().setItem(PREFIX + key, String(value));
    },
    async delete(key) {
      backing().removeItem(PREFIX + key);
    },
  };

  target.storage = storage;
  return storage;
}
