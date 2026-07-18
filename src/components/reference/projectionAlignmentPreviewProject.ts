import { normalizeProjectedStyleSettings, setProjectionAlignmentForPano } from '../../domain/defaults';
import { LocationProject } from '../../domain/types';
import {
  draftToProjectionAlignment,
  ProjectionAlignmentDraft,
} from './projectionAlignmentEditorState';

/**
 * Build an isolated project snapshot for the editor's After view.
 *
 * The draft is intentionally converted only for this clone. The persisted
 * project remains unchanged until the editor's Apply action calls its parent.
 */
export function createProjectionAlignmentPreviewProject(
  project: LocationProject,
  draft: ProjectionAlignmentDraft,
): LocationProject {
  const normalized = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const draftAlignment = draftToProjectionAlignment(draft);

  return {
    ...project,
    settings: {
      ...project.settings,
      projectedStyle: setProjectionAlignmentForPano(
        normalized,
        draft.sourcePanoId,
        draftAlignment,
      ),
    },
  };
}
