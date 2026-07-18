import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  createWarpTexture,
  projectionWarpTextureCacheSize,
  projectionWarpTextureRefCount,
  disposeAllProjectionWarpTextures,
  getIdentityWarpTexture,
} from '../src/engine/projectionWarpTexture';
import { ProjectionAlignment } from '../src/domain/types';

const DEG = Math.PI / 180;

function makeAlignment(overrides?: Partial<ProjectionAlignment>): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: 'pano-styled-1',
    targetGrayboxPanoId: 'pano-graybox-1',
    pairs: [{
      id: 'pair-1',
      order: 0,
      targetUv: [0.5, 0.5],
      sourceUv: [0.5, 0.5],
      enabled: true,
    }],
    strength: 1,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  disposeAllProjectionWarpTextures();
});

afterEach(() => {
  disposeAllProjectionWarpTextures();
});

describe('createWarpTexture', () => {
  it('zero displacement round-trip', () => {
    const w = 4;
    const h = 2;
    const disp = new Float32Array(w * h * 2);
    const alignment = makeAlignment();
    const result = createWarpTexture(
      alignment, 0, 0, disp, w, h,
    );

    expect(result.texture.image.data.length).toBe(w * h * 4);
    expect(result.width).toBe(w);
    expect(result.height).toBe(h);

    // Check first pixel: should encode 0,0
    const data = result.texture.image.data as Uint8Array;
    expect(data[0]).toBe(128);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(128);
    expect(data[3]).toBe(0);

    result.release();
  });

  it('minimum and maximum delta U', () => {
    const disp = new Float32Array(4 * 2);
    disp[0] = -0.5; // min U
    disp[2] = 0.5;  // max U

    const alignment = makeAlignment();
    const result = createWarpTexture(alignment, 0, 0, disp, 2, 1);

    const data = result.texture.image.data as Uint8Array;
    // First pixel: encoded -0.5
    const encMin = 0; // (0 - 0) / 1 * 65535 = 0
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);

    // Second pixel: encoded +0.5
    const encMax = 65535;
    expect(data[4]).toBe(255);
    expect(data[5]).toBe(255);

    result.release();
  });

  it('minimum and maximum delta V', () => {
    const disp = new Float32Array(4 * 2);
    disp[1] = -1.0; // min V
    disp[3] = 1.0;  // max V

    const alignment = makeAlignment();
    const result = createWarpTexture(alignment, 0, 0, disp, 2, 1);

    const data = result.texture.image.data as Uint8Array;
    expect(data[2]).toBe(0);  // V min = 0
    expect(data[3]).toBe(0);

    expect(data[6]).toBe(255); // V max = 65535
    expect(data[7]).toBe(255);

    result.release();
  });

  it('random representative values', () => {
    const w = 4;
    const h = 4;
    const pixelCount = w * h;
    const disp = new Float32Array(pixelCount * 2);
    for (let i = 0; i < pixelCount; i++) {
      disp[i * 2] = (Math.random() - 0.5) * 0.8;
      disp[i * 2 + 1] = (Math.random() - 0.5) * 1.5;
    }

    const alignment = makeAlignment();
    const result = createWarpTexture(alignment, 0, 0, disp, w, h);
    expect(result.texture.image.data.length).toBe(pixelCount * 4);
    result.release();
  });

  it('deterministic cache key', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    const r1 = createWarpTexture(alignment, 10 * DEG, 20 * DEG, disp, 4, 2);
    const r2 = createWarpTexture(alignment, 10 * DEG, 20 * DEG, disp, 4, 2);

    expect(r1.texture).toBe(r2.texture);

    r1.release();
    r2.release();
  });

  it('strength does not alter key', () => {
    const disp = new Float32Array(8);
    const a1 = makeAlignment({ strength: 1 });
    const a2 = makeAlignment({ strength: 0.5 });

    const r1 = createWarpTexture(a1, 0, 0, disp, 2, 1);
    const r2 = createWarpTexture(a2, 0, 0, disp, 2, 1);

    expect(r1.texture).toBe(r2.texture);

    r1.release();
    r2.release();
  });

  it('yaw changes alter key', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    const r1 = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    const r2 = createWarpTexture(alignment, 10 * DEG, 0, disp, 2, 1);

    expect(r1.texture).not.toBe(r2.texture);

    r1.release();
    r2.release();
  });

  it('same inputs reuse texture', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    expect(projectionWarpTextureCacheSize()).toBe(0);

    const r1 = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    expect(projectionWarpTextureCacheSize()).toBe(1);

    const r2 = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    expect(projectionWarpTextureCacheSize()).toBe(1);

    r1.release();
    r2.release();
  });

  it('release decrements once', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    const result = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(1);

    result.release();
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(0);
  });

  it('repeated release is harmless', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    const result = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    result.release();
    result.release();
    result.release();

    expect(projectionWarpTextureCacheSize()).toBe(0);
  });

  it('final release disposes and evicts', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    const result = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    result.release();

    expect(projectionWarpTextureCacheSize()).toBe(0);
  });

  it('two consumers: double release from A does not consume B reference', () => {
    const disp = new Float32Array(8);
    const alignment = makeAlignment();

    // A acquires
    const rA = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(1);

    // B acquires
    const rB = createWarpTexture(alignment, 0, 0, disp, 2, 1);
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(2);

    // A releases twice — second call must be idempotent
    rA.release();
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(1);
    rA.release();
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(1);

    // B releases — cache should now be empty
    rB.release();
    expect(projectionWarpTextureRefCount(buildKey(alignment, 0, 0, 2, 1))).toBe(0);
    expect(projectionWarpTextureCacheSize()).toBe(0);
  });

  it('identity texture is shared', () => {
    const t1 = getIdentityWarpTexture();
    const t2 = getIdentityWarpTexture();
    expect(t1).toBe(t2);
    expect(t1.image.width).toBe(1);
    expect(t1.image.height).toBe(1);
  });
});

function buildKey(
  alignment: ProjectionAlignment,
  sourceYaw: number,
  targetYaw: number,
  w: number,
  h: number,
): string {
  const pairIds = alignment.pairs
    .filter((p) => p.enabled)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((p) => `${p.id}:${p.order}:${p.targetUv[0].toFixed(6)}:${p.targetUv[1].toFixed(6)}:${p.sourceUv[0].toFixed(6)}:${p.sourceUv[1].toFixed(6)}`)
    .join('|');

  return [
    'warp-v1',
    alignment.sourcePanoId,
    alignment.targetGrayboxPanoId,
    sourceYaw.toFixed(6),
    targetYaw.toFixed(6),
    w,
    h,
    pairIds,
  ].join(':');
}
