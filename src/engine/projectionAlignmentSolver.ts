import { ProjectionAlignment } from '../domain/types';
import {
  angularDistanceRadians,
  applyInverseYawRotation,
  applyYawRotation,
  axisAngleVectorBetween,
  equirectUvToUnitDirection,
  rotateDirectionByAxisAngleVector,
  unitDirectionToEquirectUv,
  wendlandC2,
} from './projectionAlignmentMath';
import { degreesToRadians } from './sync';

export const WARP_MAP_WIDTH = 512;
export const WARP_MAP_HEIGHT = 256;

export interface SolverOptions {
  /** Yaw of the target (graybox) panorama in radians. */
  targetYaw: number;
  /** Yaw of the source (styled) panorama in radians. */
  sourceYaw: number;
  /** Warp map dimensions (default 512×256). */
  width?: number;
  height?: number;
}

export interface SolverResult {
  /** Flattened Float32Array of size width×height×2: [dU, dV] per texel. */
  field: Float32Array;
  width: number;
  height: number;
  /** Maximum angular error of any enabled marker after solve (radians). */
  maxMarkerErrorRadians: number;
  /** Number of conflicting marker pairs. */
  conflictCount: number;
}

const TOLERANCE_DEGREES = 1;
const MAX_RESIDUAL_PASSES = 4;
const MAX_DISPLACEMENT_DEGREES = 35;
const ANCHOR_RADIUS_RADIANS = degreesToRadians(45);
const ANCHOR_WEIGHT = 0.08;
const SINGLETON_RADIUS_RADIANS = degreesToRadians(50);
const INFLUENCE_MULTIPLIER = 1.75;
const INFLUENCE_MIN_RADIANS = degreesToRadians(20);
const INFLUENCE_MAX_RADIANS = degreesToRadians(70);

interface MarkerInfo {
  /** Source-aligned target UV (the warp-map key). */
  sourceAlignedUv: [number, number];
  /** Desired source UV. */
  sourceUv: [number, number];
  /** Unit direction in world space for the target position. */
  worldTargetDir: [number, number, number];
  /** Unit direction in world space for the desired source position. */
  worldSourceDir: [number, number, number];
}

function computeToleranceRadians(width: number, height: number): number {
  const oneDegree = Math.PI / 180;
  const twoHorizontalTexels = (2 * 2 * Math.PI) / width;
  const twoVerticalTexels = (2 * Math.PI) / height;
  return Math.min(oneDegree, twoHorizontalTexels, twoVerticalTexels);
}

function uvToIndex(u: number, v: number, width: number, height: number): number {
  const ix = Math.round(u * (width - 1));
  const iy = Math.round(v * (height - 1));
  return (iy * width + ix) * 2;
}

function encodeField(field: Float32Array, u: number, v: number, width: number, height: number, dU: number, dV: number): void {
  const idx = uvToIndex(u, v, width, height);
  field[idx] = dU;
  field[idx + 1] = dV;
}

export function solveProjectionAlignment(
  alignment: ProjectionAlignment | undefined | null,
  options: SolverOptions,
): SolverResult {
  const width = options.width ?? WARP_MAP_WIDTH;
  const height = options.height ?? WARP_MAP_HEIGHT;
  const field = new Float32Array(width * height * 2);

  const emptyResult: SolverResult = {
    field,
    width,
    height,
    maxMarkerErrorRadians: 0,
    conflictCount: 0,
  };

  if (!alignment) return emptyResult;

  const enabledPairs = alignment.pairs.filter((p) => p.enabled);
  if (enabledPairs.length === 0) return emptyResult;

  const markers: MarkerInfo[] = enabledPairs.map((pair) => {
    const targetDir = equirectUvToUnitDirection(pair.targetUv);
    const worldTargetDir = applyYawRotation(targetDir, options.targetYaw);
    const sourceLocalTargetDir = applyInverseYawRotation(worldTargetDir, options.sourceYaw);
    const sourceAlignedUv = unitDirectionToEquirectUv(sourceLocalTargetDir);
    const sourceDir = equirectUvToUnitDirection(pair.sourceUv);
    const worldSourceDir = applyYawRotation(sourceDir, options.sourceYaw);
    return {
      sourceAlignedUv: [sourceAlignedUv[0], sourceAlignedUv[1]],
      sourceUv: [...pair.sourceUv],
      worldTargetDir: [...worldTargetDir],
      worldSourceDir: [...worldSourceDir],
    };
  });

  const toleranceRadians = computeToleranceRadians(width, height);
  let maxError = 0;
  let conflictCount = 0;
  let currentRotationField = new Float32Array(width * height * 3);

  function solveOnePass(existingRotationField: Float32Array): {
    error: number;
    conflicts: number;
  } {
    const newRotationField = new Float32Array(width * height * 3);
    let maxMarkerError = 0;
    let localConflictCount = 0;

    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        const u = ix / (width - 1);
        const v = iy / (height - 1);
        const idx = (iy * width + ix);

        const texelDir = equirectUvToUnitDirection([u, v]);
        const worldTexelDir = applyYawRotation(texelDir, options.sourceYaw);

        const angularDists: number[] = [];
        for (const marker of markers) {
          const worldMarkerDir = marker.worldTargetDir;
          const dist = angularDistanceRadians(worldTexelDir, worldMarkerDir);
          angularDists.push(dist);
        }

        const sortedDists = [...angularDists].sort((a, b) => a - b);
        const nearestDist = sortedDists[0];

        let influenceRadius: number;
        if (markers.length === 1) {
          influenceRadius = SINGLETON_RADIUS_RADIANS;
        } else {
          influenceRadius = Math.max(
            INFLUENCE_MIN_RADIANS,
            Math.min(INFLUENCE_MAX_RADIANS, nearestDist * INFLUENCE_MULTIPLIER),
          );
        }

        let totalWeight = 0;
        const accumulatedCorrection: [number, number, number] = [0, 0, 0];

        if (existingRotationField.length > 0) {
          const existingIdx = idx * 3;
          accumulatedCorrection[0] = existingRotationField[existingIdx];
          accumulatedCorrection[1] = existingRotationField[existingIdx + 1];
          accumulatedCorrection[2] = existingRotationField[existingIdx + 2];
        }

        for (let mi = 0; mi < markers.length; mi++) {
          const dist = angularDists[mi];
          if (dist > influenceRadius) continue;

          const t = dist / influenceRadius;
          const kernelWeight = wendlandC2(t);
          if (kernelWeight < 1e-10) continue;

          const marker = markers[mi];

          let correctedWorldTexelDir: [number, number, number] = [...worldTexelDir];
          if (existingRotationField.length > 0) {
            const existingIdx = idx * 3;
            const existingRot: [number, number, number] = [
              existingRotationField[existingIdx],
              existingRotationField[existingIdx + 1],
              existingRotationField[existingIdx + 2],
            ];
            correctedWorldTexelDir = rotateDirectionByAxisAngleVector(correctedWorldTexelDir, existingRot);
          }

          const axisAngle = axisAngleVectorBetween(correctedWorldTexelDir, marker.worldSourceDir);

          accumulatedCorrection[0] += axisAngle[0] * kernelWeight;
          accumulatedCorrection[1] += axisAngle[1] * kernelWeight;
          accumulatedCorrection[2] += axisAngle[2] * kernelWeight;
          totalWeight += kernelWeight;
        }

        for (const anchorU of [0, 0.25, 0.5, 0.75]) {
          const anchorDir = equirectUvToUnitDirection([anchorU, 0.5]);
          const worldAnchorDir = applyYawRotation(anchorDir, options.sourceYaw);
          const dist = angularDistanceRadians(worldTexelDir, worldAnchorDir);
          if (dist > ANCHOR_RADIUS_RADIANS) continue;
          const t = dist / ANCHOR_RADIUS_RADIANS;
          const kernelWeight = wendlandC2(t) * ANCHOR_WEIGHT;
          if (kernelWeight < 1e-10) continue;
          totalWeight += kernelWeight;
        }

        if (totalWeight > 1e-10) {
          const invWeight = 1 / totalWeight;
          accumulatedCorrection[0] *= invWeight;
          accumulatedCorrection[1] *= invWeight;
          accumulatedCorrection[2] *= invWeight;
        }

        const mag = Math.sqrt(
          accumulatedCorrection[0] ** 2 + accumulatedCorrection[1] ** 2 + accumulatedCorrection[2] ** 2,
        );
        const maxRad = degreesToRadians(MAX_DISPLACEMENT_DEGREES);
        if (mag > maxRad) {
          const scale = maxRad / mag;
          accumulatedCorrection[0] *= scale;
          accumulatedCorrection[1] *= scale;
          accumulatedCorrection[2] *= scale;
        }

        newRotationField[idx * 3] = accumulatedCorrection[0];
        newRotationField[idx * 3 + 1] = accumulatedCorrection[1];
        newRotationField[idx * 3 + 2] = accumulatedCorrection[2];
      }
    }

    for (let mi = 0; mi < markers.length; mi++) {
      const marker = markers[mi];
      const targetU = marker.sourceAlignedUv[0];
      const targetV = marker.sourceAlignedUv[1];
      const ix = Math.round(targetU * (width - 1));
      const iy = Math.round(targetV * (height - 1));
      const clampedIx = Math.max(0, Math.min(width - 1, ix));
      const clampedIy = Math.max(0, Math.min(height - 1, iy));
      const idx = (clampedIy * width + clampedIx);

      const rotIdx = idx * 3;
      const rot: [number, number, number] = [
        newRotationField[rotIdx],
        newRotationField[rotIdx + 1],
        newRotationField[rotIdx + 2],
      ];

      const rotatedDir = rotateDirectionByAxisAngleVector(marker.worldTargetDir, rot);
      const resultUv = unitDirectionToEquirectUv(rotatedDir);
      const desiredDir = marker.worldSourceDir;
      const error = angularDistanceRadians(rotatedDir, desiredDir);
      maxMarkerError = Math.max(maxMarkerError, error);

      if (error > toleranceRadians) {
        localConflictCount++;
      }
    }

    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        const u = ix / (width - 1);
        const v = iy / (height - 1);
        const idx = (iy * width + ix) * 3;

        const rot: [number, number, number] = [
          newRotationField[idx],
          newRotationField[idx + 1],
          newRotationField[idx + 2],
        ];

        const texelDir = equirectUvToUnitDirection([u, v]);
        const rotatedDir = rotateDirectionByAxisAngleVector(texelDir, rot);
        const resultUv = unitDirectionToEquirectUv(rotatedDir);

        const dU = resultUv[0] - u;
        const dV = resultUv[1] - v;

        encodeField(field, u, v, width, height, dU, dV);
      }
    }

    return {
      error: maxMarkerError,
      conflicts: localConflictCount,
    };
  }

  let firstResult = solveOnePass(currentRotationField);
  maxError = firstResult.error;
  conflictCount = firstResult.conflicts;

  if (maxError > toleranceRadians) {
    for (let pass = 0; pass < MAX_RESIDUAL_PASSES; pass++) {
      currentRotationField = new Float32Array(field);
      const prevMaxError = maxError;
      const result = solveOnePass(currentRotationField);
      maxError = result.error;
      conflictCount = result.conflicts;

      if (maxError <= toleranceRadians || maxError >= prevMaxError) {
        break;
      }
    }
  }

  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i])) {
      field[i] = 0;
    }
  }

  return {
    field,
    width,
    height,
    maxMarkerErrorRadians: maxError,
    conflictCount,
  };
}
