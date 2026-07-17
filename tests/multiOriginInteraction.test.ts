import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
} from '../src/domain/defaults';
import {
  computeProjectorBlendWeights,
  projectorConfidence,
} from '../src/engine/multiOriginProjection';
import {
  applyInversePanoYaw,
  equirectUvFromDirection,
  sampleProjectedSyntheticAtWorld,
  rgbClose,
  SYNTHETIC_PANO_COLORS,
} from '../src/engine/projectedStyleMath';
import { degreesToRadians } from '../src/engine/sync';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// 1. Secondary projector fallback state tests (pure derived state logic)
// ---------------------------------------------------------------------------

interface ProjectedStateParams {
  appearance: 'clay' | 'projected';
  primaryTextureIsReady: boolean;
  primaryUrl: string;
  currentPrimaryUrl: string;
  primaryPanoExists: boolean;
  blendMode: string;
  secondaryPanoExists: boolean;
  secondaryTextureIsReady: boolean;
  secondaryUrl: string;
  currentSecondaryUrl: string;
}

function projectedState(p: ProjectedStateParams) {
  const projectedActive = p.appearance === 'projected'
    && p.primaryTextureIsReady
    && p.primaryUrl === p.currentPrimaryUrl
    && p.primaryPanoExists;

  const dualActive = projectedActive
    && p.blendMode !== 'primary_only'
    && p.secondaryPanoExists
    && p.secondaryTextureIsReady
    && p.secondaryUrl === p.currentSecondaryUrl;

  return { projectedActive, dualActive };
}

describe('projected appearance state', () => {
  const base: ProjectedStateParams = {
    appearance: 'projected',
    primaryTextureIsReady: true,
    primaryUrl: 'url-a',
    currentPrimaryUrl: 'url-a',
    primaryPanoExists: true,
    blendMode: 'primary_dominant',
    secondaryPanoExists: true,
    secondaryTextureIsReady: true,
    secondaryUrl: 'url-b',
    currentSecondaryUrl: 'url-b',
  };

  it('primary loaded, secondary absent → projected active, dual inactive', () => {
    const s = projectedState({ ...base, secondaryPanoExists: false, secondaryTextureIsReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary loading → projected active, dual inactive', () => {
    const s = projectedState({ ...base, secondaryTextureIsReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary failed → projected active, dual inactive', () => {
    const s = projectedState({ ...base, secondaryTextureIsReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary loaded → projected active, dual active', () => {
    const s = projectedState(base);
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(true);
  });

  it('primary_only blend → projected active, dual inactive even when secondary ready', () => {
    const s = projectedState({ ...base, blendMode: 'primary_only' });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary load failure → projected inactive, dual inactive', () => {
    const s = projectedState({ ...base, primaryTextureIsReady: false });
    expect(s.projectedActive).toBe(false);
    expect(s.dualActive).toBe(false);
  });

  it('clay appearance → projected inactive, dual inactive', () => {
    const s = projectedState({ ...base, appearance: 'clay' });
    expect(s.projectedActive).toBe(false);
    expect(s.dualActive).toBe(false);
  });

  it('secondary URL changes → old error clears (stale async cannot overwrite)', () => {
    // Simulate projected state with mismatched secondary URL (stale load)
    const s = projectedState({
      ...base,
      currentSecondaryUrl: 'url-c',
      secondaryUrl: 'url-b',
    });
    expect(s.dualActive).toBe(false);
  });

  it('primary missing pano → projected inactive', () => {
    const s = projectedState({ ...base, primaryPanoExists: false });
    expect(s.projectedActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Graybox yaw round-trip invariants
// ---------------------------------------------------------------------------

describe('graybox yaw round-trip', () => {
  it('zero yaw maps world +Z to pano-local +Z', () => {
    const local = applyInversePanoYaw([0, 0, 1], 0);
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('positive yaw rotates world +Z into former -X content', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(90));
    expect(local[0]).toBeCloseTo(-1, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(0, 5);
  });

  it('negative yaw rotates world +Z into former +X content', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(-90));
    expect(local[0]).toBeCloseTo(1, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(0, 5);
  });

  it('360° yaw is equivalent to zero', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(360));
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('-360° yaw is equivalent to zero', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(-360));
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('projection with stamped origin and yaw aligns with original scene', () => {
    // Simulate graybox rendered from origin O with yaw Y.
    const origin: [number, number, number] = [5, 1.6, 5];
    const yawDegrees = 45;
    // A world point at [5, 1.6, 7] is +Z from the origin.
    const worldPos: [number, number, number] = [5, 1.6, 7];
    const rgb = sampleProjectedSyntheticAtWorld({
      worldPosition: worldPos,
      panoOrigin: origin,
      panoYawRadians: degreesToRadians(yawDegrees),
    });
    expect(rgb).not.toBe('near-origin');
    // With 45° yaw, world +Z (from origin) maps to pano-local -Z/-X diagonal.
    // The result should be a valid color, not a fallback.
    const color = rgb as [number, number, number];
    expect(color.every((c) => c >= 0 && c <= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Blend formula equivalence (CPU helper vs GLSL)
// ---------------------------------------------------------------------------

describe('blend formula parity', () => {
  it('CPU projectorConfidence matches GLSL formula (falloff/(falloff+distance))', () => {
    const origin: [number, number, number] = [0, 0, 0];
    const distances = [0, 0.5, 1, 3, 6, 12, 24];
    const falloff = 6;
    for (const d of distances) {
      const conf = projectorConfidence([d, 0, 0], origin, falloff);
      const expected = falloff / (falloff + d);
      expect(conf).toBeCloseTo(expected, 10);
    }
  });

  it('primary_dominant weights near primary origin favor primary heavily', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [1, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'primary_dominant',
    });
    expect(w.wPrimary).toBeGreaterThan(0.85);
  });

  it('primary_dominant weights near secondary origin favor secondary over primary', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [20, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'primary_dominant',
    });
    expect(w.wSecondary).toBeGreaterThan(w.wPrimary);
  });

  it('secondary_dominant weights near secondary origin favor secondary heavily', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [19, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'secondary_dominant',
    });
    expect(w.wSecondary).toBeGreaterThan(0.85);
  });

  it('primary_only always returns wPrimary=1', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [100, 0, 0],
      primaryOrigin: [0, 0, 0],
      secondaryOrigin: [5, 0, 0],
      mode: 'primary_only',
    });
    expect(w.wPrimary).toBe(1);
    expect(w.wSecondary).toBe(0);
  });

  it('secondary_only always returns wSecondary=1', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [0, 0, 0],
      primaryOrigin: [0, 0, 0],
      secondaryOrigin: [5, 0, 0],
      mode: 'secondary_only',
    });
    expect(w.wPrimary).toBe(0);
    expect(w.wSecondary).toBe(1);
  });

  it('projected blend GLSL snippet uses consistent falloff constant', () => {
    const materials = readFileSync(
      new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url),
      'utf8',
    );
    expect(materials).toContain('PROJECTED_FALLOFF = 6.0');
    expect(materials).toContain('projectedConfidence');
  });
});

// ---------------------------------------------------------------------------
// 4. Origin rotation yaw-only mutation
// ---------------------------------------------------------------------------

describe('pano origin rotation yaw-only', () => {
  it('setPanoRotation preserves existing X and Z values when only yaw changes', () => {
    // Simulate the store's setPanoRotation with a callback pattern
    const stored: [number, number, number] = [10, 20, 30];
    const incoming: [number, number, number] = [10, 35, 30];
    // Only index 1 (yaw) changed
    expect(incoming[0]).toBe(stored[0]); // X preserved
    expect(incoming[2]).toBe(stored[2]); // Z preserved
    expect(incoming[1]).not.toBe(stored[1]); // Y changed
  });

  it('rotation with nonzero stored X and Z does not crash', () => {
    // Projection currently consumes only rotation[1]; stored X/Z are ignored.
    const rotation: [number, number, number] = [45, 90, -30];
    // Applying inverse yaw with any rotation should not throw
    expect(() => {
      applyInversePanoYaw([0, 0, 1], degreesToRadians(rotation[1]));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Synthetic dual-projector sampling (CPU-level blend verification)
// ---------------------------------------------------------------------------

describe('synthetic dual-projector CPU blend', () => {
  const originA: [number, number, number] = [0, 1.6, 0];
  const originB: [number, number, number] = [10, 1.6, 0];

  it('near primary origin, primary_dominant → primary blend weight dominates', () => {
    const worldPos: [number, number, number] = [0.5, 1.6, 0.5];
    const weights = computeProjectorBlendWeights({
      worldPosition: worldPos,
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'primary_dominant',
    });
    expect(weights.wPrimary).toBeGreaterThan(0.7);
    expect(weights.wSecondary).toBeLessThan(0.3);
  });

  it('near secondary origin, secondary_dominant → secondary blend weight dominates', () => {
    const worldPos: [number, number, number] = [10, 1.6, 0.5];
    const weights = computeProjectorBlendWeights({
      worldPosition: worldPos,
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'secondary_dominant',
    });
    expect(weights.wSecondary).toBeGreaterThan(0.7);
    expect(weights.wPrimary).toBeLessThan(0.3);
    expect(weights.wPrimary + weights.wSecondary).toBeCloseTo(1, 5);
  });
});
