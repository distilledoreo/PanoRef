/**
 * projectionAlignmentMath.ts
 *
 * Pure, side-effect-free spherical math helpers for the Projection Assist
 * solver and warp texture generator.
 *
 * Convention (matches the rest of PanoRef):
 *   Unrotated pano centre (u=0.5, v=0.5) faces world +Z.
 *   longitude = atan2(x, z).  u = longitude/(2π) + 0.5
 *   latitude  = asin(y).      v = latitude/π + 0.5
 */

import { Vec2, Vec3 } from '../domain/types';

// ---------------------------------------------------------------------------
// Equirect ↔ direction
// ---------------------------------------------------------------------------

/** Convert an equirect UV (each in 0–1) to a unit direction vector. */
export function equirectUvToUnitDirection(uv: Vec2): Vec3 {
  const longitude = (uv[0] - 0.5) * 2 * Math.PI; // atan2 convention: 0.5 → +Z
  const latitude = (uv[1] - 0.5) * Math.PI; // asin convention: 0.5 → horizon
  const cosLat = Math.cos(latitude);
  return [
    Math.sin(longitude) * cosLat,
    Math.sin(latitude),
    Math.cos(longitude) * cosLat,
  ];
}

/** Convert a unit direction vector to equirect UV (each in 0–1). */
export function unitDirectionToEquirectUv(direction: Vec3): Vec2 {
  const len = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
  if (len < 1e-12) return [0.5, 0.5];
  const x = direction[0] / len;
  const y = direction[1] / len;
  const z = direction[2] / len;
  const longitude = Math.atan2(x, z);
  const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
  return [
    longitude / (2 * Math.PI) + 0.5,
    latitude / Math.PI + 0.5,
  ];
}

// ---------------------------------------------------------------------------
// UV arithmetic on the wrapped horizontal axis
// ---------------------------------------------------------------------------

/**
 * Shortest wrapped delta on the U axis.
 * Result is in [-0.5, 0.5) so it always takes the shorter arc around the seam.
 */
export function shortestWrappedDeltaU(fromU: number, toU: number): number {
  let delta = toU - fromU;
  delta = ((delta % 1) + 1.5) % 1 - 0.5; // map to [-0.5, 0.5)
  return delta;
}

/** Wrap U back into [0, 1). */
export function wrapUvU(u: number): number {
  return ((u % 1) + 1) % 1;
}

/** Clamp V to [0, 1]. */
export function clampUvV(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Spherical distance / rotation helpers
// ---------------------------------------------------------------------------

/** Angular distance in radians between two unit vectors (0–π). */
export function angularDistanceRadians(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // clamp for float safety
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Return the axis-angle rotation vector that rotates direction `from` to
 * direction `to` (both assumed unit length).
 *
 * The return value is axis × angle (Rodrigues form), with:
 *   magnitude = angle in radians
 *   direction = unit rotation axis
 *
 * Returns the zero vector for parallel inputs.
 * For anti-parallel inputs, picks a deterministic perpendicular axis.
 */
export function axisAngleVectorBetween(from: Vec3, to: Vec3): Vec3 {
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const angle = Math.acos(dot);

  if (angle < 1e-10) return [0, 0, 0];

  if (Math.PI - angle < 1e-6) {
    // Anti-parallel: pick a perpendicular axis deterministically.
    const perp = Math.abs(from[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
    const axis = normalizeVec3(crossVec3(from, perp));
    return [axis[0] * Math.PI, axis[1] * Math.PI, axis[2] * Math.PI];
  }

  const axis = normalizeVec3(crossVec3(from, to));
  return [axis[0] * angle, axis[1] * angle, axis[2] * angle];
}

/**
 * Rotate a unit direction by an axis-angle rotation vector
 * (Rodrigues' rotation formula).
 */
export function rotateDirectionByAxisAngleVector(direction: Vec3, rotation: Vec3): Vec3 {
  const angle = Math.sqrt(rotation[0] ** 2 + rotation[1] ** 2 + rotation[2] ** 2);
  if (angle < 1e-12) return [...direction];

  const ax = rotation[0] / angle;
  const ay = rotation[1] / angle;
  const az = rotation[2] / angle;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dot = ax * direction[0] + ay * direction[1] + az * direction[2];
  const cross = crossVec3([ax, ay, az], direction);

  return [
    direction[0] * cosA + cross[0] * sinA + ax * dot * (1 - cosA),
    direction[1] * cosA + cross[1] * sinA + ay * dot * (1 - cosA),
    direction[2] * cosA + cross[2] * sinA + az * dot * (1 - cosA),
  ];
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/**
 * Wendland C2 radial basis function (compact support on [0,1]).
 * Returns 1 at t=0, 0 at t≥1, smooth in between.
 */
export function wendlandC2(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const q = 1 - t;
  return q * q * q * q * (4 * t + 1);
}

// ---------------------------------------------------------------------------
// Yaw rotation helpers (pano convention: yaw 0 faces +Z, radians)
// ---------------------------------------------------------------------------

/**
 * Rotate a direction by a Y-axis yaw in radians (pano convention).
 * Used to transform between world space and pano-local space.
 */
export function applyYawRotation(direction: Vec3, yawRadians: number): Vec3 {
  const s = Math.sin(yawRadians);
  const c = Math.cos(yawRadians);
  return [
    direction[0] * c + direction[2] * s,
    direction[1],
    direction[2] * c - direction[0] * s,
  ];
}

/**
 * Rotate a direction by the inverse of a Y-axis yaw (pano-local → world
 * when yaw > 0 rotates the pano left).
 */
export function applyInverseYawRotation(direction: Vec3, yawRadians: number): Vec3 {
  return applyYawRotation(direction, -yawRadians);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  if (len < 1e-12) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}
