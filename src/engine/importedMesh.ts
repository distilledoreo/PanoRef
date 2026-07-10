import * as THREE from 'three';
import { AssetRegistry, ProjectAsset, SceneObject } from '../domain/types';

export const PANOREF_MESH_MIME = 'application/vnd.panoref.graybox-mesh';
export const PANOREF_MESH_VERSION = 1;
export const MAX_PACKED_MESH_BYTES = 96 * 1024 * 1024;

const HEADER_BYTES = 40;
const MAGIC = [0x50, 0x52, 0x47, 0x4d] as const; // PRGM
const CACHE_IDLE_MS = 30_000;

interface GeometryCacheEntry {
  assetUri: string;
  geometry: THREE.BufferGeometry;
  references: number;
  disposeTimer?: ReturnType<typeof setTimeout>;
}

const geometryCache = new Map<string, GeometryCacheEntry>();

export interface PackedGrayboxMesh {
  uri: string;
  byteLength: number;
  vertexCount: number;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

/**
 * Encode exact triangle positions/indices into PanoRef's small synchronous runtime format.
 * Materials, texture coordinates, animation and hierarchy intentionally do not belong here.
 */
export function encodePackedGrayboxMesh(
  positions: Float32Array,
  indices: Uint32Array,
): PackedGrayboxMesh {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('Imported geometry must contain XYZ vertex positions.');
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error('Imported geometry must contain triangle indices.');
  }

  const vertexCount = positions.length / 3;
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] >= vertexCount) {
      throw new Error('Imported geometry contains an out-of-range triangle index.');
    }
  }

  const bounds = positionBounds(positions);
  const byteLength = HEADER_BYTES + positions.byteLength + indices.byteLength;
  if (byteLength > MAX_PACKED_MESH_BYTES) {
    throw new Error(
      `The texture-free mesh would use ${formatMegabytes(byteLength)}, above the ${formatMegabytes(MAX_PACKED_MESH_BYTES)} safety limit. No geometry was simplified.`,
    );
  }

  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(MAGIC, 0);
  const view = new DataView(buffer);
  view.setUint16(4, PANOREF_MESH_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, indices.length, true);
  bounds.min.forEach((value, index) => view.setFloat32(16 + index * 4, value, true));
  bounds.max.forEach((value, index) => view.setFloat32(28 + index * 4, value, true));
  new Float32Array(buffer, HEADER_BYTES, positions.length).set(positions);
  new Uint32Array(buffer, HEADER_BYTES + positions.byteLength, indices.length).set(indices);

  return {
    uri: `data:${PANOREF_MESH_MIME};base64,${bytesToBase64(bytes)}`,
    byteLength,
    vertexCount,
    triangleCount: indices.length / 3,
    bounds,
  };
}

export function createImportedMeshNode(
  object: SceneObject,
  assets: AssetRegistry | undefined,
  material: THREE.Material,
): THREE.Object3D {
  const asset = object.modelAssetId ? assets?.assets[object.modelAssetId] : undefined;
  if (!asset) return createMissingMeshPlaceholder(object, material, 'The imported mesh asset is missing.');

  try {
    const geometry = acquireGeometry(asset);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.importedModelAssetId = asset.id;
    const sourceSize = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
    mesh.scale.set(
      safeDimensionRatio(object.dimensions[0], sourceSize.x) * object.transform.scale[0],
      safeDimensionRatio(object.dimensions[1], sourceSize.y) * object.transform.scale[1],
      safeDimensionRatio(object.dimensions[2], sourceSize.z) * object.transform.scale[2],
    );
    return mesh;
  } catch (error) {
    return createMissingMeshPlaceholder(
      object,
      material,
      error instanceof Error ? error.message : 'The imported mesh asset is invalid.',
    );
  }
}

/** Release a cached geometry reference instead of invalidating shared GPU buffers. */
export function releaseImportedGeometry(geometry: THREE.BufferGeometry): boolean {
  const cacheKey = geometry.userData.panorefImportedCacheKey;
  if (typeof cacheKey !== 'string') return false;
  const entry = geometryCache.get(cacheKey);
  if (!entry || entry.geometry !== geometry) return true;
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references === 0 && !entry.disposeTimer) {
    entry.disposeTimer = setTimeout(() => {
      const current = geometryCache.get(cacheKey);
      if (!current || current.references > 0) return;
      current.geometry.dispose();
      geometryCache.delete(cacheKey);
    }, CACHE_IDLE_MS);
    if (typeof entry.disposeTimer === 'object' && 'unref' in entry.disposeTimer) {
      entry.disposeTimer.unref();
    }
  }
  return true;
}

export function resetImportedMeshCacheForTests() {
  geometryCache.forEach((entry) => {
    if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
    entry.geometry.dispose();
  });
  geometryCache.clear();
}

function acquireGeometry(asset: ProjectAsset): THREE.BufferGeometry {
  const cached = geometryCache.get(asset.id);
  if (cached && cached.assetUri === asset.uri) {
    if (cached.disposeTimer) clearTimeout(cached.disposeTimer);
    cached.disposeTimer = undefined;
    cached.references += 1;
    return cached.geometry;
  }
  if (cached) {
    if (cached.references > 0) {
      throw new Error('The imported mesh asset changed while it was in use.');
    }
    if (cached.disposeTimer) clearTimeout(cached.disposeTimer);
    cached.geometry.dispose();
    geometryCache.delete(asset.id);
  }

  const geometry = decodeGeometry(asset);
  geometry.userData.panorefImportedCacheKey = asset.id;
  geometryCache.set(asset.id, {
    assetUri: asset.uri,
    geometry,
    references: 1,
  });
  return geometry;
}

function decodeGeometry(asset: ProjectAsset): THREE.BufferGeometry {
  const prefix = `data:${PANOREF_MESH_MIME};base64,`;
  if (asset.type !== 'model' || !asset.uri.startsWith(prefix)) {
    throw new Error('Unsupported imported mesh asset encoding.');
  }
  const bytes = base64ToBytes(asset.uri.slice(prefix.length));
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_PACKED_MESH_BYTES) {
    throw new Error('Imported mesh asset size is invalid.');
  }
  if (MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error('Imported mesh asset header is invalid.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== PANOREF_MESH_VERSION) {
    throw new Error(`Imported mesh asset version ${version} is not supported.`);
  }
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  if (vertexCount === 0 || indexCount === 0 || indexCount % 3 !== 0) {
    throw new Error('Imported mesh asset contains no triangles.');
  }
  const expectedBytes = HEADER_BYTES + vertexCount * 3 * 4 + indexCount * 4;
  if (expectedBytes !== bytes.byteLength) {
    throw new Error('Imported mesh asset payload length is invalid.');
  }

  // Copy the compact payload into aligned arrays owned by THREE.
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = view.getFloat32(HEADER_BYTES + index * 4, true);
  }
  const indexOffset = HEADER_BYTES + positions.byteLength;
  for (let index = 0; index < indices.length; index += 1) {
    const value = view.getUint32(indexOffset + index * 4, true);
    if (value >= vertexCount) throw new Error('Imported mesh asset has an out-of-range index.');
    indices[index] = value;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMissingMeshPlaceholder(
  object: SceneObject,
  material: THREE.Material,
  error: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...object.dimensions), material);
  mesh.scale.fromArray(object.transform.scale);
  mesh.userData.importedModelError = error;
  return mesh;
}

function safeDimensionRatio(current: number, source: number) {
  return current / Math.max(Math.abs(source), 1e-6);
}

function positionBounds(positions: Float32Array): PackedGrayboxMesh['bounds'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      if (!Number.isFinite(value)) throw new Error('Imported geometry contains a non-finite vertex.');
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new Error('Imported mesh asset is not valid base64 data.');
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
