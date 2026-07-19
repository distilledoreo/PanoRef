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
  return fragmentDistance <= firstHit + effectiveBias ? 1.0 : 0.0;
}

float sampleProjectorVisibility(
  vec3 worldPosition,
  vec3 projectorOrigin,
  samplerCube occlusionCube,
  float nearMeters,
  float farMeters,
  float faceSize,
  float baseBias,
  float softness
) {
  vec3 projectorOffset = worldPosition - projectorOrigin;
  float fragmentDistance = length(projectorOffset);
  vec3 direction = normalize(projectorOffset);

  float effectiveBias = baseBias
    + fragmentDistance * 0.0015
    + 2.0 * fwidth(fragmentDistance);

  // Robust tangent basis for angular offsets.
  vec3 helperAxis = abs(direction.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(helperAxis, direction));
  vec3 bitangent = normalize(cross(direction, tangent));

  float texelAngle = 2.0 / max(faceSize, 1.0);
  float offsetAngle = texelAngle * max(softness, 0.0);

  float v = 0.0;
  v += singleOcclusionSample(direction, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d1 = normalize(direction + tangent * offsetAngle);
  v += singleOcclusionSample(d1, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d2 = normalize(direction - tangent * offsetAngle);
  v += singleOcclusionSample(d2, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d3 = normalize(direction + bitangent * offsetAngle);
  v += singleOcclusionSample(d3, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  vec3 d4 = normalize(direction - bitangent * offsetAngle);
  v += singleOcclusionSample(d4, worldPosition, projectorOrigin, occlusionCube, nearMeters, farMeters, effectiveBias);
  return clamp(v / 5.0, 0.0, 1.0);
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
  return {
    visible: fragmentDistance <= firstHit + bias,
    firstHitMeters: firstHit,
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
  /** Optional explicit confidence when both visible; defaults to distance confidence. */
  primaryConfidence?: number;
  secondaryConfidence?: number;
}

export interface ProjectorBlendWeights {
  primary: number;
  secondary: number;
  /** True if both projectors are occluded (caller should use fallback). */
  bothOccluded: boolean;
}

/**
 * Distance confidence: closer projector wins. Returns a normalized 0..1 weight
 * for the primary when both visible (secondary gets the complement).
 */
export function projectedConfidence(worldPosition: Vec3, origin: Vec3): number {
  const d = length(subtract(worldPosition, origin));
  // Closer = stronger. Soft falloff so far distances still contribute.
  return 1 / (1 + d * 0.05);
}

export function computeProjectorBlendWeights(params: ProjectorBlendInput): ProjectorBlendWeights {
  const primaryVisibility = params.primaryVisibility ?? 1;
  const secondaryVisibility = params.secondaryOrigin ? (params.secondaryVisibility ?? 1) : 0;

  const mode = params.mode ?? 'primary_only';
  const hasSecondary = Boolean(params.secondaryOrigin);

  // Single-projector cases.
  if (!hasSecondary) {
    if (mode === 'secondary_only') {
      return { primary: 0, secondary: 0, bothOccluded: secondaryVisibility < 0.5 };
    }
    // primary or both with no secondary => primary only.
    return { primary: primaryVisibility >= 0.5 ? 1 : 0, secondary: 0, bothOccluded: primaryVisibility < 0.5 };
  }

  const primaryVisible = primaryVisibility >= 0.5;
  const secondaryVisible = secondaryVisibility >= 0.5;

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

  // Dominant modes fill from the other projector when their preferred source
  // is occluded, then bias quality/confidence ties toward the selected source.
  if (primaryVisible && !secondaryVisible) {
    return { primary: 1, secondary: 0, bothOccluded: false };
  }
  if (!primaryVisible && secondaryVisible) {
    return { primary: 0, secondary: 1, bothOccluded: false };
  }
  if (!primaryVisible && !secondaryVisible) {
    return { primary: 0, secondary: 0, bothOccluded: true };
  }

  const primaryConf = params.primaryConfidence ?? projectedConfidence(params.worldPosition, params.primaryOrigin);
  const secondaryConf = params.secondaryConfidence ?? projectedConfidence(params.worldPosition, params.secondaryOrigin as Vec3);
  const total = primaryConf + secondaryConf || 1;
  let primaryWeight = primaryConf / total;
  if (mode === 'primary_dominant') {
    primaryWeight = primaryConf >= secondaryConf
      ? Math.min(1, 0.55 + primaryConf * 0.55)
      : primaryConf / total;
  } else {
    primaryWeight = secondaryConf >= primaryConf
      ? Math.max(0, 0.45 - secondaryConf * 0.45)
      : primaryConf / total;
  }
  return {
    primary: primaryWeight,
    secondary: 1 - primaryWeight,
    bothOccluded: false,
  };
}
