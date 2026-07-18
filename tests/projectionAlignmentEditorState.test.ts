import { describe, expect, it } from 'vitest';
import {
  addTargetPick,
  alignmentPickStep,
  clearDraftPairs,
  completeSourcePick,
  createProjectionAlignmentDraft,
  draftToProjectionAlignment,
  isProjectionAlignmentDraftDirty,
  removeDraftPair,
  setDraftStrength,
  toggleDraftPair,
  undoLastDraftAction,
} from '../src/components/reference/projectionAlignmentEditorState';
import { ProjectionAlignment } from '../src/domain/types';

function savedAlignment(): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: 'styled-a',
    targetGrayboxPanoId: 'graybox-a',
    pairs: [
      { id: 'pair-a', order: 0, targetUv: [0.2, 0.3], sourceUv: [0.25, 0.35], enabled: true },
      { id: 'pair-b', order: 1, targetUv: [0.8, 0.7], sourceUv: [0.75, 0.65], enabled: false },
    ],
    strength: 0.7,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Projection Assist editor draft state', () => {
  it('creates a new draft with no saved alignment', () => {
    const draft = createProjectionAlignmentDraft('styled-a', 'graybox-a');
    expect(draft).toMatchObject({
      sourcePanoId: 'styled-a', targetGrayboxPanoId: 'graybox-a', pairs: [], strength: 1,
    });
    expect(isProjectionAlignmentDraftDirty(draft)).toBe(false);
  });

  it('loads a saved alignment without changing IDs, order, or strength', () => {
    const draft = createProjectionAlignmentDraft('styled-a', savedAlignment());
    expect(draft.sourcePanoId).toBe('styled-a');
    expect(draft.targetGrayboxPanoId).toBe('graybox-a');
    expect(draft.pairs.map((pair) => pair.id)).toEqual(['pair-a', 'pair-b']);
    expect(draft.pairs.map((pair) => pair.order)).toEqual([0, 1]);
    expect(draft.strength).toBe(0.7);
    expect(isProjectionAlignmentDraftDirty(draft)).toBe(false);
  });

  it('creates a pending target pick and advances to source', () => {
    const draft = addTargetPick(createProjectionAlignmentDraft('styled-a', 'graybox-a'), [0.3, 0.4]);
    expect(draft.pendingTargetUv).toEqual([0.3, 0.4]);
    expect(alignmentPickStep(draft)).toBe('source');
    expect(draft.pairs).toHaveLength(0);
    expect(isProjectionAlignmentDraftDirty(draft)).toBe(true);
  });

  it('completes exactly one pair and returns to target selection', () => {
    const target = addTargetPick(createProjectionAlignmentDraft('styled-a', 'graybox-a'), [0.3, 0.4]);
    const draft = completeSourcePick(target, [0.35, 0.45]);
    expect(draft.pendingTargetUv).toBeUndefined();
    expect(alignmentPickStep(draft)).toBe('target');
    expect(draft.pairs).toHaveLength(1);
    expect(draft.pairs[0]).toMatchObject({ order: 0, targetUv: [0.3, 0.4], sourceUv: [0.35, 0.45], enabled: true });
  });

  it('increments pair order deterministically', () => {
    let draft = createProjectionAlignmentDraft('styled-a', 'graybox-a');
    draft = completeSourcePick(addTargetPick(draft, [0.1, 0.2]), [0.2, 0.3]);
    draft = completeSourcePick(addTargetPick(draft, [0.4, 0.5]), [0.5, 0.6]);
    expect(draft.pairs.map((pair) => [pair.id, pair.order])).toEqual([
      ['match-1', 0], ['match-2', 1],
    ]);
  });

  it('undoes a pending target and a completed pair', () => {
    let draft = createProjectionAlignmentDraft('styled-a', 'graybox-a');
    draft = addTargetPick(draft, [0.2, 0.3]);
    expect(undoLastDraftAction(draft).pendingTargetUv).toBeUndefined();
    draft = completeSourcePick(draft, [0.25, 0.35]);
    const undone = undoLastDraftAction(draft);
    expect(undone.pairs).toHaveLength(0);
    expect(undone.pendingTargetUv).toEqual([0.2, 0.3]);
  });

  it('removes and toggles a pair with undoable snapshots', () => {
    let draft = createProjectionAlignmentDraft('styled-a', savedAlignment());
    draft = removeDraftPair(draft, 'pair-a');
    expect(draft.pairs.map((pair) => pair.id)).toEqual(['pair-b']);
    draft = undoLastDraftAction(draft);
    expect(draft.pairs.map((pair) => pair.id)).toEqual(['pair-a', 'pair-b']);
    draft = toggleDraftPair(draft, 'pair-b');
    expect(draft.pairs[1].enabled).toBe(true);
    expect(undoLastDraftAction(draft).pairs[1].enabled).toBe(false);
  });

  it('clears all pairs and pending state', () => {
    let draft = createProjectionAlignmentDraft('styled-a', savedAlignment());
    draft = addTargetPick(draft, [0.4, 0.5]);
    draft = clearDraftPairs(draft);
    expect(draft.pairs).toEqual([]);
    expect(draft.pendingTargetUv).toBeUndefined();
  });

  it('updates strength without changing pair data', () => {
    const initial = createProjectionAlignmentDraft('styled-a', savedAlignment());
    const draft = setDraftStrength(initial, 0.35);
    expect(draft.strength).toBe(0.35);
    expect(draft.pairs).toEqual(initial.pairs);
    expect(isProjectionAlignmentDraftDirty(draft)).toBe(true);
  });

  it('becomes clean again when every substantive value returns to the baseline', () => {
    const initial = createProjectionAlignmentDraft('styled-a', savedAlignment());
    let draft = toggleDraftPair(initial, 'pair-b');
    draft = toggleDraftPair(draft, 'pair-b');
    expect(isProjectionAlignmentDraftDirty(draft)).toBe(false);
    expect(isProjectionAlignmentDraftDirty(setDraftStrength(draft, 0.1))).toBe(true);
    expect(isProjectionAlignmentDraftDirty(setDraftStrength(draft, 0.7))).toBe(false);
  });

  it('compares IDs, coordinates, order, enabled state, and strength rather than pair count', () => {
    const initial = createProjectionAlignmentDraft('styled-a', savedAlignment());
    const changed = {
      ...initial,
      pairs: initial.pairs.map((pair, index) => index === 0
        ? { ...pair, sourceUv: [0.9, pair.sourceUv[1]] as [number, number] }
        : pair),
    };
    expect(isProjectionAlignmentDraftDirty(changed, initial)).toBe(true);
  });

  it('converts a draft back to an ID-owned alignment', () => {
    const draft = setDraftStrength(
      createProjectionAlignmentDraft('styled-a', 'graybox-a'),
      0.4,
    );
    const withPair = completeSourcePick(addTargetPick(draft, [0.3, 0.4]), [0.35, 0.45]);
    const alignment = draftToProjectionAlignment(withPair);
    expect(alignment).toMatchObject({
      sourcePanoId: 'styled-a', targetGrayboxPanoId: 'graybox-a', strength: 0.4,
    });
    expect(alignment?.pairs[0].targetUv).toEqual([0.3, 0.4]);
    expect(alignment?.updatedAt).toBeTruthy();
  });

  it('returns no alignment until a target and at least one pair exist', () => {
    expect(draftToProjectionAlignment(createProjectionAlignmentDraft('styled-a'))).toBeUndefined();
    const pending = addTargetPick(createProjectionAlignmentDraft('styled-a', 'graybox-a'), [0.1, 0.2]);
    expect(draftToProjectionAlignment(pending)).toBeUndefined();
  });
});
