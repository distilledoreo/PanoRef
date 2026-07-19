import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/domain/types';
import { createProjectionRegion, createProjectionRegionAlignment, createProjectionRegionVertexPair } from '../src/domain/defaults';
import { applyYawRotation, equirectUvToUnitDirection, shortestWrappedDeltaU } from '../src/engine/projectionAlignmentMath';
import { panoUvToScreenPoint, screenPointToPanoUv } from '../src/engine/panoViewerPicking';
import { regionToCommonPlane, tangentPlaneToUnitDirection, targetUvToSourceUv, unitDirectionToTangentPlane } from '../src/engine/projectionRegionCoordinates';
import { decodeRegionDisplacement, generateProjectionRegionTexture } from '../src/engine/projectionRegionTexture';

const viewport = { width: 1000, height: 500 };
const sharedView = { yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 };
const rotation = (yawDegrees: number): [number, number, number] => [0, yawDegrees, 0];
const radians = (degrees: number) => degrees * Math.PI / 180;

function region(points: [number, number][], source = points) {
  return createProjectionRegion(points.map((point, index) => createProjectionRegionVertexPair(point, source[index], `v${index}`)));
}

function pureYawRegion() {
  const targetPoints: Vec2[] = [[0.46, 0.46], [0.54, 0.46], [0.54, 0.54], [0.46, 0.54]];
  return createProjectionRegion(
    targetPoints.map((targetUv, index) =>
      createProjectionRegionVertexPair(
        targetUv,
        targetUvToSourceUv(targetUv, 0, 60),
        `yaw-${index}`,
      ),
    ),
  );
}

describe('Projection Region Fit coordinate conversion', () => {
  it('keeps local UV identical when panorama yaw is equal', () => {
    const targetUv: Vec2 = [0.4, 0.4];
    expect(targetUvToSourceUv(targetUv, 25, 25)).toEqual(targetUv);
  });

  it('converts different-yaw local UVs to the same shared-view screen point', () => {
    const targetUv: Vec2 = [0.4, 0.4];
    const sourceUv = targetUvToSourceUv(targetUv, 0, 60);
    expect(sourceUv[0]).not.toBeCloseTo(targetUv[0], 4);
    const targetPoint = panoUvToScreenPoint(targetUv, viewport, sharedView, rotation(0));
    const sourcePoint = panoUvToScreenPoint(sourceUv, viewport, sharedView, rotation(60));
    expect(sourcePoint.visible).toBe(true);
    expect(sourcePoint.x).toBeCloseTo(targetPoint.x, 6);
    expect(sourcePoint.y).toBeCloseTo(targetPoint.y, 6);
  });

  it('requires no manual adjustment for a pure-yaw-offset polygon', () => {
    const region = pureYawRegion();
    region.vertices.forEach((vertex) => {
      const targetPoint = panoUvToScreenPoint(vertex.targetUv, viewport, sharedView, rotation(0));
      const sourcePoint = panoUvToScreenPoint(vertex.sourceUv, viewport, sharedView, rotation(60));
      expect(sourcePoint.visible).toBe(true);
      expect(sourcePoint.x).toBeCloseTo(targetPoint.x, 6);
      expect(sourcePoint.y).toBeCloseTo(targetPoint.y, 6);
    });
  });

  it('round-trips target local direction through world and source local direction', () => {
    const targetUv: Vec2 = [0.37, 0.61];
    const targetWorld = applyYawRotation(equirectUvToUnitDirection(targetUv), radians(18));
    const sourceUv = targetUvToSourceUv(targetUv, 18, -47);
    const recoveredWorld = applyYawRotation(equirectUvToUnitDirection(sourceUv), radians(-47));
    recoveredWorld.forEach((value, index) => expect(value).toBeCloseTo(targetWorld[index], 8));
  });

  it('keeps seam-crossing conversion continuous', () => {
    const targetA: Vec2 = [0.99, 0.5];
    const targetB: Vec2 = [0.01, 0.5];
    const sourceA = targetUvToSourceUv(targetA, 12, 83);
    const sourceB = targetUvToSourceUv(targetB, 12, 83);
    expect(shortestWrappedDeltaU(targetA[0], targetB[0])).toBeCloseTo(
      shortestWrappedDeltaU(sourceA[0], sourceB[0]),
      8,
    );
    expect(Math.abs(shortestWrappedDeltaU(sourceA[0], sourceB[0]))).toBeLessThan(0.05);
  });

  it('inverts a styled handle drag through the styled panorama rotation', () => {
    const sourceUv = targetUvToSourceUv([0.43, 0.56], 0, 75);
    const view = { yawDegrees: 22, pitchDegrees: -6, fovDegrees: 72 };
    const screenPoint = panoUvToScreenPoint(sourceUv, viewport, view, rotation(75));
    expect(screenPoint.visible).toBe(true);
    const recoveredUv = screenPointToPanoUv(screenPoint, viewport, view, rotation(75));
    expect(recoveredUv?.[0]).toBeCloseTo(sourceUv[0], 8);
    expect(recoveredUv?.[1]).toBeCloseTo(sourceUv[1], 8);
  });

  it('keeps identity content undeformed in the yaw-aware preview plane', () => {
    const region = pureYawRegion();
    const plane = regionToCommonPlane(region, {
      targetYawRadians: 0,
      sourceYawRadians: radians(60),
    });
    expect(plane.diagnostics.valid).toBe(true);
    plane.target.forEach((targetPoint, index) => {
      expect(plane.source[index][0]).toBeCloseTo(targetPoint[0], 8);
      expect(plane.source[index][1]).toBeCloseTo(targetPoint[1], 8);
    });
  });

  it('applies yaw compensation once in the runtime Region Fit texture', () => {
    const alignment = createProjectionRegionAlignment('styled', 'graybox', [pureYawRegion()]);
    const result = generateProjectionRegionTexture(alignment, {
      sourceYawRadians: radians(60),
      targetYawRadians: 0,
      quality: 'preview',
    });
    try {
      const sourceCenter = targetUvToSourceUv([0.5, 0.5], 0, 60);
      const center = Math.floor(sourceCenter[1] * result.height) * result.width + Math.floor(sourceCenter[0] * result.width);
      const displacement = decodeRegionDisplacement(result.displacement[center * 2], result.displacement[center * 2 + 1]);
      expect(result.diagnostics.every((diagnostic) => diagnostic.valid)).toBe(true);
      expect(result.weight[center]).toBe(255);
      expect(displacement[0]).toBeCloseTo(0, 3);
      expect(displacement[1]).toBeCloseTo(0, 3);
    } finally {
      result.release();
    }
  });
});

describe('Region Fit common spherical coordinates', () => {
  it('maps paired identity outlines into one plane and round-trips directions', () => {
    const result = regionToCommonPlane(region([[0.45, 0.45], [0.55, 0.45], [0.5, 0.55]]), { targetYawRadians: 0, sourceYawRadians: 0 });
    expect(result.diagnostics.valid).toBe(true); expect(result.target).toEqual(result.source);
    const direction = tangentPlaneToUnitDirection(result.target[0], result.basis);
    expect(unitDirectionToTangentPlane(direction, result.basis)?.[0]).toBeCloseTo(result.target[0][0]);
  });

  it('supports different panorama yaws in a shared world-angular domain', () => {
    const fitted = regionToCommonPlane(region([[0.45, 0.45], [0.55, 0.45], [0.5, 0.55]], [[0.5, 0.45], [0.6, 0.45], [0.55, 0.55]]), { targetYawRadians: 0, sourceYawRadians: -Math.PI * 0.1 });
    fitted.target.forEach((point, index) => { expect(point[0]).toBeCloseTo(fitted.source[index][0]); expect(point[1]).toBeCloseTo(fitted.source[index][1]); });
  });

  it('rejects mismatched capture origins', () => {
    expect(regionToCommonPlane(region([[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]), { targetYawRadians: 0, sourceYawRadians: 0, targetOrigin: [0, 0, 0], sourceOrigin: [0.251, 0, 0] }).diagnostics.status).toBe('origin-mismatch');
  });

  it('rejects excessive spans and polar regions', () => {
    expect(regionToCommonPlane(region([[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]]), { targetYawRadians: 0, sourceYawRadians: 0 }).diagnostics.status).toBe('too-large');
    expect(regionToCommonPlane(region([[0.1, 0.999], [0.5, 0.999], [0.9, 0.999]]), { targetYawRadians: 0, sourceYawRadians: 0 }).diagnostics.valid).toBe(false);
  });
});
