import { Euler, SceneObject, Vec3 } from '../domain/types';

export const MAX_BUILD_HISTORY = 50;
/** Coalesce rapid field edits (name/color typing) into one undo step. */
export const BUILD_HISTORY_COALESCE_MS = 350;
export const BUILD_HISTORY_POSITION_EPSILON = 1e-6;

/**
 * How a build mutation records history:
 * - step: always one undo entry per real change (default for commands)
 * - coalesce: merge rapid successive changes into one entry
 * - batch: first real change in an open drag batch records once
 * - silent: never records
 */
export type BuildHistoryMode = 'step' | 'coalesce' | 'batch' | 'silent';

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

export function vec3NearlyEqual(
  a: Vec3,
  b: Vec3,
  epsilon = BUILD_HISTORY_POSITION_EPSILON,
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon
    && Math.abs(a[1] - b[1]) <= epsilon
    && Math.abs(a[2] - b[2]) <= epsilon
  );
}

export function buildSnapshotsEqual(a: BuildHistorySnapshot, b: BuildHistorySnapshot): boolean {
  if (a.selectedObjectId !== b.selectedObjectId) return false;
  if (!vec3NearlyEqual(a.panoOrigin, b.panoOrigin)) return false;
  if (!vec3NearlyEqual(a.panoRotation, b.panoRotation)) return false;
  // Structural scene equality (order-sensitive). Fast enough for build-scale scenes.
  return JSON.stringify(a.objects) === JSON.stringify(b.objects);
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
