import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference, createShot } from '../src/domain/defaults';
import { createShotPackageManifest } from '../src/engine/exportManifest';
import { generateImagePrompt } from '../src/engine/prompts';
import { ShotPackageError, buildShotPackage } from '../src/engine/packageExport';
import { serializeProject, parseProject } from '../src/engine/projectIO';
import { getProjectWarnings, getShotWarnings } from '../src/engine/warnings';
import { getLatestGrayboxPano, getPanoAsset } from '../src/domain/selectors';
import { setTwoPointCameraKeyframe } from '../src/engine/cameraKeyframes';
import { addCameraMoveCubemapCropPaths, buildCameraMoveCubemapVisibility, cameraMoveCubemapVisibleStitchedPath } from '../src/engine/cameraMoveCubemap';

describe('project workflow logic', () => {
  it('creates a valid default local-first project', () => {
    const project = createDefaultProject();
    expect(project.schemaVersion).toBe('0.1');
    expect(project.scene.objects.length).toBeGreaterThan(0);
    expect(project.scene.panoOrigin).toEqual([0, 1.6, 0]);
    expect(project.scene.objects.find((object) => object.name === 'Main Temple Gate')?.transform.position[2]).toBeGreaterThan(0);
    expect(project.scene.objects.find((object) => object.name === 'Man Facing Camera')?.transform.position[2]).toBeGreaterThan(0);
    expect(project.landmarks[0].promptCritical).toBe(true);
    expect(project.shots.length).toBe(1);
    expect(project.shots[0].name).toBe('Camera 001');
    expect(project.shots[0].camera.position).toEqual(project.scene.panoOrigin);
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
        includeContinuityControlView: true,
        includeAiResultFrame: undefined,
        includeSkinnedFrame: true,
      },
      assets: {
        ...shot.assets,
        skinnedFrameAssetId: 'asset_legacy_result',
      },
    };
    project.shots = [legacyShot as unknown as typeof shot];

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.shots[0].exportSettings.includeAiResultFrame).toBe(true);
    expect(parsed.shots[0].exportSettings).not.toHaveProperty('includeContinuityControlView');
    expect(parsed.shots[0].assets.aiResultFrameAssetId).toBe('asset_legacy_result');
  });

  it('normalizes legacy shots without camera keyframes or video export toggles', () => {
    const project = createDefaultProject();
    const legacyShot = {
      ...project.shots[0],
      cameraKeyframes: undefined,
      exportSettings: {
        ...project.shots[0].exportSettings,
        includeCameraMoveVideo: undefined,
        includeCameraMoveReferenceFrames: undefined,
      },
    };
    project.shots = [legacyShot as unknown as typeof project.shots[0]];

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.shots[0].cameraKeyframes).toEqual([]);
    expect(parsed.shots[0].exportSettings.includeCameraMoveVideo).toBe(true);
    expect(parsed.shots[0].exportSettings.includeCameraMoveReferenceFrames).toBe(true);
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

  it('drops legacy object-level projection stamps during parse', () => {
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
    project.scene.objects[0] = {
      ...project.scene.objects[0],
      projectionStamp: {
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
      },
    } as typeof project.scene.objects[0];

    const parsed = parseProject(serializeProject(project));
    expect(parsed.scene.objects[0]).not.toHaveProperty('projectionStamp');
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
    expect(prompt).toContain('Use viewport_clay.png as the strict camera, composition, perspective, scale, and layout reference.');
    expect(prompt).not.toContain('continuity_control_view.png');
    expect(prompt).not.toContain('projected style placement');
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

    const manifest = createShotPackageManifest(project, shot);
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toContain('shot_001/inputs/viewport_clay.png');
    expect(paths).not.toContain('shot_001/inputs/continuity_control_view.png');
    expect(paths).not.toContain('shot_001/outputs/skinned_reference_frame.png');
    expect(paths).toContain('shot_001/inputs/global_graybox.png');
    expect(paths).toContain('shot_001/prompts/image_gen_prompt.txt');
  });

  it('includes pano crop in the manifest only when crop settings exist', () => {
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
    project.shots.push(shot);

    expect(createShotPackageManifest(project, shot).files.map((file) => file.path))
      .not.toContain('shot_001/inputs/pano_crop.png');

    shot.panoCrop = {
      panoId: pano.id,
      yawDegrees: 0,
      pitchDegrees: 0,
      rollDegrees: 0,
      fovDegrees: 55,
      aspectRatio: 16 / 9,
      width: 1920,
      height: 1080,
    };
    expect(createShotPackageManifest(project, shot).files.map((file) => file.path))
      .toContain('shot_001/inputs/pano_crop.png');
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

  it('adds exported camera move video and keyframe metadata to the package manifest', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [1, 1.8, -3],
      },
      durationSeconds: 3,
    });
    shot.assets.cameraMoveVideoAssetId = 'asset_camera_move';

    const manifest = createShotPackageManifest(project, shot);
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toContain('shot_001/inputs/viewport_clay_motion.mp4');
    expect(paths).toContain('shot_001/inputs/camera_move/clay_start.png');
    expect(paths).toContain('shot_001/inputs/camera_move/clay_mid.png');
    expect(paths).toContain('shot_001/inputs/camera_move/clay_end.png');
    expect(paths).toContain('shot_001/metadata/camera_keyframes.json');
    expect(paths).toContain('shot_001/metadata/camera_move_reference_frames.json');
  });

  it('adds cubemap references to the manifest when a camera move has a linked pano', () => {
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
    const shot = project.shots[0];
    shot.linkedPanoId = pano.id;
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [1, 1.8, -3],
      },
      durationSeconds: 3,
    });

    const paths = createShotPackageManifest(project, shot).files.map((file) => file.path);
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/px.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/nx.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/py.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/ny.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/pz.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/nz.png');
    expect(paths).toContain('shot_001/inputs/camera_move/cubemap/cubemap_stitched.png');
    expect(paths).toContain('shot_001/metadata/camera_move_cubemap_visibility.json');
    expect(paths).not.toContain('shot_001/inputs/camera_move/pano_reference_start.png');
  });

  it('adds computed cubemap visible crop paths to the final manifest', () => {
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
    const shot = project.shots[0];
    shot.linkedPanoId = pano.id;
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [1, 1.8, -3],
      },
      durationSeconds: 3,
    });
    const visibility = addCameraMoveCubemapCropPaths(buildCameraMoveCubemapVisibility(
      project,
      shot,
      pano,
      [{ id: 'start', label: 'Start', timeSeconds: 0, camera: shot.camera }],
      { faceSize: 128, columns: 5, rows: 3 },
    ));

    const paths = createShotPackageManifest(project, shot, visibility).files.map((file) => file.path);
    expect(visibility.frames[0].visibleFaces.length).toBeGreaterThan(0);
    const stitchedPath = cameraMoveCubemapVisibleStitchedPath('start');
    expect(stitchedPath).toBeTruthy();
    expect(paths).toContain(`shot_001/${stitchedPath}`);
  });

  it('fails gracefully when exporting without a selected shot', async () => {
    const project = createDefaultProject();
    await expect(buildShotPackage(project, undefined)).rejects.toThrow(ShotPackageError);
    await expect(buildShotPackage(project, undefined)).rejects.toThrow('Select a shot before exporting a package.');
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
