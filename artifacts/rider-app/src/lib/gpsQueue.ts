/* GPS offline queue backed by IndexedDB.
   Stores GPS pings that could not be sent due to network unavailability.
   On reconnect, the queue is drained by sending a batch request to the server. */

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

const DB_NAME = "ajkmart_gps_queue";
const STORE   = "pings";
const DB_VER  = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
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
            }
            store.put(ping);
          };
          cursorReq.onerror = () => tx.abort();
        } else {
          store.put(ping);
        }
      };
      countReq.onerror = () => tx.abort();
    });
  } catch { /* swallow — offline queue is best-effort */ }
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
  } catch { return []; }
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
  } catch {}
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
  } catch { return 0; }
}

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
      await _drainFn(chunk);
      await clearQueue(chunk.map(p => p.id));
    }
  } catch { /* drain failed — will retry next online event */ }
  finally { _draining = false; }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => drainQueue());
}
