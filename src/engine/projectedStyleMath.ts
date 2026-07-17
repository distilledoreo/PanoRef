import { Vec3 } from '../domain/types';
import { clamp, normalize } from './sync';

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
