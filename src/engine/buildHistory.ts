import { Euler, SceneObject, Vec3 } from '../domain/types';

export const MAX_BUILD_HISTORY = 50;
/** Coalesce rapid updateObject calls (e.g. typing a name) into one undo step. */
export const BUILD_HISTORY_COALESCE_MS = 350;

export interface BuildHistorySnapshot {
  objects: SceneObject[];
  panoOrigin: Vec3;
  panoRotation: Euler;
  selectedObjectId?: string;
}

export interface BuildHistoryStacks {
  past: BuildHistorySnapshot[];
  future: BuildHistorySnapshot[];
}

export function cloneBuildSnapshot(snapshot: BuildHistorySnapshot): BuildHistorySnapshot {
  return structuredClone(snapshot);
}

export function captureBuildSnapshot(params: {
  objects: SceneObject[];
  panoOrigin: Vec3;
  panoRotation: Euler;
  selectedObjectId?: string;
}): BuildHistorySnapshot {
  return cloneBuildSnapshot({
    objects: params.objects,
    panoOrigin: params.panoOrigin,
    panoRotation: params.panoRotation,
    selectedObjectId: params.selectedObjectId,
  });
}

export function pushBuildHistoryPast(
  stacks: BuildHistoryStacks,
  snapshot: BuildHistorySnapshot,
  maxDepth = MAX_BUILD_HISTORY,
): BuildHistoryStacks {
  const past = [...stacks.past, cloneBuildSnapshot(snapshot)];
  while (past.length > maxDepth) past.shift();
  return {
    past,
    future: [],
  };
}

export function undoBuildHistory(
  stacks: BuildHistoryStacks,
  current: BuildHistorySnapshot,
): { stacks: BuildHistoryStacks; restored: BuildHistorySnapshot } | undefined {
  if (stacks.past.length === 0) return undefined;
  const past = [...stacks.past];
  const restored = past.pop()!;
  return {
    stacks: {
      past,
      future: [...stacks.future, cloneBuildSnapshot(current)],
    },
    restored: cloneBuildSnapshot(restored),
  };
}

export function redoBuildHistory(
  stacks: BuildHistoryStacks,
  current: BuildHistorySnapshot,
): { stacks: BuildHistoryStacks; restored: BuildHistorySnapshot } | undefined {
  if (stacks.future.length === 0) return undefined;
  const future = [...stacks.future];
  const restored = future.pop()!;
  return {
    stacks: {
      past: [...stacks.past, cloneBuildSnapshot(current)],
      future,
    },
    restored: cloneBuildSnapshot(restored),
  };
}

export function clearBuildHistory(): BuildHistoryStacks {
  return { past: [], future: [] };
}

export function canUndoBuild(stacks: BuildHistoryStacks): boolean {
  return stacks.past.length > 0;
}

export function canRedoBuild(stacks: BuildHistoryStacks): boolean {
  return stacks.future.length > 0;
}
