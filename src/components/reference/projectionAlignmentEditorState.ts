import {
  ProjectionAlignment,
  ProjectionControlPair,
  Vec2,
} from '../../domain/types';

export type AlignmentPickStep = 'target' | 'source';

export interface ProjectionAlignmentDraft {
  sourcePanoId: string;
  targetGrayboxPanoId: string;
  pairs: ProjectionControlPair[];
  strength: number;
  pendingTargetUv?: Vec2;
}

interface DraftComparable {
  sourcePanoId: string;
  targetGrayboxPanoId: string;
  pairs: ProjectionControlPair[];
  strength: number;
  pendingTargetUv?: Vec2;
}

interface DraftMetadata {
  baseline: DraftComparable;
  undoStack: DraftComparable[];
}

const metadata = new WeakMap<ProjectionAlignmentDraft, DraftMetadata>();

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function clonePair(pair: ProjectionControlPair): ProjectionControlPair {
  return {
    ...pair,
    targetUv: [...pair.targetUv] as Vec2,
    sourceUv: [...pair.sourceUv] as Vec2,
  };
}

function comparableFromDraft(draft: ProjectionAlignmentDraft): DraftComparable {
  return {
    sourcePanoId: draft.sourcePanoId,
    targetGrayboxPanoId: draft.targetGrayboxPanoId,
    pairs: draft.pairs.map(clonePair),
    strength: draft.strength,
    pendingTargetUv: draft.pendingTargetUv ? [...draft.pendingTargetUv] as Vec2 : undefined,
  };
}

function comparableFromAlignment(alignment: ProjectionAlignment | undefined): DraftComparable {
  return {
    sourcePanoId: alignment?.sourcePanoId ?? '',
    targetGrayboxPanoId: alignment?.targetGrayboxPanoId ?? '',
    pairs: alignment?.pairs.map(clonePair) ?? [],
    strength: clampStrength(alignment?.strength ?? 1),
    pendingTargetUv: undefined,
  };
}

function draftFromComparable(state: DraftComparable, pendingTargetUv?: Vec2): ProjectionAlignmentDraft {
  const draft: ProjectionAlignmentDraft = {
    sourcePanoId: state.sourcePanoId,
    targetGrayboxPanoId: state.targetGrayboxPanoId,
    pairs: state.pairs.map(clonePair),
    strength: state.strength,
    ...((pendingTargetUv ?? state.pendingTargetUv)
      ? { pendingTargetUv: [...(pendingTargetUv ?? state.pendingTargetUv)!] as Vec2 }
      : {}),
  };
  return draft;
}

function registerDraft(
  draft: ProjectionAlignmentDraft,
  baseline: DraftComparable,
  undoStack: DraftComparable[] = [],
): ProjectionAlignmentDraft {
  metadata.set(draft, {
    baseline: {
      ...baseline,
      pairs: baseline.pairs.map(clonePair),
    },
    undoStack: undoStack.map((entry) => ({ ...entry, pairs: entry.pairs.map(clonePair) })),
  });
  return draft;
}

function mutateDraft(
  draft: ProjectionAlignmentDraft,
  next: ProjectionAlignmentDraft,
): ProjectionAlignmentDraft {
  const currentMeta = metadata.get(draft);
  const history = currentMeta?.undoStack ?? [];
  return registerDraft(
    next,
    currentMeta?.baseline ?? comparableFromDraft(draft),
    [...history, comparableFromDraft(draft)].slice(-100),
  );
}

export function createProjectionAlignmentDraft(
  sourcePanoIdOrParams: string | {
    sourcePanoId: string;
    targetGrayboxPanoId?: string;
    alignment?: ProjectionAlignment;
  },
  targetGrayboxPanoIdOrAlignment?: string | ProjectionAlignment,
  savedAlignment?: ProjectionAlignment,
): ProjectionAlignmentDraft {
  const params = typeof sourcePanoIdOrParams === 'string'
    ? {
        sourcePanoId: sourcePanoIdOrParams,
        targetGrayboxPanoId: typeof targetGrayboxPanoIdOrAlignment === 'string'
          ? targetGrayboxPanoIdOrAlignment
          : undefined,
        alignment: typeof targetGrayboxPanoIdOrAlignment === 'object'
          ? targetGrayboxPanoIdOrAlignment
          : savedAlignment,
      }
    : sourcePanoIdOrParams;
  const alignment = params.alignment;
  const state: DraftComparable = {
    sourcePanoId: params.sourcePanoId,
    targetGrayboxPanoId: alignment?.targetGrayboxPanoId ?? params.targetGrayboxPanoId ?? '',
    pairs: alignment?.pairs.map(clonePair) ?? [],
    strength: clampStrength(alignment?.strength ?? 1),
    pendingTargetUv: undefined,
  };
  return registerDraft(draftFromComparable(state), state);
}

export function alignmentPickStep(draft: ProjectionAlignmentDraft): AlignmentPickStep {
  return draft.pendingTargetUv ? 'source' : 'target';
}

export const getAlignmentPickStep = alignmentPickStep;

export function addTargetPick(draft: ProjectionAlignmentDraft, targetUv: Vec2): ProjectionAlignmentDraft {
  const next = draftFromComparable(comparableFromDraft(draft), targetUv);
  return mutateDraft(draft, next);
}

export function completeSourcePick(draft: ProjectionAlignmentDraft, sourceUv: Vec2): ProjectionAlignmentDraft {
  if (!draft.pendingTargetUv) return draft;
  const pairs = draft.pairs.map(clonePair);
  const nextOrder = pairs.reduce((highest, pair) => Math.max(highest, pair.order), -1) + 1;
  let id = `match-${nextOrder + 1}`;
  let suffix = 2;
  while (pairs.some((pair) => pair.id === id)) {
    id = `match-${nextOrder + 1}-${suffix++}`;
  }
  pairs.push({
    id,
    order: nextOrder,
    targetUv: [...draft.pendingTargetUv] as Vec2,
    sourceUv: [...sourceUv] as Vec2,
    enabled: true,
  });
  return mutateDraft(draft, {
    ...draft,
    pairs,
    pendingTargetUv: undefined,
  });
}

export function removeDraftPair(draft: ProjectionAlignmentDraft, pairId: string): ProjectionAlignmentDraft {
  if (!draft.pairs.some((pair) => pair.id === pairId)) return draft;
  return mutateDraft(draft, {
    ...draft,
    pairs: draft.pairs.filter((pair) => pair.id !== pairId).map(clonePair),
  });
}

export function toggleDraftPair(
  draft: ProjectionAlignmentDraft,
  pairId: string,
  enabled?: boolean,
): ProjectionAlignmentDraft {
  const pair = draft.pairs.find((item) => item.id === pairId);
  if (!pair) return draft;
  return mutateDraft(draft, {
    ...draft,
    pairs: draft.pairs.map((item) => item.id === pairId
      ? { ...item, enabled: enabled ?? !item.enabled }
      : clonePair(item)),
  });
}

export function clearDraftPairs(draft: ProjectionAlignmentDraft): ProjectionAlignmentDraft {
  if (draft.pairs.length === 0 && !draft.pendingTargetUv) return draft;
  return mutateDraft(draft, {
    ...draft,
    pairs: [],
    pendingTargetUv: undefined,
  });
}

export function undoLastDraftAction(draft: ProjectionAlignmentDraft): ProjectionAlignmentDraft {
  const currentMeta = metadata.get(draft);
  if (!currentMeta || currentMeta.undoStack.length === 0) return draft;
  const previous = currentMeta.undoStack[currentMeta.undoStack.length - 1];
  const restored = draftFromComparable(previous);
  return registerDraft(restored, currentMeta.baseline, currentMeta.undoStack.slice(0, -1));
}

export function setDraftStrength(draft: ProjectionAlignmentDraft, strength: number): ProjectionAlignmentDraft {
  const nextStrength = clampStrength(strength);
  if (nextStrength === draft.strength) return draft;
  return mutateDraft(draft, { ...draft, strength: nextStrength });
}

function comparableEquals(a: DraftComparable, b: DraftComparable): boolean {
  if (
    a.sourcePanoId !== b.sourcePanoId
    || a.targetGrayboxPanoId !== b.targetGrayboxPanoId
    || a.strength !== b.strength
    || a.pendingTargetUv?.[0] !== b.pendingTargetUv?.[0]
    || a.pendingTargetUv?.[1] !== b.pendingTargetUv?.[1]
    || a.pairs.length !== b.pairs.length
  ) return false;
  return a.pairs.every((pair, index) => {
    const other = b.pairs[index];
    return Boolean(other)
      && pair.id === other.id
      && pair.order === other.order
      && pair.enabled === other.enabled
      && pair.targetUv[0] === other.targetUv[0]
      && pair.targetUv[1] === other.targetUv[1]
      && pair.sourceUv[0] === other.sourceUv[0]
      && pair.sourceUv[1] === other.sourceUv[1];
  });
}

export function isProjectionAlignmentDraftDirty(
  draft: ProjectionAlignmentDraft,
  original?: ProjectionAlignment | ProjectionAlignmentDraft,
): boolean {
  const baseline = original
    ? 'version' in original
      ? comparableFromAlignment(original)
      : comparableFromDraft(original)
    : metadata.get(draft)?.baseline ?? comparableFromDraft(draft);
  return !comparableEquals(comparableFromDraft(draft), baseline);
}

export function draftToProjectionAlignment(
  draft: ProjectionAlignmentDraft,
): ProjectionAlignment | undefined {
  if (!draft.targetGrayboxPanoId || draft.pairs.length === 0) return undefined;
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: draft.sourcePanoId,
    targetGrayboxPanoId: draft.targetGrayboxPanoId,
    pairs: draft.pairs.map(clonePair),
    strength: clampStrength(draft.strength),
    updatedAt: new Date().toISOString(),
  };
}
