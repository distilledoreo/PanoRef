import { describe, expect, it } from 'vitest';
import { CameraData } from '../src/domain/types';
import {
  clearShotCameraHistory,
  clearAllShotCameraHistory,
  getShotCameraHistoryStacks,
  pushShotCameraHistoryPast,
  redoShotCameraHistory,
  undoShotCameraHistory,
  withShotCameraHistoryStacks,
} from '../src/engine/shotCameraHistory';

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

describe('shot camera history ordering', () => {
  it('restores B then C after undoing twice from A → B → C', () => {
    let stacks = clearShotCameraHistory();
    let current = cameraWithFov(10);

    stacks = pushShotCameraHistoryPast(stacks, current);
    current = cameraWithFov(20);
    stacks = pushShotCameraHistoryPast(stacks, current);
    current = cameraWithFov(30);

    let undo = undoShotCameraHistory(stacks, current);
    expect(undo?.restored.fovDegrees).toBe(20);
    stacks = undo!.stacks;
    current = undo!.restored;

    undo = undoShotCameraHistory(stacks, current);
    expect(undo?.restored.fovDegrees).toBe(10);
    stacks = undo!.stacks;
    current = undo!.restored;

    let redo = redoShotCameraHistory(stacks, current);
    expect(redo?.restored.fovDegrees).toBe(20);
    stacks = redo!.stacks;
    current = redo!.restored;

    redo = redoShotCameraHistory(stacks, current);
    expect(redo?.restored.fovDegrees).toBe(30);
  });
});

describe('shot camera history scoping', () => {
  it('keeps independent stacks per shot id', () => {
    let byShotId = clearAllShotCameraHistory();
    const shotAStacks = pushShotCameraHistoryPast(
      getShotCameraHistoryStacks(byShotId, 'shot-a'),
      cameraWithFov(10),
    );
    byShotId = withShotCameraHistoryStacks(byShotId, 'shot-a', shotAStacks);

    expect(getShotCameraHistoryStacks(byShotId, 'shot-a').past).toHaveLength(1);
    expect(getShotCameraHistoryStacks(byShotId, 'shot-b').past).toHaveLength(0);
  });

  it('does not apply shot A history when undoing on shot B', () => {
    let byShotId = clearAllShotCameraHistory();
    byShotId = withShotCameraHistoryStacks(
      byShotId,
      'shot-a',
      pushShotCameraHistoryPast(getShotCameraHistoryStacks(byShotId, 'shot-a'), cameraWithFov(10)),
    );

    const shotBStacks = getShotCameraHistoryStacks(byShotId, 'shot-b');
    expect(undoShotCameraHistory(shotBStacks, cameraWithFov(99))).toBeUndefined();
  });
});
