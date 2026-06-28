import { describe, expect, it } from 'vitest';
import {
  directionToEquirectUv,
  isProjectionDistanceVisible,
  shouldUseProjectedPano,
  surfaceFacingConfidence,
  worldDirectionToPanoUv,
} from '../src/engine/projection';

describe('projection math', () => {
  it('maps world directions to equirectangular UV orientation', () => {
    expect(directionToEquirectUv([0, 0, 1])).toEqual({ u: 0.5, v: 0.5 });
    expect(directionToEquirectUv([1, 0, 0]).u).toBeCloseTo(0.75, 5);
    expect(directionToEquirectUv([0, 1, 0]).v).toBeCloseTo(1, 5);
  });

  it('applies pano yaw calibration when sampling a world direction', () => {
    expect(worldDirectionToPanoUv([1, 0, 0], 90).u).toBeCloseTo(0.5, 5);
    expect(worldDirectionToPanoUv([0, 0, 1], 90).u).toBeCloseTo(0.25, 5);
  });

  it('accepts front-facing surfaces', () => {
    expect(surfaceFacingConfidence([0, 0, -1], [0, 0, 1])).toBeCloseTo(1, 5);
  });

  it('rejects backsides', () => {
    expect(shouldUseProjectedPano({
      surfaceNormal: [0, 0, 1],
      fromPanoDirection: [0, 0, 1],
      hitDistanceMeters: 5,
      nearestDistanceMeters: 5,
    })).toBe(false);
  });

  it('rejects grazing-angle surfaces', () => {
    expect(shouldUseProjectedPano({
      surfaceNormal: [1, 0, 0],
      fromPanoDirection: [0, 0, 1],
      hitDistanceMeters: 5,
      nearestDistanceMeters: 5,
    })).toBe(false);
  });

  it('applies occlusion distance with bias', () => {
    expect(isProjectionDistanceVisible(5.2, 5, 0.25)).toBe(true);
    expect(isProjectionDistanceVisible(5.3, 5, 0.25)).toBe(false);
  });
});
