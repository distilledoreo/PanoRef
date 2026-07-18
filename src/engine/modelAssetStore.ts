const DATABASE_NAME = 'panoref-model-assets';
const STORE_NAME = 'mesh-binaries';
const CHUNK_STORE_NAME = 'mesh-binary-chunks';
const DATABASE_VERSION = 2;
const DEFAULT_MAX_CONCURRENT_BLOB_WRITES = 2;
const MODEL_ASSET_CHUNK_BYTES = 4 * 1024 * 1024;
const TRANSACTION_OVERHEAD_BYTES_PER_CHUNK = 4096;
const MODEL_ASSET_MANIFEST_BYTES = 512;
const CHUNKED_MODEL_ASSET_FORMAT = 'panoref-chunked-v1';

const memoryAssets = new Map<string, ArrayBuffer>();

export type ModelAssetStorageBackend = 'indexeddb' | 'memory';

/**
 * The project package contains packed mesh bytes. `storageKey` is the stable
 * key encoded by a `panoref-idb:` asset URI; the rest of the fields are kept
 * here so restore errors can identify the actual project asset without
 * throwing away the browser's underlying exception.
 */
export interface AssetBlobWrite {
  assetId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  bytes: ArrayBuffer;
}

export interface ModelAssetPreflight {
  totalBlobBytes: number;
  largestBlobBytes: number;
  assetCount: number;
  estimatedRequiredBytes: number;
  availableBytes?: number;
}

export interface ModelAssetRestoreOptions {
  projectId: string;
  projectName: string;
  signal?: AbortSignal;
  maxConcurrentWrites?: number;
  temporaryObjectUrls?: readonly string[];
}

export interface ModelAssetRestoreResult {
  backend: ModelAssetStorageBackend;
  preflight: ModelAssetPreflight;
  restoredAssetIds: string[];
}

export interface ModelAssetRestoreErrorDetails {
  operation: string;
  projectId: string;
  projectName: string;
  assetId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageBackend: ModelAssetStorageBackend;
  underlyingExceptionName: string;
  underlyingExceptionMessage: string;
  rollbackSucceeded: boolean;
  totalBlobBytes?: number;
  largestBlobBytes?: number;
  assetCount?: number;
  estimatedRequiredBytes?: number;
  availableBytes?: number;
}

export class ModelAssetRestoreError extends Error {
  constructor(public readonly details: ModelAssetRestoreErrorDetails) {
    super(formatRestoreError(details));
    this.name = 'ModelAssetRestoreError';
  }
}

interface ModelAssetStoreTestHooks {
  backend?: ModelAssetStorageBackend;
  beforeWrite?: (key: string, bytes: ArrayBuffer) => void | Promise<void>;
  beforeDelete?: (key: string) => void | Promise<void>;
  storageEstimate?: () => Promise<{ usage?: number; quota?: number }>;
}

interface ChunkedModelAssetRecord {
  format: typeof CHUNKED_MODEL_ASSET_FORMAT;
  byteLength: number;
  chunkCount: number;
}

let testHooks: ModelAssetStoreTestHooks | undefined;

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function backendForCurrentEnvironment(): ModelAssetStorageBackend {
  return testHooks?.backend ?? (typeof indexedDB === 'undefined' ? 'memory' : 'indexeddb');
}

function openDatabase(): Promise<IDBDatabase> {
  if (backendForCurrentEnvironment() !== 'indexeddb' || typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(CHUNK_STORE_NAME)) request.result.createObjectStore(CHUNK_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open model asset storage.'));
    request.onblocked = () => reject(new Error('Model asset storage is blocked by another browser connection.'));
  });
}

export function getModelAssetStorageBackend(): ModelAssetStorageBackend {
  return backendForCurrentEnvironment();
}

export function registerModelAssetBytes(key: string, bytes: ArrayBuffer): void {
  memoryAssets.set(key, cloneBuffer(bytes));
}

export function getRegisteredModelAssetBytes(key: string): ArrayBuffer | undefined {
  const bytes = memoryAssets.get(key);
  return bytes ? cloneBuffer(bytes) : undefined;
}

export async function putModelAsset(key: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<number> {
  return writeModelAsset(key, bytes, signal, true);
}

async function writeModelAsset(
  key: string,
  bytes: ArrayBuffer,
  signal: AbortSignal | undefined,
  invokeTestHook: boolean,
): Promise<number> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
    throw new Error(`Cannot store model asset ${key}: binary bytes are empty or invalid.`);
  }
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
  if (invokeTestHook) await testHooks?.beforeWrite?.(key, bytes);
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');

  const backend = backendForCurrentEnvironment();
  if (backend === 'memory') {
    registerModelAssetBytes(key, bytes);
    return bytes.byteLength;
  }

  const db = await openDatabase();
  try {
    await writeIndexedDbModelAsset(db, key, bytes, signal);
    // Cache only after the persistent write commits. This prevents a failed
    // package open from making an unwritten asset look available to the scene.
    registerModelAssetBytes(key, bytes);
    return bytes.byteLength;
  } finally {
    db.close();
  }
}

async function writeIndexedDbModelAsset(
  db: IDBDatabase,
  key: string,
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, CHUNK_STORE_NAME], 'readwrite');
    const metadataStore = transaction.objectStore(STORE_NAME);
    const chunkStore = transaction.objectStore(CHUNK_STORE_NAME);
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const rejectOnce = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const abortTransaction = () => {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed.
      }
    };
    const onAbort = () => {
      abortTransaction();
      rejectOnce(new DOMException('Import cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    transaction.oncomplete = resolveOnce;
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Could not store model geometry.'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Model geometry storage was cancelled.'));

    const previousRequest = metadataStore.get(key);
    previousRequest.onerror = () => rejectOnce(previousRequest.error ?? new Error('Could not inspect model geometry storage.'));
    previousRequest.onsuccess = () => {
      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        const previous = previousRequest.result as unknown;
        if (isChunkedModelAssetRecord(previous)) {
          for (let index = 0; index < previous.chunkCount; index += 1) {
            chunkStore.delete(modelAssetChunkKey(key, index));
          }
        }
        const chunkCount = chunkCountForBytes(bytes.byteLength);
        for (let index = 0; index < chunkCount; index += 1) {
          const start = index * MODEL_ASSET_CHUNK_BYTES;
          const end = Math.min(bytes.byteLength, start + MODEL_ASSET_CHUNK_BYTES);
          chunkStore.put(bytes.slice(start, end), modelAssetChunkKey(key, index));
        }
        metadataStore.put({
          format: CHUNKED_MODEL_ASSET_FORMAT,
          byteLength: bytes.byteLength,
          chunkCount,
        } satisfies ChunkedModelAssetRecord, key);
      } catch (cause) {
        rejectOnce(cause);
        abortTransaction();
      }
    };
  });
}

async function readIndexedDbModelAsset(db: IDBDatabase, key: string): Promise<ArrayBuffer | undefined> {
  return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, CHUNK_STORE_NAME], 'readonly');
    const metadataStore = transaction.objectStore(STORE_NAME);
    const chunkStore = transaction.objectStore(CHUNK_STORE_NAME);
    let settled = false;
    const resolveOnce = (value: ArrayBuffer | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Could not read model geometry.'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Could not read model geometry.'));

    const metadataRequest = metadataStore.get(key);
    metadataRequest.onerror = () => rejectOnce(metadataRequest.error ?? new Error('Could not read model geometry.'));
    metadataRequest.onsuccess = () => {
      const stored = metadataRequest.result as unknown;
      if (!isChunkedModelAssetRecord(stored)) {
        void toArrayBuffer(stored).then(resolveOnce).catch(rejectOnce);
        return;
      }
      let chunksRequest: IDBRequest<unknown[]>;
      try {
        chunksRequest = chunkStore.getAll(
          IDBKeyRange.bound(modelAssetChunkKey(key, 0), modelAssetChunkKey(key, stored.chunkCount - 1)),
        ) as IDBRequest<unknown[]>;
      } catch (cause) {
        rejectOnce(cause);
        return;
      }
      chunksRequest.onerror = () => rejectOnce(chunksRequest.error ?? new Error('Could not read model geometry chunks.'));
      chunksRequest.onsuccess = () => {
        void assembleChunkedModelAsset(stored, chunksRequest.result).then(resolveOnce).catch(rejectOnce);
      };
    };
  });
}

async function assembleChunkedModelAsset(
  manifest: ChunkedModelAssetRecord,
  storedChunks: unknown[],
): Promise<ArrayBuffer> {
  if (storedChunks.length !== manifest.chunkCount) {
    throw new Error(`Model geometry is incomplete: expected ${manifest.chunkCount} chunks, found ${storedChunks.length}.`);
  }
  const chunks = await Promise.all(storedChunks.map((chunk) => toArrayBuffer(chunk)));
  if (chunks.some((chunk) => !chunk)) throw new Error('Model geometry contains an invalid binary chunk.');
  const chunkBytes = chunks as ArrayBuffer[];
  const totalBytes = chunkBytes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (totalBytes !== manifest.byteLength) {
    throw new Error(`Model geometry byte count ${totalBytes} did not match manifest ${manifest.byteLength}.`);
  }
  const result = new Uint8Array(manifest.byteLength);
  let offset = 0;
  for (const chunk of chunkBytes) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function deleteIndexedDbModelAsset(db: IDBDatabase, key: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, CHUNK_STORE_NAME], 'readwrite');
    const metadataStore = transaction.objectStore(STORE_NAME);
    const chunkStore = transaction.objectStore(CHUNK_STORE_NAME);
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rejectOnce = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    transaction.oncomplete = resolveOnce;
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Could not delete model geometry.'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Could not delete model geometry.'));

    const metadataRequest = metadataStore.get(key);
    metadataRequest.onerror = () => rejectOnce(metadataRequest.error ?? new Error('Could not inspect model geometry storage.'));
    metadataRequest.onsuccess = () => {
      const stored = metadataRequest.result as unknown;
      if (isChunkedModelAssetRecord(stored)) {
        for (let index = 0; index < stored.chunkCount; index += 1) {
          chunkStore.delete(modelAssetChunkKey(key, index));
        }
      }
      metadataStore.delete(key);
    };
  });
}

function modelAssetChunkKey(key: string, index: number): IDBValidKey[] {
  return [key, index];
}

function chunkCountForBytes(byteLength: number): number {
  return Math.ceil(byteLength / MODEL_ASSET_CHUNK_BYTES);
}

function isChunkedModelAssetRecord(value: unknown): value is ChunkedModelAssetRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ChunkedModelAssetRecord>;
  return record.format === CHUNKED_MODEL_ASSET_FORMAT
    && Number.isInteger(record.byteLength)
    && record.byteLength > 0
    && Number.isInteger(record.chunkCount)
    && record.chunkCount > 0;
}

export async function getModelAsset(key: string): Promise<ArrayBuffer | undefined> {
  const cached = getRegisteredModelAssetBytes(key);
  if (cached) return cached;
  if (backendForCurrentEnvironment() === 'memory') return undefined;

  const db = await openDatabase();
  try {
    const bytes = await readIndexedDbModelAsset(db, key);
    if (bytes) registerModelAssetBytes(key, bytes);
    return bytes;
  } finally {
    db.close();
  }
}

async function toArrayBuffer(value: unknown): Promise<ArrayBuffer | undefined> {
  if (value instanceof ArrayBuffer) return cloneBuffer(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.arrayBuffer();
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return undefined;
}

export async function deleteModelAsset(key: string): Promise<void> {
  await deleteModelAssetInternal(key, true);
}

async function deleteModelAssetInternal(key: string, invokeTestHook: boolean): Promise<void> {
  if (invokeTestHook) await testHooks?.beforeDelete?.(key);
  if (backendForCurrentEnvironment() === 'memory') {
    memoryAssets.delete(key);
    return;
  }

  const db = await openDatabase();
  try {
    await deleteIndexedDbModelAsset(db, key);
    memoryAssets.delete(key);
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

/**
 * Restore a package's binary mesh entries without exposing a partially
 * restored project. The browser's IndexedDB path is the production backend;
 * the memory path is retained for unsupported/test environments and follows
 * the same transactional coordinator.
 */
export async function restoreModelAssetWrites(
  writes: readonly AssetBlobWrite[],
  options: ModelAssetRestoreOptions,
): Promise<ModelAssetRestoreResult> {
  const backend = backendForCurrentEnvironment();
  let normalized: AssetBlobWrite[];
  try {
    normalized = writes.map(normalizeWrite);
    const seenKeys = new Set<string>();
    const duplicate = normalized.find((write) => seenKeys.has(write.storageKey));
    if (duplicate) throw new Error(`Model asset storage key ${duplicate.storageKey} appears more than once.`);
    normalized.forEach((write) => seenKeys.add(write.storageKey));
  } catch (cause) {
    revokeTemporaryObjectUrls(options.temporaryObjectUrls);
    throw createRestoreError(options, writes[0] as AssetBlobWrite | undefined, backend, cause, true);
  }
  const preflight = calculatePreflight(normalized);
  try {
    await runStoragePreflight(normalized[0], options, backend, preflight);
  } catch (cause) {
    revokeTemporaryObjectUrls(options.temporaryObjectUrls);
    if (cause instanceof ModelAssetRestoreError) throw cause;
    throw createRestoreError(options, normalized[0], backend, cause, true, preflight);
  }

  if (normalized.length === 0) {
    revokeTemporaryObjectUrls(options.temporaryObjectUrls);
    return { backend, preflight, restoredAssetIds: [] };
  }

  const previous = new Map<string, ArrayBuffer | undefined>();
  try {
    for (const write of normalized) {
      throwIfAborted(options.signal);
      previous.set(write.storageKey, await getModelAsset(write.storageKey));
    }
  } catch (cause) {
    revokeTemporaryObjectUrls(options.temporaryObjectUrls);
    throw createRestoreError(options, normalized[0], backend, cause, true, preflight);
  }

  const touched = new Set<string>();
  let nextIndex = 0;
  let failure: { write: AssetBlobWrite; cause: unknown } | undefined;
  const workerCount = Math.min(
    Math.max(1, options.maxConcurrentWrites ?? DEFAULT_MAX_CONCURRENT_BLOB_WRITES),
    normalized.length,
  );

  const worker = async () => {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;
      const write = normalized[index];
      if (!write) return;
      touched.add(write.storageKey);
      try {
        throwIfAborted(options.signal);
        const writtenBytes = await writeModelAsset(write.storageKey, write.bytes, options.signal, true);
        if (writtenBytes !== write.size) {
          throw new Error(`Persistent byte count ${writtenBytes} did not match expected ${write.size}.`);
        }
      } catch (cause) {
        failure = { write, cause };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure) {
    const rollbackSucceeded = await rollbackModelAssetWrites(touched, previous);
    revokeTemporaryObjectUrls(options.temporaryObjectUrls);
    throw createRestoreError(options, failure.write, backend, failure.cause, rollbackSucceeded, preflight);
  }

  revokeTemporaryObjectUrls(options.temporaryObjectUrls);
  return {
    backend,
    preflight,
    restoredAssetIds: normalized.map((write) => write.assetId),
  };
}

async function rollbackModelAssetWrites(
  touched: Set<string>,
  previous: Map<string, ArrayBuffer | undefined>,
): Promise<boolean> {
  let succeeded = true;
  for (const key of touched) {
    try {
      const bytes = previous.get(key);
      if (bytes) await writeModelAsset(key, bytes, undefined, false);
      else await deleteModelAssetInternal(key, false);
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}

function normalizeWrite(write: AssetBlobWrite): AssetBlobWrite {
  if (!write || typeof write !== 'object') throw new Error('Invalid model asset restore entry.');
  if (!write.assetId || !write.storageKey || !write.filename || !write.mimeType) {
    throw new Error('Model asset restore entry is missing identity metadata.');
  }
  if (!(write.bytes instanceof ArrayBuffer) || write.size !== write.bytes.byteLength || write.size < 0) {
    throw new Error(`Model asset ${write.filename} has invalid byte metadata.`);
  }
  return { ...write, bytes: write.bytes };
}

function calculatePreflight(writes: readonly AssetBlobWrite[]): ModelAssetPreflight {
  const totalBlobBytes = writes.reduce((sum, write) => sum + write.size, 0);
  const largestBlobBytes = writes.reduce((largest, write) => Math.max(largest, write.size), 0);
  const estimatedStorageOverhead = writes.reduce(
    (sum, write) => sum + MODEL_ASSET_MANIFEST_BYTES + chunkCountForBytes(write.size) * TRANSACTION_OVERHEAD_BYTES_PER_CHUNK,
    0,
  );
  return {
    totalBlobBytes,
    largestBlobBytes,
    assetCount: writes.length,
    estimatedRequiredBytes: totalBlobBytes + estimatedStorageOverhead,
  };
}

async function runStoragePreflight(
  firstWrite: AssetBlobWrite | undefined,
  options: ModelAssetRestoreOptions,
  backend: ModelAssetStorageBackend,
  preflight: ModelAssetPreflight,
) {
  if (!firstWrite || backend !== 'indexeddb') return;
  let estimate: { usage?: number; quota?: number } | undefined;
  try {
    estimate = testHooks?.storageEstimate
      ? await testHooks.storageEstimate()
      : typeof navigator !== 'undefined' && navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : undefined;
  } catch {
    // Storage estimation is advisory and not available in all browsers.
    return;
  }
  if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
  const availableBytes = Math.max(0, estimate.quota! - estimate.usage!);
  preflight.availableBytes = availableBytes;
  if (preflight.estimatedRequiredBytes > availableBytes) {
    throw createRestoreError(
      options,
      firstWrite,
      backend,
      new DOMException(
        `The estimated restore requires ${formatBytes(preflight.estimatedRequiredBytes)}, but only ${formatBytes(availableBytes)} remains available.`,
        'QuotaExceededError',
      ),
      true,
      preflight,
    );
  }
}

function createRestoreError(
  options: ModelAssetRestoreOptions,
  write: AssetBlobWrite | undefined,
  backend: ModelAssetStorageBackend,
  cause: unknown,
  rollbackSucceeded: boolean,
  preflight?: ModelAssetPreflight,
): ModelAssetRestoreError {
  const underlying = cause instanceof Error
    ? { name: cause.name || 'Error', message: cause.message || 'Unknown error.' }
    : { name: 'UnknownError', message: String(cause) };
  const details: ModelAssetRestoreErrorDetails = {
    operation: 'restore model asset bytes while opening project',
    projectId: options.projectId,
    projectName: options.projectName,
    assetId: write?.assetId ?? 'unknown',
    filename: write?.filename ?? 'unknown asset',
    mimeType: write?.mimeType ?? 'application/octet-stream',
    size: write?.size ?? 0,
    storageBackend: backend,
    underlyingExceptionName: underlying.name,
    underlyingExceptionMessage: underlying.message,
    rollbackSucceeded,
    totalBlobBytes: preflight?.totalBlobBytes,
    largestBlobBytes: preflight?.largestBlobBytes,
    assetCount: preflight?.assetCount,
    estimatedRequiredBytes: preflight?.estimatedRequiredBytes,
    availableBytes: preflight?.availableBytes,
  };
  return new ModelAssetRestoreError(details);
}

function formatRestoreError(details: ModelAssetRestoreErrorDetails): string {
  const rollback = details.rollbackSucceeded
    ? 'Rollback succeeded. No project changes were committed.'
    : 'Rollback failed; inspect the asset store before retrying.';
  return [
    `Could not restore model asset "${details.filename}" (${formatBytes(details.size)}) while opening project "${details.projectName}" (${details.projectId}).`,
    `${details.operation}; asset ${details.assetId}; MIME ${details.mimeType}; backend ${details.storageBackend}.`,
    `${details.underlyingExceptionName}: ${details.underlyingExceptionMessage}`,
    rollback,
  ].join(' ');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Project open cancelled.', 'AbortError');
}

function revokeTemporaryObjectUrls(urls: readonly string[] | undefined) {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  urls?.forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function configureModelAssetStoreForTests(hooks?: ModelAssetStoreTestHooks): void {
  testHooks = hooks;
}

export function resetModelAssetStoreForTests(): void {
  memoryAssets.clear();
  testHooks = undefined;
}
