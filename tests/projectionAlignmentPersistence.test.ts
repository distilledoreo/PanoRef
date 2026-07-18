import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  createProjectionAlignment,
  createProjectionControlPair,
  defaultProjectedStyleSettings,
  findProjectionAlignmentForPano,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { LocationProject } from '../src/domain/types';
import { parseProject, serializeProject } from '../src/engine/projectIO';
import { resolveProjectionWarpWithStrengthForProject } from '../src/engine/multiOriginProjection';
import { projectionAlignmentStatusForPano } from '../src/engine/projectionAlignmentStatus';
import { disposeAllProjectionWarpTextures } from '../src/engine/projectionWarpTexture';

function makeProject(): {
  project: LocationProject;
  primary: ReturnType<typeof createPanoReference>;
  secondary: ReturnType<typeof createPanoReference>;
  graybox: ReturnType<typeof createPanoReference>;
} {
  const project = createDefaultProject();
  const primaryAsset = createPanoAsset({ name: 'styled-a.png', uri: 'styled://a', width: 4096, height: 2048 });
  const secondaryAsset = createPanoAsset({ name: 'styled-b.png', uri: 'styled://b', width: 4096, height: 2048 });
  const grayboxAsset = createPanoAsset({ name: 'graybox.png', uri: 'graybox://a', width: 4096, height: 2048 });
  const primary = createPanoReference({
    name: 'Styled A', assetId: primaryAsset.id, type: 'ai_global_reference', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  const secondary = createPanoReference({
    name: 'Styled B', assetId: secondaryAsset.id, type: 'ai_global_reference', origin: [5, 1.65, 0], width: 4096, height: 2048,
  });
  const graybox = createPanoReference({
    name: 'Graybox A', assetId: grayboxAsset.id, type: 'graybox_render', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  project.panoRefs = [primary, secondary, graybox];
  project.assets.assets = {
    [primaryAsset.id]: primaryAsset,
    [secondaryAsset.id]: secondaryAsset,
    [grayboxAsset.id]: grayboxAsset,
  };
  project.settings.projectedStyle = {
    ...defaultProjectedStyleSettings,
    panoId: primary.id,
    secondaryPanoId: secondary.id,
    blendMode: 'primary_dominant',
  };
  return { project, primary, secondary, graybox };
}

function alignment(sourcePanoId: string, targetGrayboxPanoId: string, prefix: string) {
  return createProjectionAlignment(sourcePanoId, targetGrayboxPanoId, [
    createProjectionControlPair({
      id: `${prefix}-first`,
      order: 0,
      targetUv: [0.2, 0.3],
      sourceUv: [0.25, 0.35],
      enabled: true,
    }),
    createProjectionControlPair({
      id: `${prefix}-second`,
      order: 1,
      targetUv: [0.8, 0.7],
      sourceUv: [0.75, 0.65],
      enabled: false,
    }),
  ]);
}

describe('Projection Assist persistence and stale-data boundaries', () => {
  beforeEach(() => disposeAllProjectionWarpTextures());

  it('round-trips applied primary and secondary alignments with pair metadata intact', () => {
    const { project, primary, secondary, graybox } = makeProject();
    const primaryAlignment = alignment(primary.id, graybox.id, 'primary');
    primaryAlignment.strength = 0.42;
    const secondaryAlignment = alignment(secondary.id, graybox.id, 'secondary');
    secondaryAlignment.strength = 0.73;
    project.settings.projectedStyle = setProjectionAlignmentForPano(
      setProjectionAlignmentForPano(project.settings.projectedStyle!, primary.id, primaryAlignment),
      secondary.id,
      secondaryAlignment,
    );

    const reloaded = parseProject(serializeProject(project));
    const loadedPrimary = findProjectionAlignmentForPano(reloaded.settings.projectedStyle!, primary.id);
    const loadedSecondary = findProjectionAlignmentForPano(reloaded.settings.projectedStyle!, secondary.id);

    expect(loadedPrimary).toMatchObject({
      sourcePanoId: primary.id,
      targetGrayboxPanoId: graybox.id,
      strength: 0.42,
      pairs: [
        { id: 'primary-first', order: 0, enabled: true },
        { id: 'primary-second', order: 1, enabled: false },
      ],
    });
    expect(loadedSecondary).toMatchObject({
      sourcePanoId: secondary.id,
      targetGrayboxPanoId: graybox.id,
      strength: 0.73,
      pairs: [
        { id: 'secondary-first', order: 0, enabled: true },
        { id: 'secondary-second', order: 1, enabled: false },
      ],
    });
  });

  it('keeps source-owned alignments when projector slots and blend mode change', () => {
    const { project, primary, secondary, graybox } = makeProject();
    const primaryAlignment = alignment(primary.id, graybox.id, 'primary');
    const secondaryAlignment = alignment(secondary.id, graybox.id, 'secondary');
    project.settings.projectedStyle = {
      ...setProjectionAlignmentForPano(
        setProjectionAlignmentForPano(project.settings.projectedStyle!, primary.id, primaryAlignment),
        secondary.id,
        secondaryAlignment,
      ),
      panoId: secondary.id,
      secondaryPanoId: primary.id,
      blendMode: 'secondary_dominant',
    };

    const reloaded = parseProject(serializeProject(project));
    expect(reloaded.settings.projectedStyle?.panoId).toBe(secondary.id);
    expect(reloaded.settings.projectedStyle?.secondaryPanoId).toBe(primary.id);
    expect(findProjectionAlignmentForPano(reloaded.settings.projectedStyle!, primary.id)).toEqual(primaryAlignment);
    expect(findProjectionAlignmentForPano(reloaded.settings.projectedStyle!, secondary.id)).toEqual(secondaryAlignment);
  });

  it('preserves a stale alignment as saved data but refuses to apply it', () => {
    const { project, primary, graybox } = makeProject();
    const saved = alignment(primary.id, graybox.id, 'stale');
    project.settings.projectedStyle = setProjectionAlignmentForPano(project.settings.projectedStyle!, primary.id, saved);
    project.panoRefs = project.panoRefs.filter((pano) => pano.id !== graybox.id);

    const reloaded = parseProject(serializeProject(project));
    expect(findProjectionAlignmentForPano(reloaded.settings.projectedStyle!, primary.id)).toEqual(saved);
    expect(projectionAlignmentStatusForPano(reloaded, primary.id).state).toBe('stale');
    expect(resolveProjectionWarpWithStrengthForProject(reloaded, primary.id, 'runtime')).toBeUndefined();
  });

  it('removes only one source panorama alignment and restores it when that source is re-added', () => {
    const { project, primary, secondary, graybox } = makeProject();
    const primaryAlignment = alignment(primary.id, graybox.id, 'primary');
    const secondaryAlignment = alignment(secondary.id, graybox.id, 'secondary');
    let settings = setProjectionAlignmentForPano(project.settings.projectedStyle!, primary.id, primaryAlignment);
    settings = setProjectionAlignmentForPano(settings, secondary.id, secondaryAlignment);
    const removed = setProjectionAlignmentForPano(settings, secondary.id, undefined);

    expect(findProjectionAlignmentForPano(removed, primary.id)).toEqual(primaryAlignment);
    expect(findProjectionAlignmentForPano(removed, secondary.id)).toBeUndefined();

    const restored = setProjectionAlignmentForPano(removed, secondary.id, secondaryAlignment);
    expect(findProjectionAlignmentForPano(restored, primary.id)).toEqual(primaryAlignment);
    expect(findProjectionAlignmentForPano(restored, secondary.id)).toEqual(secondaryAlignment);
  });

  it('keeps the editor workflow guarded by explicit target choice, draft cancel, preview, and focus behavior', () => {
    const editor = readFileSync(new URL('../src/components/reference/ProjectionAlignmentEditor.tsx', import.meta.url), 'utf8');
    const preview = readFileSync(new URL('../src/components/reference/ProjectionAlignmentPreview.tsx', import.meta.url), 'utf8');
    expect(editor).toContain('targets.length === 1 ? targets[0].id : undefined');
    expect(editor).toContain('staleTarget');
    expect(editor).toContain('Changing the graybox clears matches');
    expect(editor).toContain('Discard these local matches');
    expect(editor).toContain('openerRef.current?.focus();');
    expect(editor).toContain("event.key.toLowerCase() === 'z'");
    expect(editor).toContain('setPreviewMode(false)');
    expect(preview).toContain('Back to matches');
    expect(preview).toContain("setViewMode('before')");
    expect(preview).toContain("setViewMode('after')");
    expect(preview).toContain('onStrengthChange');
    expect(preview).toContain('Apply local fit');
  });
});
