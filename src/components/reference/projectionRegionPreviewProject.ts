import type { LocationProject } from '../../domain/types';
import { normalizeProjectedStyleSettings, setProjectionRegionAlignmentForPano } from '../../domain/defaults';
import { draftToProjectionRegionAlignmentForPreview, type ProjectionRegionDraft } from './projectionRegionEditorState';

export function createProjectionRegionPreviewProject(project: LocationProject, draft: ProjectionRegionDraft): LocationProject {
  const alignment = draftToProjectionRegionAlignmentForPreview(draft);
  const clone = structuredClone(project);
  clone.settings.projectedStyle = setProjectionRegionAlignmentForPano(normalizeProjectedStyleSettings(clone.settings.projectedStyle), draft.sourcePanoId, alignment);
  return clone;
}
