/**
 * A tiny IndexedDB key-value store for notebooks (browser only): cached
 * notebook details and page ink (fast reopen, offline reading) and the
 * outbox of changes not yet confirmed by the server (nothing drawn is lost
 * when the tab closes or the network drops).
 *
 * Every call degrades to a no-op when IndexedDB is unavailable (private
 * mode, blocked storage): the notebook then works online only.
 */

const DB_NAME = "studyos-notebooks";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const idb = {
  get<T>(key: string): Promise<T | undefined> {
    return run<T>("readonly", (s) => s.get(key));
  },
  set(key: string, value: unknown): Promise<void> {
    return run<void>("readwrite", (s) => s.put(value, key)).then(() => undefined);
  },
  del(key: string): Promise<void> {
    return run<void>("readwrite", (s) => s.delete(key)).then(() => undefined);
  },
};
