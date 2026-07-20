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
