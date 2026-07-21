/** Minimum near-clip distance for shot cameras, in meters. */
export const MIN_SHOT_NEAR_CLIP_METERS = 0.01;

/** Soft upper bound for intentional foreground near clipping, in meters. */
export const MAX_SHOT_NEAR_CLIP_METERS = 20;

/** Default near-clip distance for new and legacy shot cameras, in meters. */
export const DEFAULT_SHOT_NEAR_CLIP_METERS = 0.1;

/**
 * Clamp a shot near-clip value into a safe range that stays below `far`.
 * Non-finite inputs fall back to the shot default (0.1 m).
 */
export function clampShotNearClip(near: number, far: number): number {
  if (!Number.isFinite(near)) return DEFAULT_SHOT_NEAR_CLIP_METERS;

  return Math.min(
    Math.max(MIN_SHOT_NEAR_CLIP_METERS, far - 0.01),
    Math.max(MIN_SHOT_NEAR_CLIP_METERS, near),
  );
}
