import { ProjectionAlignment, Vec2, Vec3 } from '../domain/types';
import {
  equirectUvToUnitDirection,
  unitDirectionToEquirectUv,
  shortestWrappedDeltaU,
  angularDistanceRadians,
  axisAngleVectorBetween,
  rotateDirectionByAxisAngleVector,
  applyYawRotation,
  applyInverseYawRotation,
  wendlandC2,
} from './projectionAlignmentMath';

const DEG = Math.PI / 180;
const MAX_RESIDUAL_PASSES = 4;
const RESIDUAL_TOLERANCE_RADIANS = 0.5 * DEG;
const MAX_ROTATION_RADIANS = 35 * DEG;
const IDENTITY_ANCHOR_WEIGHT = 0.06;

export interface ProjectionAlignmentSolveOptions {
  width?: number;
  height?: number;
  targetYawRadians: number;
  sourceYawRadians: number;
}

export interface ProjectionWarpField {
  width: number;
  height: number;
  displacement: Float32Array;
  maxMarkerErrorRadians: number;
  conflictCount: number;
  maximumRotationRadians: number;
}

interface MarkerData {
  targetGrayboxLocalDir: Vec3;
  /** Direction in source-pano-local space where the target point naturally projects. */
  naturalSourceDir: Vec3;
  /** Direction in source-pano-local space where we want the marker to appear. */
  desiredSourceDir: Vec3;
  /** Fixed rotation that maps naturalSourceDir → desiredSourceDir (in source-pano-local space). */
  rotation: Vec3;
  radiusRadians: number;
}

function computeMarkerRadius(
  markerIndex: number,
  targetDirs: Vec3[],
  enabledFlags: boolean[],
): number {
  const enabledIndices = targetDirs
    .map((_, i) => i)
    .filter((i) => enabledFlags[i] && i !== markerIndex);

  if (enabledIndices.length === 0) {
    return 50 * DEG;
  }

  let minDist = Infinity;
  for (const i of enabledIndices) {
    const dist = angularDistanceRadians(targetDirs[markerIndex], targetDirs[i]);
    if (dist < minDist) minDist = dist;
  }

  const radius = minDist * 1.75;
  return Math.min(70 * DEG, Math.max(20 * DEG, radius));
}

function generateIdentityAnchors(): Vec2[] {
  return [
    [0.00, 0.25], [0.25, 0.25], [0.50, 0.25], [0.75, 0.25],
    [0.00, 0.50], [0.25, 0.50], [0.50, 0.50], [0.75, 0.50],
    [0.00, 0.75], [0.25, 0.75], [0.50, 0.75], [0.75, 0.75],
  ];
}

function composeRotations(
  current: Float32Array,
  correction: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  const result = new Float32Array(count * 3);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const idx = ty * width + tx;
      const offset = idx * 3;
      const currentAA: Vec3 = [current[offset], current[offset + 1], current[offset + 2]];
      const correctionAA: Vec3 = [correction[offset], correction[offset + 1], correction[offset + 2]];

      const intermediate = rotateDirectionByAxisAngleVector(
        [0, 0, 1],
        currentAA,
      );
      const finalDir = rotateDirectionByAxisAngleVector(intermediate, correctionAA);
      const composed = axisAngleVectorBetween([0, 0, 1], finalDir);
      result[offset] = composed[0];
      result[offset + 1] = composed[1];
      result[offset + 2] = composed[2];
    }
  }
  return result;
}

function clampRotationMagnitude(
  field: Float32Array,
  count: number,
  maxRadians: number,
): void {
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    const angle = Math.sqrt(
      field[offset] * field[offset] + field[offset + 1] * field[offset + 1] + field[offset + 2] * field[offset + 2],
    );
    if (angle > maxRadians) {
      const scale = maxRadians / angle;
      field[offset] *= scale;
      field[offset + 1] *= scale;
      field[offset + 2] *= scale;
    }
  }
}

function sampleRotationFieldBilinear(
  field: Float32Array,
  width: number,
  height: number,
  uv: Vec2,
): Vec3 {
  const tx = uv[0] * (width - 1);
  const ty = uv[1] * (height - 1);
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;

  const ix0 = Math.max(0, Math.min(width - 1, ix));
  const ix1 = Math.max(0, Math.min(width - 1, ix + 1));
  const iy0 = Math.max(0, Math.min(height - 1, iy));
  const iy1 = Math.max(0, Math.min(height - 1, iy + 1));

  const s00 = iy0 * width + ix0;
  const s01 = iy0 * width + ix1;
  const s10 = iy1 * width + ix0;
  const s11 = iy1 * width + ix1;

  const wx0 = 1 - fx;
  const wx1 = fx;
  const wy0 = 1 - fy;
  const wy1 = fy;

  const result: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    result[c] =
      field[s00 * 3 + c] * wx0 * wy0 +
      field[s01 * 3 + c] * wx1 * wy0 +
      field[s10 * 3 + c] * wx0 * wy1 +
      field[s11 * 3 + c] * wx1 * wy1;
  }
  return result;
}

export function solveProjectionWarp(
  alignment: ProjectionAlignment | undefined,
  options: ProjectionAlignmentSolveOptions,
): ProjectionWarpField {
  const width = options.width ?? 256;
  const height = options.height ?? 128;
  const texelCount = width * height;

  if (!alignment) {
    return {
      width, height,
      displacement: new Float32Array(texelCount * 2),
      maxMarkerErrorRadians: 0,
      conflictCount: 0,
      maximumRotationRadians: 0,
    };
  }

  const enabledPairs = alignment.pairs.filter((p) => p.enabled);
  if (enabledPairs.length === 0) {
    return {
      width, height,
      displacement: new Float32Array(texelCount * 2),
      maxMarkerErrorRadians: 0,
      conflictCount: 0,
      maximumRotationRadians: 0,
    };
  }

  // Preprocess each marker
  const markerCount = enabledPairs.length;
  const markers: MarkerData[] = [];
  const targetDirs: Vec3[] = [];

  for (const pair of enabledPairs) {
    const targetLocalDir = equirectUvToUnitDirection(pair.targetUv);
    const worldTargetDir = applyYawRotation(targetLocalDir, options.targetYawRadians);
    const naturalSourceDir = applyInverseYawRotation(worldTargetDir, options.sourceYawRadians);
    const desiredSourceDir = equirectUvToUnitDirection(pair.sourceUv);

    const rotation = axisAngleVectorBetween(naturalSourceDir, desiredSourceDir);

    targetDirs.push(targetLocalDir);
    markers.push({
      targetGrayboxLocalDir: targetLocalDir,
      naturalSourceDir,
      desiredSourceDir,
      rotation,
      radiusRadians: 0,
    });
  }

  // Compute per-marker radius
  const enabledFlags = markers.map(() => true);
  for (let i = 0; i < markerCount; i++) {
    markers[i].radiusRadians = computeMarkerRadius(i, targetDirs, enabledFlags);
  }

  const anchors = generateIdentityAnchors();

  // First-pass solve
  let rotationField = solveField(width, height, markers, anchors);

  clampRotationMagnitude(rotationField, texelCount, MAX_ROTATION_RADIANS);

  // Residual passes
  for (let pass = 0; pass < MAX_RESIDUAL_PASSES; pass++) {
    let maxError = 0;
    let stalled = true;

    for (let mi = 0; mi < markerCount; mi++) {
      const marker = markers[mi];
      const texelUv = unitDirectionToEquirectUv(marker.targetGrayboxLocalDir);
      const currentRot = sampleRotationFieldBilinear(rotationField, width, height, texelUv);

      const currentDir = rotateDirectionByAxisAngleVector(marker.naturalSourceDir, currentRot);
      const error = angularDistanceRadians(currentDir, marker.desiredSourceDir);
      if (error > maxError) maxError = error;

      if (error > RESIDUAL_TOLERANCE_RADIANS) {
        stalled = false;
      }
    }

    if (stalled || maxError <= 0.01) break;

    // Build residual markers
    const residuals: MarkerData[] = [];
    for (let mi = 0; mi < markerCount; mi++) {
      const marker = markers[mi];
      const texelUv = unitDirectionToEquirectUv(marker.targetGrayboxLocalDir);
      const currentRot = sampleRotationFieldBilinear(rotationField, width, height, texelUv);

      const currentDir = rotateDirectionByAxisAngleVector(marker.naturalSourceDir, currentRot);
      const error = angularDistanceRadians(currentDir, marker.desiredSourceDir);
      if (error > RESIDUAL_TOLERANCE_RADIANS) {
        const residualRot = axisAngleVectorBetween(currentDir, marker.desiredSourceDir);
        residuals.push({
          ...marker,
          rotation: residualRot,
        });
      }
    }

    if (residuals.length === 0) break;

    const correction = solveField(width, height, residuals, anchors);
    rotationField = composeRotations(rotationField, correction, width, height);
    clampRotationMagnitude(rotationField, texelCount, MAX_ROTATION_RADIANS);
  }

  // Convert rotation field to displacement field
  const displacement = new Float32Array(texelCount * 2);
  let maxRotationRadians = 0;

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const idx = ty * width + tx;
      const rotOffset = idx * 3;
      const dispOffset = idx * 2;

      const u = tx / (width - 1);
      const v = ty / (height - 1);

      const targetLocalDir = equirectUvToUnitDirection([u, v]);
      const worldDir = applyYawRotation(targetLocalDir, options.targetYawRadians);
      const naturalSourceDir = applyInverseYawRotation(worldDir, options.sourceYawRadians);

      const rot: Vec3 = [rotationField[rotOffset], rotationField[rotOffset + 1], rotationField[rotOffset + 2]];
      const rotAngle = Math.sqrt(rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2]);
      if (rotAngle > maxRotationRadians) maxRotationRadians = rotAngle;

      const correctedDir = rotateDirectionByAxisAngleVector(naturalSourceDir, rot);
      const sourceUv = unitDirectionToEquirectUv(correctedDir);
      const naturalUv = unitDirectionToEquirectUv(naturalSourceDir);

      displacement[dispOffset] = shortestWrappedDeltaU(naturalUv[0], sourceUv[0]);
      displacement[dispOffset + 1] = sourceUv[1] - naturalUv[1];
    }
  }

  // Calculate marker error
  let maxMarkerErrorRadians = 0;
  for (const marker of markers) {
    const texelUv = unitDirectionToEquirectUv(marker.targetGrayboxLocalDir);
    const tx = Math.round(texelUv[0] * (width - 1));
    const ty = Math.round(texelUv[1] * (height - 1));
    const idx = (ty * width + tx) * 2;
    const du = displacement[idx];
    const dv = displacement[idx + 1];

    const naturalUv = unitDirectionToEquirectUv(marker.naturalSourceDir);
    const mappedU = ((naturalUv[0] + du) % 1 + 1) % 1;
    const mappedV = Math.min(1, Math.max(0, naturalUv[1] + dv));

    const mappedDir = equirectUvToUnitDirection([mappedU, mappedV]);
    const error = angularDistanceRadians(mappedDir, marker.desiredSourceDir);
    if (error > maxMarkerErrorRadians) maxMarkerErrorRadians = error;
  }

  // Conflict detection
  let conflictCount = 0;
  for (let i = 0; i < markerCount; i++) {
    for (let j = i + 1; j < markerCount; j++) {
      const targetDist = angularDistanceRadians(
        markers[i].targetGrayboxLocalDir,
        markers[j].targetGrayboxLocalDir,
      );
      const sourceDist = angularDistanceRadians(
        markers[i].desiredSourceDir,
        markers[j].desiredSourceDir,
      );
      if (targetDist < 3 * DEG && sourceDist > 12 * DEG) {
        conflictCount++;
      }
    }
  }

  return {
    width,
    height,
    displacement,
    maxMarkerErrorRadians,
    conflictCount,
    maximumRotationRadians: maxRotationRadians,
  };
}

function solveField(
  width: number,
  height: number,
  markers: MarkerData[],
  anchors: Vec2[],
): Float32Array {
  const texelCount = width * height;
  const result = new Float32Array(texelCount * 3);
  const anchorDirs = anchors.map((a) => equirectUvToUnitDirection(a));

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const texelIdx = ty * width + tx;
      const u = tx / (width - 1);
      const v = ty / (height - 1);
      const texelDir = equirectUvToUnitDirection([u, v]);

      let totalWeight = 0;
      let weightedRotX = 0;
      let weightedRotY = 0;
      let weightedRotZ = 0;

      for (const marker of markers) {
        const dist = angularDistanceRadians(texelDir, marker.targetGrayboxLocalDir);
        const normalizedR = dist / marker.radiusRadians;
        const w = wendlandC2(normalizedR);
        weightedRotX += w * marker.rotation[0];
        weightedRotY += w * marker.rotation[1];
        weightedRotZ += w * marker.rotation[2];
        totalWeight += w;
      }

      for (const anchorDir of anchorDirs) {
        const dist = angularDistanceRadians(texelDir, anchorDir);
        const w = wendlandC2(dist / (70 * DEG)) * IDENTITY_ANCHOR_WEIGHT;
        totalWeight += w;
      }

      if (totalWeight > 1e-10) {
        const offset = texelIdx * 3;
        result[offset] = weightedRotX / totalWeight;
        result[offset + 1] = weightedRotY / totalWeight;
        result[offset + 2] = weightedRotZ / totalWeight;
      }
    }
  }

  return result;
}
