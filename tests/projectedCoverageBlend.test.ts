import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DENSITY_EPSILON,
  DOMINANCE_BIAS,
  SCORE_EPSILON,
  SEAM_FEATHER_LOG2,
  VISIBILITY_EPSILON,
  computeProjectedStyleCoverageBlend,
  projectedLogQuality,
  projectedLogQualityAt,
  projectedTexelConstant,
  projectedTexelDensity,
  rgbClose,
  resolveQualityConflictOwnership,
} from '../src/engine/projectedStyleMath';

describe('projected coverage vs quality blend contract', () => {
  const primaryRgb: [number, number, number] = [1, 0, 0];
  const secondaryRgb: [number, number, number] = [0, 1, 0];
  const fallbackRgb: [number, number, number] = [0.75, 0.75, 0.7];
  const texel4k = projectedTexelConstant(4096, 2048);
  const texel8k = projectedTexelConstant(8192, 4096);

  const base = {
    primaryEnabled: true,
    secondaryEnabled: true,
    projectedOpacity: 1,
    primarySampleRgb: primaryRgb,
    secondarySampleRgb: secondaryRgb,
    fallbackRgb,
  } as const;

  it('does not wash a visible primary-only sample toward fallback when quality is low', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      secondaryEnabled: false,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryDistanceMeters: 40,
      secondaryDistanceMeters: 1,
      primaryFacing: 0.2,
      secondaryFacing: 1,
    });

    expect(result.coverage).toBeCloseTo(1, 5);
    expect(result.mixFactor).toBeCloseTo(1, 5);
    expect(result.primaryWeight).toBeCloseTo(1, 5);
    expect(rgbClose(result.rgb, primaryRgb, 1e-4)).toBe(true);
  });

  it('softens into fallback on true soft occlusion silhouettes', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      secondaryEnabled: false,
      primaryVisibility: 0.4,
      secondaryVisibility: 0,
      primaryDistanceMeters: 2,
      secondaryDistanceMeters: 2,
      primaryFacing: 1,
      secondaryFacing: 1,
    });

    expect(result.coverage).toBeCloseTo(0.4, 5);
    expect(result.mixFactor).toBeCloseTo(0.4, 5);
    expect(result.rgb[0]).toBeCloseTo(fallbackRgb[0] * 0.6 + primaryRgb[0] * 0.4, 4);
  });

  it('uses fallback when projectors are fully occluded', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 0,
      secondaryVisibility: 0,
      primaryDistanceMeters: 2,
      secondaryDistanceMeters: 2,
    });

    expect(result.coverage).toBe(0);
    expect(result.mixFactor).toBe(0);
    expect(rgbClose(result.rgb, fallbackRgb)).toBe(true);
  });

  it('sole visible projector wins regardless of quality', () => {
    const primaryOnly = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryDistanceMeters: 40,
      secondaryDistanceMeters: 1,
      primaryFacing: 0.1,
      secondaryFacing: 1,
    });
    const secondaryOnly = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 0,
      secondaryVisibility: 1,
      primaryDistanceMeters: 1,
      secondaryDistanceMeters: 40,
      primaryFacing: 1,
      secondaryFacing: 0.1,
    });

    expect(primaryOnly.primaryWeight).toBe(1);
    expect(primaryOnly.secondaryWeight).toBe(0);
    expect(secondaryOnly.primaryWeight).toBe(0);
    expect(secondaryOnly.secondaryWeight).toBe(1);
  });

  it('same resolution at 2 m versus 8 m prefers the closer projector', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 2,
      secondaryDistanceMeters: 8,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel4k,
      secondaryTexelConstant: texel4k,
    });

    expect(result.primaryWeight).toBeGreaterThan(0.95);
    expect(result.secondaryWeight).toBeLessThan(0.05);
    // Unsaturated densities remain distinct (4× distance → 16× density → 4 stops).
    expect(result.qualityDelta).toBeGreaterThan(3.5);
  });

  it('8K versus 4K at equal distance prefers the higher-resolution panorama', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 10,
      secondaryDistanceMeters: 10,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel8k,
      secondaryTexelConstant: texel4k,
    });

    expect(result.primaryWeight).toBeGreaterThan(0.95);
    expect(result.qualityDelta).toBeGreaterThan(1.5);
  });

  it('equal-facing projectors at ordinary room distances keep a distance advantage', () => {
    // Under the old smoothstep(128,1024) both 10 m and 20 m saturated to ~1.0.
    const density10 = projectedTexelDensity({
      texelConstant: texel4k,
      facing: 1,
      distanceSquared: 100,
    });
    const density20 = projectedTexelDensity({
      texelConstant: texel4k,
      facing: 1,
      distanceSquared: 400,
    });
    expect(density10).toBeGreaterThan(1024);
    expect(density20).toBeGreaterThan(1024);

    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 10,
      secondaryDistanceMeters: 20,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel4k,
      secondaryTexelConstant: texel4k,
      blendMode: 'primary_dominant',
    });

    // Closer projector wins decisively; dominance is not required.
    expect(result.primaryWeight).toBeGreaterThan(0.95);
    expect(result.qualityDelta).toBeGreaterThan(1.5);
  });

  it('nearly occluded higher-quality source loses to fully visible lower-quality source', () => {
    // Pathological case from the review: coverage 0.001 with better intrinsic
    // quality must not beat coverage 1.0 with weaker intrinsic quality.
    const primaryLog = projectedLogQuality({
      texelDensity: projectedTexelDensity({
        texelConstant: texel4k,
        facing: 1,
        distanceSquared: 4, // closer / denser
      }),
      facing: 1,
      coverage: 0.001,
    });
    const secondaryLog = projectedLogQuality({
      texelDensity: projectedTexelDensity({
        texelConstant: texel4k,
        facing: 1,
        distanceSquared: 100, // farther / thinner
      }),
      facing: 1,
      coverage: 1,
    });

    const result = resolveQualityConflictOwnership({
      primaryCoverage: 0.001,
      secondaryCoverage: 1,
      primaryLogQuality: primaryLog,
      secondaryLogQuality: secondaryLog,
      primaryLowRank: 0.001 * 0.10,
      secondaryLowRank: 1.0 * 0.03,
      primaryBias: DOMINANCE_BIAS,
    });

    expect(result.secondaryWeight).toBeGreaterThan(0.95);
    expect(result.primaryWeight).toBeLessThan(0.05);
  });

  it('coverage-aware low-rank never awards an almost-occluded projector', () => {
    const result = resolveQualityConflictOwnership({
      primaryCoverage: VISIBILITY_EPSILON,
      secondaryCoverage: VISIBILITY_EPSILON,
      primaryLogQuality: 20,
      secondaryLogQuality: 5,
      primaryLowRank: VISIBILITY_EPSILON * 0.10,
      secondaryLowRank: VISIBILITY_EPSILON * 0.03,
    });

    // Both barely visible and equal coverage → coverage*quality low-rank decides.
    expect(result.primaryWeight).toBe(1);
    expect(result.secondaryWeight).toBe(0);

    const prefersVisible = resolveQualityConflictOwnership({
      primaryCoverage: VISIBILITY_EPSILON,
      secondaryCoverage: VISIBILITY_EPSILON * 1.6,
      primaryLogQuality: 20,
      secondaryLogQuality: 5,
      primaryLowRank: VISIBILITY_EPSILON * 0.9,
      secondaryLowRank: VISIBILITY_EPSILON * 1.6 * 0.05,
    });
    expect(prefersVisible.secondaryWeight).toBe(1);
  });

  it('dominance only nudges a true log-quality tie', () => {
    const logQ = projectedLogQualityAt({
      distanceMeters: 10,
      facing: 1,
      texelConstant: texel4k,
      coverage: 1,
    });
    const primaryDominant = resolveQualityConflictOwnership({
      primaryCoverage: 1,
      secondaryCoverage: 1,
      primaryLogQuality: logQ,
      secondaryLogQuality: logQ,
      primaryBias: DOMINANCE_BIAS,
      secondaryBias: 1,
    });
    const secondaryDominant = resolveQualityConflictOwnership({
      primaryCoverage: 1,
      secondaryCoverage: 1,
      primaryLogQuality: logQ,
      secondaryLogQuality: logQ,
      primaryBias: 1,
      secondaryBias: DOMINANCE_BIAS,
    });

    // log2(1.04) ≈ 0.057 inside ±0.30 feather → mild preference, not ~96%.
    expect(primaryDominant.primaryWeight).toBeGreaterThan(0.5);
    expect(primaryDominant.primaryWeight).toBeLessThan(0.7);
    expect(secondaryDominant.secondaryWeight).toBeCloseTo(primaryDominant.primaryWeight, 5);
  });

  it('superior secondary defeats primary dominance at ordinary distances', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 16,
      secondaryDistanceMeters: 4,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel4k,
      secondaryTexelConstant: texel4k,
      blendMode: 'primary_dominant',
    });

    expect(result.secondaryWeight).toBeGreaterThan(0.95);
    expect(result.primaryWeight).toBeLessThan(0.05);
  });

  it('near-tie log qualities feather both panoramas', () => {
    const baseLog = projectedLogQualityAt({
      distanceMeters: 10,
      facing: 1,
      texelConstant: texel4k,
      coverage: 1,
    });
    const result = resolveQualityConflictOwnership({
      primaryCoverage: 1,
      secondaryCoverage: 1,
      primaryLogQuality: baseLog + 0.12,
      secondaryLogQuality: baseLog,
    });

    expect(result.primaryWeight).toBeGreaterThan(0.5);
    expect(result.primaryWeight).toBeLessThan(0.95);
    expect(result.secondaryWeight).toBeGreaterThan(0.05);
  });

  it('swapping projector inputs and blend modes mirrors weights', () => {
    const forward = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 6,
      secondaryDistanceMeters: 9,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel4k,
      secondaryTexelConstant: texel4k,
      blendMode: 'primary_dominant',
    });
    const swapped = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryDistanceMeters: 9,
      secondaryDistanceMeters: 6,
      primaryFacing: 1,
      secondaryFacing: 1,
      primaryTexelConstant: texel4k,
      secondaryTexelConstant: texel4k,
      blendMode: 'secondary_dominant',
      primarySampleRgb: secondaryRgb,
      secondarySampleRgb: primaryRgb,
    });

    expect(forward.primaryWeight).toBeCloseTo(swapped.secondaryWeight, 5);
    expect(forward.secondaryWeight).toBeCloseTo(swapped.primaryWeight, 5);
  });

  it('no fallback washout: opacity stays governed by visibility, not quality', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      secondaryEnabled: false,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryDistanceMeters: 50,
      primaryFacing: 0.05,
    });

    expect(result.coverage).toBeCloseTo(1, 5);
    expect(result.mixFactor).toBeCloseTo(1, 5);
    expect(result.primaryWeight).toBe(1);
    expect(rgbClose(result.rgb, primaryRgb, 1e-4)).toBe(true);
  });

  it('treats extremely weak visibility as unavailable via VISIBILITY_EPSILON', () => {
    const result = resolveQualityConflictOwnership({
      primaryCoverage: VISIBILITY_EPSILON * 0.5,
      secondaryCoverage: 1,
      primaryLogQuality: 30,
      secondaryLogQuality: 5,
    });

    expect(result.primaryWeight).toBe(0);
    expect(result.secondaryWeight).toBe(1);
  });

  it('treats visibility exactly at VISIBILITY_EPSILON as available', () => {
    const result = resolveQualityConflictOwnership({
      primaryCoverage: VISIBILITY_EPSILON,
      secondaryCoverage: 0,
      primaryLogQuality: -10,
      secondaryLogQuality: 30,
    });

    expect(result.primaryWeight).toBe(1);
    expect(result.secondaryWeight).toBe(0);
  });

  it('exports shared constants for GLSL parity', () => {
    expect(DOMINANCE_BIAS).toBe(1.04);
    expect(SEAM_FEATHER_LOG2).toBeCloseTo(0.3, 5);
    expect(SCORE_EPSILON).toBeCloseTo(1e-6, 12);
    expect(VISIBILITY_EPSILON).toBeCloseTo(0.001, 6);
    expect(DENSITY_EPSILON).toBeCloseTo(0.001, 6);
  });

  it('shader uses unsaturated log density rather than saturated resolutionQuality', () => {
    const materials = readFileSync(
      new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url),
      'utf8',
    );
    const math = readFileSync(
      new URL('../src/engine/projectedStyleMath.ts', import.meta.url),
      'utf8',
    );
    expect(materials).toContain('projectedLogQualityAt');
    expect(materials).toContain('const float DOMINANCE_BIAS = 1.04;');
    expect(materials).toContain('const float SEAM_FEATHER_LOG2 = 0.30;');
    expect(materials).toContain('const float DENSITY_EPSILON = 0.001;');
    expect(materials).toContain('float qualityDelta =');
    expect(materials).toContain('log2(max(texelDensity, 0.001))');
    expect(materials).toContain('visibilityPenalty');
    expect(materials).not.toContain('smoothstep(128.0, 1024.0, texelDensity)');
    expect(materials).not.toContain('projectedQualityAt');
    expect(materials).not.toContain('0.001 + pow(primaryQuality');
    expect(materials).not.toContain('pow(clamp(primaryQuality * primaryBias');
    expect(math).toContain('export const DOMINANCE_BIAS = 1.04;');
    expect(math).toContain('projectedLogQuality');
    expect(math).toContain('resolveQualityConflictOwnership');
    expect(materials).toContain('generateMipmaps = false');
    expect(materials).toContain('minFilter = THREE.LinearFilter');
    expect(math).toContain('quantizationBias');
    expect(math).toContain('firstHit * 0.01');
    expect(math).toContain('if (center > 0.5)');
    expect(math).toContain('mix(center, averaged, 0.25)');
  });
});
