import {
  clampFocalLengthMm,
  clampShotVerticalFov,
  focalLengthToVerticalFov,
  verticalFovToFocalLength,
} from './focalLength';

/** Wheel delta required before applying one focal-length step. */
export const SHOT_FOV_WHEEL_STEP_THRESHOLD = 80;

/** Idle delay after the last wheel step before ending a batched history gesture. */
export const SHOT_FOV_WHEEL_BATCH_IDLE_MS = 300;

export type FocalLengthZoomDirection = 'in' | 'out';

export function snapFocalLengthStep(
  currentFocalLengthMm: number,
  direction: FocalLengthZoomDirection,
  stepMm: number,
): number {
  const epsilon = 1e-3;
  const nearestStep = Math.round(currentFocalLengthMm / stepMm) * stepMm;
  const onNearestStep = Math.abs(currentFocalLengthMm - nearestStep) <= epsilon
    || Math.round(currentFocalLengthMm) === nearestStep;

  if (direction === 'in') {
    if (onNearestStep) {
      return nearestStep + stepMm;
    }
    const boundary = Math.ceil((currentFocalLengthMm - epsilon) / stepMm) * stepMm;
    return boundary <= currentFocalLengthMm + epsilon ? boundary + stepMm : boundary;
  }

  if (onNearestStep) {
    return nearestStep - stepMm;
  }
  const boundary = Math.floor((currentFocalLengthMm + epsilon) / stepMm) * stepMm;
  return boundary >= currentFocalLengthMm - epsilon ? boundary - stepMm : boundary;
}

export function applyShotFovWheelDelta(options: {
  currentFovDegrees: number;
  aspectRatio: number;
  deltaY: number;
  altKey: boolean;
  accumulatedDeltaY: number;
}): {
  nextFovDegrees: number;
  nextAccumulatedDeltaY: number;
  stepsApplied: number;
} {
  let accumulated = options.accumulatedDeltaY + options.deltaY;
  const stepMm = options.altKey ? 1 : 5;
  let currentFov = options.currentFovDegrees;
  let stepsApplied = 0;

  while (Math.abs(accumulated) >= SHOT_FOV_WHEEL_STEP_THRESHOLD) {
    const direction: FocalLengthZoomDirection = accumulated > 0 ? 'out' : 'in';
    accumulated -= Math.sign(accumulated) * SHOT_FOV_WHEEL_STEP_THRESHOLD;

    let focalLengthMm = verticalFovToFocalLength(currentFov, options.aspectRatio);
    focalLengthMm = snapFocalLengthStep(focalLengthMm, direction, stepMm);
    focalLengthMm = clampFocalLengthMm(focalLengthMm);
    currentFov = clampShotVerticalFov(
      focalLengthToVerticalFov(focalLengthMm, options.aspectRatio),
      options.aspectRatio,
    );
    stepsApplied += 1;
  }

  return {
    nextFovDegrees: currentFov,
    nextAccumulatedDeltaY: accumulated,
    stepsApplied,
  };
}
