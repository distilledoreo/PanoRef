import { CameraData } from '../domain/types';

export const MAX_SHOT_CAMERA_HISTORY = 50;

export interface ShotCameraHistoryStacks {
  past: CameraData[];
  future: CameraData[];
}

export function cloneCameraData(camera: CameraData): CameraData {
  return {
    ...camera,
    position: [...camera.position] as CameraData['position'],
    target: [...camera.target] as CameraData['target'],
  };
}

export function cameraDataEqual(a: CameraData, b: CameraData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pushShotCameraHistoryPast(
  stacks: ShotCameraHistoryStacks,
  camera: CameraData,
  maxDepth = MAX_SHOT_CAMERA_HISTORY,
): ShotCameraHistoryStacks {
  const past = [...stacks.past, cloneCameraData(camera)];
  while (past.length > maxDepth) past.shift();
  return {
    past,
    future: [],
  };
}

export function undoShotCameraHistory(
  stacks: ShotCameraHistoryStacks,
  current: CameraData,
): { stacks: ShotCameraHistoryStacks; restored: CameraData } | undefined {
  if (stacks.past.length === 0) return undefined;
  const past = [...stacks.past];
  const restored = past.pop()!;
  return {
    stacks: {
      past,
      future: [cloneCameraData(current), ...stacks.future],
    },
    restored: cloneCameraData(restored),
  };
}

export function redoShotCameraHistory(
  stacks: ShotCameraHistoryStacks,
  current: CameraData,
): { stacks: ShotCameraHistoryStacks; restored: CameraData } | undefined {
  if (stacks.future.length === 0) return undefined;
  const future = [...stacks.future];
  const restored = future.pop()!;
  return {
    stacks: {
      past: [...stacks.past, cloneCameraData(current)],
      future,
    },
    restored: cloneCameraData(restored),
  };
}

export function clearShotCameraHistory(): ShotCameraHistoryStacks {
  return { past: [], future: [] };
}
