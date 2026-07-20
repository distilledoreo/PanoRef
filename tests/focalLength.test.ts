import { describe, expect, it } from 'vitest';
import {
  clampFocalLengthMm,
  clampShotVerticalFov,
  focalLengthToVerticalFov,
  MAX_SHOT_FOCAL_LENGTH_MM,
  MIN_SHOT_FOCAL_LENGTH_MM,
  verticalFovToFocalLength,
} from '../src/engine/focalLength';
import {
  applyShotFovWheelDelta,
  SHOT_FOV_WHEEL_STEP_THRESHOLD,
  snapFocalLengthStep,
} from '../src/engine/shotFovWheel';
import {
  cloneCameraData,
  pushShotCameraHistoryPast,
  redoShotCameraHistory,
  undoShotCameraHistory,
} from '../src/engine/shotCameraHistory';
import { CameraData } from '../src/domain/types';

const aspectRatio = 16 / 9;

describe('focal length conversions', () => {
  it('round-trips vertical FOV and focal length', () => {
    const verticalFovDegrees = 42.5;
    const focalLengthMm = verticalFovToFocalLength(verticalFovDegrees, aspectRatio);
    expect(focalLengthToVerticalFov(focalLengthMm, aspectRatio)).toBeCloseTo(verticalFovDegrees, 5);
  });

  it('supports the 5–300 mm lens range', () => {
    expect(clampFocalLengthMm(2)).toBe(MIN_SHOT_FOCAL_LENGTH_MM);
    expect(clampFocalLengthMm(400)).toBe(MAX_SHOT_FOCAL_LENGTH_MM);
    expect(clampShotVerticalFov(180, aspectRatio)).toBeCloseTo(
      focalLengthToVerticalFov(MIN_SHOT_FOCAL_LENGTH_MM, aspectRatio),
      5,
    );
  });
});

describe('snapFocalLengthStep', () => {
  it('snaps 37 mm to 40 mm when zooming in and 35 mm when zooming out', () => {
    expect(snapFocalLengthStep(37, 'in', 5)).toBe(40);
    expect(snapFocalLengthStep(37, 'out', 5)).toBe(35);
  });

  it('steps by exactly 5 mm from aligned values', () => {
    expect(snapFocalLengthStep(35, 'in', 5)).toBe(40);
    expect(snapFocalLengthStep(40, 'out', 5)).toBe(35);
  });
});

describe('applyShotFovWheelDelta', () => {
  it('applies one 5 mm step after enough wheel delta accumulates', () => {
    const startFov = focalLengthToVerticalFov(37, aspectRatio);
    const first = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: SHOT_FOV_WHEEL_STEP_THRESHOLD / 2,
      altKey: false,
      accumulatedDeltaY: 0,
    });
    expect(first.stepsApplied).toBe(0);

    const second = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: SHOT_FOV_WHEEL_STEP_THRESHOLD / 2,
      altKey: false,
      accumulatedDeltaY: first.nextAccumulatedDeltaY,
    });
    expect(second.stepsApplied).toBe(1);
    expect(verticalFovToFocalLength(second.nextFovDegrees, aspectRatio)).toBeCloseTo(35, 5);
  });

  it('uses 1 mm precision when Alt is held during wheel input', () => {
    const startFov = focalLengthToVerticalFov(37.4, aspectRatio);
    const result = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: -SHOT_FOV_WHEEL_STEP_THRESHOLD,
      altKey: true,
      accumulatedDeltaY: 0,
    });
    expect(result.stepsApplied).toBe(1);
    expect(verticalFovToFocalLength(result.nextFovDegrees, aspectRatio)).toBeCloseTo(38, 5);
  });

  it('preserves scroll direction (positive deltaY zooms out)', () => {
    const startFov = focalLengthToVerticalFov(55, aspectRatio);
    const result = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: SHOT_FOV_WHEEL_STEP_THRESHOLD,
      altKey: false,
      accumulatedDeltaY: 0,
    });
    expect(result.stepsApplied).toBe(1);
    expect(verticalFovToFocalLength(result.nextFovDegrees, aspectRatio)).toBeCloseTo(50, 5);
  });
});

describe('shot camera history', () => {
  const cameraA: CameraData = {
    position: [0, 1.6, 0],
    target: [0, 1.6, 1],
    fovDegrees: 54,
    aspectRatio: 16 / 9,
    near: 0.1,
    far: 100,
  };
  const cameraB: CameraData = {
    ...cameraA,
    fovDegrees: 40,
  };

  it('restores the previous camera on undo and the newer camera on redo', () => {
    const stacks = pushShotCameraHistoryPast({ past: [], future: [] }, cameraA);
    const undo = undoShotCameraHistory(stacks, cameraB);
    expect(undo?.restored.fovDegrees).toBe(54);
    const redo = redoShotCameraHistory(undo!.stacks, cameraA);
    expect(redo?.restored.fovDegrees).toBe(40);
  });

  it('clones camera data in history entries', () => {
    const stacks = pushShotCameraHistoryPast({ past: [], future: [] }, cameraA);
    stacks.past[0].fovDegrees = 10;
    expect(cameraA.fovDegrees).toBe(54);
    expect(cloneCameraData(cameraA).fovDegrees).toBe(54);
  });
});
