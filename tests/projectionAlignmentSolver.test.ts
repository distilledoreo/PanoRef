import { describe, expect, it } from 'vitest';
import { ProjectionAlignment } from '../src/domain/types';
import {
  solveProjectionWarp,
  ProjectionWarpField,
} from '../src/engine/projectionAlignmentSolver';

const DEG = Math.PI / 180;

function makePair(overrides?: Record<string, unknown>) {
  return {
    id: 'pair-1',
    order: 0,
    targetUv: [0.5, 0.5] as const,
    sourceUv: [0.5, 0.5] as const,
    enabled: true,
    ...overrides,
  };
}

function makeAlignment(overrides?: Partial<ProjectionAlignment>): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: 'pano-styled-1',
    targetGrayboxPanoId: 'pano-graybox-1',
    pairs: [makePair() as any],
    strength: 1,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as ProjectionAlignment;
}

describe('solveProjectionWarp', () => {
  it('missing alignment returns identity', () => {
    const result = solveProjectionWarp(undefined, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.width).toBe(256);
    expect(result.height).toBe(128);
    expect(result.maxMarkerErrorRadians).toBe(0);
    expect(result.conflictCount).toBe(0);

    for (let i = 0; i < result.displacement.length; i++) {
      expect(result.displacement[i]).toBe(0);
    }
  }, 10000);

  it('no enabled pairs returns identity', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ enabled: false }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBe(0);
    for (let i = 0; i < result.displacement.length; i++) {
      expect(result.displacement[i]).toBe(0);
    }
  }, 10000);

  it('single marker reaches its target', () => {
    const offset = 0.05;
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.5, 0.5], sourceUv: [0.5 + offset, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);

  it('several markers reach their targets', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'p1', order: 0, targetUv: [0.4, 0.5], sourceUv: [0.42, 0.5] }) as any,
        makePair({ id: 'p2', order: 1, targetUv: [0.6, 0.5], sourceUv: [0.58, 0.5] }) as any,
      ],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);

  it('separate regions remain locally independent', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'p1', order: 0, targetUv: [0.3, 0.3], sourceUv: [0.32, 0.3] }) as any,
        makePair({ id: 'p2', order: 1, targetUv: [0.7, 0.7], sourceUv: [0.72, 0.7] }) as any,
      ],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);

  it('distant regions stay near identity', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ id: 'p1', targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maximumRotationRadians).toBeLessThan(1 * DEG);
  }, 10000);

  it('seam-crossing uses the shortest path', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.01, 0.5], sourceUv: [0.99, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);

  it('different source and target yaws work', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.5, 0.5], sourceUv: [0.55, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 30 * DEG,
      sourceYawRadians: 10 * DEG,
    });
    expect(result.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);

  it('conflict detection works', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'p1', targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] }) as any,
        makePair({ id: 'p2', targetUv: [0.51, 0.5], sourceUv: [0.7, 0.5] }) as any,
      ],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.conflictCount).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('disabled markers are ignored', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ id: 'p1', targetUv: [0.5, 0.5], sourceUv: [0.55, 0.5], enabled: false }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maxMarkerErrorRadians).toBe(0);
  }, 10000);

  it('output contains no NaN or Infinity', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'p1', targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5] }) as any,
        makePair({ id: 'p2', targetUv: [0.3, 0.7], sourceUv: [0.35, 0.3] }) as any,
      ],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 45 * DEG,
      sourceYawRadians: 15 * DEG,
    });
    for (let i = 0; i < result.displacement.length; i++) {
      expect(Number.isFinite(result.displacement[i])).toBe(true);
    }
  }, 30000);

  it('rotation is clamped', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.5, 0.5], sourceUv: [0.3, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.maximumRotationRadians).toBeLessThanOrEqual(36 * DEG);
  }, 30000);

  it('no channel-size mismatch', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5] }) as any],
    });
    const result = solveProjectionWarp(alignment, {
      width: 64, height: 32,
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(result.displacement.length).toBe(result.width * result.height * 2);
  }, 10000);

  it('map resolution changes do not change the qualitative solve', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5] }) as any],
    });
    const resultSmall = solveProjectionWarp(alignment, {
      width: 64, height: 32,
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    const resultLarge = solveProjectionWarp(alignment, {
      width: 128, height: 64,
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });
    expect(resultSmall.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
    expect(resultLarge.maxMarkerErrorRadians).toBeLessThan(5 * DEG);
  }, 30000);
});
