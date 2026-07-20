/** Delay after the last FOV scroll before the focal-length HUD begins fading out. */
export const FOCAL_LENGTH_HUD_HIDE_DELAY_MS = 1000;

/** Opacity transition duration for the focal-length HUD fade-out. */
export const FOCAL_LENGTH_HUD_FADE_MS = 300;

/** Maximum full-frame equivalent focal length reachable in the shot viewfinder. */
export const MAX_SHOT_FOCAL_LENGTH_MM = 200;

/** Maximum vertical FOV reachable in the shot viewfinder (wide-angle end). */
export const MAX_SHOT_VERTICAL_FOV_DEGREES = 120;

/**
 * Full-frame (36 mm wide) equivalent focal length from vertical FOV and camera aspect ratio.
 * The returned value is not rounded — callers should round for display only.
 */
export function focalLengthFromVerticalFov(verticalFovDegrees: number, aspectRatio: number): number {
  const sensorHeightMm = 36 / aspectRatio;
  return sensorHeightMm / (2 * Math.tan((verticalFovDegrees * Math.PI / 180) / 2));
}

/** Vertical FOV that corresponds to a full-frame equivalent focal length. */
export function verticalFovFromFocalLength(focalLengthMm: number, aspectRatio: number): number {
  const sensorHeightMm = 36 / aspectRatio;
  return 2 * Math.atan(sensorHeightMm / (2 * focalLengthMm)) * 180 / Math.PI;
}

/** Clamp shot-framing vertical FOV to the supported wide-angle and telephoto range. */
export function clampShotVerticalFov(verticalFovDegrees: number, aspectRatio: number): number {
  const minFov = verticalFovFromFocalLength(MAX_SHOT_FOCAL_LENGTH_MM, aspectRatio);
  return Math.max(minFov, Math.min(MAX_SHOT_VERTICAL_FOV_DEGREES, verticalFovDegrees));
}
