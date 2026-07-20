import { CameraData } from '../domain/types';

export interface ShotFovWheelBatchState {
  shotId: string;
  startedAt: number;
}

export function beginShotFovWheelBatch(shotId: string, startedAt = Date.now()): ShotFovWheelBatchState {
  return { shotId, startedAt };
}

export function shouldFinalizeShotFovWheelBatchOnShotChange(
  batch: ShotFovWheelBatchState | null | undefined,
  nextShotId: string | undefined,
): batch is ShotFovWheelBatchState {
  return Boolean(batch && nextShotId && batch.shotId !== nextShotId);
}

export function buildShotFovWheelBatchCommit(
  storedCamera: CameraData,
  liveCamera: CameraData,
): CameraData {
  return {
    ...storedCamera,
    fovDegrees: liveCamera.fovDegrees,
  };
}

/** Keep the live draft pose while applying a store-only FOV commit from a wheel batch. */
export function applyLiveShotFovWheelBatchCommit(
  currentFramingCamera: CameraData | undefined,
  committedCamera: CameraData,
): CameraData {
  return currentFramingCamera
    ? { ...currentFramingCamera, fovDegrees: committedCamera.fovDegrees }
    : committedCamera;
}
