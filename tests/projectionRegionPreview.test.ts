import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { commitPendingRegion, completeTargetPolygon, createProjectionRegionDraft } from '../src/components/reference/projectionRegionEditorState';
import { createProjectionRegionPreviewProject } from '../src/components/reference/projectionRegionPreviewProject';

describe('Region Fit non-persistent preview', () => {
  it('adds only the draft alignment to a cloned project', () => {
    const project = createDefaultProject(); const before = JSON.stringify(project);
    const draft = commitPendingRegion(completeTargetPolygon(createProjectionRegionDraft('styled', 'graybox'), [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]));
    const preview = createProjectionRegionPreviewProject(project, draft);
    expect(preview.settings.projectedStyle?.regionAlignments?.[0].regions).toHaveLength(1);
    expect(JSON.stringify(project)).toBe(before);
  });
});
