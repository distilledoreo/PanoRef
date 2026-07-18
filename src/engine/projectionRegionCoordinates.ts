import type { ProjectionRegion, Vec2, Vec3 } from '../domain/types';
import { applyYawRotation, equirectUvToUnitDirection } from './projectionAlignmentMath';

export const MAX_REGION_FIT_ORIGIN_DISTANCE_METERS = 0.25;
export const MAX_REGION_ANGULAR_SPAN_DEGREES = 100;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => { const length = Math.hypot(...v); return length > 1e-10 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1]; };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface TangentPlaneBasis { center: Vec3; right: Vec3; up: Vec3 }
export interface ProjectionRegionCoordinateDiagnostics { valid: boolean; status: 'ready' | 'origin-mismatch' | 'too-large' | 'behind-plane' | 'unstable-pole' | 'error'; message?: string }
export interface CommonPlaneRegion { target: Vec2[]; source: Vec2[]; basis: TangentPlaneBasis; diagnostics: ProjectionRegionCoordinateDiagnostics }

export function unitDirectionToTangentPlane(direction: Vec3, basis: TangentPlaneBasis): Vec2 | undefined {
  const depth = dot(direction, basis.center);
  if (!Number.isFinite(depth) || depth <= 1e-5) return undefined;
  const result: Vec2 = [dot(direction, basis.right) / depth, dot(direction, basis.up) / depth];
  return result.every(Number.isFinite) ? result : undefined;
}

export function tangentPlaneToUnitDirection(point: Vec2, basis: TangentPlaneBasis): Vec3 {
  return normalize([
    basis.center[0] + basis.right[0] * point[0] + basis.up[0] * point[1],
    basis.center[1] + basis.right[1] * point[0] + basis.up[1] * point[1],
    basis.center[2] + basis.right[2] * point[0] + basis.up[2] * point[1],
  ]);
}

function angularSpan(directions: Vec3[]): number {
  let maximum = 0;
  for (let i = 0; i < directions.length; i += 1) for (let j = i + 1; j < directions.length; j += 1) maximum = Math.max(maximum, Math.acos(Math.max(-1, Math.min(1, dot(directions[i], directions[j])))) * 180 / Math.PI);
  return maximum;
}

export function regionToCommonPlane(region: ProjectionRegion, options: { targetYawRadians: number; sourceYawRadians: number; targetOrigin?: Vec3; sourceOrigin?: Vec3 }): CommonPlaneRegion {
  const invalid = (status: ProjectionRegionCoordinateDiagnostics['status'], message: string): CommonPlaneRegion => ({ target: [], source: [], basis: { center: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] }, diagnostics: { valid: false, status, message } });
  const targetOrigin = options.targetOrigin ?? [0, 0, 0]; const sourceOrigin = options.sourceOrigin ?? [0, 0, 0];
  if (Math.hypot(targetOrigin[0] - sourceOrigin[0], targetOrigin[1] - sourceOrigin[1], targetOrigin[2] - sourceOrigin[2]) > MAX_REGION_FIT_ORIGIN_DISTANCE_METERS) return invalid('origin-mismatch', 'These panoramas were captured from different positions. Region Fit currently requires matching capture origins.');
  try {
    const targetDirections = region.vertices.map((vertex) => applyYawRotation(equirectUvToUnitDirection(vertex.targetUv), options.targetYawRadians));
    const sourceDirections = region.vertices.map((vertex) => applyYawRotation(equirectUvToUnitDirection(vertex.sourceUv), options.sourceYawRadians));
    const directions = [...targetDirections, ...sourceDirections];
    if (angularSpan(directions) > MAX_REGION_ANGULAR_SPAN_DEGREES) return invalid('too-large', 'This region is too large for one fit. Split it into smaller regions.');
    const center = normalize(directions.reduce(add, [0, 0, 0] as Vec3));
    if (Math.abs(center[1]) > 0.985) return invalid('unstable-pole', 'This region is too close to a panorama pole.');
    const right = normalize(cross([0, 1, 0], center)); const up = normalize(cross(center, right)); const basis = { center, right, up };
    const target = targetDirections.map((direction) => unitDirectionToTangentPlane(direction, basis));
    const source = sourceDirections.map((direction) => unitDirectionToTangentPlane(direction, basis));
    if (target.some((point) => !point) || source.some((point) => !point)) return invalid('behind-plane', 'Part of this region crosses behind its fitting plane. Split it into smaller regions.');
    return { target: target as Vec2[], source: source as Vec2[], basis, diagnostics: { valid: true, status: 'ready' } };
  } catch { return invalid('error', 'Region Fit could not be evaluated.'); }
}
