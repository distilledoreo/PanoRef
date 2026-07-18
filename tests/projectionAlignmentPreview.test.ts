import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  createProjectionAlignment,
  createProjectionControlPair,
  defaultProjectedStyleSettings,
  normalizeProjectedStyleSettings,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { createProjectionAlignmentPreviewProject } from '../src/components/reference/projectionAlignmentPreviewProject';
import {
  createProjectionAlignmentDraft,
  draftToProjectionAlignment,
  setDraftStrength,
} from '../src/components/reference/projectionAlignmentEditorState';

function makeProject() {
  const project = createDefaultProject();
  const sourceAsset = createPanoAsset({ name: 'styled-a.png', uri: 'styled://a', width: 4096, height: 2048 });
  const secondaryAsset = createPanoAsset({ name: 'styled-b.png', uri: 'styled://b', width: 4096, height: 2048 });
  const targetAsset = createPanoAsset({ name: 'graybox.png', uri: 'graybox://a', width: 4096, height: 2048 });
  const source = createPanoReference({
    name: 'Styled A', assetId: sourceAsset.id, type: 'ai_global_reference', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  const secondary = createPanoReference({
    name: 'Styled B', assetId: secondaryAsset.id, type: 'ai_global_reference', origin: [4, 1.65, 0], width: 4096, height: 2048,
  });
  const target = createPanoReference({
    name: 'Graybox', assetId: targetAsset.id, type: 'graybox_render', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  const sourceAlignment = createProjectionAlignment(source.id, target.id, [
    createProjectionControlPair({ id: 'source-old', order: 0, targetUv: [0.2, 0.3], sourceUv: [0.3, 0.4] }),
  ]);
  const secondaryAlignment = createProjectionAlignment(secondary.id, target.id, [
    createProjectionControlPair({ id: 'secondary-old', order: 0, targetUv: [0.7, 0.3], sourceUv: [0.6, 0.4] }),
  ]);
  project.panoRefs = [source, secondary, target];
  project.assets.assets = {
    [sourceAsset.id]: sourceAsset,
    [secondaryAsset.id]: secondaryAsset,
    [targetAsset.id]: targetAsset,
  };
  project.settings.projectedStyle = {
    ...defaultProjectedStyleSettings,
    panoId: source.id,
    secondaryPanoId: secondary.id,
    alignments: [sourceAlignment, secondaryAlignment],
  };
  return { project, source, secondary, target, sourceAlignment, secondaryAlignment };
}

describe('Projection Assist non-persistent preview', () => {
  it('replaces only the draft source alignment in a cloned project', () => {
    const { project, source, secondary, target, secondaryAlignment } = makeProject();
    const draft = setDraftStrength(
      createProjectionAlignmentDraft(source.id, target.id),
      0.35,
    );
    const withPair = {
      ...draft,
      pairs: [createProjectionControlPair({ id: 'draft-match', order: 0, targetUv: [0.1, 0.2], sourceUv: [0.4, 0.5] })],
    };
    const preview = createProjectionAlignmentPreviewProject(project, withPair);
    const previewSettings = normalizeProjectedStyleSettings(preview.settings.projectedStyle);

    expect(preview).not.toBe(project);
    expect(preview.settings).not.toBe(project.settings);
    expect(previewSettings.panoId).toBe(source.id);
    expect(previewSettings.alignments).toHaveLength(2);
    expect(previewSettings.alignments?.find((alignment) => alignment.sourcePanoId === source.id)).toMatchObject({
      sourcePanoId: source.id,
      targetGrayboxPanoId: target.id,
      strength: 0.35,
      pairs: [{ id: 'draft-match' }],
    });
    expect(previewSettings.alignments?.find((alignment) => alignment.sourcePanoId === secondary.id)).toEqual(secondaryAlignment);
  });

  it('does not mutate the saved project while strength changes in the draft', () => {
    const { project, source, target, sourceAlignment } = makeProject();
    const originalJson = JSON.stringify(project.settings.projectedStyle);
    const draft = createProjectionAlignmentDraft(source.id, sourceAlignment);
    const changedDraft = setDraftStrength(draft, 0.2);
    const preview = createProjectionAlignmentPreviewProject(project, changedDraft);

    expect(changedDraft.strength).toBe(0.2);
    expect(project.settings.projectedStyle).toEqual(JSON.parse(originalJson));
    expect(project.settings.projectedStyle?.alignments?.[0]).toEqual(sourceAlignment);
    expect(preview.settings.projectedStyle?.alignments?.find((alignment) => alignment.sourcePanoId === source.id)?.strength).toBe(0.2);
    expect(draftToProjectionAlignment(changedDraft)?.targetGrayboxPanoId).toBe(target.id);
  });

  it('removes only the draft source alignment when the draft represents removal', () => {
    const { project, source, secondary, secondaryAlignment } = makeProject();
    const draft = createProjectionAlignmentDraft(source.id, 'graybox-a');
    const preview = createProjectionAlignmentPreviewProject(project, draft);
    const previewSettings = normalizeProjectedStyleSettings(preview.settings.projectedStyle);

    expect(previewSettings.alignments).toEqual([secondaryAlignment]);
    expect(project.settings.projectedStyle?.alignments?.map((alignment) => alignment.sourcePanoId)).toEqual([
      source.id,
      secondary.id,
    ]);
  });

  it('preserves unrelated projected-style settings in the preview clone', () => {
    const { project, source, target } = makeProject();
    project.settings.projectedStyle = setProjectionAlignmentForPano(
      normalizeProjectedStyleSettings(project.settings.projectedStyle),
      source.id,
      undefined,
    );
    const draft = createProjectionAlignmentDraft(source.id, target.id);
    const preview = createProjectionAlignmentPreviewProject(project, draft);

    expect(preview.settings.projectedStyle?.opacity).toBe(project.settings.projectedStyle?.opacity);
    expect(preview.settings.projectedStyle?.secondaryPanoId).toBe(project.settings.projectedStyle?.secondaryPanoId);
    expect(preview.scene).toBe(project.scene);
    expect(preview.assets).toBe(project.assets);
  });
});
