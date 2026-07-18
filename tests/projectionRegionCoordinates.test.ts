import { describe, expect, it } from 'vitest';
import { createProjectionRegion, createProjectionRegionVertexPair } from '../src/domain/defaults';
import { regionToCommonPlane, tangentPlaneToUnitDirection, unitDirectionToTangentPlane } from '../src/engine/projectionRegionCoordinates';

function region(points: [number, number][], source = points) { return createProjectionRegion(points.map((point, index) => createProjectionRegionVertexPair(point, source[index], `v${index}`))); }

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
