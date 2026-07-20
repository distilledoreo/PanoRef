import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeProjectedStyleCoverageBlend,
  rgbClose,
} from '../src/engine/projectedStyleMath';

describe('projected coverage vs quality blend contract', () => {
  const primaryRgb: [number, number, number] = [1, 0, 0];
  const secondaryRgb: [number, number, number] = [0, 1, 0];
  const fallbackRgb: [number, number, number] = [0.75, 0.75, 0.7];

  it('does not wash a visible primary-only sample toward fallback when quality is low', () => {
    const result = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: false,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryQuality: 0.02,
      secondaryQuality: 0,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(result.coverage).toBeCloseTo(1, 5);
    expect(result.mixFactor).toBeCloseTo(1, 5);
    expect(rgbClose(result.rgb, primaryRgb, 1e-4)).toBe(true);
  });

  it('softens into fallback on true soft occlusion silhouettes', () => {
    const result = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: false,
      primaryVisibility: 0.4,
      secondaryVisibility: 0,
      primaryQuality: 1,
      secondaryQuality: 0,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(result.coverage).toBeCloseTo(0.4, 5);
    expect(result.mixFactor).toBeCloseTo(0.4, 5);
    expect(result.rgb[0]).toBeCloseTo(fallbackRgb[0] * 0.6 + primaryRgb[0] * 0.4, 4);
  });

  it('uses fallback when projectors are fully occluded', () => {
    const result = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: true,
      primaryVisibility: 0,
      secondaryVisibility: 0,
      primaryQuality: 1,
      secondaryQuality: 1,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(result.coverage).toBe(0);
    expect(result.mixFactor).toBe(0);
    expect(rgbClose(result.rgb, fallbackRgb)).toBe(true);
  });

  it('lets quality rank dual projectors without changing coverage opacity', () => {
    const prefersPrimary = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: true,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.9,
      secondaryQuality: 0.1,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });
    const prefersSecondary = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: true,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.1,
      secondaryQuality: 0.9,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(prefersPrimary.coverage).toBeCloseTo(1, 5);
    expect(prefersSecondary.coverage).toBeCloseTo(1, 5);
    expect(prefersPrimary.primaryWeight).toBeGreaterThan(prefersPrimary.secondaryWeight);
    expect(prefersSecondary.secondaryWeight).toBeGreaterThan(prefersSecondary.primaryWeight);
    expect(prefersPrimary.rgb[0]).toBeGreaterThan(prefersPrimary.rgb[1]);
    expect(prefersSecondary.rgb[1]).toBeGreaterThan(prefersSecondary.rgb[0]);
  });

  it('respects primary/secondary dominance bias when qualities are equal', () => {
    const primaryDominant = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: true,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.5,
      secondaryQuality: 0.5,
      primaryDominance: 1.15,
      secondaryDominance: 1,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });
    const secondaryDominant = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: true,
      primaryVisibility: 1,
      secondaryVisibility: 1,
      primaryQuality: 0.5,
      secondaryQuality: 0.5,
      primaryDominance: 1,
      secondaryDominance: 1.15,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(primaryDominant.primaryWeight).toBeGreaterThan(primaryDominant.secondaryWeight);
    expect(secondaryDominant.secondaryWeight).toBeGreaterThan(secondaryDominant.primaryWeight);
  });

  it('keeps a positive weighting floor so low quality never collapses to black', () => {
    const result = computeProjectedStyleCoverageBlend({
      primaryEnabled: true,
      secondaryEnabled: false,
      primaryVisibility: 1,
      secondaryVisibility: 0,
      primaryQuality: 0,
      secondaryQuality: 0,
      projectedOpacity: 1,
      primarySampleRgb: primaryRgb,
      secondarySampleRgb: secondaryRgb,
      fallbackRgb,
    });

    expect(result.primaryWeight).toBeGreaterThan(0);
    expect(result.mixFactor).toBeCloseTo(1, 5);
    expect(rgbClose(result.rgb, primaryRgb, 1e-4)).toBe(true);
  });

  it('shader separates visibility coverage from quality ranking', () => {
    const materials = readFileSync(
      new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url),
      'utf8',
    );
    const math = readFileSync(
      new URL('../src/engine/projectedStyleMath.ts', import.meta.url),
      'utf8',
    );
    expect(materials).toContain('float primaryCoverage = primaryEnabled * primaryVisibility;');
    expect(materials).toContain('float secondaryCoverage = secondaryEnabled * secondaryVisibility;');
    expect(materials).toContain('float coverage = max(primaryCoverage, secondaryCoverage);');
    expect(materials).toContain('0.001 + pow(primaryQuality * primaryDominance, 4.0)');
    expect(materials).toContain('0.001 + pow(secondaryQuality * secondaryDominance, 4.0)');
    expect(materials).toContain('/ max(weightTotal, 0.0001)');
    expect(materials).not.toContain('float primaryScore = primaryEnabled * primaryVisibility * primaryQuality');
    expect(materials).toContain('float p = primaryCoverage;');
    expect(materials).toContain('float s = secondaryCoverage;');
    expect(materials).toContain('generateMipmaps = false');
    expect(materials).toContain('minFilter = THREE.LinearFilter');
    // Non-occluded strip prevention: adaptive bias + trust visible center taps.
    expect(math).toContain('quantizationBias');
    expect(math).toContain('firstHit * 0.01');
    expect(math).toContain('if (center > 0.5)');
    expect(math).toContain('mix(center, averaged, 0.25)');
  });
});
