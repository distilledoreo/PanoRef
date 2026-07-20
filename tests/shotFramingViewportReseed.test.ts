import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_ASPECT_RATIO,
  DEFAULT_CAMERA_FOV_DEGREES,
  DEFAULT_CAMERA_LENS_MM,
} from '../src/domain/defaults';
import {
  focalLengthToVerticalFov,
  verticalFovToFocalLength,
} from '../src/engine/focalLength';
import {
  applyShotFovWheelDelta,
  SHOT_FOV_WHEEL_STEP_THRESHOLD,
} from '../src/engine/shotFovWheel';
import { simulateShotFovWheelProgression } from '../src/engine/shotFramingViewportReseed';

const LEGACY_DEFAULT_FOV_DEGREES = 54.4;

describe('default camera lens consistency', () => {
  it('derives the default vertical FOV from the default lens', () => {
    expect(DEFAULT_CAMERA_FOV_DEGREES).toBeCloseTo(
      focalLengthToVerticalFov(DEFAULT_CAMERA_LENS_MM, DEFAULT_CAMERA_ASPECT_RATIO),
      5,
    );
    expect(Math.round(verticalFovToFocalLength(
      DEFAULT_CAMERA_FOV_DEGREES,
      DEFAULT_CAMERA_ASPECT_RATIO,
    ))).toBe(DEFAULT_CAMERA_LENS_MM);
  });
});

describe('shot framing viewport wheel loop', () => {
  it('can step the wheel delta repeatedly from a legacy default lens', () => {
    let fov = 54.4;
    let accumulated = 0;
    const focalLengths: number[] = [];
    for (const targetMm of [25, 30, 35, 40]) {
      let guard = 0;
      while (
        Math.round(verticalFovToFocalLength(fov, DEFAULT_CAMERA_ASPECT_RATIO)) < targetMm
        && guard < 8
      ) {
        const stepped = applyShotFovWheelDelta({
          currentFovDegrees: fov,
          aspectRatio: DEFAULT_CAMERA_ASPECT_RATIO,
          deltaY: -SHOT_FOV_WHEEL_STEP_THRESHOLD,
          altKey: false,
          accumulatedDeltaY: accumulated,
        });
        expect(stepped.stepsApplied).toBe(1);
        fov = stepped.nextFovDegrees;
        accumulated = stepped.nextAccumulatedDeltaY;
        guard += 1;
      }
      focalLengths.push(Math.round(verticalFovToFocalLength(fov, DEFAULT_CAMERA_ASPECT_RATIO)));
    }
    expect(focalLengths).toEqual([25, 30, 35, 40]);
  });

  it('oscillates around the legacy default when parent camera values reseed the viewport', () => {
    const focalLengths = simulateShotFovWheelProgression({
      startFovDegrees: LEGACY_DEFAULT_FOV_DEGREES,
      aspectRatio: DEFAULT_CAMERA_ASPECT_RATIO,
      targetFocalLengthsMm: [25, 30, 35, 40],
      reseedOnParentCameraValueChange: true,
    });

    expect(focalLengths).toEqual([20, 20, 20, 20]);
  });

  it('progresses through repeated wheel steps when reseed is token-driven', () => {
    const focalLengths = simulateShotFovWheelProgression({
      startFovDegrees: LEGACY_DEFAULT_FOV_DEGREES,
      aspectRatio: DEFAULT_CAMERA_ASPECT_RATIO,
      targetFocalLengthsMm: [25, 30, 35, 40],
      reseedOnParentCameraValueChange: false,
    });

    expect(focalLengths).toEqual([25, 30, 35, 40]);
  });

  it('keeps progressing after undo, live move, and another lens batch', () => {
    const focalLengths = simulateShotFovWheelProgression({
      startFovDegrees: LEGACY_DEFAULT_FOV_DEGREES,
      aspectRatio: DEFAULT_CAMERA_ASPECT_RATIO,
      targetFocalLengthsMm: [25, 30],
      reseedOnParentCameraValueChange: false,
      includeUndoMoveLensSequence: true,
    });

    expect(focalLengths).toEqual([25, 30, 25]);
  });
});
