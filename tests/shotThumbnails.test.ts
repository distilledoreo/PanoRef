import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import { resolveShotThumbnail } from '../src/domain/shotThumbnails';

describe('shot thumbnail resolution', () => {
  it('prefers shot-specific frame assets over reference imagery', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const viewportAsset = createPanoAsset({
      name: 'viewport_clay.png',
      uri: 'data:image/png;base64,VIEWPORT',
      width: 1920,
      height: 1080,
    });
    const aiAsset = createPanoAsset({
      name: 'ai_result_frame.png',
      uri: 'data:image/png;base64,AI',
      width: 1920,
      height: 1080,
    });
    project.assets.assets[viewportAsset.id] = viewportAsset;
    project.assets.assets[aiAsset.id] = aiAsset;
    shot.assets.viewportRenderAssetId = viewportAsset.id;
    shot.assets.aiResultFrameAssetId = aiAsset.id;

    const thumbnail = resolveShotThumbnail(project, shot);

    expect(thumbnail.source).toBe('ai_result');
    expect(thumbnail.asset?.id).toBe(aiAsset.id);
  });

  it('uses the shot linked pano before falling back to the canonical reference', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const canonicalAsset = createPanoAsset({
      name: 'global_reference.png',
      uri: 'data:image/png;base64,CANONICAL',
      width: 2048,
      height: 1024,
    });
    const linkedAsset = createPanoAsset({
      name: 'shot_linked_pano.png',
      uri: 'data:image/png;base64,LINKED',
      width: 2048,
      height: 1024,
    });
    const canonicalPano = createPanoReference({
      name: 'Canonical Reference',
      assetId: canonicalAsset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: 2048,
      height: 1024,
      isCanonical: true,
    });
    const linkedPano = createPanoReference({
      name: 'Shot Linked Reference',
      assetId: linkedAsset.id,
      type: 'external_reference',
      origin: project.scene.panoOrigin,
      width: 2048,
      height: 1024,
      isCanonical: false,
    });
    project.assets.assets[canonicalAsset.id] = canonicalAsset;
    project.assets.assets[linkedAsset.id] = linkedAsset;
    project.panoRefs.push(canonicalPano, linkedPano);

    expect(resolveShotThumbnail(project, shot).source).toBe('canonical_pano');

    shot.linkedPanoId = linkedPano.id;
    const thumbnail = resolveShotThumbnail(project, shot);

    expect(thumbnail.source).toBe('linked_pano');
    expect(thumbnail.asset?.id).toBe(linkedAsset.id);
  });

  it('returns an empty state when no usable image asset exists', () => {
    const project = createDefaultProject();

    expect(resolveShotThumbnail(project, project.shots[0])).toEqual({ label: 'No image yet' });
  });
});
