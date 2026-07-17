import * as THREE from 'three';
import { ProjectionAlignment } from '../domain/types';

const DELTA_U_MIN = -0.5;
const DELTA_U_MAX = 0.5;
const DELTA_V_MIN = -1.0;
const DELTA_V_MAX = 1.0;

interface WarpCacheEntry {
  texture: THREE.DataTexture;
  refCount: number;
  key: string;
}

const warpCache = new Map<string, WarpCacheEntry>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function encodeSigned16(value: number, min: number, max: number): number {
  const normalized = (clamp(value, min, max) - min) / (max - min);
  return Math.round(normalized * 65535);
}

function buildWarpCacheKey(
  alignment: ProjectionAlignment,
  sourceYawRadians: number,
  targetYawRadians: number,
  width: number,
  height: number,
): string {
  const pairIds = alignment.pairs
    .filter((p) => p.enabled)
    .map((p) => `${p.id}:${p.order}:${p.targetUv[0].toFixed(6)}:${p.targetUv[1].toFixed(6)}:${p.sourceUv[0].toFixed(6)}:${p.sourceUv[1].toFixed(6)}`)
    .join('|');

  return [
    'warp-v1',
    alignment.sourcePanoId,
    alignment.targetGrayboxPanoId,
    sourceYawRadians.toFixed(6),
    targetYawRadians.toFixed(6),
    width,
    height,
    pairIds,
  ].join(':');
}

export interface WarpTextureResult {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  release: () => void;
}

export function createWarpTexture(
  alignment: ProjectionAlignment,
  sourceYawRadians: number,
  targetYawRadians: number,
  displacement: Float32Array,
  width: number,
  height: number,
): WarpTextureResult {
  const key = buildWarpCacheKey(alignment, sourceYawRadians, targetYawRadians, width, height);

  const existing = warpCache.get(key);
  if (existing) {
    existing.refCount += 1;
    return {
      texture: existing.texture,
      width,
      height,
      release: () => releaseWarpTexture(key),
    };
  }

  const pixelCount = width * height;
  const data = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const du = displacement[i * 2];
    const dv = displacement[i * 2 + 1];

    const encodedU = encodeSigned16(du, DELTA_U_MIN, DELTA_U_MAX);
    const encodedV = encodeSigned16(dv, DELTA_V_MIN, DELTA_V_MAX);

    data[i * 4] = encodedU >> 8;
    data[i * 4 + 1] = encodedU & 0xff;
    data[i * 4 + 2] = encodedV >> 8;
    data[i * 4 + 3] = encodedV & 0xff;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const entry: WarpCacheEntry = { texture, refCount: 1, key };
  warpCache.set(key, entry);

  return {
    texture,
    width,
    height,
    release: () => releaseWarpTexture(key),
  };
}

function releaseWarpTexture(key: string): void {
  const entry = warpCache.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.texture.dispose();
    warpCache.delete(key);
  }
}

export function projectionWarpTextureCacheSize(): number {
  return warpCache.size;
}

export function projectionWarpTextureRefCount(key: string): number {
  return warpCache.get(key)?.refCount ?? 0;
}

export function disposeAllProjectionWarpTextures(): void {
  for (const [, entry] of warpCache) {
    entry.texture.dispose();
  }
  warpCache.clear();
}

const identityTexture: { texture: THREE.DataTexture | null } = { texture: null };

export function getIdentityWarpTexture(): THREE.DataTexture {
  if (!identityTexture.texture) {
    const data = new Uint8Array(4);
    data[0] = 128;
    data[1] = 0;
    data[2] = 128;
    data[3] = 0;
    identityTexture.texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    identityTexture.texture.wrapS = THREE.RepeatWrapping;
    identityTexture.texture.wrapT = THREE.ClampToEdgeWrapping;
    identityTexture.texture.minFilter = THREE.NearestFilter;
    identityTexture.texture.magFilter = THREE.NearestFilter;
    identityTexture.texture.generateMipmaps = false;
    identityTexture.texture.needsUpdate = true;
  }
  return identityTexture.texture;
}
