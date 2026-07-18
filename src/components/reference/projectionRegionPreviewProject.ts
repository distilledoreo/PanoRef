import type { LocationProject } from '../../domain/types';
import { normalizeProjectedStyleSettings, setProjectionRegionAlignmentForPano } from '../../domain/defaults';
import { draftToProjectionRegionAlignment, type ProjectionRegionDraft } from './projectionRegionEditorState';

export function createProjectionRegionPreviewProject(project: LocationProject, draft: ProjectionRegionDraft): LocationProject {
  const alignment = draftToProjectionRegionAlignment(draft);
  const clone = structuredClone(project);
  clone.settings.projectedStyle = setProjectionRegionAlignmentForPano(normalizeProjectedStyleSettings(clone.settings.projectedStyle), draft.sourcePanoId, alignment);
  return clone;
}
