import { describe, expect, it } from 'vitest';
import type { ProjectionAlignment, ProjectionControlPair, Vec2 } from '../src/domain/types';
import { solveProjectionWarp } from '../src/engine/projectionAlignmentSolver';

function pair(id: string, targetUv: Vec2, sourceUv: Vec2, order: number): ProjectionControlPair {
  return { id, order, targetUv, sourceUv, enabled: true };
}

function displacementMagnitudeAt(
  displacement: Float32Array,
  width: number,
  uv: Vec2,
): number {
  const height = displacement.length / (width * 2);
  const x = Math.min(width - 1, Math.floor(uv[0] * width));
  const y = Math.min(height - 1, Math.floor(uv[1] * height));
  const offset = (y * width + x) * 2;
  return Math.hypot(displacement[offset], displacement[offset + 1]);
}

describe('Projection Assist global-warp limitation fixture', () => {
  it('documents that canopy control points influence unrelated throne-room surfaces', () => {
    const alignment: ProjectionAlignment = {
      version: 1,
      solver: 'spherical-rbf-v1',
      sourcePanoId: 'throne-room-styled',
      targetGrayboxPanoId: 'throne-room-graybox',
      pairs: [
        pair('canopy-left', [0.45, 0.27], [0.42, 0.22], 0),
        pair('canopy-right', [0.55, 0.27], [0.58, 0.22], 1),
        pair('canopy-base', [0.50, 0.38], [0.50, 0.33], 2),
      ],
      strength: 1,
      updatedAt: '2026-07-18T00:00:00.000Z',
    };

    const result = solveProjectionWarp(alignment, {
      width: 128,
      height: 64,
      targetYawRadians: 0,
      sourceYawRadians: 0,
    });

    // The wall sample lies below and outside the canopy polygon. This non-zero motion is
    // the behavior Region Fit replaces; keep this as a characterization test,
    // not as a desired contract for the legacy solver.
    expect(displacementMagnitudeAt(result.displacement, result.width, [0.50, 0.45])).toBeGreaterThan(0);
  }, 30_000);
});
