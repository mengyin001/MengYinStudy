/**
 * Tiny IndexedDB key/value store with an in-memory fallback so the app still
 * works in private windows or when storage is blocked.
 *
 * The database used to be called `cityu-review`; on first boot the contents of
 * that database are copied across once, so an existing learner keeps their
 * progress. See `lib/legacy.ts` for the matching plugin-id remap.
 */
import { LEGACY_DB_NAMES } from './legacy';

export interface KeyValueStore {
  readonly kind: 'indexeddb' | 'memory';
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB_NAME = 'mengyin-study';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

function migrationFlag(name: string): string {
  return `migrated-db:${name}`;
}

function createMemoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    kind: 'memory',
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
    },
    async remove(key: string) {
      data.delete(key);
    },
  };
}

function openDatabase(name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法開啟資料庫'));
  });
}


function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('資料庫操作失敗'));
  });
}

/** True when `name` already exists; opening a missing database creates it, so clean that up. */
async function legacyDatabaseExists(name: string): Promise<boolean> {
  // Chromium, Firefox and Safari expose the list; prefer it to the probe below.
  if (typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      return databases.some((database) => database.name === name);
    } catch {
      // Fall through to the probe.
    }
  }
  return probeDatabase(name);
}

function probeDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
    };
    request.onsuccess = () => {
      const db = request.result;
      db.close();
      if (!created) {
        resolve(true);
        return;
      }
      const removal = indexedDB.deleteDatabase(name);
      removal.onsuccess = removal.onerror = removal.onblocked = () => resolve(false);
    };
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

function readAll(db: IDBDatabase): Promise<Array<[IDBValidKey, unknown]>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).openCursor();
    const entries: Array<[IDBValidKey, unknown]> = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(entries);
    tx.onerror = () => reject(tx.error ?? new Error('讀取舊資料庫失敗'));
    tx.onabort = () => reject(tx.error ?? new Error('讀取舊資料庫失敗'));
  });
}

function putAll(db: IDBDatabase, entries: ReadonlyArray<[IDBValidKey, unknown]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const [key, value] of entries) store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('寫入新資料庫失敗'));
    tx.onabort = () => reject(tx.error ?? new Error('寫入新資料庫失敗'));
  });
}

/**
 * Copies the pre-rename store into the current one, once per database name.
 * Keys already present in the new store win, so a later migration can never
 * overwrite fresh progress with stale data.
 */
async function migrateLegacyDatabases(target: IDBDatabase): Promise<void> {
  for (const name of LEGACY_DB_NAMES) {
    const flag = migrationFlag(name);
    const store = target.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
    if ((await toPromise(store.get(flag))) === 'done') continue;

    try {
      if (await legacyDatabaseExists(name)) {
        const legacy = await openDatabase(name);
        try {
          if (legacy.objectStoreNames.contains(STORE_NAME)) {
            const entries = await readAll(legacy);
            const current = new Set(
              await toPromise(target.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys()),
            );
            const missing = entries.filter(([key]) => !current.has(key));
            if (missing.length > 0) await putAll(target, missing);
          }
        } finally {
          legacy.close();
        }
      }
      await putAll(target, [[flag, 'done']]);
    } catch {
      // A failed copy must never stop the app booting; retry on the next launch.
    }
  }
}

async function openMigratedDatabase(): Promise<IDBDatabase> {
  const db = await openDatabase();
  await migrateLegacyDatabases(db);
  return db;
}

export function createKvStore(): KeyValueStore {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  let dbPromise: Promise<IDBDatabase> | null = null;
  let broken = false;

  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= openMigratedDatabase().catch((error: unknown) => {
      broken = true;
      throw error;
    });
    return dbPromise;
  };

  return {
    get kind() {
      return broken ? 'memory' : 'indexeddb';
    },
    async get<T>(key: string) {
      try {
        const database = await db();
        const tx = database.transaction(STORE_NAME, 'readonly');
        const result = await toPromise(tx.objectStore(STORE_NAME).get(key));
        return result as T | undefined;
      } catch {
        broken = true;
        return undefined;
      }
    },
    async set(key: string, value: unknown) {
      try {
        const database = await db();
        const tx = database.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('寫入失敗'));
        });
      } catch {
        broken = true;
      }
    },
    async remove(key: string) {
      try {
        const database = await db();
        const tx = database.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('刪除失敗'));
        });
      } catch {
        broken = true;
      }
    },
  };
}

export const appStore = createKvStore();

export const STORAGE_KEYS = {
  /** Pre-0.4.1 shared progress record. Read once, when an account claims it. */
  progress: 'progress:v1',
  /** Per-identity progress records, suffixed with `:guest` or `:user:<id>`. */
  progressScoped: 'progress:v2',
  localPlugins: 'local-plugins:v1',
  pluginKvPrefix: 'plugin-kv:',
  /** AI provider credentials — deliberately never copied into backups. */
  aiConfig: 'ai-config:v1',
  aiMaterials: 'ai-materials:v1',
  /** Official catalogue snapshot, so the app works offline after one sync. */
  officialContent: 'official-content:v1',
  /** Last cloud deck list per account, keyed with `:${userId}`. */
  userDecksCache: 'user-decks-cache:v1',
  /** Last official-library list per account, keyed with `:${userId}`. */
  userLibraryCache: 'user-library-cache:v1',
  /** One-time cleanup marker for the official-only catalogue. */
  storageMigrations: 'storage-migrations:v1',
} as const;

/**
 * 0.3.0 official-only cleanup. Remove question banks that lived only in this
 * browser (imported or AI-generated decks) and the cached official snapshot,
 * then mark the migration done. Later local imports still work normally.
 *
 * Progress, settings, notes and attempts are deliberately untouched.
 */
export async function runStorageMigrations(store: KeyValueStore = appStore): Promise<void> {
  if (await store.get<boolean>(STORAGE_KEYS.storageMigrations)) return;
  await store.remove(STORAGE_KEYS.localPlugins);
  await store.remove(STORAGE_KEYS.officialContent);
  await store.set(STORAGE_KEYS.storageMigrations, true);
}

export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readFileText(file: File): Promise<string> {
  return file.text();
}
