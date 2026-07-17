import { Vec2, Vec3 } from '../domain/types';

const PI = Math.PI;
const TWO_PI = 2 * PI;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-10) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Convert equirectangular UV to a unit direction vector.
 * Convention: u=0.5 faces +Z, u=0 faces -Z, u=0.25 faces -X, u=0.75 faces +X.
 * v=0 is south pole (floor), v=0.5 is horizon, v=1 is north pole (ceiling).
 * Matches the existing projection shader convention.
 */
export function equirectUvToUnitDirection(uv: Vec2): Vec3 {
  const theta = (uv[0] - 0.5) * TWO_PI;
  const phi = uv[1] * PI - PI / 2;
  const cosPhi = Math.cos(phi);
  return normalize([
    Math.sin(theta) * cosPhi,
    Math.sin(phi),
    Math.cos(theta) * cosPhi,
  ]);
}

/**
 * Convert a unit direction vector to equirectangular UV.
 * Inverse of equirectUvToUnitDirection.
 */
export function unitDirectionToEquirectUv(direction: Vec3): Vec2 {
  const dir = normalize(direction);
  const longitude = Math.atan2(dir[0], dir[2]);
  const latitude = Math.asin(clamp(dir[1], -1, 1));
  const u = ((longitude / TWO_PI + 0.5) % 1 + 1) % 1;
  const v = latitude / PI + 0.5;
  return [u, clamp(v, 0, 1)];
}

/**
 * Shortest wrapped delta U, handling the 0/1 seam.
 * Returns a value in [-0.5, 0.5].
 */
export function shortestWrappedDeltaU(fromU: number, toU: number): number {
  let delta = toU - fromU;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;
  return delta;
}

/**
 * Wrap U coordinate into [0, 1).
 */
export function wrapUvU(u: number): number {
  return ((u % 1) + 1) % 1;
}

/**
 * Clamp V coordinate into [0, 1].
 */
export function clampUvV(v: number): number {
  return clamp(v, 0, 1);
}

/**
 * Angular distance in radians between two unit directions.
 */
export function angularDistanceRadians(a: Vec3, b: Vec3): number {
  const dotProduct = clamp(dot(normalize(a), normalize(b)), -1, 1);
  return Math.acos(dotProduct);
}

/**
 * Compute the axis-angle vector (angle * axis) that rotates `from` toward `to`.
 * Returns a zero vector when from and to are parallel.
 * The vector direction is the rotation axis, magnitude is the rotation angle.
 */
export function axisAngleVectorBetween(from: Vec3, to: Vec3): Vec3 {
  const f = normalize(from);
  const t = normalize(to);
  const dotProduct = clamp(dot(f, t), -1, 1);

  if (dotProduct > 0.99999) {
    return [0, 0, 0];
  }

  if (dotProduct < -0.99999) {
    const arbitrary: Vec3 = Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp = normalize(cross(f, arbitrary));
    return scale(perp, PI);
  }

  const angle = Math.acos(dotProduct);
  const axis = normalize(cross(f, t));
  return scale(axis, angle);
}

/**
 * Rotate a direction vector by an axis-angle vector using Rodrigues' rotation formula.
 */
export function rotateDirectionByAxisAngleVector(
  direction: Vec3,
  axisAngle: Vec3,
): Vec3 {
  const angle = length(axisAngle);
  if (angle < 1e-10) return direction;

  const axis = normalize(axisAngle);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dotProduct = dot(direction, axis);

  return add(
    scale(direction, cosA),
    add(
      scale(cross(axis, direction), sinA),
      scale(axis, dotProduct * (1 - cosA)),
    ),
  );
}

/**
 * Apply yaw rotation (around Y axis) to a direction vector.
 * Positive yaw rotates clockwise when viewed from above.
 */
export function applyYawRotation(direction: Vec3, yawRadians: number): Vec3 {
  const s = Math.sin(yawRadians);
  const c = Math.cos(yawRadians);
  return normalize([
    direction[0] * c + direction[2] * s,
    direction[1],
    direction[2] * c - direction[0] * s,
  ]);
}

/**
 * Apply inverse yaw rotation (around Y axis) to a direction vector.
 * Matches the existing projectedStyleMath.ts convention.
 */
export function applyInverseYawRotation(direction: Vec3, yawRadians: number): Vec3 {
  const s = Math.sin(yawRadians);
  const c = Math.cos(yawRadians);
  return normalize([
    direction[0] * c - direction[2] * s,
    direction[1],
    direction[2] * c + direction[0] * s,
  ]);
}

/**
 * Wendland C2 compactly supported radial basis function.
 * Returns 1 at r=0, 0 at r>=1, smooth in between.
 */
export function wendlandC2(r: number): number {
  if (r <= 0) return 1;
  if (r >= 1) return 0;
  const oneMinusR = 1 - r;
  const term = oneMinusR * oneMinusR * oneMinusR;
  return term * (1 + 3 * r);
}
