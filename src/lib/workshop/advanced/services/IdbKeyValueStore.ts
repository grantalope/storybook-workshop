// @graph-layer: private

// src/routes/dashboard/storybook-workshop/advanced/services/IdbKeyValueStore.ts
//
// Minimal IDB key/value helper shared by the three advanced-mode stores
// (overrides / diff-snapshots / telemetry).
//
// Why local rather than reusing some shared IDB helper:
//   - Wave-1 storybook-workshop services don't expose an IDB helper.
//   - The repo's other IDB helpers carry kernel coupling we don't want for a
//     pure UI persistence store.
//   - Tests use `fake-indexeddb/auto` to swap in the in-memory backend.

const SCHEMA_VERSION = 1;

/**
 * Small KV wrapper. Each instance owns ONE store inside ONE database.
 * Keys are strings; values are JSON-serializable.
 */
export class IdbKeyValueStore<TValue> {
  private readonly dbName: string;
  private readonly storeName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string, storeName: string) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async _db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async put(key: string, value: TValue): Promise<void> {
    const db = await this._db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(value as unknown as IDBValidKey, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
    });
  }

  async get(key: string): Promise<TValue | null> {
    const db = await this._db();
    return new Promise<TValue | null>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve((req.result as TValue | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this._db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list(): Promise<{ key: string; value: TValue }[]> {
    const db = await this._db();
    return new Promise<{ key: string; value: TValue }[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const out: { key: string; value: TValue }[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push({ key: String(cursor.key), value: cursor.value as TValue });
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this._db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Test-only: forget the cached connection so a fresh open is forced. */
  __TEST_resetConnection(): void {
    this.dbPromise = null;
  }
}
