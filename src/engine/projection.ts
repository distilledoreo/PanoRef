import { Vec3 } from '../domain/types';
import { clamp, multiplyScalar, normalize } from './sync';

export const PROJECTION_MIN_FACING = 0.2;
export const PROJECTION_OCCLUSION_BIAS_METERS = 0.25;

export function directionToEquirectUv(direction: Vec3): { u: number; v: number } {
  const dir = normalize(direction);
  return {
    u: Math.atan2(dir[0], dir[2]) / (Math.PI * 2) + 0.5,
    v: Math.asin(clamp(dir[1], -1, 1)) / Math.PI + 0.5,
  };
}

export function worldDirectionToPanoUv(direction: Vec3, panoYawDegrees = 0): { u: number; v: number } {
  return directionToEquirectUv(rotateDirectionYaw(direction, -panoYawDegrees));
}

export function rotateDirectionYaw(direction: Vec3, yawDegrees: number): Vec3 {
  const yaw = yawDegrees * (Math.PI / 180);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dir = normalize(direction);
  return normalize([
    dir[0] * cos + dir[2] * sin,
    dir[1],
    -dir[0] * sin + dir[2] * cos,
  ]);
}

export function surfaceFacingConfidence(surfaceNormal: Vec3, fromPanoDirection: Vec3): number {
  const normal = normalize(surfaceNormal);
  const towardPano = normalize(multiplyScalar(fromPanoDirection, -1));
  return clamp(normal[0] * towardPano[0] + normal[1] * towardPano[1] + normal[2] * towardPano[2], 0, 1);
}

export function isProjectionDistanceVisible(
  hitDistanceMeters: number,
  nearestDistanceMeters: number,
  biasMeters = PROJECTION_OCCLUSION_BIAS_METERS,
): boolean {
  return hitDistanceMeters <= nearestDistanceMeters + biasMeters;
}

export function shouldUseProjectedPano(params: {
  surfaceNormal: Vec3;
  fromPanoDirection: Vec3;
  hitDistanceMeters: number;
  nearestDistanceMeters: number;
  minFacing?: number;
  occlusionBiasMeters?: number;
}): boolean {
  const confidence = surfaceFacingConfidence(params.surfaceNormal, params.fromPanoDirection);
  return (
    confidence >= (params.minFacing ?? PROJECTION_MIN_FACING)
    && isProjectionDistanceVisible(
      params.hitDistanceMeters,
      params.nearestDistanceMeters,
      params.occlusionBiasMeters ?? PROJECTION_OCCLUSION_BIAS_METERS,
    )
  );
}
