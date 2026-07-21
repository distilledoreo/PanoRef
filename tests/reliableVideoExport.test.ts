import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createDefaultProject, createCameraData } from '../src/domain/defaults';
import { DEFAULT_SHOT_NEAR_CLIP_METERS } from '../src/engine/cameraClipping';
import { computeCameraMoveClippingRange } from '../src/engine/exportClipping';
import { createFinalRenderSceneOptions } from '../src/engine/finalRenderProfile';
import {
  analyzeTimestamps,
  evaluateAvcProfileAndLevel,
  isAvcLevelSufficientFor,
  macroblocksForFrame,
  parseAvcCodecString,
} from '../src/engine/mp4Validate';
import { buildScene, disposeScene } from '../src/engine/sceneObjects';
import {
  cameraMoveFrameTimeSeconds,
  computeCameraMoveFrameCount,
  resolveVideoPreset,
  VIDEO_RESOLUTION_PRESETS,
} from '../src/engine/videoPresets';

describe('reliable video export foundations', () => {
  it('uses a final-render profile that disables fog, grid, and editor overlays', () => {
    const project = createDefaultProject();
    const scene = buildScene(project, createFinalRenderSceneOptions());

    expect(scene.fog).toBeNull();
    expect(scene.children.some((child) => child.type === 'GridHelper')).toBe(false);
    expect(scene.children.some((child) => child.name.startsWith('Frustum'))).toBe(false);

    disposeScene(scene);
  });

  it('computes one fixed near/far from all keyframes to scene bounds', () => {
    const project = createDefaultProject();
    project.scene.objects[0].transform.position = [0, 0, 0];
    if (project.scene.objects[1]) {
      project.scene.objects[1].transform.position = [0, 0, 120];
    }
    const scene = buildScene(project, createFinalRenderSceneOptions());

    const start = createCameraData([0, 1.65, 2], [0, 1.65, 0]);
    start.far = 30;
    const end = createCameraData([0, 1.65, -10], [0, 1.65, 120]);
    end.far = 40;
    const clipping = computeCameraMoveClippingRange({
      scene,
      keyframeCameras: [start, end],
    });

    expect(clipping.near).toBe(DEFAULT_SHOT_NEAR_CLIP_METERS);
    expect(clipping.far).toBeGreaterThan(100);
    expect(clipping.far).toBeGreaterThan(clipping.near + 1);

    disposeScene(scene);
  });

  it('does not clip geometry beyond the old 42 m fog horizon', () => {
    const project = createDefaultProject();
    if (project.scene.objects[1]) {
      project.scene.objects[1].transform.position = [0, 0, 80];
    }
    const scene = buildScene(project, createFinalRenderSceneOptions());
    const camera = createCameraData([0, 1.65, 0], [0, 1.65, 80]);
    const clipping = computeCameraMoveClippingRange({
      scene,
      keyframeCameras: [camera],
    });

    expect(scene.fog).toBeNull();
    expect(clipping.far).toBeGreaterThan(80);

    disposeScene(scene);
  });

  it('defaults camera-move video to 1080p30 High Profile Level 4.0', () => {
    const preset = resolveVideoPreset('1080p');
    expect(preset.width).toBe(1920);
    expect(preset.height).toBe(1080);
    expect(preset.frameRate).toBe(30);
    expect(preset.avcCodecString).toBe('avc1.640028');
    expect(VIDEO_RESOLUTION_PRESETS['4k'].avcCodecString).toBe('avc1.640033');
  });

  it('keeps still export defaults at 4K UHD', () => {
    const project = createDefaultProject();
    expect(project.shots[0].exportSettings.width).toBe(3840);
    expect(project.shots[0].exportSettings.height).toBe(2160);
  });

  it('computes fixed-step frame counts and inclusive end-pose sample times', () => {
    expect(computeCameraMoveFrameCount(3, 30)).toBe(90);
    expect(computeCameraMoveFrameCount(1, 30)).toBe(30);
    expect(cameraMoveFrameTimeSeconds(0, 30, 3)).toBe(0);
    expect(cameraMoveFrameTimeSeconds(89, 30, 3)).toBe(3);
    expect(cameraMoveFrameTimeSeconds(45, 30, 3)).toBeCloseTo(45 / 89 * 3, 5);
    expect(cameraMoveFrameTimeSeconds(0, 30, 1)).toBe(0);
    expect(cameraMoveFrameTimeSeconds(29, 30, 1)).toBe(1);
    expect(cameraMoveFrameTimeSeconds(0, 30, 0)).toBe(0);
  });

  it('detects uneven and duplicate timestamps', () => {
    const even = analyzeTimestamps([0, 1 / 30, 2 / 30, 3 / 30]);
    expect(even.timestampsEven).toBe(true);
    expect(even.duplicateTimestamps).toBe(false);
    expect(even.frameCount).toBe(4);

    const uneven = analyzeTimestamps([0, 0.01, 0.2, 0.21]);
    expect(uneven.timestampsEven).toBe(false);

    const dupes = analyzeTimestamps([0, 0.1, 0.1, 0.2]);
    expect(dupes.duplicateTimestamps).toBe(true);
  });

  it('requires High profile and a level sufficient for the encoded frame, not an exact codec string', () => {
    expect(parseAvcCodecString('avc1.640028')).toEqual({
      profileIdc: 0x64,
      constraintFlags: 0x00,
      levelIdc: 0x28,
      raw: 'avc1.640028',
    });
    expect(macroblocksForFrame(1920, 1080)).toBe(120 * 68);
    expect(macroblocksForFrame(3840, 2160)).toBe(240 * 135);
    expect(macroblocksForFrame(320, 180)).toBe(20 * 12);

    // Production 1080p / 4K need their preset levels (or higher).
    expect(isAvcLevelSufficientFor({ levelIdc: 0x28, width: 1920, height: 1080, frameRate: 30 })).toBe(true);
    expect(isAvcLevelSufficientFor({ levelIdc: 0x1e, width: 1920, height: 1080, frameRate: 30 })).toBe(false);
    expect(isAvcLevelSufficientFor({ levelIdc: 0x33, width: 3840, height: 2160, frameRate: 30 })).toBe(true);
    expect(isAvcLevelSufficientFor({ levelIdc: 0x28, width: 3840, height: 2160, frameRate: 30 })).toBe(false);

    // Tiny harness clip: Level 3.0 is enough even when the exporter requested Level 4.0.
    expect(
      evaluateAvcProfileAndLevel({
        codecParam: 'avc1.640c1e',
        presetCodecString: 'avc1.640028',
        width: 320,
        height: 180,
        frameRate: 30,
      }),
    ).toBeUndefined();

    // Same Level 3.0 bitstream is rejected for full 1080p.
    expect(
      evaluateAvcProfileAndLevel({
        codecParam: 'avc1.640c1e',
        presetCodecString: 'avc1.640028',
        width: 1920,
        height: 1080,
        frameRate: 30,
      })?.code,
    ).toBe('profileLevel');

    // Wrong profile fails even when the level would be enough.
    expect(
      evaluateAvcProfileAndLevel({
        codecParam: 'avc1.42E01E',
        presetCodecString: 'avc1.640028',
        width: 320,
        height: 180,
        frameRate: 30,
      })?.code,
    ).toBe('profileLevel');
  });

  it('wires deterministic encode path without silent Render→Quick Preview downgrade', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    expect(source).toContain("mode?: 'render' | 'quickPreview'");
    expect(source).toContain('encodeCanvasFramesToMp4');
    expect(source).toContain('renderShotCameraMoveMp4QuickPreview');
    expect(source).toContain('createFinalRenderSceneOptions');
    expect(source).toContain('computeCameraMoveClippingRange');
    expect(source).toContain("occlusionFilter ?? 'fast'");
    expect(source).toContain('Render MP4 requires WebCodecs H.264');
    expect(source).not.toMatch(/mode\s*=\s*'quickPreview'/);
    expect(source).toContain('includeDataUrl');
  });

  it('uses one shared VBR encoder config for support checks and CanvasSource', () => {
    const source = readFileSync(new URL('../src/engine/videoEncode.ts', import.meta.url), 'utf8');
    expect(source).toContain('buildDeterministicAvcEncodingConfig');
    expect(source).toContain("bitrateMode: 'variable'");
    expect(source).toContain('buildDeterministicVideoEncoderSupportConfig');
    expect(source).not.toContain("bitrateMode: 'constant'");
  });
  it('exposes a fast projected occlusion filter mode in the shader', () => {
    const math = readFileSync(new URL('../src/engine/projectedStyleMath.ts', import.meta.url), 'utf8');
    const materials = readFileSync(new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url), 'utf8');
    expect(math).toContain('float fastMode');
    expect(math).toContain('if (fastMode > 0.5)');
    expect(materials).toContain('projectedOcclusionFastMode');
    expect(materials).toContain("occlusionFilterMode === 'fast'");
  });

  it('builds a visual-regression scene with distant dual-path geometry', () => {
    const project = createDefaultProject();
    const template = project.scene.objects[0];
    project.scene.objects[0].transform.position = [0, 0.7, -4];
    project.scene.objects.push({
      ...template,
      id: 'far-55',
      name: 'Far 55m',
      transform: {
        ...template.transform,
        position: [12, 1, 55],
      },
    });
    project.scene.objects.push({
      ...template,
      id: 'far-100',
      name: 'Far 100m',
      transform: {
        ...template.transform,
        position: [0, 2, 110],
      },
    });

    const scene = buildScene(project, createFinalRenderSceneOptions());
    const start = createCameraData([0, 1.65, 8], [0, 1.65, 0]);
    const end = createCameraData([0, 1.65, -20], [0, 1.65, 110]);
    const clipping = computeCameraMoveClippingRange({
      scene,
      keyframeCameras: [start, end],
    });

    expect(scene.fog).toBeNull();
    expect(clipping.far).toBeGreaterThan(110);
    const bounds = new THREE.Box3().setFromObject(scene);
    expect(bounds.max.z).toBeGreaterThan(100);

    disposeScene(scene);
  });
});
