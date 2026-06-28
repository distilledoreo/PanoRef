import { describe, expect, it } from 'vitest';
import {
  createCameraFromPanoView,
  directionToYawPitch,
  getPanoCropSettingsForShot,
  getPanoMatchQuality,
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
