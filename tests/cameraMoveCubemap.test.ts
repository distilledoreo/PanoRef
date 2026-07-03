import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import { setTwoPointCameraKeyframe } from '../src/engine/cameraKeyframes';
import {
  addCameraMoveCubemapCropPaths,
  applyInversePanoYaw,
  buildCameraMoveCubemapVisibility,
  cameraMoveCubemapVisibleCropPath,
  cameraMoveCubemapVisibleStitchedPath,
  cubemapUvBoundsToPixelCrop,
  directionToCubemapFaceUv,
} from '../src/engine/cameraMoveCubemap';

describe('camera move cubemap references', () => {
  it('maps world directions to stable cubemap faces and UVs', () => {
    expect(directionToCubemapFaceUv([0, 0, 1]).face).toBe('pz');
    expect(directionToCubemapFaceUv([0, 0, -1]).face).toBe('nz');
    expect(directionToCubemapFaceUv([1, 0, 0]).face).toBe('px');
    expect(directionToCubemapFaceUv([-1, 0, 0]).face).toBe('nx');
    expect(directionToCubemapFaceUv([0, 1, 0]).face).toBe('py');
    expect(directionToCubemapFaceUv([0, -1, 0]).face).toBe('ny');

    const forward = directionToCubemapFaceUv([0, 0, 1]);
    expect(forward.u).toBeCloseTo(0.5);
    expect(forward.v).toBeCloseTo(0.5);
  });

  it('applies linked pano yaw before converting visible hits to cubemap UVs', () => {
    const rotated = applyInversePanoYaw([0, 0, 1], [0, 90, 0]);
    expect(rotated[0]).toBeCloseTo(-1);
    expect(rotated[2]).toBeCloseTo(0);
    expect(directionToCubemapFaceUv(rotated).face).toBe('nx');
  });

  it('converts visible UV bounds into padded pixel crop rectangles', () => {
    expect(cubemapUvBoundsToPixelCrop({
      uMin: 0.4,
      vMin: 0.25,
      uMax: 0.6,
      vMax: 0.5,
    }, 100, 0.1)).toEqual({
      x: 30,
      y: 15,
      width: 40,
      height: 45,
    });
  });

  it('produces stitched visible path for a frame', () => {
    expect(cameraMoveCubemapVisibleStitchedPath('start'))
      .toBe('inputs/camera_move/cubemap_visible/start_stitched.png');
    expect(cameraMoveCubemapVisibleStitchedPath('mid'))
      .toBe('inputs/camera_move/cubemap_visible/mid_stitched.png');
  });

  it('raycasts the shot camera into the graybox to produce visible cubemap crop metadata', () => {
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

    const frames = [
      { id: 'start' as const, label: 'Start' as const, timeSeconds: 0, camera: shot.camera },
    ];
    const visibility = addCameraMoveCubemapCropPaths(buildCameraMoveCubemapVisibility(
      project,
      shot,
      pano,
      frames,
      { faceSize: 128, columns: 5, rows: 3, cropPaddingFraction: 0.05 },
    ));

    expect(visibility.sourcePanoId).toBe(pano.id);
    expect(visibility.frames[0].sampleCount).toBe(15);
    expect(visibility.frames[0].hitCount).toBeGreaterThan(0);
    expect(visibility.frames[0].visibleFaces.length).toBeGreaterThan(0);
    expect(visibility.frames[0].visibleFaces[0].crop.width).toBeGreaterThan(0);
    expect(visibility.frames[0].visibleFaces[0].cropPath).toBe(cameraMoveCubemapVisibleCropPath(
      'start',
      visibility.frames[0].visibleFaces[0].face,
    ));
  });
});
