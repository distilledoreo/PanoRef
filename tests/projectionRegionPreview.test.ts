import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { commitPendingRegion, completeTargetPolygon, createProjectionRegionDraft, draftToProjectionRegionAlignment } from '../src/components/reference/projectionRegionEditorState';
import { createProjectionRegionPreviewProject } from '../src/components/reference/projectionRegionPreviewProject';

describe('Region Fit non-persistent preview', () => {
  it('adds only the draft alignment to a cloned project', () => {
    const project = createDefaultProject(); const before = JSON.stringify(project);
    const draft = commitPendingRegion(completeTargetPolygon(createProjectionRegionDraft('styled', 'graybox'), [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]));
    const preview = createProjectionRegionPreviewProject(project, draft);
    expect(preview.settings.projectedStyle?.regionAlignments?.[0].regions).toHaveLength(1);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('includes an in-progress target region in the preview while Apply remains blocked by draft state', () => {
    const project = createDefaultProject();
    const draft = completeTargetPolygon(createProjectionRegionDraft('styled', 'graybox'), [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]]);
    const preview = createProjectionRegionPreviewProject(project, draft);
    expect(preview.settings.projectedStyle?.regionAlignments?.[0].regions).toHaveLength(1);
    expect(draft.pendingRegion).toBeDefined();
    expect(draft.regions).toHaveLength(0);
    expect(draftToProjectionRegionAlignment(draft)).toBeUndefined();
  });
});
