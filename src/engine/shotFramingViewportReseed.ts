import { CameraData } from '../domain/types';
import { clampShotVerticalFov, verticalFovToFocalLength } from './focalLength';
import {
  applyShotFovWheelDelta,
  SHOT_FOV_WHEEL_STEP_THRESHOLD,
} from './shotFovWheel';
import {
  applyLiveShotFovWheelBatchCommit,
  buildShotFovWheelBatchCommit,
} from './shotFovWheelBatch';

export interface ShotFramingViewportReseedInput {
  reseedGeneration: number;
  lastHandledReseedGeneration: number;
  wheelBatchActive: boolean;
  dragKind: 'idle' | 'shot_framing' | string;
  hasShotFraming: boolean;
}

export function shouldReseedShotFramingViewport(
  input: ShotFramingViewportReseedInput,
): boolean {
  if (!input.hasShotFraming) return false;
  if (input.dragKind === 'shot_framing') return false;
  if (input.wheelBatchActive) return false;
  return input.reseedGeneration !== input.lastHandledReseedGeneration;
}

export function applyShotFramingViewportReseed(options: {
  camera: CameraData;
  reseedGeneration: number;
}): {
  framingFovDegrees: number;
  lastHandledReseedGeneration: number;
  wheelAccumulatedDeltaY: number;
} {
  return {
    framingFovDegrees: clampShotVerticalFov(
      options.camera.fovDegrees,
      options.camera.aspectRatio,
    ),
    lastHandledReseedGeneration: options.reseedGeneration,
    wheelAccumulatedDeltaY: 0,
  };
}

export interface ShotFramingWheelLoopState {
  storedFovDegrees: number;
  viewportFovDegrees: number;
  wheelAccumulatedDeltaY: number;
  reseedGeneration: number;
  lastHandledReseedGeneration: number;
  wheelBatchActive: boolean;
  restoreGeneration: number;
  lastHandledRestoreGeneration: number;
}

export function createShotFramingWheelLoopState(camera: CameraData): ShotFramingWheelLoopState {
  const fovDegrees = clampShotVerticalFov(camera.fovDegrees, camera.aspectRatio);
  return {
    storedFovDegrees: fovDegrees,
    viewportFovDegrees: fovDegrees,
    wheelAccumulatedDeltaY: 0,
    reseedGeneration: 1,
    lastHandledReseedGeneration: 1,
    wheelBatchActive: false,
    restoreGeneration: 0,
    lastHandledRestoreGeneration: 0,
  };
}

function maybeReseedViewport(
  state: ShotFramingWheelLoopState,
  camera: CameraData,
  options: { reseedOnParentCameraValueChange: boolean },
): ShotFramingWheelLoopState {
  if (options.reseedOnParentCameraValueChange) {
    return {
      ...state,
      viewportFovDegrees: clampShotVerticalFov(
        state.storedFovDegrees,
        camera.aspectRatio,
      ),
      wheelAccumulatedDeltaY: 0,
    };
  }

  if (!shouldReseedShotFramingViewport({
    reseedGeneration: state.reseedGeneration,
    lastHandledReseedGeneration: state.lastHandledReseedGeneration,
    wheelBatchActive: state.wheelBatchActive,
    dragKind: 'idle',
    hasShotFraming: true,
  })) {
    return state;
  }

  const reseeded = applyShotFramingViewportReseed({
    camera,
    reseedGeneration: state.reseedGeneration,
  });
  return {
    ...state,
    viewportFovDegrees: reseeded.framingFovDegrees,
    wheelAccumulatedDeltaY: reseeded.wheelAccumulatedDeltaY,
    lastHandledReseedGeneration: reseeded.lastHandledReseedGeneration,
  };
}

function dispatchWheelStep(
  state: ShotFramingWheelLoopState,
  camera: CameraData,
  deltaY: number,
  options: { reseedOnParentCameraValueChange: boolean },
): ShotFramingWheelLoopState {
  const wheelResult = applyShotFovWheelDelta({
    currentFovDegrees: state.viewportFovDegrees,
    aspectRatio: camera.aspectRatio,
    deltaY,
    altKey: false,
    accumulatedDeltaY: state.wheelAccumulatedDeltaY,
  });
  if (wheelResult.stepsApplied === 0) {
    return {
      ...state,
      wheelAccumulatedDeltaY: wheelResult.nextAccumulatedDeltaY,
    };
  }

  let next: ShotFramingWheelLoopState = {
    ...state,
    viewportFovDegrees: wheelResult.nextFovDegrees,
    wheelAccumulatedDeltaY: wheelResult.nextAccumulatedDeltaY,
    wheelBatchActive: true,
  };

  return maybeReseedViewport(next, camera, options);
}

function finishWheelBatch(
  state: ShotFramingWheelLoopState,
  camera: CameraData,
  options: { reseedOnParentCameraValueChange: boolean },
): ShotFramingWheelLoopState {
  if (!state.wheelBatchActive) return state;

  const storedCamera = { ...camera, fovDegrees: state.storedFovDegrees };
  const liveCamera = { ...camera, fovDegrees: state.viewportFovDegrees };
  const committed = buildShotFovWheelBatchCommit(storedCamera, liveCamera);
  const liveFraming = applyLiveShotFovWheelBatchCommit(liveCamera, committed);

  let next: ShotFramingWheelLoopState = {
    ...state,
    wheelBatchActive: false,
    wheelAccumulatedDeltaY: 0,
    storedFovDegrees: committed.fovDegrees,
    viewportFovDegrees: liveFraming.fovDegrees,
  };

  return maybeReseedViewport(next, camera, options);
}

function undoLensChange(
  state: ShotFramingWheelLoopState,
  camera: CameraData,
  previousStoredFovDegrees: number,
  options: { reseedOnParentCameraValueChange: boolean },
): ShotFramingWheelLoopState {
  let next: ShotFramingWheelLoopState = {
    ...state,
    storedFovDegrees: previousStoredFovDegrees,
    restoreGeneration: state.restoreGeneration + 1,
    reseedGeneration: state.reseedGeneration + 1,
    lastHandledRestoreGeneration: state.restoreGeneration + 1,
  };

  return maybeReseedViewport(next, {
    ...camera,
    fovDegrees: previousStoredFovDegrees,
  }, options);
}

export function simulateShotFovWheelProgression(options: {
  startFovDegrees: number;
  aspectRatio: number;
  targetFocalLengthsMm: number[];
  reseedOnParentCameraValueChange: boolean;
  includeUndoMoveLensSequence?: boolean;
}): number[] {
  const camera: CameraData = {
    position: [0, 1.6, 0],
    target: [0, 1.6, 1],
    fovDegrees: options.startFovDegrees,
    aspectRatio: options.aspectRatio,
    near: 0.1,
    far: 100,
  };

  let state = createShotFramingWheelLoopState(camera);

  const focalLengths: number[] = [];
  const recordFocalLength = () => {
    focalLengths.push(Math.round(verticalFovToFocalLength(
      state.viewportFovDegrees,
      options.aspectRatio,
    )));
  };

  const wheelOptions = {
    reseedOnParentCameraValueChange: options.reseedOnParentCameraValueChange,
  };

  for (const targetMm of options.targetFocalLengthsMm) {
    let guard = 0;
    while (
      Math.round(verticalFovToFocalLength(state.viewportFovDegrees, options.aspectRatio)) < targetMm
      && guard < 24
    ) {
      state = dispatchWheelStep(
        state,
        camera,
        -SHOT_FOV_WHEEL_STEP_THRESHOLD,
        wheelOptions,
      );
      guard += 1;
    }
    recordFocalLength();
    state = finishWheelBatch(state, camera, wheelOptions);
  }

  if (options.includeUndoMoveLensSequence) {
    state = undoLensChange(state, camera, options.startFovDegrees, wheelOptions);
    state = dispatchWheelStep(
      state,
      camera,
      -SHOT_FOV_WHEEL_STEP_THRESHOLD,
      wheelOptions,
    );
    state = finishWheelBatch(state, camera, wheelOptions);
    recordFocalLength();
  }

  return focalLengths;
}
