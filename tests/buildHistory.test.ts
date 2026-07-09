import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/domain/defaults';
import {
  MAX_BUILD_HISTORY,
  canRedoBuild,
  canUndoBuild,
  captureBuildSnapshot,
  clearBuildHistory,
  cloneBuildSnapshot,
  pushBuildHistoryPast,
  redoBuildHistory,
  undoBuildHistory,
  type BuildHistorySnapshot,
  type BuildHistoryStacks,
} from '../src/engine/buildHistory';

function snap(name: string, selectedObjectId?: string): BuildHistorySnapshot {
  const object = createSceneObject('box', 1);
  object.name = name;
  return captureBuildSnapshot({
    objects: [object],
    panoOrigin: [0, 1.65, 0],
    panoRotation: [0, 0, 0],
    selectedObjectId,
  });
}

describe('buildHistory', () => {
  it('clones snapshots so later mutations cannot corrupt history', () => {
    const original = snap('A');
    const cloned = cloneBuildSnapshot(original);
    cloned.objects[0].name = 'mutated';
    expect(original.objects[0].name).toBe('A');
  });

  it('pushes past and clears future on new edits', () => {
    let stacks: BuildHistoryStacks = clearBuildHistory();
    stacks = pushBuildHistoryPast(stacks, snap('before-edit'));
    stacks = {
      past: stacks.past,
      future: [snap('stale-future')],
    };
    stacks = pushBuildHistoryPast(stacks, snap('before-next'));
    expect(stacks.future).toEqual([]);
    expect(stacks.past).toHaveLength(2);
  });

  it('undoes and redoes with isolated clones', () => {
    let stacks: BuildHistoryStacks = clearBuildHistory();
    const before = snap('before', 'sel-1');
    const after = snap('after', 'sel-2');
    stacks = pushBuildHistoryPast(stacks, before);

    const undone = undoBuildHistory(stacks, after);
    expect(undone).toBeTruthy();
    expect(undone!.restored.objects[0].name).toBe('before');
    expect(undone!.restored.selectedObjectId).toBe('sel-1');
    expect(canUndoBuild(undone!.stacks)).toBe(false);
    expect(canRedoBuild(undone!.stacks)).toBe(true);

    const redone = redoBuildHistory(undone!.stacks, undone!.restored);
    expect(redone).toBeTruthy();
    expect(redone!.restored.objects[0].name).toBe('after');
    expect(canRedoBuild(redone!.stacks)).toBe(false);
    expect(canUndoBuild(redone!.stacks)).toBe(true);
  });

  it('caps past depth at MAX_BUILD_HISTORY', () => {
    let stacks = clearBuildHistory();
    for (let i = 0; i < MAX_BUILD_HISTORY + 5; i += 1) {
      stacks = pushBuildHistoryPast(stacks, snap(`s${i}`));
    }
    expect(stacks.past).toHaveLength(MAX_BUILD_HISTORY);
    expect(stacks.past[0].objects[0].name).toBe('s5');
  });

  it('returns undefined when stacks are empty', () => {
    const empty = clearBuildHistory();
    const current = snap('now');
    expect(undoBuildHistory(empty, current)).toBeUndefined();
    expect(redoBuildHistory(empty, current)).toBeUndefined();
  });
});
