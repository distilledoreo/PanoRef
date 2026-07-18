import { describe, expect, it } from 'vitest';
import {
  cancelPendingRegion, commitPendingRegion, completeTargetPolygon, createProjectionRegionDraft,
  draftToProjectionRegionAlignment, insertRegionVertexPair, isProjectionRegionDraftDirty,
  moveRegionDown, moveRegionUp, moveSourceVertex, removeRegion, removeRegionVertexPair,
  renameRegion, replaceTargetPolygon, rotateSourceRegion, scaleSourceRegion, setRegionEdgeSoftness,
  setRegionStrength, toggleRegion, translateSourceRegion, undoRegionAction,
} from '../src/components/reference/projectionRegionEditorState';

const outline: [number, number][] = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]];
function pending() { return completeTargetPolygon(createProjectionRegionDraft('styled', 'graybox'), outline, 'Canopy'); }

describe('Projection Region editor draft', () => {
  it('clones one target drawing with identical IDs and coordinates then advances to styled', () => {
    const draft = pending();
    expect(draft.step).toBe('adjust-source');
    expect(draft.pendingRegion?.vertices.map((vertex) => vertex.sourceUv)).toEqual(outline);
    expect(draft.pendingRegion?.vertices.map((vertex) => vertex.id)).toHaveLength(4);
    expect(isProjectionRegionDraftDirty(draft)).toBe(true);
  });

  it('moves, scales, rotates, and edits only styled positions', () => {
    const initial = pending(); const id = initial.pendingRegion!.id; const vertex = initial.pendingRegion!.vertices[0];
    let draft = moveSourceVertex(initial, id, vertex.id, [0.25, 0.3]);
    expect(draft.pendingRegion!.vertices[0].targetUv).toEqual([0.2, 0.2]);
    draft = translateSourceRegion(draft, id, [0.1, 0]);
    draft = scaleSourceRegion(draft, id, 1.2);
    draft = rotateSourceRegion(draft, id, Math.PI / 4);
    expect(draft.pendingRegion!.vertices[0].sourceUv).not.toEqual(draft.pendingRegion!.vertices[0].targetUv);
    expect(draft.pendingRegion!.vertices[0].targetUv).toEqual([0.2, 0.2]);
  });

  it('inserts and removes shared topology without dropping below three', () => {
    let draft = pending(); const id = draft.pendingRegion!.id; const edge = draft.pendingRegion!.vertices[0].id;
    draft = insertRegionVertexPair(draft, id, edge, 0.6);
    expect(draft.pendingRegion!.vertices).toHaveLength(5);
    const inserted = draft.pendingRegion!.vertices[1];
    expect(inserted.targetUv).toEqual(inserted.sourceUv);
    draft = removeRegionVertexPair(draft, id, inserted.id);
    expect(draft.pendingRegion!.vertices).toHaveLength(4);
  });

  it('commits, cancels, undoes, and never emits incomplete pending state', () => {
    const draft = pending();
    expect(draftToProjectionRegionAlignment(draft)).toBeUndefined();
    expect(cancelPendingRegion(draft).regions).toEqual([]);
    const committed = commitPendingRegion(draft);
    expect(committed.step).toBe('review'); expect(committed.regions).toHaveLength(1);
    expect(draftToProjectionRegionAlignment(committed)?.regions).toHaveLength(1);
    expect(undoRegionAction(committed).pendingRegion).toBeDefined();
  });

  it('supports region metadata, ordering, strength, redraw, removal, and dirty tracking', () => {
    let draft = commitPendingRegion(pending());
    draft = commitPendingRegion(completeTargetPolygon(draft, outline.map(([u, v]) => [u + 0.1, v]), 'Wall'));
    const first = draft.regions[0].id; const second = draft.regions[1].id;
    draft = renameRegion(draft, first, 'Crown');
    draft = toggleRegion(draft, first, false);
    draft = setRegionEdgeSoftness(draft, first, 9);
    draft = setRegionStrength(draft, 0.4);
    expect(draft.regions[0]).toMatchObject({ name: 'Crown', enabled: false, edgeSoftness: 0.25 });
    expect(moveRegionDown(draft, first).regions.map((region) => region.id)).toEqual([second, first]);
    expect(moveRegionUp(draft, second).regions.map((region) => region.id)).toEqual([second, first]);
    draft = replaceTargetPolygon(draft, first, outline.slice(0, 3));
    expect(draft.regions.find((region) => region.id === first)?.vertices).toHaveLength(3);
    expect(removeRegion(draft, first).regions).toHaveLength(1);
    expect(isProjectionRegionDraftDirty(draft)).toBe(true);
  });
});
