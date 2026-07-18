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
/**
 * Resolution-dependent residual tolerance. The solver iterates until every
 * marker sits within this many radians of its target, or until improvement
 * stalls. The tolerance scales with the smaller of the horizontal/vertical
 * angular resolution of the warp field so a low-resolution run is not
 * penalized for sub-texel drift that cannot physically be represented.
 */
const RESIDUAL_TOLERANCE_FRACTION_OF_TEXEL = 0.25;
const STALL_IMPROVEMENT_RATIO = 0.05;
const MAX_ROTATION_RADIANS = 35 * DEG;
const IDENTITY_ANCHOR_WEIGHT = 0.06;

export function computeResidualToleranceRadians(width: number, height: number): number {
  // Per-texel angular step: equirect horizontal is 2π/width, vertical π/height.
  const horizontalStep = (2 * Math.PI) / width;
  const verticalStep = Math.PI / height;
  const texelStep = Math.min(horizontalStep, verticalStep);
  return Math.max(texelStep * RESIDUAL_TOLERANCE_FRACTION_OF_TEXEL, 0.1 * DEG);
}

export interface ProjectionAlignmentSolveOptions {
  sourcePanoWidth?: number;
  sourcePanoHeight?: number;
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

      const u = tx / width;
      const v = ty / height;
      const texelDir = equirectUvToUnitDirection([u, v]);

      const intermediate = rotateDirectionByAxisAngleVector(texelDir, currentAA);
      const finalDir = rotateDirectionByAxisAngleVector(intermediate, correctionAA);
      const composed = axisAngleVectorBetween(texelDir, finalDir);
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

/**
 * Wrap an integer texel index into [0, width) for equirectangular horizontal
 * sampling. Matches the GLSL `mod(x0 + 1.0, warpSize.x)` wrap used by
 * sampleWarpMap so CPU diagnostics agree with GPU sampling at the +U/-U seam.
 */
function wrapHorizontally(index: number, width: number): number {
  return ((index % width) + width) % width;
}

/**
 * Sample the rotation field using the same texel-center addressing as the
 * GLSL sampleWarpMap: texelCoord = uv * [width, height], with bilinear
 * interpolation. Horizontal neighbors wrap (equirect seam); vertical
 * neighbors clamp to edge.
 */
function sampleRotationFieldBilinear(
  field: Float32Array,
  width: number,
  height: number,
  uv: Vec2,
): Vec3 {
  const tx = uv[0] * width;
  const ty = uv[1] * height;
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;

  const ix0 = wrapHorizontally(ix, width);
  const ix1 = wrapHorizontally(ix + 1, width);
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

/**
 * Sample the displacement field using the same texel-center addressing as the
 * GLSL sampleWarpMap: texelCoord = uv * [width, height], with bilinear
 * interpolation. Horizontal neighbors wrap (equirect seam); vertical
 * neighbors clamp to edge.
 */
function sampleDisplacementFieldBilinear(
  field: Float32Array,
  width: number,
  height: number,
  uv: Vec2,
): Vec2 {
  const tx = uv[0] * width;
  const ty = uv[1] * height;
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;

  const ix0 = wrapHorizontally(ix, width);
  const ix1 = wrapHorizontally(ix + 1, width);
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

  return [
    field[s00 * 2] * wx0 * wy0 + field[s01 * 2] * wx1 * wy0 + field[s10 * 2] * wx0 * wy1 + field[s11 * 2] * wx1 * wy1,
    field[s00 * 2 + 1] * wx0 * wy0 + field[s01 * 2 + 1] * wx1 * wy0 + field[s10 * 2 + 1] * wx0 * wy1 + field[s11 * 2 + 1] * wx1 * wy1,
  ];
}

export function solveProjectionWarp(
  alignment: ProjectionAlignment | undefined,
  options: ProjectionAlignmentSolveOptions,
): ProjectionWarpField {
  const width = options.sourcePanoWidth ?? options.width ?? 256;
  const height = options.sourcePanoHeight ?? options.height ?? 128;
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
  const sourceDirs: Vec3[] = [];

  for (const pair of enabledPairs) {
    const targetLocalDir = equirectUvToUnitDirection(pair.targetUv);
    const worldTargetDir = applyYawRotation(targetLocalDir, options.targetYawRadians);
    const naturalSourceDir = applyInverseYawRotation(worldTargetDir, options.sourceYawRadians);
    const desiredSourceDir = equirectUvToUnitDirection(pair.sourceUv);

    const rotation = axisAngleVectorBetween(naturalSourceDir, desiredSourceDir);

    sourceDirs.push(naturalSourceDir);
    markers.push({
      targetGrayboxLocalDir: targetLocalDir,
      naturalSourceDir,
      desiredSourceDir,
      rotation,
      radiusRadians: 0,
    });
  }

  // Compute per-marker radius using source-space distances
  const enabledFlags = markers.map(() => true);
  for (let i = 0; i < markerCount; i++) {
    markers[i].radiusRadians = computeMarkerRadius(i, sourceDirs, enabledFlags);
  }

  const anchors = generateIdentityAnchors();

  // First-pass solve
  let rotationField = solveField(width, height, markers, anchors);

  clampRotationMagnitude(rotationField, texelCount, MAX_ROTATION_RADIANS);

  // Residual passes: iteratively correct the rotation field toward the
  // markers' targets. Each pass measures the worst marker error, builds
  // residual markers for everything still outside tolerance, solves a
  // correction field, and verifies that the correction actually improves
  // the worst error before committing it. A correction that worsens the
  // result is rejected and the loop stops; the loop also stops once
  // improvement stalls (less than STALL_IMPROVEMENT_RATIO of the
  // previous error) or every marker is within resolution-dependent
  // tolerance.
  const residualToleranceRadians = computeResidualToleranceRadians(width, height);
  let previousMaxError = Infinity;

  for (let pass = 0; pass < MAX_RESIDUAL_PASSES; pass++) {
    let maxError = 0;

    for (let mi = 0; mi < markerCount; mi++) {
      const marker = markers[mi];
      const texelUv = unitDirectionToEquirectUv(marker.naturalSourceDir);
      const currentRot = sampleRotationFieldBilinear(rotationField, width, height, texelUv);

      const currentDir = rotateDirectionByAxisAngleVector(marker.naturalSourceDir, currentRot);
      const error = angularDistanceRadians(currentDir, marker.desiredSourceDir);
      if (error > maxError) maxError = error;
    }

    // Converged — every marker is within tolerance.
    if (maxError <= residualToleranceRadians) break;
    // Stalled — improvement this pass is negligible relative to last pass.
    if (previousMaxError !== Infinity && maxError >= previousMaxError * (1 - STALL_IMPROVEMENT_RATIO)) {
      break;
    }

    // Build residual markers
    const residuals: MarkerData[] = [];
    for (let mi = 0; mi < markerCount; mi++) {
      const marker = markers[mi];
      const texelUv = unitDirectionToEquirectUv(marker.naturalSourceDir);
      const currentRot = sampleRotationFieldBilinear(rotationField, width, height, texelUv);

      const currentDir = rotateDirectionByAxisAngleVector(marker.naturalSourceDir, currentRot);
      const error = angularDistanceRadians(currentDir, marker.desiredSourceDir);
      if (error > residualToleranceRadians) {
        const residualRot = axisAngleVectorBetween(currentDir, marker.desiredSourceDir);
        residuals.push({
          ...marker,
          rotation: residualRot,
        });
      }
    }

    if (residuals.length === 0) break;

    const candidateField = composeRotations(
      rotationField,
      solveField(width, height, residuals, anchors),
      width,
      height,
    );
    clampRotationMagnitude(candidateField, texelCount, MAX_ROTATION_RADIANS);

    // Measure the worst marker error under the candidate field. Reject the
    // correction (keep the existing field) if it does not improve the result.
    let candidateMaxError = 0;
    for (let mi = 0; mi < markerCount; mi++) {
      const marker = markers[mi];
      const texelUv = unitDirectionToEquirectUv(marker.naturalSourceDir);
      const currentRot = sampleRotationFieldBilinear(candidateField, width, height, texelUv);
      const currentDir = rotateDirectionByAxisAngleVector(marker.naturalSourceDir, currentRot);
      const error = angularDistanceRadians(currentDir, marker.desiredSourceDir);
      if (error > candidateMaxError) candidateMaxError = error;
    }

    if (candidateMaxError >= maxError) {
      // Correction is worse than what we already had — stop iterating.
      break;
    }

    rotationField = candidateField;
    previousMaxError = maxError;
  }

  // Convert rotation field to displacement field
  const displacement = new Float32Array(texelCount * 2);
  let maxRotationRadians = 0;

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const idx = ty * width + tx;
      const rotOffset = idx * 3;
      const dispOffset = idx * 2;

      const u = tx / width;
      const v = ty / height;
      const sourceDir = equirectUvToUnitDirection([u, v]);

      const rot: Vec3 = [rotationField[rotOffset], rotationField[rotOffset + 1], rotationField[rotOffset + 2]];
      const rotAngle = Math.sqrt(rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2]);
      if (rotAngle > maxRotationRadians) maxRotationRadians = rotAngle;

      const correctedDir = rotateDirectionByAxisAngleVector(sourceDir, rot);
      const correctedUv = unitDirectionToEquirectUv(correctedDir);

      displacement[dispOffset] = shortestWrappedDeltaU(u, correctedUv[0]);
      displacement[dispOffset + 1] = correctedUv[1] - v;
    }
  }

  // Calculate marker error
  let maxMarkerErrorRadians = 0;
  for (const marker of markers) {
    const queryUv = unitDirectionToEquirectUv(marker.naturalSourceDir);
    const [du, dv] = sampleDisplacementFieldBilinear(displacement, width, height, queryUv);

    const mappedU = ((queryUv[0] + du) % 1 + 1) % 1;
    const mappedV = Math.min(1, Math.max(0, queryUv[1] + dv));

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
      const u = tx / width;
      const v = ty / height;
      const sourceDir = equirectUvToUnitDirection([u, v]);

      let totalWeight = 0;
      let weightedRotX = 0;
      let weightedRotY = 0;
      let weightedRotZ = 0;

      for (const marker of markers) {
        const dist = angularDistanceRadians(sourceDir, marker.naturalSourceDir);
        const normalizedR = dist / marker.radiusRadians;
        const w = wendlandC2(normalizedR);
        weightedRotX += w * marker.rotation[0];
        weightedRotY += w * marker.rotation[1];
        weightedRotZ += w * marker.rotation[2];
        totalWeight += w;
      }

      for (const anchorDir of anchorDirs) {
        const dist = angularDistanceRadians(sourceDir, anchorDir);
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
