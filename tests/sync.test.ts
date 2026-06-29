import { describe, expect, it } from 'vitest';
import {
  cameraFromFlyState,
  cameraForward,
  cameraFromOrbit,
  cameraOrbitFromCamera,
  computeExportFrameLayout,
  createCameraFromPanoView,
  directionToYawPitch,
  flyCameraFromCamera,
  horizontalFlyDirections,
  threeJsDirectionFromYawPitch,
  yawPitchFromThreeJsDirection,
  getPanoCropSettingsForShot,
  getPanoMatchQuality,
  panoYawToThreeJsYawDegrees,
  panoViewFromCamera,
  yawPitchToDirection,
} from '../src/engine/sync';
import { equirectUvToDirection } from '../src/engine/equirect';
import { createDefaultProject } from '../src/domain/defaults';

describe('sync math', () => {
  it('maps equirect vertical orientation with up at the top of the image', () => {
    expect(equirectUvToDirection(0.5, 1)[1]).toBeCloseTo(1, 5);
    expect(equirectUvToDirection(0.5, 0)[1]).toBeCloseTo(-1, 5);
    expect(equirectUvToDirection(0.5, 0.5)).toEqual([0, 0, 1]);
  });

  it('round-trips yaw and pitch through direction vectors', () => {
    const direction = yawPitchToDirection(45, 15);
    const result = directionToYawPitch(direction);
    expect(result.yawDegrees).toBeCloseTo(45, 5);
    expect(result.pitchDegrees).toBeCloseTo(15, 5);
  });

  it('creates a shot camera from a pano view at the pano origin', () => {
    const project = createDefaultProject();
    const pano = {
      id: 'pano_1',
      name: 'Graybox',
      imageAssetId: 'asset_1',
      type: 'graybox_render' as const,
      projection: 'equirectangular' as const,
      origin: project.scene.panoOrigin,
      rotation: [0, 0, 0] as [number, number, number],
      width: 2048,
      height: 1024,
      isCanonical: true,
      createdAt: new Date().toISOString(),
    };
    const camera = createCameraFromPanoView({
      pano,
      yawDegrees: 90,
      pitchDegrees: 0,
      fovDegrees: 60,
      aspectRatio: 16 / 9,
    });
    expect(camera.position).toEqual(project.scene.panoOrigin);
    expect(camera.target[0]).toBeGreaterThan(camera.position[0]);
  });

  it('aligns pano crop yaw with the reference pano view convention', () => {
    const camera = {
      position: [0, 1.6, 0] as [number, number, number],
      target: [0, 1.6, 5] as [number, number, number],
      fovDegrees: 55,
      aspectRatio: 16 / 9,
      near: 0.1,
      far: 100,
    };
    const view = panoViewFromCamera(camera);
    const project = createDefaultProject();
    const pano = {
      id: 'pano_1',
      name: 'Graybox',
      imageAssetId: 'asset_1',
      type: 'graybox_render' as const,
      projection: 'equirectangular' as const,
      origin: project.scene.panoOrigin,
      rotation: [0, 0, 0] as [number, number, number],
      width: 2048,
      height: 1024,
      isCanonical: true,
      createdAt: new Date().toISOString(),
    };
    const crop = getPanoCropSettingsForShot(camera, pano, 1920, 1080);
    expect(crop.yawDegrees).toBeCloseTo(view.yawDegrees, 3);
    expect(crop.pitchDegrees).toBeCloseTo(view.pitchDegrees, 3);
  });

  it('derives pano crop settings from shot camera direction', () => {
    const project = createDefaultProject();
    const pano = {
      id: 'pano_1',
      name: 'Graybox',
      imageAssetId: 'asset_1',
      type: 'graybox_render' as const,
      projection: 'equirectangular' as const,
      origin: project.scene.panoOrigin,
      rotation: [0, 0, 0] as [number, number, number],
      width: 2048,
      height: 1024,
      isCanonical: true,
      createdAt: new Date().toISOString(),
    };
    const crop = getPanoCropSettingsForShot(
      {
        position: [0, 1.6, 0],
        target: [0, 1.6, 5],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
      pano,
      1920,
      1080,
    );
    expect(crop.yawDegrees).toBeCloseTo(0);
    expect(crop.pitchDegrees).toBeCloseTo(0);
    expect(crop.width).toBe(1920);
  });

  it('converts app pano yaw to the Three.js sphere viewer convention', () => {
    const camera = {
      position: [0, 1.6, 0] as [number, number, number],
      target: [-2, 1.6, 10] as [number, number, number],
      fovDegrees: 55,
      aspectRatio: 16 / 9,
      near: 0.1,
      far: 100,
    };
    const project = createDefaultProject();
    const pano = {
      id: 'pano_1',
      name: 'Graybox',
      imageAssetId: 'asset_1',
      type: 'graybox_render' as const,
      projection: 'equirectangular' as const,
      origin: project.scene.panoOrigin,
      rotation: [0, 0, 0] as [number, number, number],
      width: 2048,
      height: 1024,
      isCanonical: true,
      createdAt: new Date().toISOString(),
    };

    const crop = getPanoCropSettingsForShot(camera, pano, 1920, 1080);
    const renderDirection = sampledEquirectDirectionForThreeJsYaw(
      panoYawToThreeJsYawDegrees(crop.yawDegrees),
    );
    const shotDirection = cameraForward(camera);

    expect(renderDirection[0]).toBeCloseTo(shotDirection[0], 5);
    expect(renderDirection[2]).toBeCloseTo(shotDirection[2], 5);
  });

  it('round-trips shot camera through orbit state', () => {
    const original = {
      position: [1.2, 1.55, -4.1] as [number, number, number],
      target: [0.1, 1.45, 3.8] as [number, number, number],
      fovDegrees: 52,
      aspectRatio: 16 / 9,
      near: 0.1,
      far: 100,
    };
    const orbit = cameraOrbitFromCamera(original);
    const restored = cameraFromOrbit(orbit, original.fovDegrees, original.aspectRatio, original.near, original.far);
    expect(restored.position[0]).toBeCloseTo(original.position[0], 4);
    expect(restored.position[1]).toBeCloseTo(original.position[1], 4);
    expect(restored.position[2]).toBeCloseTo(original.position[2], 4);
    expect(restored.target).toEqual(original.target);
  });

  it('aligns fly movement with the Three.js camera yaw convention', () => {
    const { forward, right } = horizontalFlyDirections(0);
    expect(forward[0]).toBeCloseTo(0);
    expect(forward[1]).toBe(0);
    expect(forward[2]).toBeCloseTo(-1);
    expect(right[0]).toBeCloseTo(1);
    expect(right[1]).toBe(0);
    expect(right[2]).toBeCloseTo(0);
  });

  it('round-trips three.js fly yaw and pitch through camera data', () => {
    const fly = {
      position: [1.2, 1.55, -4.1] as [number, number, number],
      yawDegrees: 24,
      pitchDegrees: -8,
    };
    const camera = cameraFromFlyState(fly, 52, 16 / 9);
    const restored = flyCameraFromCamera(camera);
    expect(restored.position).toEqual(fly.position);
    expect(restored.yawDegrees).toBeCloseTo(fly.yawDegrees, 3);
    expect(restored.pitchDegrees).toBeCloseTo(fly.pitchDegrees, 3);
  });

  it('matches three.js forward at yaw zero to negative Z', () => {
    const forward = threeJsDirectionFromYawPitch(0, 0);
    expect(forward[0]).toBeCloseTo(0);
    expect(forward[1]).toBe(0);
    expect(forward[2]).toBeCloseTo(-1);
    const yawPitch = yawPitchFromThreeJsDirection([0, 0, -1]);
    expect(yawPitch.yawDegrees).toBeCloseTo(0);
    expect(yawPitch.pitchDegrees).toBeCloseTo(0);
  });

  it('centers export frame layout inside a wider viewport', () => {
    const frame = computeExportFrameLayout(2000, 900, 16 / 9);
    expect(frame.height).toBe(900);
    expect(frame.width).toBeCloseTo(1600, 0);
    expect(frame.left).toBeCloseTo(200, 0);
  });

  it('derives pano view from a shot camera forward vector', () => {
    const view = panoViewFromCamera({
      position: [0, 1.6, -5],
      target: [0, 1.6, 5],
      fovDegrees: 60,
      aspectRatio: 16 / 9,
      near: 0.1,
      far: 100,
    });
    expect(view.yawDegrees).toBeCloseTo(0, 3);
    expect(view.pitchDegrees).toBeCloseTo(0, 3);
    expect(view.fovDegrees).toBe(60);
  });

  it('classifies pano origin match quality by distance', () => {
    const project = createDefaultProject();
    const pano = {
      id: 'pano_1',
      name: 'Graybox',
      imageAssetId: 'asset_1',
      type: 'graybox_render' as const,
      projection: 'equirectangular' as const,
      origin: [0, 1.6, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      width: 2048,
      height: 1024,
      isCanonical: true,
      createdAt: new Date().toISOString(),
    };
    const match = getPanoMatchQuality(
      {
        position: [5, 1.6, 0],
        target: [5, 1.6, 1],
        fovDegrees: 55,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 100,
      },
      pano,
      project.settings,
    );
    expect(match.quality).toBe('poor');
  });
});

function sampledEquirectDirectionForThreeJsYaw(threeJsYawDegrees: number) {
  const cameraDirection = threeJsDirectionFromYawPitch(threeJsYawDegrees, 0);
  const spherePhi = Math.atan2(cameraDirection[2], cameraDirection[0]);
  const u = ((spherePhi / (Math.PI * 2)) % 1 + 1) % 1;
  return equirectUvToDirection(u, 0.5);
}
