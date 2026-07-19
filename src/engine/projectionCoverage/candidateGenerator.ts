import type { Vec3 } from '../../domain/types';
import { floorHeightAt, readWorldTriangle } from './geometryAccess';
import type { SceneAccelerationStructure } from './sceneAcceleration';
import { buildSceneAcceleration } from './sceneAcceleration';
import type {
  CoverageOptimizationOptions,
  CoverageSceneData,
  OriginCandidate,
} from './types';

export function candidateClearance(
  scene: CoverageSceneData,
  position: Vec3,
  acceleration: SceneAccelerationStructure,
): number {
  return acceleration.distanceToGeometry(position, scene.diagonal);
}

/** Place X/Z at camera height above the nearest matching floor component. */
export function projectCandidateToFloor(
  scene: CoverageSceneData,
  x: number,
  z: number,
  panoramaHeightMeters: number,
  preferredFloorY?: number,
): Vec3 | undefined {
  const triangleScratch = new Float64Array(9);
  let bestFloorY: number | undefined;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let floorOffset = 0; floorOffset < scene.floorTriangleIndices.length; floorOffset += 1) {
    const boundsOffset = floorOffset * 4;
    if (x < scene.floorBounds[boundsOffset] || x > scene.floorBounds[boundsOffset + 1]
      || z < scene.floorBounds[boundsOffset + 2] || z > scene.floorBounds[boundsOffset + 3]) continue;
    const triangleIndex = scene.floorTriangleIndices[floorOffset];
    readWorldTriangle(scene, triangleIndex, triangleScratch);
    const floorY = floorHeightAt(triangleScratch, x, z);
    if (floorY === undefined) continue;
    const difference = preferredFloorY === undefined ? -floorY : Math.abs(floorY - preferredFloorY);
    if (bestFloorY === undefined || difference < bestDifference) {
      bestFloorY = floorY;
      bestDifference = difference;
    }
  }
  return bestFloorY === undefined ? undefined : [x, bestFloorY + panoramaHeightMeters, z];
}

export function isCandidatePositionValid(
  scene: CoverageSceneData,
  position: Vec3,
  cameraClearanceRadius: number,
  panoramaHeightMeters: number,
  acceleration: SceneAccelerationStructure,
  verticalTolerance = 0.12,
): boolean {
  if (position[0] < scene.bounds.min[0] || position[0] > scene.bounds.max[0]) return false;
  if (position[2] < scene.bounds.min[2] || position[2] > scene.bounds.max[2]) return false;
  const projected = projectCandidateToFloor(
    scene,
    position[0],
    position[2],
    panoramaHeightMeters,
    position[1] - panoramaHeightMeters,
  );
  if (!projected || Math.abs(projected[1] - position[1]) > verticalTolerance) return false;
  return candidateClearance(scene, position, acceleration) >= cameraClearanceRadius;
}

function addCandidate(
  candidates: OriginCandidate[],
  scene: CoverageSceneData,
  position: Vec3,
  spacing: number,
  clearanceRadius: number,
  acceleration: SceneAccelerationStructure,
): void {
  const clearance = candidateClearance(scene, position, acceleration);
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
  acceleration = buildSceneAcceleration(scene),
): OriginCandidate[] {
  if (scene.floorTriangleIndices.length === 0) {
    throw new Error('No upward-facing floor surface is available for safe origin placement.');
  }
  const spacing = Math.max(options.candidateSpacing, 0.05);
  const candidates: OriginCandidate[] = [];
  const startX = Math.ceil(scene.bounds.min[0] / spacing) * spacing;
  const startZ = Math.ceil(scene.bounds.min[2] / spacing) * spacing;
  const triangleScratch = new Float64Array(9);

  for (let x = startX; x <= scene.bounds.max[0] + 1e-8; x += spacing) {
    for (let z = startZ; z <= scene.bounds.max[2] + 1e-8; z += spacing) {
      for (let floorOffset = 0; floorOffset < scene.floorTriangleIndices.length; floorOffset += 1) {
        const boundsOffset = floorOffset * 4;
        if (x < scene.floorBounds[boundsOffset] || x > scene.floorBounds[boundsOffset + 1]
          || z < scene.floorBounds[boundsOffset + 2] || z > scene.floorBounds[boundsOffset + 3]) continue;
        const triangleIndex = scene.floorTriangleIndices[floorOffset];
        readWorldTriangle(scene, triangleIndex, triangleScratch);
        const floorY = floorHeightAt(triangleScratch, x, z);
        if (floorY === undefined) continue;
        addCandidate(
          candidates,
          scene,
          [x, floorY + options.panoramaHeightMeters, z],
          spacing,
          options.cameraClearanceRadius,
          acceleration,
        );
      }
    }
  }

  // Very small or rotated floor components can fall between grid points.
  for (const triangleIndex of scene.floorTriangleIndices) {
    readWorldTriangle(scene, triangleIndex, triangleScratch);
    const position: Vec3 = [
      (triangleScratch[0] + triangleScratch[3] + triangleScratch[6]) / 3,
      (triangleScratch[1] + triangleScratch[4] + triangleScratch[7]) / 3 + options.panoramaHeightMeters,
      (triangleScratch[2] + triangleScratch[5] + triangleScratch[8]) / 3,
    ];
    addCandidate(candidates, scene, position, spacing, options.cameraClearanceRadius, acceleration);
  }

  if (candidates.length === 0) {
    throw new Error('No candidate origin has enough geometry clearance above the detected floor.');
  }
  if (candidates.length <= options.maximumCandidateCount) return candidates;
  const thinned: OriginCandidate[] = [];
  const step = candidates.length / options.maximumCandidateCount;
  for (let index = 0; index < options.maximumCandidateCount; index += 1) {
    thinned.push(candidates[Math.floor(index * step)]);
  }
  return thinned;
}

export function localCandidateOffsets(origin: Vec3, step: number): Array<[number, number]> {
  return [
    [origin[0] + step, origin[2]],
    [origin[0] - step, origin[2]],
    [origin[0], origin[2] + step],
    [origin[0], origin[2] - step],
    [origin[0] + step, origin[2] + step],
    [origin[0] + step, origin[2] - step],
    [origin[0] - step, origin[2] + step],
    [origin[0] - step, origin[2] - step],
  ];
}
