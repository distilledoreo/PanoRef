import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOMINANCE_BIAS,
  QUALITY_SCORE_EXPONENT,
  SCORE_EPSILON,
  SEAM_FEATHER_LOG2,
  VISIBILITY_EPSILON,
  computeProjectedStyleCoverageBlend,
  rgbClose,
  resolveQualityConflictOwnership,
} from '../src/engine/projectedStyleMath';

describe('projected coverage vs quality blend contract', () => {
  const primaryRgb: [number, number, number] = [1, 0, 0];
  const secondaryRgb: [number, number, number] = [0, 1, 0];
  const fallbackRgb: [number, number, number] = [0.75, 0.75, 0.7];

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
      primaryQuality: 0.02,
      secondaryQuality: 0,
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
      primaryQuality: 1,
      secondaryQuality: 0,
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
      primaryQuality: 1,
      secondaryQuality: 1,
    });

    expect(result.coverage).toBe(0);
    expect(result.mixFactor).toBe(0);
    expect(rgbClose(result.rgb, fallbackRgb)).toBe(true);
  });

  it('bad primary cannot contaminate secondary (quality 0 vs 0.1)', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0,
      secondaryQuality: 0.1,
    });

    expect(result.primaryWeight).toBeLessThan(0.01);
    expect(result.secondaryWeight).toBeGreaterThan(0.99);
    expect(rgbClose(result.rgb, secondaryRgb, 1e-3)).toBe(true);
  });

  it('sole visible projector wins regardless of quality', () => {
    const primaryOnly = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryQuality: 0,
      secondaryQuality: 1,
    });
    const secondaryOnly = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 0,
      secondaryVisibility: 1,
      primaryQuality: 1,
      secondaryQuality: 0,
    });

    expect(primaryOnly.primaryWeight).toBe(1);
    expect(primaryOnly.secondaryWeight).toBe(0);
    expect(secondaryOnly.primaryWeight).toBe(0);
    expect(secondaryOnly.secondaryWeight).toBe(1);
  });

  it('strong quality difference yields clear ownership (>95%)', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.8,
      secondaryQuality: 0.3,
    });

    expect(result.primaryWeight).toBeGreaterThan(0.95);
    expect(result.secondaryWeight).toBeLessThan(0.05);
    expect(result.coverage).toBeCloseTo(1, 5);
  });

  it('near-tie qualities feather both panoramas', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.51,
      secondaryQuality: 0.49,
    });

    // Exponent-4 scores amplify small gaps; 0.51 vs 0.49 still lands inside the
    // smoothstep feather (±0.30 log2), so both contribute rather than hard-cut.
    expect(result.primaryWeight).toBeGreaterThan(0.5);
    expect(result.primaryWeight).toBeLessThan(1);
    expect(result.secondaryWeight).toBeGreaterThan(0);
    expect(result.secondaryWeight).toBeLessThan(0.5);
    expect(result.primaryWeight + result.secondaryWeight).toBeCloseTo(1, 5);

    // Even closer qualities should land nearer the middle of the seam.
    const closer = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.502,
      secondaryQuality: 0.498,
    });
    expect(closer.primaryWeight).toBeLessThan(0.85);
    expect(closer.secondaryWeight).toBeGreaterThan(0.15);
  });

  it('dominance breaks a true quality tie', () => {
    const primaryDominant = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.5,
      secondaryQuality: 0.5,
      blendMode: 'primary_dominant',
    });
    const secondaryDominant = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.5,
      secondaryQuality: 0.5,
      blendMode: 'secondary_dominant',
    });

    expect(primaryDominant.primaryWeight).toBeGreaterThan(primaryDominant.secondaryWeight);
    expect(secondaryDominant.secondaryWeight).toBeGreaterThan(secondaryDominant.primaryWeight);
    expect(primaryDominant.primaryWeight).toBeCloseTo(secondaryDominant.secondaryWeight, 5);
    expect(primaryDominant.secondaryWeight).toBeCloseTo(secondaryDominant.primaryWeight, 5);
  });

  it('superior secondary defeats primary dominance', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.3,
      secondaryQuality: 0.8,
      blendMode: 'primary_dominant',
    });

    expect(result.secondaryWeight).toBeGreaterThan(0.95);
    expect(result.primaryWeight).toBeLessThan(0.05);
  });

  it('swapping projector inputs and blend modes mirrors weights', () => {
    const forward = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.62,
      secondaryQuality: 0.48,
      blendMode: 'primary_dominant',
    });
    const swapped = computeProjectedStyleCoverageBlend({
      ...base,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.48,
      secondaryQuality: 0.62,
      blendMode: 'secondary_dominant',
      primarySampleRgb: secondaryRgb,
      secondarySampleRgb: primaryRgb,
    });

    expect(forward.primaryWeight).toBeCloseTo(swapped.secondaryWeight, 5);
    expect(forward.secondaryWeight).toBeCloseTo(swapped.primaryWeight, 5);
  });

  it('no fallback washout: low quality still uses visibility for opacity', () => {
    const result = computeProjectedStyleCoverageBlend({
      ...base,
      secondaryEnabled: false,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryQuality: 0,
      secondaryQuality: 0,
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
      primaryQuality: 1,
      secondaryQuality: 0.2,
    });

    expect(result.primaryWeight).toBe(0);
    expect(result.secondaryWeight).toBe(1);
  });

  it('treats visibility exactly at VISIBILITY_EPSILON as available', () => {
    const result = resolveQualityConflictOwnership({
      primaryCoverage: VISIBILITY_EPSILON,
      secondaryCoverage: 0,
      primaryQuality: 0.01,
      secondaryQuality: 1,
    });

    expect(result.primaryWeight).toBe(1);
    expect(result.secondaryWeight).toBe(0);
  });

  it('exports shared constants for GLSL parity', () => {
    expect(DOMINANCE_BIAS).toBe(1.04);
    expect(SEAM_FEATHER_LOG2).toBeCloseTo(0.3, 5);
    expect(SCORE_EPSILON).toBeCloseTo(1e-6, 12);
    expect(VISIBILITY_EPSILON).toBeCloseTo(0.001, 6);
    expect(QUALITY_SCORE_EXPONENT).toBe(4);
  });

  it('shader mirrors TypeScript conflict resolution constants and branching', () => {
    const materials = readFileSync(
      new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url),
      'utf8',
    );
    const math = readFileSync(
      new URL('../src/engine/projectedStyleMath.ts', import.meta.url),
      'utf8',
    );
    expect(materials).toContain('const float DOMINANCE_BIAS = 1.04;');
    expect(materials).toContain('const float SEAM_FEATHER_LOG2 = 0.30;');
    expect(materials).toContain('const float SCORE_EPSILON = 1e-6;');
    expect(materials).toContain('const float VISIBILITY_EPSILON = 0.001;');
    expect(materials).toContain('float qualityRatio = log2(');
    expect(materials).toContain('smoothstep(');
    expect(materials).toContain('-SEAM_FEATHER_LOG2');
    expect(materials).toContain('float coverage = max(primaryCoverage, secondaryCoverage);');
    expect(materials).not.toContain('0.001 + pow(primaryQuality');
    expect(materials).not.toContain('? 1.15 : 1.0');
    expect(math).toContain('export const DOMINANCE_BIAS = 1.04;');
    expect(math).toContain('resolveQualityConflictOwnership');
    expect(math).toContain('Math.log2');
    expect(materials).toContain('generateMipmaps = false');
    expect(materials).toContain('minFilter = THREE.LinearFilter');
    expect(math).toContain('quantizationBias');
    expect(math).toContain('firstHit * 0.01');
    expect(math).toContain('if (center > 0.5)');
    expect(math).toContain('mix(center, averaged, 0.25)');
  });
});
