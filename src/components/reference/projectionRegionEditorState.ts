import type { ProjectionRegion, ProjectionRegionAlignment, Vec2 } from '../../domain/types';
import { createProjectionRegion, createProjectionRegionAlignment, createProjectionRegionVertexPair, MAX_REGION_EDGE_SOFTNESS } from '../../domain/defaults';
import { insertPairedVertex, removePairedVertex, rotateSourceMask, scaleSourceMask, translateSourceMask } from '../../engine/projectionRegionPolygon';
import { targetUvToSourceUv } from '../../engine/projectionRegionCoordinates';

export type RegionEditorStep = 'draw-target' | 'adjust-source' | 'review';
export interface ProjectionRegionDraft {
  sourcePanoId: string;
  targetGrayboxPanoId: string;
  regions: ProjectionRegion[];
  pendingRegion?: ProjectionRegion;
  activeRegionId?: string;
  strength: number;
  step: RegionEditorStep;
}

interface DraftMeta { baseline: string; undo: ProjectionRegionDraft[] }
export interface ProjectionRegionYawPair { targetYawDegrees: number; sourceYawDegrees: number }
const metadata = new WeakMap<ProjectionRegionDraft, DraftMeta>();
const cloneRegion = (region: ProjectionRegion): ProjectionRegion => ({ ...region, vertices: region.vertices.map((vertex) => ({ ...vertex, targetUv: [...vertex.targetUv], sourceUv: [...vertex.sourceUv] })) });
const cloneDraft = (draft: ProjectionRegionDraft): ProjectionRegionDraft => ({ ...draft, regions: draft.regions.map(cloneRegion), pendingRegion: draft.pendingRegion ? cloneRegion(draft.pendingRegion) : undefined });
const comparable = (draft: ProjectionRegionDraft) => JSON.stringify(cloneDraft(draft));
function register(draft: ProjectionRegionDraft, baseline = comparable(draft), undo: ProjectionRegionDraft[] = []): ProjectionRegionDraft { metadata.set(draft, { baseline, undo: undo.map(cloneDraft) }); return draft; }
function update(draft: ProjectionRegionDraft, next: ProjectionRegionDraft): ProjectionRegionDraft { const meta = metadata.get(draft); return register(next, meta?.baseline ?? comparable(draft), [...(meta?.undo ?? []), cloneDraft(draft)].slice(-100)); }
function updateTransient(draft: ProjectionRegionDraft, next: ProjectionRegionDraft): ProjectionRegionDraft { const meta = metadata.get(draft); return register(next, meta?.baseline ?? comparable(draft), meta?.undo ?? []); }
function mapRegion(draft: ProjectionRegionDraft, regionId: string, mapper: (region: ProjectionRegion) => ProjectionRegion): ProjectionRegionDraft {
  if (draft.pendingRegion?.id === regionId) return update(draft, { ...draft, pendingRegion: mapper(draft.pendingRegion) });
  if (!draft.regions.some((region) => region.id === regionId)) return draft;
  return update(draft, { ...draft, regions: draft.regions.map((region) => region.id === regionId ? mapper(region) : cloneRegion(region)) });
}
function mapRegionTransient(draft: ProjectionRegionDraft, regionId: string, mapper: (region: ProjectionRegion) => ProjectionRegion): ProjectionRegionDraft {
  if (draft.pendingRegion?.id === regionId) return updateTransient(draft, { ...draft, pendingRegion: mapper(draft.pendingRegion) });
  if (!draft.regions.some((region) => region.id === regionId)) return draft;
  return updateTransient(draft, { ...draft, regions: draft.regions.map((region) => region.id === regionId ? mapper(region) : cloneRegion(region)) });
}

export function createProjectionRegionDraft(sourcePanoId: string, targetGrayboxPanoId = '', alignment?: ProjectionRegionAlignment): ProjectionRegionDraft {
  const draft: ProjectionRegionDraft = { sourcePanoId, targetGrayboxPanoId: alignment?.targetGrayboxPanoId ?? targetGrayboxPanoId, regions: alignment?.regions.map(cloneRegion) ?? [], strength: Math.min(1, Math.max(0, alignment?.strength ?? 1)), step: 'review' };
  return register(draft);
}
export function cloneTargetIntoSource(region: ProjectionRegion, yaws?: ProjectionRegionYawPair): ProjectionRegion { return { ...cloneRegion(region), vertices: region.vertices.map((vertex) => ({ ...vertex, targetUv: [...vertex.targetUv], sourceUv: yaws ? targetUvToSourceUv(vertex.targetUv, yaws.targetYawDegrees, yaws.sourceYawDegrees) : [...vertex.targetUv] })) }; }
export function completeTargetPolygon(draft: ProjectionRegionDraft, points: Vec2[], name = `Region ${draft.regions.length + 1}`, yaws?: ProjectionRegionYawPair): ProjectionRegionDraft {
  if (points.length < 3) return draft;
  const pendingRegion = cloneTargetIntoSource(createProjectionRegion(points.map((point, index) => createProjectionRegionVertexPair(point, point, `vertex-${Date.now()}-${index + 1}`)), name), yaws);
  pendingRegion.order = draft.regions.length;
  return update(draft, { ...draft, pendingRegion, activeRegionId: pendingRegion.id, step: 'adjust-source' });
}
export function markTargetRegionDraftStarted(draft: ProjectionRegionDraft): ProjectionRegionDraft { return draft.step === 'draw-target' ? draft : update(draft, { ...draft, step: 'draw-target' }); }
export const moveSourceVertex = (draft: ProjectionRegionDraft, regionId: string, vertexId: string, sourceUv: Vec2) => mapRegion(draft, regionId, (region) => ({ ...region, vertices: region.vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, sourceUv: [...sourceUv] } : vertex) }));
export const moveTargetVertex = (draft: ProjectionRegionDraft, regionId: string, vertexId: string, targetUv: Vec2) => mapRegion(draft, regionId, (region) => ({ ...region, vertices: region.vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, targetUv: [...targetUv] } : vertex) }));
export const translateSourceRegion = (draft: ProjectionRegionDraft, regionId: string, delta: Vec2) => mapRegion(draft, regionId, (region) => translateSourceMask(region, delta));
export const moveSourceVertexTransient = (draft: ProjectionRegionDraft, regionId: string, vertexId: string, sourceUv: Vec2) => mapRegionTransient(draft, regionId, (region) => ({ ...region, vertices: region.vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, sourceUv: [...sourceUv] } : vertex) }));
export const moveTargetVertexTransient = (draft: ProjectionRegionDraft, regionId: string, vertexId: string, targetUv: Vec2) => mapRegionTransient(draft, regionId, (region) => ({ ...region, vertices: region.vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, targetUv: [...targetUv] } : vertex) }));
export const translateSourceRegionTransient = (draft: ProjectionRegionDraft, regionId: string, delta: Vec2) => mapRegionTransient(draft, regionId, (region) => translateSourceMask(region, delta));
export const scaleSourceRegion = (draft: ProjectionRegionDraft, regionId: string, scale: number) => mapRegion(draft, regionId, (region) => scaleSourceMask(region, scale));
export const rotateSourceRegion = (draft: ProjectionRegionDraft, regionId: string, radians: number) => mapRegion(draft, regionId, (region) => rotateSourceMask(region, radians));
export const resetSourceRegion = (draft: ProjectionRegionDraft, regionId: string, yaws?: ProjectionRegionYawPair) => mapRegion(draft, regionId, (region) => cloneTargetIntoSource(region, yaws));
export const insertRegionVertexPair = (draft: ProjectionRegionDraft, regionId: string, edgeStartVertexId: string, edgeT: number) => mapRegion(draft, regionId, (region) => insertPairedVertex(region, edgeStartVertexId, edgeT));
export const removeRegionVertexPair = (draft: ProjectionRegionDraft, regionId: string, vertexId: string) => mapRegion(draft, regionId, (region) => removePairedVertex(region, vertexId));
export function commitPendingRegion(draft: ProjectionRegionDraft): ProjectionRegionDraft { if (!draft.pendingRegion) return draft; const regions = [...draft.regions.map(cloneRegion), { ...cloneRegion(draft.pendingRegion), order: draft.regions.length }]; return update(draft, { ...draft, regions, pendingRegion: undefined, activeRegionId: regions.at(-1)?.id, step: 'review' }); }
export function cancelPendingRegion(draft: ProjectionRegionDraft): ProjectionRegionDraft { if (!draft.pendingRegion) return draft; return update(draft, { ...draft, pendingRegion: undefined, activeRegionId: undefined, step: 'review' }); }
export function replaceTargetPolygon(draft: ProjectionRegionDraft, regionId: string, points: Vec2[], yaws?: ProjectionRegionYawPair): ProjectionRegionDraft { if (points.length < 3) return draft; return mapRegion(draft, regionId, (region) => cloneTargetIntoSource({ ...region, vertices: points.map((point, index) => createProjectionRegionVertexPair(point, point, region.vertices[index]?.id)) }, yaws)); }
export function removeRegion(draft: ProjectionRegionDraft, regionId: string): ProjectionRegionDraft { if (!draft.regions.some((region) => region.id === regionId)) return draft; return update(draft, { ...draft, regions: draft.regions.filter((region) => region.id !== regionId).map((region, order) => ({ ...cloneRegion(region), order })), activeRegionId: draft.activeRegionId === regionId ? undefined : draft.activeRegionId }); }
export const renameRegion = (draft: ProjectionRegionDraft, regionId: string, name: string) => mapRegion(draft, regionId, (region) => ({ ...region, name: name.trim() || region.name }));
export const toggleRegion = (draft: ProjectionRegionDraft, regionId: string, enabled?: boolean) => mapRegion(draft, regionId, (region) => ({ ...region, enabled: enabled ?? !region.enabled }));
function reorder(draft: ProjectionRegionDraft, regionId: string, direction: -1 | 1): ProjectionRegionDraft { const index = draft.regions.findIndex((region) => region.id === regionId); const destination = index + direction; if (index < 0 || destination < 0 || destination >= draft.regions.length) return draft; const regions = draft.regions.map(cloneRegion); [regions[index], regions[destination]] = [regions[destination], regions[index]]; return update(draft, { ...draft, regions: regions.map((region, order) => ({ ...region, order })) }); }
export const moveRegionUp = (draft: ProjectionRegionDraft, regionId: string) => reorder(draft, regionId, -1);
export const moveRegionDown = (draft: ProjectionRegionDraft, regionId: string) => reorder(draft, regionId, 1);
export const setRegionEdgeSoftness = (draft: ProjectionRegionDraft, regionId: string, value: number) => mapRegion(draft, regionId, (region) => ({ ...region, edgeSoftness: Math.min(MAX_REGION_EDGE_SOFTNESS, Math.max(0, Number.isFinite(value) ? value : region.edgeSoftness)) }));
export function setRegionStrength(draft: ProjectionRegionDraft, strength: number): ProjectionRegionDraft { const value = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : draft.strength)); return value === draft.strength ? draft : update(draft, { ...draft, strength: value }); }
export function undoRegionAction(draft: ProjectionRegionDraft): ProjectionRegionDraft { const meta = metadata.get(draft); if (!meta?.undo.length) return draft; const previous = cloneDraft(meta.undo.at(-1)!); return register(previous, meta.baseline, meta.undo.slice(0, -1)); }
export function commitRegionGesture(draft: ProjectionRegionDraft, before: ProjectionRegionDraft | undefined): ProjectionRegionDraft {
  if (!before || comparable(draft) === comparable(before)) return draft;
  const meta = metadata.get(draft);
  return register(draft, meta?.baseline ?? comparable(draft), [...(meta?.undo ?? []), cloneDraft(before)].slice(-100));
}
export function isProjectionRegionDraftDirty(draft: ProjectionRegionDraft): boolean { return comparable(draft) !== (metadata.get(draft)?.baseline ?? comparable(draft)); }
export function draftToProjectionRegionAlignment(draft: ProjectionRegionDraft): ProjectionRegionAlignment | undefined { if (!draft.targetGrayboxPanoId || draft.pendingRegion || !draft.regions.length) return undefined; return { ...createProjectionRegionAlignment(draft.sourcePanoId, draft.targetGrayboxPanoId, draft.regions.map(cloneRegion)), strength: draft.strength }; }
export function draftToProjectionRegionAlignmentForPreview(draft: ProjectionRegionDraft): ProjectionRegionAlignment | undefined {
  if (!draft.targetGrayboxPanoId) return undefined;
  const regions = draft.pendingRegion ? [...draft.regions, draft.pendingRegion] : draft.regions;
  if (!regions.length) return undefined;
  return { ...createProjectionRegionAlignment(draft.sourcePanoId, draft.targetGrayboxPanoId, regions.map(cloneRegion)), strength: draft.strength };
}
