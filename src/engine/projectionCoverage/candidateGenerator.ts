import type { Vec3 } from '../../domain/types';
import type {
  CoverageBounds,
  CoverageOptimizationOptions,
  CoverageSceneData,
  CoverageTriangle,
  OriginCandidate,
} from './types';

function distanceToBounds(point: Vec3, bounds: CoverageBounds): number {
  const dx = Math.max(bounds.min[0] - point[0], 0, point[0] - bounds.max[0]);
  const dy = Math.max(bounds.min[1] - point[1], 0, point[1] - bounds.max[1]);
  const dz = Math.max(bounds.min[2] - point[2], 0, point[2] - bounds.max[2]);
  return Math.hypot(dx, dy, dz);
}

function interpolateFloorHeight(triangle: CoverageTriangle, x: number, z: number): number | undefined {
  const [ax, , az] = triangle.a;
  const [bx, , bz] = triangle.b;
  const [cx, , cz] = triangle.c;
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = x - ax;
  const v2z = z - az;
  const denominator = v0x * v1z - v1x * v0z;
  if (Math.abs(denominator) < 1e-10) return undefined;
  const u = (v2x * v1z - v1x * v2z) / denominator;
  const v = (v0x * v2z - v2x * v0z) / denominator;
  const w = 1 - u - v;
  const tolerance = 1e-7;
  if (u < -tolerance || v < -tolerance || w < -tolerance) return undefined;
  return triangle.a[1] * w + triangle.b[1] * u + triangle.c[1] * v;
}

export function candidateClearance(scene: CoverageSceneData, position: Vec3): number {
  if (scene.obstacleBounds.length === 0) return scene.diagonal;
  let clearance = Number.POSITIVE_INFINITY;
  for (const bounds of scene.obstacleBounds) {
    clearance = Math.min(clearance, distanceToBounds(position, bounds));
  }
  return clearance;
}

export function isCandidatePositionValid(
  scene: CoverageSceneData,
  position: Vec3,
  cameraClearanceRadius: number,
  verticalTolerance = 0.12,
): boolean {
  if (position[0] < scene.bounds.min[0] || position[0] > scene.bounds.max[0]) return false;
  if (position[2] < scene.bounds.min[2] || position[2] > scene.bounds.max[2]) return false;
  if (candidateClearance(scene, position) < cameraClearanceRadius) return false;
  const expectedFloorY = position[1] - verticalTolerance;
  return scene.floorTriangles.some((floor) => {
    if (position[0] < floor.minX || position[0] > floor.maxX
      || position[2] < floor.minZ || position[2] > floor.maxZ) return false;
    const floorY = interpolateFloorHeight(scene.triangles[floor.triangleIndex], position[0], position[2]);
    return floorY !== undefined && floorY <= expectedFloorY;
  });
}

function addCandidate(
  candidates: OriginCandidate[],
  scene: CoverageSceneData,
  position: Vec3,
  spacing: number,
  clearanceRadius: number,
): void {
  const clearance = candidateClearance(scene, position);
  if (clearance < clearanceRadius) return;
  const minimumSpacing = Math.max(spacing * 0.45, 0.05);
  if (candidates.some((candidate) => Math.hypot(
    candidate.position[0] - position[0],
    candidate.position[1] - position[1],
    candidate.position[2] - position[2],
  ) < minimumSpacing)) return;
  candidates.push({ position, clearance });
}

/** Automatic fallback candidate region derived from upward-facing surfaces. */
export function generateOriginCandidates(
  scene: CoverageSceneData,
  options: CoverageOptimizationOptions,
): OriginCandidate[] {
  if (scene.floorTriangles.length === 0) {
    throw new Error('No upward-facing floor surface is available for safe origin placement.');
  }
  const spacing = Math.max(options.candidateSpacing, 0.05);
  const candidates: OriginCandidate[] = [];
  const startX = Math.ceil(scene.bounds.min[0] / spacing) * spacing;
  const startZ = Math.ceil(scene.bounds.min[2] / spacing) * spacing;

  for (let x = startX; x <= scene.bounds.max[0] + 1e-8; x += spacing) {
    for (let z = startZ; z <= scene.bounds.max[2] + 1e-8; z += spacing) {
      for (const floor of scene.floorTriangles) {
        if (x < floor.minX || x > floor.maxX || z < floor.minZ || z > floor.maxZ) continue;
        const floorY = interpolateFloorHeight(scene.triangles[floor.triangleIndex], x, z);
        if (floorY === undefined) continue;
        addCandidate(
          candidates,
          scene,
          [x, floorY + options.panoramaHeightMeters, z],
          spacing,
          options.cameraClearanceRadius,
        );
      }
    }
  }

  // Very small or rotated floor components can fall between grid points.
  for (const floor of scene.floorTriangles) {
    const triangle = scene.triangles[floor.triangleIndex];
    const position: Vec3 = [
      (triangle.a[0] + triangle.b[0] + triangle.c[0]) / 3,
      (triangle.a[1] + triangle.b[1] + triangle.c[1]) / 3 + options.panoramaHeightMeters,
      (triangle.a[2] + triangle.b[2] + triangle.c[2]) / 3,
    ];
    addCandidate(candidates, scene, position, spacing, options.cameraClearanceRadius);
  }

  if (candidates.length === 0) {
    throw new Error('No candidate origin has enough camera clearance above the detected floor.');
  }

  if (candidates.length <= options.maximumCandidateCount) return candidates;
  // Deterministic even thinning preserves the whole region instead of truncating one corner.
  const thinned: OriginCandidate[] = [];
  const step = candidates.length / options.maximumCandidateCount;
  for (let i = 0; i < options.maximumCandidateCount; i += 1) {
    thinned.push(candidates[Math.floor(i * step)]);
  }
  return thinned;
}

export function localCandidateOffsets(origin: Vec3, step: number): Vec3[] {
  return [
    [origin[0] + step, origin[1], origin[2]],
    [origin[0] - step, origin[1], origin[2]],
    [origin[0], origin[1], origin[2] + step],
    [origin[0], origin[1], origin[2] - step],
    [origin[0] + step, origin[1], origin[2] + step],
    [origin[0] + step, origin[1], origin[2] - step],
    [origin[0] - step, origin[1], origin[2] + step],
    [origin[0] - step, origin[1], origin[2] - step],
  ];
}

