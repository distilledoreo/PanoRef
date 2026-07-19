import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import {
  buildMultiShotPackage,
  buildShotPackage,
  countShotPackageUnits,
  PackageExportProgress,
} from '../src/engine/packageExport';

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
      includeCameraMoveReferenceFrames: false,
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
  it('generates camera move MP4 during packaging when keyframes exist without a pre-exported asset', () => {
    const source = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');
    expect(source).toContain('hasRenderableCameraMove(shot.cameraKeyframes)');
    expect(source).toContain('renderShotCameraMoveMp4');
    expect(source).toContain('viewport_clay_motion.mp4');
    expect(source).toContain("resolutionPreset: '1080p'");
    expect(source).toContain("mode: 'render'");
    expect(source).not.toContain('getSupportedCameraMoveMp4MimeType');
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
