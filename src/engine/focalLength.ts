/** Delay after the last FOV scroll before the focal-length HUD begins fading out. */
export const FOCAL_LENGTH_HUD_HIDE_DELAY_MS = 1000;

/** Opacity transition duration for the focal-length HUD fade-out. */
export const FOCAL_LENGTH_HUD_FADE_MS = 300;

/**
 * Full-frame (36 mm wide) equivalent focal length from vertical FOV and camera aspect ratio.
 * The returned value is not rounded — callers should round for display only.
 */
export function focalLengthFromVerticalFov(verticalFovDegrees: number, aspectRatio: number): number {
  const sensorHeightMm = 36 / aspectRatio;
  return sensorHeightMm / (2 * Math.tan((verticalFovDegrees * Math.PI / 180) / 2));
}
