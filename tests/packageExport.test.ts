import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import { setTwoPointCameraKeyframe } from '../src/engine/cameraKeyframes';
import {
  buildMultiShotPackage,
  buildShotPackage,
  countShotPackageUnits,
  PackageExportProgress,
  resolveClayCameraMovePackageSource,
} from '../src/engine/packageExport';
import { renderShotCameraMoveMp4 } from '../src/engine/renderers';

vi.mock('../src/engine/renderers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/renderers')>();
  return {
    ...actual,
    renderShotCameraMoveMp4: vi.fn(actual.renderShotCameraMoveMp4),
  };
});

function withGrayboxAndShot(name = 'Temple') {
  const project = createDefaultProject();
  project.name = name;
  const asset = createPanoAsset({
    name: 'graybox.png',
    uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    width: 4,
    height: 2,
  });
  const pano = createPanoReference({
    name: 'Graybox',
    assetId: asset.id,
    type: 'graybox_render',
    origin: project.scene.panoOrigin,
    width: 4,
    height: 2,
    isCanonical: true,
  });
  project.assets.assets[asset.id] = asset;
  project.panoRefs.push(pano);
  project.workflow.grayboxApprovedForReferenceAt = new Date().toISOString();

  // Disable expensive render paths for unit tests.
  for (const shot of project.shots) {
    shot.exportSettings = {
      ...shot.exportSettings,
      includeViewport: false,
      includeAiResultFrame: false,
      includePanoCrop: false,
      includeFullPano: false,
      includeGrayboxPano: false,
      includeCameraMoveVideo: false,
      includeProjectedCameraMoveVideo: false,
      includeCameraMoveReferenceFrames: false,
      includeProjectedCameraMoveReferenceFrames: false,
      includeProjectedViewport: false,
      includeMetadata: true,
      includePrompt: true,
    };
  }
  return project;
}

async function zipPaths(blob: Blob): Promise<string[]> {
  const buffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files);
}

describe('package export', () => {
  beforeEach(() => {
    vi.mocked(renderShotCameraMoveMp4).mockReset();
    vi.mocked(renderShotCameraMoveMp4).mockImplementation(async () => {
      throw new Error('renderShotCameraMoveMp4 should be mocked in camera-move package tests');
    });
  });

  it('generates camera move MP4 during packaging when keyframes exist without a pre-exported asset', () => {
    const source = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');
    expect(source).toContain('resolveClayCameraMovePackageSource');
    expect(source).toContain('hasRenderableCameraMove(shot.cameraKeyframes)');
    expect(source).toContain('renderShotCameraMoveMp4');
    expect(source).toContain('viewport_clay_motion.mp4');
    expect(source).toContain("resolutionPreset: '1080p'");
    expect(source).toContain("mode: 'render'");
    expect(source).toContain('Legacy fallback only when rerendering is impossible');
    expect(source).not.toContain('getSupportedCameraMoveMp4MimeType');
  });

  it('prefers fresh deterministic clay encode over a stored Quick Preview asset when keyframes exist', () => {
    const project = withGrayboxAndShot();
    const shot = project.shots[0];
    shot.exportSettings = {
      ...shot.exportSettings,
      includeCameraMoveVideo: true,
    };
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: [],
      slot: 'start',
      camera: shot.camera,
      durationSeconds: 2,
    });
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: shot.cameraKeyframes,
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [1, 1.6, 3],
        target: [1, 1.6, 8],
      },
      durationSeconds: 2,
    });

    const legacyId = 'legacy-quick-preview';
    project.assets.assets[legacyId] = {
      id: legacyId,
      type: 'video',
      name: 'legacy_quick_preview.mp4',
      uri: `data:video/mp4;base64,${Buffer.from('LEGACY_QUICK_PREVIEW_BYTES').toString('base64')}`,
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      createdAt: new Date().toISOString(),
      metadata: {
        source: 'graybox_camera_keyframes',
        encodeMode: 'quickPreview',
      },
    };
    shot.assets.cameraMoveVideoAssetId = legacyId;

    expect(resolveClayCameraMovePackageSource(shot, project.assets.assets[legacyId])).toBe('encode');
  });

  it('ignores a stored Quick Preview clay asset and packs a freshly encoded MP4 when keyframes exist', async () => {
    const project = withGrayboxAndShot();
    const shot = project.shots[0];
    shot.exportSettings = {
      ...shot.exportSettings,
      includeCameraMoveVideo: true,
    };
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: [],
      slot: 'start',
      camera: shot.camera,
      durationSeconds: 2,
    });
    shot.cameraKeyframes = setTwoPointCameraKeyframe({
      keyframes: shot.cameraKeyframes,
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [1, 1.6, 3],
        target: [1, 1.6, 8],
      },
      durationSeconds: 2,
    });

    const legacyId = 'legacy-quick-preview';
    project.assets.assets[legacyId] = {
      id: legacyId,
      type: 'video',
      name: 'legacy_quick_preview.mp4',
      uri: `data:video/mp4;base64,${Buffer.from('LEGACY_QUICK_PREVIEW_BYTES').toString('base64')}`,
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      createdAt: new Date().toISOString(),
      metadata: {
        source: 'graybox_camera_keyframes',
        encodeMode: 'quickPreview',
      },
    };
    shot.assets.cameraMoveVideoAssetId = legacyId;

    vi.mocked(renderShotCameraMoveMp4).mockResolvedValue({
      blob: new Blob([Uint8Array.from(Buffer.from('FRESH_DETERMINISTIC_ENCODE'))], { type: 'video/mp4' }),
      width: 1920,
      height: 1080,
      durationSeconds: 2,
      frameRate: 30,
      mimeType: 'video/mp4',
      fileExtension: 'mp4',
      encodeMode: 'render',
      frameCount: 60,
      codecString: 'avc1.640028',
    });

    const result = await buildShotPackage(project, shot);
    expect(renderShotCameraMoveMp4).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderShotCameraMoveMp4).mock.calls[0]?.[2]).toMatchObject({
      mode: 'render',
      appearance: 'clay',
      resolutionPreset: '1080p',
    });
    expect(result.manifestPaths.some((path) => path.includes('viewport_clay_motion.mp4'))).toBe(true);

    // Confirm the packed bytes came from the fresh encode, not the legacy data-URL asset.
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const motionPath = Object.keys(zip.files).find((path) => path.endsWith('viewport_clay_motion.mp4'));
    expect(motionPath).toBeTruthy();
    const packed = new TextDecoder().decode(await zip.file(motionPath!)!.async('uint8array'));
    expect(packed).toContain('FRESH_DETERMINISTIC_ENCODE');
    expect(packed).not.toContain('LEGACY_QUICK_PREVIEW_BYTES');
  });

  it('copies a stored clay asset only when keyframes cannot be re-encoded', () => {
    const project = withGrayboxAndShot();
    const shot = project.shots[0];
    shot.exportSettings = {
      ...shot.exportSettings,
      includeCameraMoveVideo: true,
    };
    shot.cameraKeyframes = [];
    expect(resolveClayCameraMovePackageSource(shot, { uri: 'data:video/mp4;base64,AAA' })).toBe('copy');
    expect(resolveClayCameraMovePackageSource(shot, null)).toBe('skip');
  });

  it('builds a single-shot package zip', async () => {
    const project = withGrayboxAndShot();
    const result = await buildShotPackage(project, project.shots[0]);
    expect(result.fileName).toMatch(/_package\.zip$/);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.manifestPaths.some((path) => path.includes('metadata/shot.json'))).toBe(true);

    const paths = await zipPaths(result.blob);
    expect(paths.some((path) => path.endsWith('manifest.json'))).toBe(true);
    expect(paths.some((path) => path.includes('metadata/shot.json'))).toBe(true);
  });

  it('packs multiple shots into one outer zip download', async () => {
    const project = withGrayboxAndShot('Multi Export');
    const second = {
      ...project.shots[0],
      id: 'shot-test-2',
      shotNumber: '002',
      name: 'Camera 002',
    };
    project.shots.push(second);

    const result = await buildMultiShotPackage(project, project.shots);
    expect(result.fileName).toBe('Multi_Export_2_shots_package.zip');
    expect(result.blob.size).toBeGreaterThan(0);

    const paths = await zipPaths(result.blob);
    const shotFolders = new Set(
      paths
        .map((path) => path.split('/')[0])
        .filter((folder) => folder.startsWith('shot_')),
    );
    expect(shotFolders.size).toBeGreaterThanOrEqual(2);
    expect(paths.filter((path) => path.endsWith('manifest.json')).length).toBeGreaterThanOrEqual(2);
  });

  it('delegates single-shot multi export to the single package path', async () => {
    const project = withGrayboxAndShot();
    const multi = await buildMultiShotPackage(project, [project.shots[0]]);
    const single = await buildShotPackage(project, project.shots[0]);
    expect(multi.fileName).toBe(single.fileName);
  });

  it('emits staged package progress and advances the active shot', async () => {
    const project = withGrayboxAndShot('Progress Export');
    const second = {
      ...project.shots[0],
      id: 'shot-test-2',
      shotNumber: '002',
      name: 'Camera 002',
    };
    project.shots.push(second);

    const events: PackageExportProgress[] = [];
    await buildMultiShotPackage(project, project.shots, {
      onProgress: (progress) => events.push({ ...progress }),
    });

    expect(events.length).toBeGreaterThan(3);
    expect(events[0]?.phase).toBe('preparing');
    expect(events.some((event) => event.phase === 'packaging')).toBe(true);
    expect(events.some((event) => event.phase === 'compressing')).toBe(true);
    expect(events.at(-1)?.phase).toBe('complete');
    expect(events.some((event) => event.currentShot === 1 && event.shotId === project.shots[0].id)).toBe(true);
    expect(events.some((event) => event.currentShot === 2 && event.shotId === second.id)).toBe(true);
    expect(events.at(-1)?.progress).toBe(1);
  });

  it('honours abort during multi-shot package export', async () => {
    const project = withGrayboxAndShot('Cancel Export');
    const second = {
      ...project.shots[0],
      id: 'shot-test-2',
      shotNumber: '002',
      name: 'Camera 002',
    };
    project.shots.push(second);

    const controller = new AbortController();
    controller.abort();
    await expect(
      buildMultiShotPackage(project, project.shots, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('counts at least one package unit per shot', () => {
    const project = withGrayboxAndShot();
    expect(countShotPackageUnits(project, project.shots[0])).toBeGreaterThanOrEqual(1);
  });
});
