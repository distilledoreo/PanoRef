const DATABASE_NAME = 'panoref-model-assets';
const STORE_NAME = 'mesh-binaries';
const DATABASE_VERSION = 1;

const memoryAssets = new Map<string, ArrayBuffer>();

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open model asset storage.'));
  });
}

export function registerModelAssetBytes(key: string, bytes: ArrayBuffer): void {
  memoryAssets.set(key, cloneBuffer(bytes));
}

export function getRegisteredModelAssetBytes(key: string): ArrayBuffer | undefined {
  const bytes = memoryAssets.get(key);
  return bytes ? cloneBuffer(bytes) : undefined;
}

export async function putModelAsset(key: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
  registerModelAssetBytes(key, bytes);
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(bytes, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not store model geometry.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Model geometry storage was cancelled.'));
      signal?.addEventListener('abort', () => transaction.abort(), { once: true });
    });
  } finally {
    db.close();
  }
}

export async function getModelAsset(key: string): Promise<ArrayBuffer | undefined> {
  const cached = getRegisteredModelAssetBytes(key);
  if (cached) return cached;
  const db = await openDatabase();
  if (!db) return undefined;
  try {
    const value = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read model geometry.'));
    });
    if (value) registerModelAssetBytes(key, value);
    return value;
  } finally {
    db.close();
  }
}

export async function deleteModelAsset(key: string): Promise<void> {
  memoryAssets.delete(key);
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete model geometry.'));
    });
  } finally {
    db.close();
  }
}

export async function hydrateModelAssetKeys(keys: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    if (!await getModelAsset(key)) missing.push(key);
  }
  return missing;
}

export function resetModelAssetStoreForTests(): void {
  memoryAssets.clear();
}
