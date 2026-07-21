import { ProjectorBlendMode, Vec3 } from '../domain/types';
import { clamp, length, normalize, subtract } from './sync';

/**
 * Pure projection sampling math shared by tests and the Projected Style shader.
 * Convention: unrotated pano center (u=0.5) faces world +Z; +X is right when looking +Z.
 * Matches equirectUvToDirection / crop atan(x,z) conventions used elsewhere in PanoRef.
 */

export function applyInversePanoYaw(direction: Vec3, yawRadians: number): Vec3 {
  const s = Math.sin(yawRadians);
  const c = Math.cos(yawRadians);
  return normalize([
    direction[0] * c - direction[2] * s,
    direction[1],
    direction[2] * c + direction[0] * s,
  ]);
}

/** Equirect UV from a unit direction (pano-local, after inverse yaw). */
export function equirectUvFromDirection(direction: Vec3): { u: number; v: number } {
  const dir = normalize(direction);
  const longitude = Math.atan2(dir[0], dir[2]);
  const latitude = Math.asin(clamp(dir[1], -1, 1));
  let u = longitude / (2 * Math.PI) + 0.5;
  // Fract for seamless horizontal wrap (avoids black seam at ±π).
  u = ((u % 1) + 1) % 1;
  const v = clamp(latitude / Math.PI + 0.5, 0, 1);
  return { u, v };
}

/**
 * World-space point → equirect UV for the projector.
 * Returns null when extremely close to the origin (caller should use clay/neutral fallback).
 */
export function worldPositionToProjectedPanoUv(params: {
  worldPosition: Vec3;
  panoOrigin: Vec3;
  panoYawRadians: number;
  nearOriginEpsilonSq?: number;
}): { u: number; v: number } | null {
  const epsilon = params.nearOriginEpsilonSq ?? 1e-8;
  const offset: Vec3 = [
    params.worldPosition[0] - params.panoOrigin[0],
    params.worldPosition[1] - params.panoOrigin[1],
    params.worldPosition[2] - params.panoOrigin[2],
  ];
  const distSq = offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2];
  if (distSq < epsilon) return null;
  const local = applyInversePanoYaw(normalize(offset), params.panoYawRadians);
  return equirectUvFromDirection(local);
}

export function blendProjectedSample(params: {
  sampleRgb: Vec3;
  fallbackRgb: Vec3;
  opacity: number;
  exposure: number;
}): Vec3 {
  const opacity = clamp(params.opacity, 0, 1);
  const exposed: Vec3 = [
    params.sampleRgb[0] * params.exposure,
    params.sampleRgb[1] * params.exposure,
    params.sampleRgb[2] * params.exposure,
  ];
  return [
    params.fallbackRgb[0] * (1 - opacity) + exposed[0] * opacity,
    params.fallbackRgb[1] * (1 - opacity) + exposed[1] * opacity,
    params.fallbackRgb[2] * (1 - opacity) + exposed[2] * opacity,
  ];
}

/** GLSL bodies kept in sync with the pure JS helpers above (injected into onBeforeCompile). */
export const PROJECTED_STYLE_GLSL = {
  applyInversePanoYaw: `vec3 applyInversePanoYaw(vec3 direction, float yaw) {
  float s = sin(yaw);
  float c = cos(yaw);
  return normalize(vec3(
    direction.x * c - direction.z * s,
    direction.y,
    direction.z * c + direction.x * s
  ));
}`,
  equirectUvFromDirection: `vec2 equirectUvFromDirection(vec3 direction) {
  float longitude = atan(direction.x, direction.z);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  return vec2(
    longitude / (2.0 * PROJECTED_PI) + 0.5,
    latitude / PROJECTED_PI + 0.5
  );
}`,
  occlusionDepthHelpers: `vec2 packDepth16GLSL(float value) {
  float scaled = floor(clamp(value, 0.0, 1.0) * 65535.0 + 0.5);
  float highByte = floor(scaled / 256.0);
  float lowByte = scaled - highByte * 256.0;
  return vec2(highByte, lowByte) / 255.0;
}

float unpackDepth16GLSL(vec4 packed) {
  float highByte = floor(packed.r * 255.0 + 0.5);
  float lowByte = floor(packed.g * 255.0 + 0.5);
  return (highByte * 256.0 + lowByte) / 65535.0;
}

float decodeDepthMetersGLSL(vec4 packed, float nearMeters, float farMeters) {
  float normalizedDepth = unpackDepth16GLSL(packed);
  return mix(nearMeters, farMeters, normalizedDepth);
}`,
  occlusionVisibility: `float singleOcclusionSample(
  vec3 sampleDirection,
  vec3 worldPosition,
  vec3 projectorOrigin,
  samplerCube occlusionCube,
  float nearMeters,
  float farMeters,
  float effectiveBias
) {
  vec3 projectorOffset = worldPosition - projectorOrigin;
  float fragmentDistance = length(projectorOffset);
  vec4 packedDepth = textureCube(occlusionCube, sampleDirection);
  if (packedDepth.b < 0.5) {
    return 1.0;
  }
  float firstHit = decodeDepthMetersGLSL(packedDepth, nearMeters, farMeters);
  // Absorb 16-bit packing + cube-face quantization so the receiving surface
  // itself is not falsely marked occluded (stripy white acne).
  float quantizationBias = 2.0 * max(farMeters - nearMeters, 1.0) / 65535.0;
  float adaptiveBias = effectiveBias + quantizationBias + firstHit * 0.01;
  return fragmentDistance <= firstHit + adaptiveBias ? 1.0 : 0.0;
}

float sampleProjectorVisibility(
  vec3 worldPosition,
  vec3 projectorOrigin,
  samplerCube occlusionCube,
  float nearMeters,
  float farMeters,
  float faceSize,
  float baseBias,
  float softness,
  float fastMode
) {
  vec3 projectorOffset = worldPosition - projectorOrigin;
  float fragmentDistance = length(projectorOffset);
  vec3 direction = normalize(projectorOffset);

  float effectiveBias = baseBias
    + fragmentDistance * 0.01
    + 4.0 * fwidth(fragmentDistance);

  // Export / Fast: one center cubemap sample (~5× fewer occlusion lookups).
  if (fastMode > 0.5) {
    return singleOcclusionSample(
      direction,
      worldPosition,
      projectorOrigin,
      occlusionCube,
      nearMeters,
      farMeters,
      effectiveBias
    );
  }

  // Soft edges: five-tap angular filter (viewport quality).
  vec3 helperAxis = abs(direction.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(helperAxis, direction));
  vec3 bitangent = normalize(cross(direction, tangent));

  float texelAngle = 2.0 / max(faceSize, 1.0);
  float offsetAngle = texelAngle * max(softness, 0.0);

  float center = singleOcclusionSample(
    direction,
    worldPosition,
    projectorOrigin,
    occlusionCube,
    nearMeters,
    farMeters,
    effectiveBias
  );
  float v = center;
  vec3 d1 = normalize(direction + tangent * offsetAngle);
  v += singleOcclusionSample(d1, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d2 = normalize(direction - tangent * offsetAngle);
  v += singleOcclusionSample(d2, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d3 = normalize(direction + bitangent * offsetAngle);
  v += singleOcclusionSample(d3, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d4 = normalize(direction - bitangent * offsetAngle);
  v += singleOcclusionSample(d4, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  float averaged = clamp(v / 5.0, 0.0, 1.0);
  // Neighbor taps often graze closer geometry and falsely darken a surface that
  // the center tap correctly sees. Keep true silhouettes soft, but never let
  // neighbors alone paint white strips across an otherwise visible receiver.
  if (center > 0.5) {
    return mix(center, averaged, 0.25);
  }
  return averaged;
}`,
} as const;

// --- Synthetic directional pano helpers (tests + offline diagnostics) ---

export type CardinalPanoFace = '+z' | '+x' | '-z' | '-x' | 'ceiling' | 'floor';

/** Deterministic synthetic pano: cardinal directions map to fixed RGB triples in 0–1. */
export const SYNTHETIC_PANO_COLORS: Record<CardinalPanoFace, Vec3> = {
  '+z': [1, 0, 0], // red
  '+x': [0, 1, 0], // green
  '-z': [0, 0, 1], // blue
  '-x': [1, 1, 0], // yellow
  ceiling: [1, 1, 1], // white
  floor: [0, 0, 0], // black
};

/**
 * Sample a synthetic 6-region equirect for unit tests without WebGL.
 * Regions are chosen from the dominant axis of the local direction.
 */
export function sampleSyntheticDirectionalPano(u: number, v: number): Vec3 {
  // Reconstruct direction from UV (same convention as equirectUvToDirection).
  const theta = u * 2 * Math.PI - Math.PI;
  const phi = v * Math.PI - Math.PI * 0.5;
  const dir = normalize([
    Math.sin(theta) * Math.cos(phi),
    Math.sin(phi),
    Math.cos(theta) * Math.cos(phi),
  ]);
  const ax = Math.abs(dir[0]);
  const ay = Math.abs(dir[1]);
  const az = Math.abs(dir[2]);
  if (ay >= ax && ay >= az) {
    return dir[1] >= 0 ? SYNTHETIC_PANO_COLORS.ceiling : SYNTHETIC_PANO_COLORS.floor;
  }
  if (ax >= az) {
    return dir[0] >= 0 ? SYNTHETIC_PANO_COLORS['+x'] : SYNTHETIC_PANO_COLORS['-x'];
  }
  return dir[2] >= 0 ? SYNTHETIC_PANO_COLORS['+z'] : SYNTHETIC_PANO_COLORS['-z'];
}

/** Project a world point onto the synthetic directional pano and return RGB. */
export function sampleProjectedSyntheticAtWorld(params: {
  worldPosition: Vec3;
  panoOrigin?: Vec3;
  panoYawRadians?: number;
  opacity?: number;
  exposure?: number;
  fallbackRgb?: Vec3;
}): Vec3 | 'near-origin' {
  const uv = worldPositionToProjectedPanoUv({
    worldPosition: params.worldPosition,
    panoOrigin: params.panoOrigin ?? [0, 0, 0],
    panoYawRadians: params.panoYawRadians ?? 0,
  });
  if (!uv) return 'near-origin';
  const sample = sampleSyntheticDirectionalPano(uv.u, uv.v);
  return blendProjectedSample({
    sampleRgb: sample,
    fallbackRgb: params.fallbackRgb ?? [0.5, 0.5, 0.5],
    opacity: params.opacity ?? 1,
    exposure: params.exposure ?? 1,
  });
}

export function rgbClose(a: Vec3, b: Vec3, epsilon = 1e-5): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon
    && Math.abs(a[1] - b[1]) <= epsilon
    && Math.abs(a[2] - b[2]) <= epsilon;
}

// --- Radial-depth packing (mirrors GLSL packDepth16/unpackDepth16) ----------

/** Pack a normalized [0,1] depth into two 8-bit channels (0..65535). */
export function packDepth16(normalized: number): [number, number] {
  const value = clamp(normalized, 0, 1);
  const scaled = Math.min(65535, Math.max(0, Math.round(value * 65535)));
  const highByte = Math.floor(scaled / 256);
  const lowByte = scaled - highByte * 256;
  return [highByte / 255, lowByte / 255];
}

/** Decode two packed 8-bit channels (0..255 byte values) back to [0,1]. */
export function unpackDepth16(highByte: number, lowByte: number): number {
  const h = Math.round(clamp(highByte, 0, 1) * 255);
  const l = Math.round(clamp(lowByte, 0, 1) * 255);
  return (h * 256 + l) / 65535;
}

/** Decode a packed RGBA tuple (each 0..1) into world-space meters. */
export function decodeDepthMeters(
  packed: [number, number, number, number],
  nearMeters: number,
  farMeters: number,
): number {
  const normalized = unpackDepth16(packed[0], packed[1]);
  return nearMeters + (farMeters - nearMeters) * normalized;
}

// --- Visibility -------------------------------------------------------------

export interface VisibilitySampleResult {
  visible: boolean;
  /** Decoded first-hit distance in meters (Infinity when no hit recorded). */
  firstHitMeters: number;
}

/**
 * Pure CPU visibility test for a fragment relative to one projector's depth map.
 * `packedDepth` is the sampled cube value [r,g,b,a] with blue=hit flag.
 * Missing map (null) => legacy behavior: always visible.
 */
export function sampleProjectorVisibility(params: {
  worldPosition: Vec3;
  projectorOrigin: Vec3;
  packedDepth: [number, number, number, number] | null;
  nearMeters: number;
  farMeters: number;
  biasMeters?: number;
}): VisibilitySampleResult {
  if (!params.packedDepth) {
    return { visible: true, firstHitMeters: Infinity };
  }
  const [, , blue] = params.packedDepth;
  if (blue < 0.5) {
    // No occluder recorded along the ray.
    return { visible: true, firstHitMeters: Infinity };
  }
  const fragmentDistance = length(subtract(params.worldPosition, params.projectorOrigin));
  const firstHit = decodeDepthMeters(params.packedDepth, params.nearMeters, params.farMeters);
  const bias = params.biasMeters ?? 0.04;
  const quantizationBias = 2 * Math.max(params.farMeters - params.nearMeters, 1) / 65535;
  const adaptiveBias = bias + quantizationBias + firstHit * 0.01;
  return {
    visible: fragmentDistance <= firstHit + adaptiveBias,
    firstHitMeters: firstHit,
  };
}

// --- Quality-based dual-projector conflict resolution -----------------------
// Keep these constants mirrored in projectedStyleMaterials.ts GLSL.

/** Modest tie-breaker when qualities are nearly equal (not a broad dominance). */
export const DOMINANCE_BIAS = 1.04;
/** Half-width of the log2 quality-ratio feather (≈±0.3 → short seam). */
export const SEAM_FEATHER_LOG2 = 0.30;
/** Avoids log(0) and marks effectively-zero quality scores. */
export const SCORE_EPSILON = 1e-6;
/** Soft visibility below this is treated as unavailable (not the old 0.5 cutoff). */
export const VISIBILITY_EPSILON = 0.001;
/** Quality exponent applied after bias clamp. */
export const QUALITY_SCORE_EXPONENT = 4;

/** GLSL-compatible smoothstep for CPU parity with the shader. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dominanceBiasForBlendMode(mode: ProjectorBlendMode | undefined): {
  primaryBias: number;
  secondaryBias: number;
} {
  return {
    primaryBias: mode === 'primary_dominant' ? DOMINANCE_BIAS : 1,
    secondaryBias: mode === 'secondary_dominant' ? DOMINANCE_BIAS : 1,
  };
}

export interface QualityConflictOwnershipInput {
  primaryCoverage: number;
  secondaryCoverage: number;
  primaryQuality: number;
  secondaryQuality: number;
  primaryBias?: number;
  secondaryBias?: number;
}

export interface QualityConflictOwnershipResult {
  primaryWeight: number;
  secondaryWeight: number;
  primaryScore: number;
  secondaryScore: number;
}

/**
 * Winner-takes-most ownership from biased quality scores.
 * Coverage stays separate: callers use max(coverage) for mix-vs-fallback opacity.
 */
export function resolveQualityConflictOwnership(
  params: QualityConflictOwnershipInput,
): QualityConflictOwnershipResult {
  const primaryBias = params.primaryBias ?? 1;
  const secondaryBias = params.secondaryBias ?? 1;
  const primaryVisible = params.primaryCoverage >= VISIBILITY_EPSILON;
  const secondaryVisible = params.secondaryCoverage >= VISIBILITY_EPSILON;

  if (primaryVisible && !secondaryVisible) {
    return { primaryWeight: 1, secondaryWeight: 0, primaryScore: 0, secondaryScore: 0 };
  }
  if (!primaryVisible && secondaryVisible) {
    return { primaryWeight: 0, secondaryWeight: 1, primaryScore: 0, secondaryScore: 0 };
  }
  if (!primaryVisible && !secondaryVisible) {
    return { primaryWeight: 0, secondaryWeight: 0, primaryScore: 0, secondaryScore: 0 };
  }

  const primaryScore = params.primaryCoverage
    * (clamp(params.primaryQuality * primaryBias, 0, 1) ** QUALITY_SCORE_EXPONENT);
  const secondaryScore = params.secondaryCoverage
    * (clamp(params.secondaryQuality * secondaryBias, 0, 1) ** QUALITY_SCORE_EXPONENT);

  // Both usable in coverage but effectively zero quality: pick higher raw quality,
  // then break an exact tie with the dominant preference.
  if (primaryScore <= SCORE_EPSILON && secondaryScore <= SCORE_EPSILON) {
    if (params.primaryQuality > params.secondaryQuality) {
      return { primaryWeight: 1, secondaryWeight: 0, primaryScore, secondaryScore };
    }
    if (params.secondaryQuality > params.primaryQuality) {
      return { primaryWeight: 0, secondaryWeight: 1, primaryScore, secondaryScore };
    }
    if (primaryBias > secondaryBias) {
      return { primaryWeight: 1, secondaryWeight: 0, primaryScore, secondaryScore };
    }
    if (secondaryBias > primaryBias) {
      return { primaryWeight: 0, secondaryWeight: 1, primaryScore, secondaryScore };
    }
    return { primaryWeight: 0.5, secondaryWeight: 0.5, primaryScore, secondaryScore };
  }

  const qualityRatio = Math.log2(
    (primaryScore + SCORE_EPSILON) / (secondaryScore + SCORE_EPSILON),
  );
  const primaryOwnership = smoothstep(-SEAM_FEATHER_LOG2, SEAM_FEATHER_LOG2, qualityRatio);
  return {
    primaryWeight: primaryOwnership,
    secondaryWeight: 1 - primaryOwnership,
    primaryScore,
    secondaryScore,
  };
}

// --- Visibility-gated multi-origin blend weights ----------------------------

export interface ProjectorBlendInput {
  worldPosition: Vec3;
  primaryOrigin: Vec3;
  secondaryOrigin?: Vec3;
  mode?: ProjectorBlendMode;
  /** Omitted => 1 (legacy / non-occlusion paths stay valid). */
  primaryVisibility?: number;
  secondaryVisibility?: number;
  /**
   * Optional quality/confidence when both visible.
   * Defaults to a distance proxy so call sites without explicit quality stay usable;
   * the live shader uses projectedQualityAt instead — prefer computeProjectedStyleCoverageBlend
   * for shader-parity checks.
   */
  primaryConfidence?: number;
  secondaryConfidence?: number;
  primaryQuality?: number;
  secondaryQuality?: number;
}

export interface ProjectorBlendWeights {
  primary: number;
  secondary: number;
  /** True if both projectors are occluded (caller should use fallback). */
  bothOccluded: boolean;
}

/**
 * Distance confidence: closer projector wins. Soft falloff proxy for tests /
 * callers that do not supply explicit projection quality.
 */
export function projectedConfidence(worldPosition: Vec3, origin: Vec3): number {
  const d = length(subtract(worldPosition, origin));
  return 1 / (1 + d * 0.05);
}

/**
 * Visibility-gated blend weights using the same quality conflict resolver as the
 * projected-style shader (via resolveQualityConflictOwnership).
 */
export function computeProjectorBlendWeights(params: ProjectorBlendInput): ProjectorBlendWeights {
  const primaryVisibility = params.primaryVisibility ?? 1;
  const secondaryVisibility = params.secondaryOrigin ? (params.secondaryVisibility ?? 1) : 0;

  const mode = params.mode ?? 'primary_only';
  const hasSecondary = Boolean(params.secondaryOrigin);
  const { primaryBias, secondaryBias } = dominanceBiasForBlendMode(mode);

  // Single-projector cases.
  if (!hasSecondary) {
    if (mode === 'secondary_only') {
      return { primary: 0, secondary: 0, bothOccluded: secondaryVisibility < VISIBILITY_EPSILON };
    }
    return {
      primary: primaryVisibility >= VISIBILITY_EPSILON ? 1 : 0,
      secondary: 0,
      bothOccluded: primaryVisibility < VISIBILITY_EPSILON,
    };
  }

  const primaryVisible = primaryVisibility >= VISIBILITY_EPSILON;
  const secondaryVisible = secondaryVisibility >= VISIBILITY_EPSILON;

  if (mode === 'primary_only') {
    return {
      primary: primaryVisible ? 1 : 0,
      secondary: 0,
      bothOccluded: !primaryVisible,
    };
  }
  if (mode === 'secondary_only') {
    return {
      primary: 0,
      secondary: secondaryVisible ? 1 : 0,
      bothOccluded: !secondaryVisible,
    };
  }

  if (!primaryVisible && !secondaryVisible) {
    return { primary: 0, secondary: 0, bothOccluded: true };
  }

  const primaryQuality = params.primaryQuality
    ?? params.primaryConfidence
    ?? projectedConfidence(params.worldPosition, params.primaryOrigin);
  const secondaryQuality = params.secondaryQuality
    ?? params.secondaryConfidence
    ?? projectedConfidence(params.worldPosition, params.secondaryOrigin as Vec3);

  const ownership = resolveQualityConflictOwnership({
    primaryCoverage: clamp(primaryVisibility, 0, 1),
    secondaryCoverage: clamp(secondaryVisibility, 0, 1),
    primaryQuality,
    secondaryQuality,
    primaryBias,
    secondaryBias,
  });

  return {
    primary: ownership.primaryWeight,
    secondary: ownership.secondaryWeight,
    bothOccluded: false,
  };
}

/**
 * Mirrors the projected-style fragment coverage/quality contract:
 * visibility owns mix-vs-fallback coverage; quality decides color ownership.
 */
export interface ProjectedStyleCoverageBlendInput {
  primaryEnabled: boolean;
  secondaryEnabled: boolean;
  primaryVisibility: number;
  secondaryVisibility: number;
  primaryQuality: number;
  secondaryQuality: number;
  /** Explicit bias multipliers; defaults from blendMode when omitted. */
  primaryDominance?: number;
  secondaryDominance?: number;
  blendMode?: ProjectorBlendMode;
  projectedOpacity?: number;
  primarySampleRgb: Vec3;
  secondarySampleRgb: Vec3;
  fallbackRgb: Vec3;
}

export interface ProjectedStyleCoverageBlendResult {
  primaryCoverage: number;
  secondaryCoverage: number;
  coverage: number;
  primaryWeight: number;
  secondaryWeight: number;
  primaryScore: number;
  secondaryScore: number;
  mixFactor: number;
  rgb: Vec3;
}

export function computeProjectedStyleCoverageBlend(
  params: ProjectedStyleCoverageBlendInput,
): ProjectedStyleCoverageBlendResult {
  const modeBiases = dominanceBiasForBlendMode(params.blendMode);
  const primaryBias = params.primaryDominance ?? modeBiases.primaryBias;
  const secondaryBias = params.secondaryDominance ?? modeBiases.secondaryBias;
  const projectedOpacity = clamp(params.projectedOpacity ?? 1, 0, 1);

  const primaryCoverage = (params.primaryEnabled ? 1 : 0) * clamp(params.primaryVisibility, 0, 1);
  const secondaryCoverage = (params.secondaryEnabled ? 1 : 0) * clamp(params.secondaryVisibility, 0, 1);
  const coverage = Math.max(primaryCoverage, secondaryCoverage);

  const ownership = resolveQualityConflictOwnership({
    primaryCoverage,
    secondaryCoverage,
    primaryQuality: params.primaryQuality,
    secondaryQuality: params.secondaryQuality,
    primaryBias,
    secondaryBias,
  });

  const { primaryWeight, secondaryWeight, primaryScore, secondaryScore } = ownership;
  const weightTotal = primaryWeight + secondaryWeight;

  let projectedColor: Vec3 = [...params.fallbackRgb];
  if (weightTotal > SCORE_EPSILON) {
    projectedColor = [
      (params.primarySampleRgb[0] * primaryWeight + params.secondarySampleRgb[0] * secondaryWeight) / weightTotal,
      (params.primarySampleRgb[1] * primaryWeight + params.secondarySampleRgb[1] * secondaryWeight) / weightTotal,
      (params.primarySampleRgb[2] * primaryWeight + params.secondarySampleRgb[2] * secondaryWeight) / weightTotal,
    ];
  }

  const mixFactor = coverage > 1e-4
    ? projectedOpacity * clamp(coverage, 0, 1)
    : 0;
  const rgb: Vec3 = coverage > 1e-4
    ? [
      params.fallbackRgb[0] * (1 - mixFactor) + projectedColor[0] * mixFactor,
      params.fallbackRgb[1] * (1 - mixFactor) + projectedColor[1] * mixFactor,
      params.fallbackRgb[2] * (1 - mixFactor) + projectedColor[2] * mixFactor,
    ]
    : [...params.fallbackRgb];

  return {
    primaryCoverage,
    secondaryCoverage,
    coverage,
    primaryWeight,
    secondaryWeight,
    primaryScore,
    secondaryScore,
    mixFactor,
    rgb,
  };
}
