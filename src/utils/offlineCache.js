/**
 * Lightweight offline read-cache (doc "9. Offline Mode"): a durable,
 * origin-scoped key/value store for "previously loaded" data -- profile,
 * events, menus, notifications, saved events -- so those screens still
 * render something real when a fetch fails while offline, instead of an
 * error state or an empty list. Backed by IndexedDB where available; falls
 * back to an in-memory Map (same-tab only, cleared on reload) wherever it
 * isn't -- Jest/jsdom, older browsers, private-browsing lockdowns -- so
 * every call site gets the same contract either way and never needs to
 * feature-detect this itself.
 *
 * Deliberately NOT a write-back sync queue: nothing in CampusOS writes
 * while offline -- payments, new orders, booking, marketplace transactions
 * and SOS submission are all online-required by design (see the doc).
 * "Synchronization" here means exactly one thing: on reconnect, the app
 * refetches and overwrites these entries with the server's current data
 * (see the reconnect-reconciliation effect in App.jsx) -- the server is
 * always the source of truth, so there is no real write-conflict to
 * resolve, only a stale read to replace.
 */

const DB_NAME = "campusos-offline-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";

function supportsIndexedDb() {
  return typeof indexedDB !== "undefined";
}

let dbPromise = null;

function openDb() {
  if (!supportsIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      // Any open failure (blocked upgrade, disabled storage, etc.) just
      // means every call below falls back to the in-memory store.
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

// Fallback store used whenever IndexedDB is unavailable or errors.
const memoryStore = new Map();

/** Read a previously cached entry: `{ data, cachedAt }`, or `null`. */
export async function cacheRead(key) {
  const db = await openDb();
  if (!db) return memoryStore.get(key) ?? null;

  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Best-effort write; never throws -- a caching failure must never break
 * the real data flow that's calling it. */
export async function cacheWrite(key, data) {
  const entry = { data, cachedAt: Date.now() };
  const db = await openDb();
  if (!db) {
    memoryStore.set(key, entry);
    return;
  }

  try {
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry, key);
  } catch {
    memoryStore.set(key, entry); // fall back rather than silently lose it
  }
}

/**
 * Read-through cache for a network fetch: run `fetcher`, cache the result
 * on success, and on failure (offline or any other error) fall back to
 * whatever was last cached under `key` -- surfacing stale-but-real data
 * instead of an error or an empty screen. Rethrows the original error when
 * there's no cached fallback to offer, so first-ever-load failures behave
 * exactly as before this cache existed.
 */
export async function withOfflineCache(key, fetcher) {
  try {
    const data = await fetcher();
    cacheWrite(key, data);
    return data;
  } catch (error) {
    const cached = await cacheRead(key);
    if (cached) return cached.data;
    throw error;
  }
}
