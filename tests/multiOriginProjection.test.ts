import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  normalizeProjectedStyleSettings,
} from '../src/domain/defaults';
import {
  canUseDualProjectorBlend,
  computeProjectorBlendWeights,
  countStyledPanoramas,
  originMoveWarningMessage,
  projectorConfidence,
  resolveProjectedProjectorAssets,
  resolveProjectorPose,
  resolveProjectors,
  resolveStyledImportMode,
  shouldWarnOnOriginMove,
  normalizeProjectorBlendMode,
} from '../src/engine/multiOriginProjection';

function withTwoStyledPanos() {
  const project = createDefaultProject();
  const aAsset = createPanoAsset({
    name: 'a.png',
    uri: 'data:image/png;base64,AAAA',
    width: 4096,
    height: 2048,
  });
  const bAsset = createPanoAsset({
    name: 'b.png',
    uri: 'data:image/png;base64,BBBB',
    width: 4096,
    height: 2048,
  });
  project.assets.assets[aAsset.id] = aAsset;
  project.assets.assets[bAsset.id] = bAsset;
  const a = createPanoReference({
    name: 'Pano A',
    assetId: aAsset.id,
    type: 'ai_global_reference',
    origin: [0, 1.6, 0],
    rotation: [0, 0, 0],
    width: 4096,
    height: 2048,
    isCanonical: true,
  });
  const b = createPanoReference({
    name: 'Pano B',
    assetId: bAsset.id,
    type: 'external_reference',
    origin: [8, 1.6, 0],
    rotation: [0, 15, 0],
    width: 4096,
    height: 2048,
    isCanonical: false,
  });
  project.panoRefs = [a, b];
  return { project, a, b };
}

describe('multi-origin projection helpers', () => {
  it('warns on origin move only when styled/reference panos exist', () => {
    const empty = createDefaultProject();
    empty.panoRefs = [];
    expect(shouldWarnOnOriginMove(empty)).toBe(false);

    const grayOnly = createDefaultProject();
    const grayAsset = createPanoAsset({
      name: 'g.png',
      uri: 'data:image/png;base64,GGGG',
      width: 4,
      height: 2,
    });
    grayOnly.assets.assets[grayAsset.id] = grayAsset;
    grayOnly.panoRefs = [createPanoReference({
      name: 'Gray',
      assetId: grayAsset.id,
      type: 'graybox_render',
      origin: grayOnly.scene.panoOrigin,
      width: 4,
      height: 2,
      isCanonical: true,
    })];
    expect(shouldWarnOnOriginMove(grayOnly)).toBe(false);

    const { project } = withTwoStyledPanos();
    expect(shouldWarnOnOriginMove(project)).toBe(true);
    expect(countStyledPanoramas(project)).toBe(2);
    expect(originMoveWarningMessage(2)).toMatch(/reference panoramas/i);
    expect(originMoveWarningMessage(2)).toMatch(/second vantage/i);
  });

  it('resolves styled import mode from capture vs primary origin', () => {
    const { project, a } = withTwoStyledPanos();
    project.panoRefs = [a];
    project.scene.panoOrigin = [...a.origin];
    expect(resolveStyledImportMode(project)).toBe('replace');

    project.scene.panoOrigin = [8, 1.6, 0];
    expect(resolveStyledImportMode(project)).toBe('add_secondary');

    project.scene.panoOrigin = [...a.origin];
    expect(resolveStyledImportMode(project, { pendingSecondaryStyledImport: true })).toBe('add_secondary');

    project.panoRefs = [];
    expect(resolveStyledImportMode(project)).toBe('first');
  });

  it('freezes pano origin copies so scene moves do not rewrite styled poses', () => {
    const project = createDefaultProject();
    const sharedOrigin: [number, number, number] = [1, 2, 3];
    project.scene.panoOrigin = sharedOrigin;
    const asset = createPanoAsset({
      name: 's.png',
      uri: 'data:image/png;base64,SSSS',
      width: 4,
      height: 2,
    });
    const pano = createPanoReference({
      name: 'Styled',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: 4,
      height: 2,
      isCanonical: true,
    });
    expect(pano.origin).not.toBe(project.scene.panoOrigin);
    expect(pano.origin).toEqual([1, 2, 3]);
    project.scene.panoOrigin[0] = 99;
    expect(pano.origin[0]).toBe(1);
  });

  it('does not auto-pick graybox as dual secondary', () => {
    const project = createDefaultProject();
    const styledAsset = createPanoAsset({
      name: 's.png',
      uri: 'data:image/png;base64,SSSS',
      width: 4,
      height: 2,
    });
    const grayAsset = createPanoAsset({
      name: 'g.png',
      uri: 'data:image/png;base64,GGGG',
      width: 4,
      height: 2,
    });
    project.assets.assets[styledAsset.id] = styledAsset;
    project.assets.assets[grayAsset.id] = grayAsset;
    const styled = createPanoReference({
      name: 'Styled',
      assetId: styledAsset.id,
      type: 'ai_global_reference',
      origin: [0, 1.6, 0],
      width: 4,
      height: 2,
      isCanonical: true,
    });
    const gray = createPanoReference({
      name: 'Gray',
      assetId: grayAsset.id,
      type: 'graybox_render',
      origin: [4, 1.6, 0],
      width: 4,
      height: 2,
    });
    project.panoRefs = [styled, gray];
    const resolved = resolveProjectors(project, { blendMode: 'primary_dominant' });
    expect(resolved.primary?.id).toBe(styled.id);
    expect(resolved.secondary).toBeUndefined();
  });

  it('resolves projector pose from the pano itself, not the scene origin', () => {
    const { project, a, b } = withTwoStyledPanos();
    project.scene.panoOrigin = [99, 0, 99];
    project.scene.panoRotation = [0, 90, 0];
    const poseA = resolveProjectorPose(a);
    const poseB = resolveProjectorPose(b);
    expect(poseA.origin).toEqual([0, 1.6, 0]);
    expect(poseB.origin).toEqual([8, 1.6, 0]);
    expect(poseB.rotation[1]).toBe(15);
    expect(poseA.origin).not.toEqual(project.scene.panoOrigin);
  });

  it('normalizes blend modes and rejects illegal secondary = primary', () => {
    expect(normalizeProjectorBlendMode(undefined)).toBe('primary_only');
    expect(normalizeProjectorBlendMode('primary_dominant')).toBe('primary_dominant');
    expect(normalizeProjectorBlendMode('nope')).toBe('primary_only');

    const settings = normalizeProjectedStyleSettings({
      panoId: 'same',
      secondaryPanoId: 'same',
      blendMode: 'primary_dominant',
    });
    expect(settings.secondaryPanoId).toBeUndefined();
    expect(settings.blendMode).toBe('primary_dominant');
  });

  it('prefers primary near origin A under primary_dominant; fill prefers B when far from A', () => {
    const originA: [number, number, number] = [0, 1.6, 0];
    const originB: [number, number, number] = [10, 1.6, 0];

    const nearA = computeProjectorBlendWeights({
      worldPosition: [0.5, 1.6, 0],
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'primary_dominant',
    });
    expect(nearA.wPrimary).toBeGreaterThan(0.7);
    expect(nearA.wSecondary).toBeLessThan(0.3);

    const nearB = computeProjectorBlendWeights({
      worldPosition: [10, 1.6, 0],
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'primary_dominant',
    });
    expect(nearB.wSecondary).toBeGreaterThan(nearB.wPrimary);

    const onlyA = computeProjectorBlendWeights({
      worldPosition: [10, 1.6, 0],
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'primary_only',
    });
    expect(onlyA.wPrimary).toBe(1);
    expect(onlyA.wSecondary).toBe(0);

    const onlyB = computeProjectorBlendWeights({
      worldPosition: [0, 1.6, 0],
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'secondary_only',
    });
    expect(onlyB.wPrimary).toBe(0);
    expect(onlyB.wSecondary).toBe(1);
  });

  it('projector confidence falls with distance', () => {
    const origin: [number, number, number] = [0, 0, 0];
    const near = projectorConfidence([0.1, 0, 0], origin);
    const far = projectorConfidence([20, 0, 0], origin);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.8);
    expect(far).toBeLessThan(0.4);
  });

  it('resolveProjectors wires dual slots for blend modes', () => {
    const { project, a, b } = withTwoStyledPanos();
    const dual = resolveProjectors(project, {
      panoId: a.id,
      secondaryPanoId: b.id,
      blendMode: 'primary_dominant',
    });
    expect(dual.primary?.id).toBe(a.id);
    expect(dual.secondary?.id).toBe(b.id);
    expect(canUseDualProjectorBlend(project, {
      panoId: a.id,
      secondaryPanoId: b.id,
      blendMode: 'primary_dominant',
    })).toBe(true);

    const single = resolveProjectors(project, { panoId: a.id, blendMode: 'primary_only' });
    expect(single.primary?.id).toBe(a.id);
  });

  it('resolveProjectedProjectorAssets freezes per-pano origins and dual URLs', () => {
    const { project, a, b } = withTwoStyledPanos();
    project.scene.panoOrigin = [99, 1.6, 99];
    const assets = resolveProjectedProjectorAssets(project, {
      panoId: a.id,
      secondaryPanoId: b.id,
      blendMode: 'primary_dominant',
    });
    expect(assets?.primary.id).toBe(a.id);
    expect(assets?.primaryUrl).toBeTruthy();
    expect(assets?.secondary?.id).toBe(b.id);
    expect(assets?.secondaryUrl).toBeTruthy();
    // Projector poses come from the pano references, not the live capture origin.
    expect(assets?.primary.origin).toEqual(a.origin);
    expect(assets?.secondary?.origin).toEqual(b.origin);
    expect(assets?.primary.origin).not.toEqual(project.scene.panoOrigin);
  });
});
