import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  createProjectionAlignment,
  createProjectionControlPair,
  defaultProjectedStyleSettings,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { LocationProject, PanoReference } from '../src/domain/types';
import { disposeAllProjectionWarpTextures, projectionWarpTextureCacheSize } from '../src/engine/projectionWarpTexture';
import { projectionAlignmentStatusForPano } from '../src/engine/projectionAlignmentStatus';

function makeProject() {
  const project = createDefaultProject();
  const sourceAsset = createPanoAsset({ name: 'styled.png', uri: 'styled://pano', width: 4096, height: 2048 });
  const secondaryAsset = createPanoAsset({ name: 'styled-b.png', uri: 'styled://pano-b', width: 4096, height: 2048 });
  const targetAsset = createPanoAsset({ name: 'graybox.png', uri: 'graybox://pano', width: 4096, height: 2048 });
  const source = createPanoReference({
    name: 'Styled A', assetId: sourceAsset.id, type: 'ai_global_reference', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  const secondary = createPanoReference({
    name: 'Styled B', assetId: secondaryAsset.id, type: 'ai_global_reference', origin: [4, 1.65, 0], width: 4096, height: 2048,
  });
  const target = createPanoReference({
    name: 'Graybox', assetId: targetAsset.id, type: 'graybox_render', origin: [0, 1.65, 0], width: 4096, height: 2048,
  });
  project.panoRefs = [source, secondary, target];
  project.assets.assets = {
    [sourceAsset.id]: sourceAsset,
    [secondaryAsset.id]: secondaryAsset,
    [targetAsset.id]: targetAsset,
  };
  project.settings.projectedStyle = {
    ...defaultProjectedStyleSettings,
    panoId: source.id,
    alignments: [createProjectionAlignment(source.id, target.id, [
      createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5] }),
    ])],
  };
  return { project, source, secondary, target, sourceAsset, secondaryAsset, targetAsset };
}

function setAlignment(project: LocationProject, source: PanoReference, target: PanoReference, pairs = [
  createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5] }),
]) {
  project.settings.projectedStyle = setProjectionAlignmentForPano(
    project.settings.projectedStyle!,
    source.id,
    createProjectionAlignment(source.id, target.id, pairs),
  );
}

describe('Projection Assist alignment status', () => {
  beforeEach(() => disposeAllProjectionWarpTextures());

  it('reports none when there is no alignment', () => {
    const { project, source } = makeProject();
    project.settings.projectedStyle!.alignments = undefined;
    expect(projectionAlignmentStatusForPano(project, source.id)).toMatchObject({
      state: 'none', message: 'No local fit', pairCount: 0, enabledPairCount: 0,
    });
  });

  it('reports ready and includes enabled match count', () => {
    const { project, source } = makeProject();
    const status = projectionAlignmentStatusForPano(project, source.id);
    expect(status.state).toBe('ready');
    expect(status.message).toBe('1 match');
    expect(status.enabledPairCount).toBe(1);
    expect(status.maxMarkerErrorRadians).toEqual(expect.any(Number));
  });

  it('reports stale when the source pano is missing', () => {
    const { project, source } = makeProject();
    project.panoRefs = project.panoRefs.filter((pano) => pano.id !== source.id);
    expect(projectionAlignmentStatusForPano(project, source.id).state).toBe('stale');
  });

  it('reports stale when the source asset is missing', () => {
    const { project, source, sourceAsset } = makeProject();
    delete project.assets.assets[sourceAsset.id];
    expect(projectionAlignmentStatusForPano(project, source.id).state).toBe('stale');
  });

  it('reports stale when the target pano is missing', () => {
    const { project, source, target } = makeProject();
    project.panoRefs = project.panoRefs.filter((pano) => pano.id !== target.id);
    expect(projectionAlignmentStatusForPano(project, source.id).state).toBe('stale');
  });

  it('reports stale when the target asset is missing', () => {
    const { project, source, targetAsset } = makeProject();
    delete project.assets.assets[targetAsset.id];
    expect(projectionAlignmentStatusForPano(project, source.id).state).toBe('stale');
  });

  it('reports stale when the target is not a graybox render', () => {
    const { project, source, target } = makeProject();
    target.type = 'ai_global_reference';
    expect(projectionAlignmentStatusForPano(project, source.id).state).toBe('stale');
  });

  it('reports none for disabled-only pairs', () => {
    const { project, source, target } = makeProject();
    setAlignment(project, source, target, [
      createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.52, 0.5], enabled: false }),
    ]);
    expect(projectionAlignmentStatusForPano(project, source.id)).toMatchObject({
      state: 'none', pairCount: 1, enabledPairCount: 0, message: 'No local fit',
    });
  });

  it('reports conflicts from cached warp diagnostics', () => {
    const { project, source, target } = makeProject();
    setAlignment(project, source, target, [
      createProjectionControlPair({ id: 'a', order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] }),
      createProjectionControlPair({ id: 'b', order: 1, targetUv: [0.505, 0.5], sourceUv: [0.7, 0.5] }),
    ]);
    const status = projectionAlignmentStatusForPano(project, source.id);
    expect(status.state).toBe('conflicting');
    expect(status.conflictCount).toBe(1);
    expect(status.message).toBe('1 match conflict');
  });

  it('releases the status acquisition resource', () => {
    const { project, source } = makeProject();
    expect(projectionWarpTextureCacheSize()).toBe(0);
    projectionAlignmentStatusForPano(project, source.id);
    expect(projectionWarpTextureCacheSize()).toBe(0);
  });

  it('keeps primary and secondary status independent', () => {
    const { project, source, secondary, target } = makeProject();
    setAlignment(project, secondary, target, [
      createProjectionControlPair({ order: 0, targetUv: [0.25, 0.5], sourceUv: [0.3, 0.5] }),
      createProjectionControlPair({ order: 1, targetUv: [0.75, 0.5], sourceUv: [0.7, 0.5] }),
    ]);
    const primary = projectionAlignmentStatusForPano(project, source.id);
    const secondaryStatus = projectionAlignmentStatusForPano(project, secondary.id);
    expect(primary.enabledPairCount).toBe(1);
    expect(secondaryStatus.enabledPairCount).toBe(2);
  });
});

