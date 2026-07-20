import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { CameraData } from '../src/domain/types';
import {
  getShotCameraHistoryStacks,
} from '../src/engine/shotCameraHistory';
import {
  beginShotFovWheelBatch,
  buildShotFovWheelBatchCommit,
  shouldFinalizeShotFovWheelBatchOnShotChange,
} from '../src/engine/shotFovWheelBatch';
import { useContinuityStore } from '../src/state/useContinuityStore';

function cameraWithFov(fovDegrees: number): CameraData {
  return {
    position: [0, 1.6, 0],
    target: [0, 1.6, 1],
    fovDegrees,
    aspectRatio: 16 / 9,
    near: 0.1,
    far: 100,
  };
}

describe('shot fov wheel batch', () => {
  it('finalizes when the selected shot changes during an active batch', () => {
    const batch = beginShotFovWheelBatch('shot-a');
    expect(shouldFinalizeShotFovWheelBatchOnShotChange(batch, 'shot-b')).toBe(true);
    expect(shouldFinalizeShotFovWheelBatchOnShotChange(batch, 'shot-a')).toBe(false);
  });

  it('commits only the originating shot FOV from stored camera data', () => {
    const stored = cameraWithFov(35);
    const live = { ...stored, fovDegrees: 40, position: [1, 2, 3] as CameraData['position'] };
    const committed = buildShotFovWheelBatchCommit(stored, live);
    expect(committed.fovDegrees).toBe(40);
    expect(committed.position).toEqual(stored.position);
  });
});

describe('shot camera store history', () => {
  it('clears per-shot camera history when loading another project', () => {
    const project = createDefaultProject();
    const shotA = project.shots[0].id;
    useContinuityStore.setState({
      project,
      selectedShotId: shotA,
      shotCameraHistoryByShotId: {
        [shotA]: {
          past: [cameraWithFov(10)],
          future: [],
        },
      },
    });

    const replacement = createDefaultProject();
    replacement.name = 'Replacement Project';
    useContinuityStore.getState().setProject(replacement);

    expect(useContinuityStore.getState().shotCameraHistoryByShotId).toEqual({});
  });

  it('undoes only the currently selected shot camera', () => {
    useContinuityStore.setState({
      project: createDefaultProject(),
      selectedShotId: undefined,
      shotCameraHistoryByShotId: {},
    });
    const shotA = useContinuityStore.getState().project.shots[0].id;
    const originalShotAFov = useContinuityStore.getState().project.shots[0].camera.fovDegrees;
    const shotB = useContinuityStore.getState().addCamera({ navigateToShots: false }).id;

    useContinuityStore.getState().selectShot(shotA);
    useContinuityStore.getState().updateShot(shotA, { camera: cameraWithFov(55) });
    useContinuityStore.getState().selectShot(shotB);

    expect(useContinuityStore.getState().undoShotCamera()).toBe(false);

    useContinuityStore.getState().selectShot(shotA);
    expect(useContinuityStore.getState().undoShotCamera()).toBe(true);
    expect(
      useContinuityStore.getState().project.shots.find((shot) => shot.id === shotA)?.camera.fovDegrees,
    ).toBe(originalShotAFov);
    expect(getShotCameraHistoryStacks(useContinuityStore.getState().shotCameraHistoryByShotId, shotB).past).toHaveLength(0);
  });
});
