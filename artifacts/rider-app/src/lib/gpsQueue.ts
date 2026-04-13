/* GPS offline queue backed by IndexedDB.
   Stores GPS pings that could not be sent due to network unavailability.
   On reconnect, the queue is drained by sending a batch request to the server.

   Also provides a dismissed-request store with a 90-second TTL so that
   request cards the rider hides are still hidden when the tab is reopened
   mid-trip, but automatically re-surface after the request has expired. */

export interface QueuedPing {
  id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  action?: string | null;
  mockProvider?: boolean;
}

interface DismissedEntry {
  id: string;
  expiresAt: number;
}

const DB_NAME    = "ajkmart_gps_queue";
const STORE      = "pings";
const DISMISSED  = "dismissed";
const DB_VER     = 2;

const DISMISSED_TTL_MS = 90_000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(DISMISSED)) {
        const ds = db.createObjectStore(DISMISSED, { keyPath: "id" });
        ds.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

const MAX_QUEUE_SIZE = 500;

export async function enqueue(ping: QueuedPing): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const countReq = store.count();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      countReq.onsuccess = () => {
        if (countReq.result >= MAX_QUEUE_SIZE) {
          const idx = store.index("timestamp");
          const cursorReq = idx.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              cursor.delete();
              store.put(ping);
            } else {
              tx.abort();
            }
          };
          cursorReq.onerror = () => tx.abort();
        } else {
          store.put(ping);
        }
      };
      countReq.onerror = () => tx.abort();
    });
  } catch (err) {
    console.error("[gpsQueue] enqueue failed — offline queue is best-effort", err);
  }
}

export async function dequeueAll(): Promise<QueuedPing[]> {
  try {
    const db = await openDB();
    return await new Promise<QueuedPing[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const index = store.index("timestamp");
      const req = index.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as QueuedPing[]);
      req.onerror   = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.error("[gpsQueue] dequeueAll failed", err);
    return [];
  }
}

export async function clearQueue(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      ids.forEach(id => store.delete(id));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[gpsQueue] clearQueue failed", err);
  }
}

export async function queueSize(): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.error("[gpsQueue] queueSize failed", err);
    return 0;
  }
}

/* ── Dismissed-request store ──────────────────────────────────────────────────
   Persists dismissed request IDs across tab close with a 90-second TTL.
   On read, expired entries are purged automatically so the store stays small. */

export async function addDismissed(id: string): Promise<void> {
  try {
    const db = await openDB();
    const entry: DismissedEntry = { id, expiresAt: Date.now() + DISMISSED_TTL_MS };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DISMISSED, "readwrite");
      tx.objectStore(DISMISSED).put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.error("[gpsQueue] addDismissed failed", err);
  }
}

export async function removeDismissed(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DISMISSED, "readwrite");
      tx.objectStore(DISMISSED).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.error("[gpsQueue] removeDismissed failed", err);
  }
}

export async function loadDismissed(): Promise<Set<string>> {
  try {
    const db = await openDB();
    const now = Date.now();
    const entries = await new Promise<DismissedEntry[]>((resolve, reject) => {
      const tx = db.transaction(DISMISSED, "readonly");
      const req = tx.objectStore(DISMISSED).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as DismissedEntry[]);
      req.onerror   = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    const valid = entries.filter(e => e.expiresAt > now);
    const expired = entries.filter(e => e.expiresAt <= now);
    if (expired.length) {
      purgeExpiredDismissed(expired.map(e => e.id));
    }
    return new Set(valid.map(e => e.id));
  } catch (err) {
    console.error("[gpsQueue] loadDismissed failed", err);
    return new Set();
  }
}

/** Purge expired entries from the dismissed store (fire-and-forget) */
async function purgeExpiredDismissed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DISMISSED, "readwrite");
      const store = tx.objectStore(DISMISSED);
      ids.forEach(id => store.delete(id));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.error("[gpsQueue] purgeExpiredDismissed failed", err);
  }
}

/**
 * Sweep the dismissed store for expired entries and return the current valid set.
 * Call this on tab re-focus (visibilitychange) so stale dismissals don't hide
 * newly-arrived requests after the TTL has elapsed.
 */
export async function sweepAndLoadDismissed(): Promise<Set<string>> {
  return loadDismissed();
}

export async function clearAllDismissed(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DISMISSED, "readwrite");
      tx.objectStore(DISMISSED).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.error("[gpsQueue] clearAllDismissed failed", err);
  }
}

/* ── Drain handler ────────────────────────────────────────────────────────────
   The drain function calls the registered batch-upload callback.
   If the server responds with GPS_SPOOF_DETECTED (HTTP 422), those pings
   are dropped from the queue permanently — never re-queued.
   Any other error leaves the pings in the queue to retry on the next
   online event. */

let _drainFn: ((pings: QueuedPing[]) => Promise<void>) | null = null;
let _draining = false;

export function registerDrainHandler(fn: (pings: QueuedPing[]) => Promise<void>): () => void {
  _drainFn = fn;
  if (typeof navigator !== "undefined" && navigator.onLine) {
    drainQueue();
  }
  return () => { if (_drainFn === fn) _drainFn = null; };
}

async function drainQueue(): Promise<void> {
  if (_draining || !_drainFn) return;
  _draining = true;
  try {
    const pings = await dequeueAll();
    if (pings.length === 0) return;
    const CHUNK = 100;
    for (let i = 0; i < pings.length; i += CHUNK) {
      const chunk = pings.slice(i, i + CHUNK);
      try {
        await _drainFn(chunk);
        await clearQueue(chunk.map(p => p.id));
      } catch (rawErr: unknown) {
        const err = rawErr as Record<string, unknown>;
        const responseData = err.responseData as Record<string, unknown> | undefined;
        const responseDataNested = responseData?.data as Record<string, unknown> | undefined;
        const isSpoofRejection =
          err.code === "GPS_SPOOF_DETECTED" ||
          responseData?.code === "GPS_SPOOF_DETECTED" ||
          responseDataNested?.code === "GPS_SPOOF_DETECTED" ||
          err.spoofDetected === true;
        if (isSpoofRejection) {
          console.error("[gpsQueue] drainQueue chunk rejected: GPS spoof detected — dropping chunk", rawErr);
          await clearQueue(chunk.map(p => p.id));
        } else {
          console.error("[gpsQueue] drainQueue chunk upload failed — will retry on next online event", rawErr);
        }
        break;
      }
    }
  } catch (err) {
    console.error("[gpsQueue] drainQueue failed — will retry on next online event", err);
  } finally { _draining = false; }
}

/* ── Module-level online listener lifecycle ───────────────────────────────────
   A single "online" listener is registered lazily.
   `initOnlineListener` registers it (called once on first import or after teardown).
   `teardownOnlineListener` removes it (for module reset / test isolation). */

let _onlineListenerActive = false;

function _onOnline() { drainQueue(); }

export function initOnlineListener(): void {
  if (_onlineListenerActive || typeof window === "undefined") return;
  _onlineListenerActive = true;
  window.addEventListener("online", _onOnline);
}

export function teardownOnlineListener(): void {
  if (!_onlineListenerActive || typeof window === "undefined") return;
  _onlineListenerActive = false;
  window.removeEventListener("online", _onOnline);
}

initOnlineListener();
