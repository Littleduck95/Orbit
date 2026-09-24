/*
 * Trip photos live here, and only here. They are far too big for
 * localStorage, so they go in IndexedDB as Blobs, in their own database.
 *
 * Everything the app knows about storing a photo goes through this module:
 * nothing else opens the database. Moving photos to cloud storage later means
 * reimplementing the exports below, not touching the screens that use them.
 *
 * Two object stores, both keyed by photo id:
 *   photos  { id, tripId, blob, width, height, size, savedAt }   (the full-size copy)
 *   thumbs  { id, blob }                                        (a small copy for grids and popups)
 * Thumbnails are kept apart so drawing a grid never reads the large files.
 */

const DB_NAME = 'orbit-photos';
const DB_VERSION = 1;
const PHOTOS = 'photos';
const THUMBS = 'thumbs';

// The friendly half of every failure here. The message is written to be shown
// as it is.
export class PhotoError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PhotoError';
    this.cause = cause;
  }
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('The photo store gave up on that change.'));
});

const fullUp = (e) => e?.name === 'QuotaExceededError'
  ? new PhotoError('There is no room left in this browser for more photos. Delete some, or back up and free up space.', e)
  : e;

let opening = null;

const open = () => {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new PhotoError('This browser will not store photos here. Private browsing often blocks it.'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new PhotoError('This browser will not store photos here. Private browsing often blocks it.', e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: 'id' }).createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the database needs this one to let go.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => reject(new PhotoError('The photo store could not be opened.', req.error));
    req.onblocked = () => reject(new PhotoError('Orbit is open in another tab that is holding the photo store. Close it and try again.'));
  });
  // A failed open is not remembered, so the next call tries again.
  opening.catch(() => { opening = null; });
  return opening;
};

// Asking once per visit is enough. Browsers decide for themselves, and a
// refusal now can turn into a yes later (after the site is bookmarked, say).
let askedToPersist = false;
export const persistOnce = async () => {
  if (askedToPersist) return null;
  askedToPersist = true;
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
};

// { usage, quota } in bytes, or null where the browser will not say.
export const estimate = async () => {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return typeof usage === 'number' ? { usage, quota: quota ?? null } : null;
  } catch {
    return null;
  }
};

// Stores one prepared photo (see processImage) under the trip it belongs to.
export const save = async ({ id, tripId, blob, thumb, width = null, height = null }) => {
  if (!id || !(blob instanceof Blob)) throw new PhotoError('That photo could not be stored.');
  const db = await open();
  const tx = db.transaction([PHOTOS, THUMBS], 'readwrite');
  const end = finished(tx);
  tx.objectStore(PHOTOS).put({ id, tripId: tripId || '', blob, width, height, size: blob.size, savedAt: new Date().toISOString() });
  tx.objectStore(THUMBS).put({ id, blob: thumb instanceof Blob ? thumb : blob });
  try {
    await end;
  } catch (e) {
    throw fullUp(e);
  }
  persistOnce();
  return id;
};

const read = async (store, id) => {
  if (!id) return null;
  const db = await open();
  return (await done(db.transaction(store).objectStore(store).get(id))) || null;
};

// The full-size Blob, or null when there is no such photo.
export const get = async (id) => (await read(PHOTOS, id))?.blob || null;

// The small Blob, or null when there is no such photo.
export const getThumbnail = async (id) => (await read(THUMBS, id))?.blob || null;

// Everything stored for one photo, for backups: { id, tripId, blob, thumb, width, height }.
export const getRecord = async (id) => {
  const [full, small] = await Promise.all([read(PHOTOS, id), read(THUMBS, id)]);
  if (!full) return null;
  return { id, tripId: full.tripId, blob: full.blob, thumb: small?.blob || full.blob, width: full.width, height: full.height };
};

export const has = async (id) => {
  if (!id) return false;
  const db = await open();
  return (await done(db.transaction(PHOTOS).objectStore(PHOTOS).count(id))) > 0;
};

// Ids of the photos stored against a trip.
export const listForTrip = async (tripId) => {
  const db = await open();
  return done(db.transaction(PHOTOS).objectStore(PHOTOS).index('tripId').getAllKeys(tripId));
};

// A light list of every photo: { id, tripId, size, thumbSize, savedAt }. Blobs are
// handles, so walking them does not read the image data.
export const listAll = async () => {
  const db = await open();
  const tx = db.transaction([PHOTOS, THUMBS]);
  const [photos, thumbs] = await Promise.all([
    done(tx.objectStore(PHOTOS).getAll()),
    done(tx.objectStore(THUMBS).getAll()),
  ]);
  const thumbSize = new Map(thumbs.map((t) => [t.id, t.blob?.size || 0]));
  return photos.map((p) => ({
    id: p.id, tripId: p.tripId, size: p.blob?.size || 0, thumbSize: thumbSize.get(p.id) || 0, savedAt: p.savedAt || '',
  }));
};

export const deleteMany = async (ids) => {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return;
  const db = await open();
  const tx = db.transaction([PHOTOS, THUMBS], 'readwrite');
  const end = finished(tx);
  list.forEach((id) => {
    tx.objectStore(PHOTOS).delete(id);
    tx.objectStore(THUMBS).delete(id);
  });
  await end;
};

// Named for what it does; `delete` is a reserved word as a binding.
export const remove = (id) => deleteMany([id]);
export { remove as delete };

export const deleteForTrip = async (tripId) => deleteMany(await listForTrip(tripId));

/* ---------- preparing an upload ---------- */
// Every photo is redrawn on a canvas before it is kept: at most 1600px on its
// long edge, as a JPEG. Redrawing also leaves behind everything the camera
// wrote into the file, including where it was taken. That is on purpose.

export const PHOTO_MAX = 1600;
export const THUMB_MAX = 300;
const PHOTO_QUALITY = 0.8;
const THUMB_QUALITY = 0.72;
// Past this, decoding alone can exhaust a phone's memory.
const FILE_CAP = 60 * 1024 * 1024;

const looksHeic = (file) => /\.(heic|heif)$/i.test(file?.name || '') || /heic|heif/i.test(file?.type || '');

const unreadable = (file, cause) => new PhotoError(
  looksHeic(file)
    ? `${file.name} is a HEIC photo, which this browser cannot open. Save it as JPEG or PNG and add it again. (On an iPhone: Settings, Camera, Formats, Most Compatible.)`
    : `${file?.name || 'That file'} could not be read as a picture. JPEG and PNG work everywhere.`,
  cause,
);

// Returns something drawImage accepts, its size, and a way to let it go.
const decode = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch {
      /* some formats only decode through <img>; try that next */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
};

const fit = (w, h, max) => {
  const scale = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
};

const drawJpeg = (source, w, h, quality) => new Promise((resolve, reject) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { reject(new Error('no 2d context')); return; }
  // JPEG has no transparency; a clear PNG would otherwise come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  canvas.toBlob((b) => {
    canvas.width = 0;
    canvas.height = 0;
    if (b) resolve(b); else reject(new Error('the canvas would not encode'));
  }, 'image/jpeg', quality);
});

// file -> { blob, thumb, width, height }, or throws a PhotoError to show.
export const processImage = async (file) => {
  if (!(file instanceof Blob)) throw unreadable(file);
  if (file.size > FILE_CAP) {
    throw new PhotoError(`${file.name} is too large to add (over ${Math.round(FILE_CAP / 1048576)} MB).`);
  }
  if (file.type && !file.type.startsWith('image/') && !looksHeic(file)) throw unreadable(file);
  let img;
  try {
    img = await decode(file);
  } catch (e) {
    throw unreadable(file, e);
  }
  try {
    if (!img.width || !img.height) throw unreadable(file);
    const [w, h] = fit(img.width, img.height, PHOTO_MAX);
    const [tw, th] = fit(img.width, img.height, THUMB_MAX);
    const blob = await drawJpeg(img.source, w, h, PHOTO_QUALITY);
    const thumb = await drawJpeg(img.source, tw, th, THUMB_QUALITY);
    return { blob, thumb, width: w, height: h };
  } catch (e) {
    throw e instanceof PhotoError ? e : unreadable(file, e);
  } finally {
    img.release();
  }
};
