/** Delay after the last focal-length reveal before the HUD begins fading out. */
export const FOCAL_LENGTH_HUD_HIDE_DELAY_MS = 1000;

/** Opacity transition duration for the focal-length HUD fade-out. */
export const FOCAL_LENGTH_HUD_FADE_MS = 300;

export const FULL_FRAME_SENSOR_WIDTH_MM = 36;

/** Supported full-frame equivalent focal-length range in the shot viewfinder. */
export const MIN_SHOT_FOCAL_LENGTH_MM = 5;
export const MAX_SHOT_FOCAL_LENGTH_MM = 300;

export function verticalFovToFocalLength(
  verticalFovDegrees: number,
  aspectRatio: number,
): number {
  const sensorHeightMm = FULL_FRAME_SENSOR_WIDTH_MM / aspectRatio;
  const fovRadians = verticalFovDegrees * Math.PI / 180;

  return sensorHeightMm / (2 * Math.tan(fovRadians / 2));
}

export function focalLengthToVerticalFov(
  focalLengthMm: number,
  aspectRatio: number,
): number {
  const sensorHeightMm = FULL_FRAME_SENSOR_WIDTH_MM / aspectRatio;

  return (
    2 *
    Math.atan(sensorHeightMm / (2 * focalLengthMm)) *
    180 /
    Math.PI
  );
}

/** @deprecated Use `verticalFovToFocalLength`. */
export const focalLengthFromVerticalFov = verticalFovToFocalLength;

/** @deprecated Use `focalLengthToVerticalFov`. */
export const verticalFovFromFocalLength = focalLengthToVerticalFov;

export function clampFocalLengthMm(focalLengthMm: number): number {
  return Math.max(MIN_SHOT_FOCAL_LENGTH_MM, Math.min(MAX_SHOT_FOCAL_LENGTH_MM, focalLengthMm));
}

export function clampShotVerticalFov(verticalFovDegrees: number, aspectRatio: number): number {
  const focalLengthMm = clampFocalLengthMm(verticalFovToFocalLength(verticalFovDegrees, aspectRatio));
  return focalLengthToVerticalFov(focalLengthMm, aspectRatio);
}
