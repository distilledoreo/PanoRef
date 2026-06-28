import { CameraData, PanoCropSettings, PanoReference, ProjectSettings, Vec3 } from '../domain/types';

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function multiplyScalar(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

export function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

export function normalize(value: Vec3): Vec3 {
  const distance = length(value);
  if (distance === 0) return [0, 0, 1];
  return [value[0] / distance, value[1] / distance, value[2] / distance];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function directionToYawPitch(direction: Vec3): { yawDegrees: number; pitchDegrees: number } {
  const dir = normalize(direction);
  const yaw = Math.atan2(dir[0], dir[2]);
  const pitch = Math.asin(clamp(dir[1], -1, 1));
  return {
    yawDegrees: radiansToDegrees(yaw),
    pitchDegrees: radiansToDegrees(pitch),
  };
}

export function yawPitchToDirection(yawDegrees: number, pitchDegrees: number): Vec3 {
  const yaw = degreesToRadians(yawDegrees);
  const pitch = degreesToRadians(pitchDegrees);
  const cosPitch = Math.cos(pitch);
  return normalize([
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    Math.cos(yaw) * cosPitch,
  ]);
}

export function cameraForward(camera: CameraData): Vec3 {
  return normalize(subtract(camera.target, camera.position));
}

export function getPanoCropSettingsForShot(
  shotCamera: CameraData,
  pano: PanoReference,
  width: number,
  height: number,
): PanoCropSettings {
  const direction = cameraForward(shotCamera);
  const { yawDegrees, pitchDegrees } = directionToYawPitch(direction);
  return {
    panoId: pano.id,
    yawDegrees,
    pitchDegrees,
    rollDegrees: 0,
    fovDegrees: shotCamera.fovDegrees,
    aspectRatio: shotCamera.aspectRatio,
    width,
    height,
  };
}

export function createCameraFromPanoView(params: {
  pano: PanoReference;
  yawDegrees: number;
  pitchDegrees: number;
  fovDegrees: number;
  aspectRatio: number;
}): CameraData {
  const direction = yawPitchToDirection(params.yawDegrees, params.pitchDegrees);
  const target = add(params.pano.origin, multiplyScalar(direction, 10));
  return {
    position: [...params.pano.origin],
    target,
    fovDegrees: params.fovDegrees,
    aspectRatio: params.aspectRatio,
    near: 0.1,
    far: 100,
  };
}

export function getPanoMatchQuality(
  camera: CameraData,
  pano: PanoReference,
  settings: Pick<ProjectSettings, 'panoGoodMatchMeters' | 'panoModerateMatchMeters'>,
): { quality: 'good' | 'moderate' | 'poor'; distanceMeters: number } {
  const distanceMeters = length(subtract(camera.position, pano.origin));
  if (distanceMeters <= settings.panoGoodMatchMeters) {
    return { quality: 'good', distanceMeters };
  }
  if (distanceMeters <= settings.panoModerateMatchMeters) {
    return { quality: 'moderate', distanceMeters };
  }
  return { quality: 'poor', distanceMeters };
}

export function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

export function radiansToDegrees(value: number): number {
  return value * (180 / Math.PI);
}

