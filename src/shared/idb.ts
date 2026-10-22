// Minimal IndexedDB wrapper shared by the service worker and the offscreen document.
// Stores: `kv` (job snapshots), `pages` (extracted pages), `blobs` (assets and finished ZIPs).

const DB_NAME = 'unfoldr';
const DB_VERSION = 1;
export type StoreName = 'kv' | 'pages' | 'blobs';

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['kv', 'pages', 'blobs'] as const) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = undefined;
      reject(req.error);
    };
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return (await wrap(db.transaction(store, 'readonly').objectStore(store).get(key))) as T | undefined;
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/** Deletes every key that starts with `prefix`. */
export async function idbDeletePrefix(store: StoreName, prefix: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
}

export async function idbGetPrefix<T>(store: StoreName, prefix: string): Promise<T[]> {
  const db = await open();
  return (await wrap(db.transaction(store, 'readonly').objectStore(store).getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)))) as T[];
}
