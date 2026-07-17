import * as THREE from 'three';
import { ProjectionAlignment } from '../domain/types';
import { solveProjectionAlignment, WARP_MAP_HEIGHT, WARP_MAP_WIDTH } from './projectionAlignmentSolver';
import { degreesToRadians } from './sync';

interface CacheEntry {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  refCount: number;
  key: string;
}

const textureCache = new Map<string, CacheEntry>();

function buildCacheKey(
  alignment: ProjectionAlignment,
  targetYawDegrees: number,
  sourceYawDegrees: number,
  width: number,
  height: number,
): string {
  const enabledPairs = alignment.pairs
    .filter((p) => p.enabled)
    .map((p) => `${p.id}:${p.targetUv[0]},${p.targetUv[1]}-${p.sourceUv[0]},${p.sourceUv[1]}`)
    .sort()
    .join('|');
  return [
    alignment.savedAt,
    alignment.sourcePanoId,
    alignment.targetGrayboxPanoId,
    targetYawDegrees.toFixed(4),
    sourceYawDegrees.toFixed(4),
    width,
    height,
    enabledPairs,
  ].join(':');
}

function packDisplacementToTexture(
  field: Float32Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const fi = i * 2;
    let dU = field[fi];
    let dV = field[fi + 1];

    dU = Math.max(-1, Math.min(1, dU));
    dV = Math.max(-1, Math.min(1, dV));

    const u16 = Math.round((dU * 0.5 + 0.5) * 65535);
    const v16 = Math.round((dV * 0.5 + 0.5) * 65535);

    const pi = i * 4;
    data[pi] = (u16 >> 8) & 0xff;
    data[pi + 1] = u16 & 0xff;
    data[pi + 2] = (v16 >> 8) & 0xff;
    data[pi + 3] = v16 & 0xff;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

export interface AcquireOptions {
  targetYawDegrees?: number;
  sourceYawDegrees?: number;
  width?: number;
  height?: number;
}

export interface AcquireResult {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  release: () => void;
}

export function acquireProjectionWarpTexture(
  alignment: ProjectionAlignment | undefined | null,
  options: AcquireOptions = {},
): AcquireResult {
  const width = options.width ?? WARP_MAP_WIDTH;
  const height = options.height ?? WARP_MAP_HEIGHT;

  if (!alignment || alignment.pairs.filter((p) => p.enabled).length === 0) {
    const field = new Float32Array(width * height * 2);
    const texture = packDisplacementToTexture(field, width, height);
    let released = false;
    return {
      texture,
      width,
      height,
      release: () => {
        if (released) return;
        released = true;
        texture.dispose();
      },
    };
  }

  const targetYaw = degreesToRadians(options.targetYawDegrees ?? 0);
  const sourceYaw = degreesToRadians(options.sourceYawDegrees ?? 0);
  const key = buildCacheKey(alignment, options.targetYawDegrees ?? 0, options.sourceYawDegrees ?? 0, width, height);

  const existing = textureCache.get(key);
  if (existing) {
    existing.refCount += 1;
    let released = false;
    return {
      texture: existing.texture,
      width: existing.width,
      height: existing.height,
      release: () => {
        if (released) return;
        released = true;
        const entry = textureCache.get(key);
        if (!entry) return;
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount === 0) {
          entry.texture.dispose();
          textureCache.delete(key);
        }
      },
    };
  }

  const result = solveProjectionAlignment(alignment, { targetYaw, sourceYaw, width, height });
  const texture = packDisplacementToTexture(result.field, width, height);
  const entry: CacheEntry = { texture, width, height, refCount: 1, key };
  textureCache.set(key, entry);

  let released = false;
  return {
    texture,
    width,
    height,
    release: () => {
      if (released) return;
      released = true;
      const entry = textureCache.get(key);
      if (!entry) return;
      entry.refCount = Math.max(0, entry.refCount - 1);
      if (entry.refCount === 0) {
        entry.texture.dispose();
        textureCache.delete(key);
      }
    },
  };
}

export function projectionWarpTextureCacheSize(): number {
  return textureCache.size;
}

export function disposeAllProjectionWarpTextures(): void {
  for (const [, entry] of textureCache) {
    entry.texture.dispose();
  }
  textureCache.clear();
}
