// Characterization tests for src/storage.js, the window.storage shim every
// save goes through. Its contract, per the file's own header: get resolves to
// { value } or null, set resolves on success and rejects on failure.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from '../src/storage.js';

const fakeLocalStorage = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
};

describe('storage shim', () => {
  it('reads, writes and deletes under the orbit: prefix', async () => {
    const localStorage = fakeLocalStorage();
    globalThis.window = { localStorage };
    try {
      const s = installStorage({});
      assert.equal(await s.get('k'), null);
      await s.set('k', 'v');
      assert.deepEqual(await s.get('k'), { value: 'v' });
      assert.equal(localStorage.data.get('orbit:k'), 'v');
      await s.set('n', 5);
      assert.deepEqual(await s.get('n'), { value: '5' }, 'values are stored as text');
      await s.delete('k');
      assert.equal(await s.get('k'), null);
    } finally {
      delete globalThis.window;
    }
  });

  it('leaves an existing window.storage alone', () => {
    const existing = { get() {}, set() {} };
    const target = { storage: existing, localStorage: fakeLocalStorage() };
    assert.equal(installStorage(target), existing);
  });

  it('CURRENT: reads localStorage from the global window, not the target it was given', async () => {
    // backing() looks at window.localStorage, so the target only decides where
    // the shim is installed. In a browser the two are the same object.
    const target = {};
    globalThis.window = { localStorage: fakeLocalStorage() };
    try {
      const s = installStorage(target);
      await s.set('k', 'v');
      assert.equal(globalThis.window.localStorage.data.get('orbit:k'), 'v');
    } finally {
      delete globalThis.window;
    }
  });

  it('rejects, rather than failing quietly, when the browser refuses', async () => {
    globalThis.window = {
      localStorage: { ...fakeLocalStorage(), setItem: () => { throw new Error('QuotaExceededError'); } },
    };
    try {
      const s = installStorage({});
      await assert.rejects(s.set('k', 'v'), /QuotaExceeded/);
    } finally {
      delete globalThis.window;
    }
    globalThis.window = {};
    try {
      const s = installStorage({});
      await assert.rejects(s.get('k'), /unavailable/);
    } finally {
      delete globalThis.window;
    }
  });
});
