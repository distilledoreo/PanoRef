export const SHOT_FLY_PRECISION_MULTIPLIER = 0.2;

export function shotFlySpeedMultiplier(options: { altHeld: boolean; sprinting: boolean }): number {
  const sprintScale = options.sprinting ? 2.4 : 1;
  const precisionScale = options.altHeld ? SHOT_FLY_PRECISION_MULTIPLIER : 1;
  return sprintScale * precisionScale;
}
