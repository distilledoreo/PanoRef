import { Landmark, PanoViewState, Vec3 } from '../domain/types';
import { directionToYawPitch, subtract } from './sync';

export function landmarkStripThumbnailYaw(landmarkPosition: Vec3, panoOrigin: Vec3) {
  const { yawDegrees } = directionToYawPitch(subtract(landmarkPosition, panoOrigin));
  return yawDegrees;
}

export interface LandmarkScreenPosition {
  landmarkId: string;
  x: number;
  y: number;
  visible: boolean;
  yawDegrees: number;
  pitchDegrees: number;
}

export function projectLandmarkToScreen(params: {
  landmark: Landmark;
  panoOrigin: Vec3;
  view: PanoViewState;
  viewportWidth: number;
  viewportHeight: number;
}): LandmarkScreenPosition {
  const offset = subtract(params.landmark.position, params.panoOrigin);
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  if (distance < 0.01) {
    return {
      landmarkId: params.landmark.id,
      x: 0.5,
      y: 0.5,
      visible: false,
      yawDegrees: 0,
      pitchDegrees: 0,
    };
  }

  const { yawDegrees, pitchDegrees } = directionToYawPitch(offset);
  const deltaYaw = normalizeSignedDelta(yawDegrees - params.view.yawDegrees);
  const deltaPitch = pitchDegrees - params.view.pitchDegrees;

  const fovRad = (params.view.fovDegrees * Math.PI) / 180;
  const tanHalf = Math.tan(fovRad / 2);
  const aspect = params.viewportWidth / Math.max(1, params.viewportHeight);
  const deltaYawRad = (deltaYaw * Math.PI) / 180;
  const deltaPitchRad = (deltaPitch * Math.PI) / 180;

  const x = 0.5 + (Math.tan(deltaYawRad) / (aspect * tanHalf)) * 0.5;
  const y = 0.5 - (Math.tan(deltaPitchRad) / tanHalf) * 0.5;

  const margin = 0.06;
  const visible = x >= -margin
    && x <= 1 + margin
    && y >= -margin
    && y <= 1 + margin
    && Math.abs(deltaYaw) < 92
    && Math.abs(deltaPitch) < 78;

  return {
    landmarkId: params.landmark.id,
    x,
    y,
    visible,
    yawDegrees,
    pitchDegrees,
  };
}

export function landmarkPanoBackgroundPosition(yawDegrees: number) {
  const normalized = ((((yawDegrees + 180) % 360) + 360) % 360) / 360;
  return `${(normalized * 100).toFixed(2)}% center`;
}

export function landmarkStripBackgroundPosition(landmarkPosition: Vec3, panoOrigin: Vec3) {
  return landmarkPanoBackgroundPosition(landmarkStripThumbnailYaw(landmarkPosition, panoOrigin));
}

function normalizeSignedDelta(yaw: number) {
  return ((((yaw + 180) % 360) + 360) % 360) - 180;
}