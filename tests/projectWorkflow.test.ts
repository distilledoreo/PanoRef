import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference, createShot } from '../src/domain/defaults';
import { createShotPackageManifest } from '../src/engine/exportManifest';
import { generateImagePrompt } from '../src/engine/prompts';
import { serializeProject, parseProject } from '../src/engine/projectIO';
import { getProjectWarnings, getShotWarnings } from '../src/engine/warnings';
import { getLatestGrayboxPano, getPanoAsset } from '../src/domain/selectors';

describe('project workflow logic', () => {
  it('creates a valid default local-first project', () => {
    const project = createDefaultProject();
    expect(project.schemaVersion).toBe('0.1');
    expect(project.scene.objects.length).toBeGreaterThan(0);
    expect(project.scene.panoOrigin).toEqual([0, 1.6, 0]);
    expect(project.scene.objects.find((object) => object.name === 'Main Temple Gate')?.transform.position[2]).toBeGreaterThan(0);
    expect(project.scene.objects.find((object) => object.name === 'Man Facing Camera')?.transform.position[2]).toBeGreaterThan(0);
    expect(project.landmarks[0].promptCritical).toBe(true);
    expect(project.shots.length).toBe(0);
  });

  it('serializes and parses project JSON', () => {
    const project = createDefaultProject();
    const parsed = parseProject(serializeProject(project));
    expect(parsed.id).toBe(project.id);
    expect(parsed.scene.objects[0].name).toBe(project.scene.objects[0].name);
  });

  it('migrates legacy in-app skinned frame fields to imported AI result fields', () => {
    const project = createDefaultProject();
    const shot = createShot({
      index: 1,
      camera: {
        position: [0, 1.6, 0],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    const legacyShot = {
      ...shot,
      exportSettings: {
        ...shot.exportSettings,
        includeContinuityControlView: undefined,
        includeAiResultFrame: undefined,
        includeSkinnedFrame: true,
      },
      assets: {
        ...shot.assets,
        skinnedFrameAssetId: 'asset_legacy_result',
      },
    };
    project.shots.push(legacyShot as unknown as typeof shot);

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.shots[0].exportSettings.includeContinuityControlView).toBe(true);
    expect(parsed.shots[0].exportSettings.includeAiResultFrame).toBe(true);
    expect(parsed.shots[0].assets.aiResultFrameAssetId).toBe('asset_legacy_result');
  });

  it('normalizes legacy pano references without rotation', () => {
    const project = createDefaultProject();
    const asset = createPanoAsset({
      name: 'legacy_reference.png',
      uri: 'data:image/png;base64,AAAA',
      width: 2048,
      height: 1024,
    });
    const pano = createPanoReference({
      name: 'Legacy Reference',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: asset.width ?? 2048,
      height: asset.height ?? 1024,
      isCanonical: true,
    });
    project.assets.assets[asset.id] = asset;
    project.panoRefs.push({ ...pano, rotation: undefined } as unknown as typeof pano);

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.panoRefs[0].rotation).toEqual([0, 0, 0]);
  });

  it('serializes object-level projection stamps', () => {
    const project = createDefaultProject();
    const asset = createPanoAsset({
      name: 'global_reference.png',
      uri: 'data:image/png;base64,AAAA',
      width: 2048,
      height: 1024,
    });
    const pano = createPanoReference({
      name: 'Canonical',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: asset.width ?? 2048,
      height: asset.height ?? 1024,
      isCanonical: true,
    });
    project.assets.assets[asset.id] = asset;
    project.panoRefs.push(pano);
    project.scene.objects[0].projectionStamp = {
      id: 'stamp_floor',
      panoId: pano.id,
      panoYawDegrees: 0,
      yawDegrees: 12,
      pitchDegrees: -4,
      viewFovDegrees: 42,
      panoFovDegrees: 58,
      opacity: 0.8,
      aspectRatio: 16 / 9,
      createdAt: '2026-06-28T00:00:00.000Z',
    };

    const parsed = parseProject(serializeProject(project));
    expect(parsed.scene.objects[0].projectionStamp).toMatchObject({
      panoId: pano.id,
      yawDegrees: 12,
      viewFovDegrees: 42,
      panoFovDegrees: 58,
    });
  });

  it('emits warnings until graybox and canonical panos exist', () => {
    const project = createDefaultProject();
    const warnings = getProjectWarnings(project).map((warning) => warning.id);
    expect(warnings).toContain('missing-graybox-pano');
    expect(warnings).toContain('missing-canonical-pano');
  });

  it('builds shot prompts with selected prompt-critical landmarks', () => {
    const project = createDefaultProject();
    const shot = createShot({
      index: 1,
      camera: {
        position: [0, 1.6, 0],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    shot.landmarkIds = [project.landmarks[0].id];
    const prompt = generateImagePrompt(project, shot);
    expect(prompt).toContain('Use continuity_control_view.png as the primary camera/layout control');
    expect(prompt).toContain('Gray areas in continuity_control_view.png are untextured structure placeholders');
    expect(prompt).toContain(project.landmarks[0].displayName);
    expect(prompt).toContain('Do not move, redesign, remove, or replace');
  });

  it('creates a package manifest for expected shot export artifacts', () => {
    const project = createDefaultProject();
    const asset = createPanoAsset({
      name: 'global_graybox.png',
      uri: 'data:image/png;base64,AAAA',
      width: 2048,
      height: 1024,
    });
    const pano = createPanoReference({
      name: 'Graybox',
      assetId: asset.id,
      type: 'graybox_render',
      origin: project.scene.panoOrigin,
      width: asset.width ?? 2048,
      height: asset.height ?? 1024,
      isCanonical: true,
    });
    project.assets.assets[asset.id] = asset;
    project.panoRefs.push(pano);
    const shot = createShot({
      index: 1,
      linkedPanoId: pano.id,
      camera: {
        position: project.scene.panoOrigin,
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    project.shots.push(shot);
    expect(shot.exportSettings.includeContinuityControlView).toBe(true);

    const manifest = createShotPackageManifest(project, shot);
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toContain('shot_001/inputs/viewport_clay.png');
    expect(paths).toContain('shot_001/inputs/continuity_control_view.png');
    expect(paths).not.toContain('shot_001/outputs/skinned_reference_frame.png');
    expect(paths).toContain('shot_001/inputs/global_graybox.png');
    expect(paths).toContain('shot_001/prompts/image_gen_prompt.txt');
  });

  it('omits the continuity control view from the package manifest when disabled', () => {
    const project = createDefaultProject();
    const asset = createPanoAsset({
      name: 'global_reference.png',
      uri: 'data:image/png;base64,AAAA',
      width: 2048,
      height: 1024,
    });
    const pano = createPanoReference({
      name: 'Canonical',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: asset.width ?? 2048,
      height: asset.height ?? 1024,
      isCanonical: true,
    });
    project.assets.assets[asset.id] = asset;
    project.panoRefs.push(pano);
    const shot = createShot({
      index: 1,
      linkedPanoId: pano.id,
      camera: {
        position: [0, 1.6, -2],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    shot.exportSettings.includeContinuityControlView = false;
    project.shots.push(shot);

    expect(createShotPackageManifest(project, shot).files.map((file) => file.path))
      .not.toContain('shot_001/inputs/continuity_control_view.png');
  });

  it('adds an imported AI result frame to the package manifest only after one exists', () => {
    const project = createDefaultProject();
    const shot = createShot({
      index: 1,
      camera: {
        position: [0, 1.6, 0],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    project.shots.push(shot);
    expect(createShotPackageManifest(project, shot).files.map((file) => file.path))
      .not.toContain('shot_001/outputs/ai_result_frame.png');

    shot.assets.aiResultFrameAssetId = 'asset_ai_result';
    expect(createShotPackageManifest(project, shot).files.map((file) => file.path))
      .toContain('shot_001/outputs/ai_result_frame.png');
  });

  it('selects the latest graybox pano asset for direct download controls', () => {
    const project = createDefaultProject();
    const firstAsset = createPanoAsset({
      name: 'global_graybox_old.png',
      uri: 'data:image/png;base64,OLD',
      width: 1024,
      height: 512,
    });
    const secondAsset = createPanoAsset({
      name: 'global_graybox.png',
      uri: 'data:image/png;base64,NEW',
      width: 2048,
      height: 1024,
    });
    const firstPano = createPanoReference({
      name: 'Old Graybox',
      assetId: firstAsset.id,
      type: 'graybox_render',
      origin: project.scene.panoOrigin,
      width: 1024,
      height: 512,
    });
    const secondPano = createPanoReference({
      name: 'Graybox 360',
      assetId: secondAsset.id,
      type: 'graybox_render',
      origin: project.scene.panoOrigin,
      width: 2048,
      height: 1024,
    });
    project.assets.assets[firstAsset.id] = firstAsset;
    project.assets.assets[secondAsset.id] = secondAsset;
    project.panoRefs.push(firstPano, secondPano);

    const latest = getLatestGrayboxPano(project);
    expect(latest?.id).toBe(secondPano.id);
    expect(getPanoAsset(project, latest)?.name).toBe('global_graybox.png');
  });

  it('warns when a shot has no selected critical landmarks', () => {
    const project = createDefaultProject();
    const shot = createShot({
      index: 1,
      camera: {
        position: [0, 1.6, 0],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
    });
    project.shots.push(shot);
    expect(getShotWarnings(project, shot).some((warning) => warning.id.endsWith('missing-landmarks'))).toBe(true);
  });
});
