import JSZip from 'jszip';
import { LocationProject, Shot } from '../domain/types';
import { getCameraMoveReferenceFrames, hasRenderableCameraMove } from './cameraKeyframes';
import {
  CAMERA_MOVE_CUBEMAP_FACES,
  DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE,
} from './cameraMoveCubemap';
import { buildShotMetadata, createShotPackageManifest } from './exportManifest';
import { generateImagePrompt, generateVideoPrompt } from './prompts';
import { preparePanoExportDataUrl } from './panoImage';
import { stitchCubemapFacesCrossAsync } from './cubemapStitch';
import { ensureHumanMannequinModel } from './humanMannequinModel';
import { downloadBlob } from './projectIO';
import { canUseProjectedAppearance } from './projectedStyle';
import {
  CameraMoveExportProgress,
  renderPanoCubemapFaces,
  renderPanoPerspectiveCrop,
  renderShotCameraMoveMp4,
  renderShotFrame,
  renderShotProjectedFrame,
  renderViewportClay,
  renderViewportProjected,
} from './renderers';

export { downloadBlob };

export type PackageExportPhase =
  | 'preparing'
  | 'rendering'
  | 'encoding'
  | 'packaging'
  | 'compressing'
  | 'complete';

export interface PackageExportProgress {
  phase: PackageExportPhase;
  /** Overall 0–1 when determinate; ignored when `indeterminate` is true. */
  progress: number;
  currentShot: number;
  totalShots: number;
  shotId?: string;
  shotName?: string;
  message: string;
  /** Prefer a moving bar + message when true (e.g. early prep with no reliable %). */
  indeterminate?: boolean;
}

export interface PackageExportOptions {
  onProgress?: (progress: PackageExportProgress) => void;
  signal?: AbortSignal;
}

export interface ShotPackageResult {
  blob: Blob;
  fileName: string;
  manifestPaths: string[];
}

export class ShotPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotPackageError';
  }
}

export function isPackageExportCancelled(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /cancelled/i.test(error.message)) return true;
  return false;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled.', 'AbortError');
  }
}

interface ProgressTracker {
  report(partial: {
    phase: PackageExportPhase;
    message: string;
    shotIndex: number;
    shot?: Shot;
    completedUnits: number;
    unitFraction?: number;
    indeterminate?: boolean;
  }): void;
  advance(units?: number): void;
  readonly completedUnits: number;
  readonly totalUnits: number;
}

function createProgressTracker(args: {
  shots: Shot[];
  totalUnits: number;
  onProgress?: (progress: PackageExportProgress) => void;
}): ProgressTracker {
  let completedUnits = 0;
  const totalUnits = Math.max(1, args.totalUnits);

  const report: ProgressTracker['report'] = (partial) => {
    const unitFraction = Math.min(1, Math.max(0, partial.unitFraction ?? 0));
    const progress = Math.min(1, (partial.completedUnits + unitFraction) / totalUnits);
    args.onProgress?.({
      phase: partial.phase,
      progress: partial.indeterminate ? 0 : progress,
      currentShot: partial.shotIndex + 1,
      totalShots: args.shots.length,
      shotId: partial.shot?.id,
      shotName: partial.shot ? `Shot ${partial.shot.shotNumber}` : undefined,
      message: partial.message,
      indeterminate: partial.indeterminate,
    });
  };

  return {
    get completedUnits() {
      return completedUnits;
    },
    get totalUnits() {
      return totalUnits;
    },
    report,
    advance(units = 1) {
      completedUnits += units;
    },
  };
}

/** Discrete work units for one shot — used to weight multi-shot progress. */
export function countShotPackageUnits(project: LocationProject, shot: Shot): number {
  let units = 0;
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const canonicalPano = project.panoRefs.find((pano) => pano.isCanonical);
  const grayboxPano = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const canonicalAsset = canonicalPano ? project.assets.assets[canonicalPano.imageAssetId] : undefined;
  const grayboxAsset = grayboxPano ? project.assets.assets[grayboxPano.imageAssetId] : undefined;
  const linkedPanoAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const aiResultAssetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;
  const canProject = canUseProjectedAppearance(project);
  const clayMoveFrames = shot.exportSettings.includeCameraMoveReferenceFrames
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  const projectedMoveFrames = (
    shot.exportSettings.includeProjectedCameraMoveReferenceFrames && canProject
  )
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  const hasCubemap = Boolean(
    shot.exportSettings.includeFullPano
    && ((canonicalPano && canonicalAsset) || (linkedPano && linkedPanoAsset)),
  );

  if (shot.exportSettings.includeViewport) units += 1;
  if (shot.exportSettings.includeProjectedViewport && canProject) units += 1;
  if (shot.exportSettings.includeAiResultFrame && aiResultAssetId) units += 1;
  if (shot.exportSettings.includeCameraMoveVideo) {
    if (shot.assets.cameraMoveVideoAssetId || hasRenderableCameraMove(shot.cameraKeyframes)) {
      units += 1;
    }
  }
  if (
    shot.exportSettings.includeProjectedCameraMoveVideo
    && canProject
    && hasRenderableCameraMove(shot.cameraKeyframes)
  ) {
    units += 1;
  }
  units += clayMoveFrames.length;
  units += projectedMoveFrames.length;
  if (hasCubemap) units += CAMERA_MOVE_CUBEMAP_FACES.length + 1; // faces + stitch
  if (shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop && linkedPanoAsset) units += 1;
  if (shot.exportSettings.includeFullPano && canonicalAsset && canonicalPano) units += 1;
  if (shot.exportSettings.includeGrayboxPano && grayboxAsset && grayboxPano) units += 1;
  if (shot.exportSettings.includeMetadata) units += 1;
  if (shot.exportSettings.includePrompt) units += 1;
  units += 1; // manifest
  return Math.max(1, units);
}

export async function buildShotPackage(
  project: LocationProject,
  shot?: Shot,
  options: PackageExportOptions = {},
): Promise<ShotPackageResult> {
  if (!shot) {
    throw new ShotPackageError('Select a shot before exporting a package.');
  }

  throwIfAborted(options.signal);
  const totalUnits = countShotPackageUnits(project, shot) + 1; // + compress
  const tracker = createProgressTracker({
    shots: [shot],
    totalUnits,
    onProgress: options.onProgress,
  });

  tracker.report({
    phase: 'preparing',
    message: 'Preparing package…',
    shotIndex: 0,
    shot,
    completedUnits: tracker.completedUnits,
    indeterminate: true,
  });

  const zip = new JSZip();
  const manifestPaths = await appendShotPackageToZip(zip, project, shot, {
    shotIndex: 0,
    tracker,
    signal: options.signal,
  });
  const rootFolder = createShotPackageManifest(project, shot).rootFolder;
  const blob = await compressZip(zip, {
    tracker,
    shotIndex: 0,
    shot,
    signal: options.signal,
  });

  tracker.report({
    phase: 'complete',
    message: 'Package ready',
    shotIndex: 0,
    shot,
    completedUnits: tracker.totalUnits,
  });

  return {
    blob,
    fileName: `${rootFolder}_package.zip`,
    manifestPaths,
  };
}

/**
 * Single download for multiple shots — one outer ZIP with each shot folder inside.
 * Avoids browser multi-download blocking that hits sequential per-shot downloads.
 */
export async function buildMultiShotPackage(
  project: LocationProject,
  shots: Shot[],
  options: PackageExportOptions = {},
): Promise<ShotPackageResult> {
  if (shots.length === 0) {
    throw new ShotPackageError('Select at least one shot before exporting.');
  }
  if (shots.length === 1) {
    return buildShotPackage(project, shots[0], options);
  }

  throwIfAborted(options.signal);
  const shotUnits = shots.reduce((sum, shot) => sum + countShotPackageUnits(project, shot), 0);
  const tracker = createProgressTracker({
    shots,
    totalUnits: shotUnits + 1,
    onProgress: options.onProgress,
  });

  tracker.report({
    phase: 'preparing',
    message: 'Preparing multi-shot package…',
    shotIndex: 0,
    shot: shots[0],
    completedUnits: 0,
    indeterminate: true,
  });

  const zip = new JSZip();
  const manifestPaths: string[] = [];
  for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
    const shot = shots[shotIndex];
    throwIfAborted(options.signal);
    const paths = await appendShotPackageToZip(zip, project, shot, {
      shotIndex,
      tracker,
      signal: options.signal,
    });
    manifestPaths.push(...paths);
  }

  const safeName = (project.name || 'continuity')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || 'continuity';
  const blob = await compressZip(zip, {
    tracker,
    shotIndex: shots.length - 1,
    shot: shots[shots.length - 1],
    signal: options.signal,
  });

  tracker.report({
    phase: 'complete',
    message: 'Package ready',
    shotIndex: shots.length - 1,
    shot: shots[shots.length - 1],
    completedUnits: tracker.totalUnits,
  });

  return {
    blob,
    fileName: `${safeName}_${shots.length}_shots_package.zip`,
    manifestPaths,
  };
}

async function compressZip(
  zip: JSZip,
  args: {
    tracker: ProgressTracker;
    shotIndex: number;
    shot?: Shot;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  throwIfAborted(args.signal);
  args.tracker.report({
    phase: 'compressing',
    message: 'Compressing ZIP…',
    shotIndex: args.shotIndex,
    shot: args.shot,
    completedUnits: args.tracker.completedUnits,
    indeterminate: true,
  });

  const blob = await zip.generateAsync(
    { type: 'blob' },
    (metadata) => {
      if (args.signal?.aborted) return;
      const fraction = Math.min(1, Math.max(0, (metadata.percent ?? 0) / 100));
      args.tracker.report({
        phase: 'compressing',
        message: fraction > 0 ? `Compressing ZIP… ${Math.round(fraction * 100)}%` : 'Compressing ZIP…',
        shotIndex: args.shotIndex,
        shot: args.shot,
        completedUnits: args.tracker.completedUnits,
        unitFraction: fraction,
        indeterminate: fraction <= 0,
      });
    },
  );

  throwIfAborted(args.signal);
  args.tracker.advance(1);
  return blob;
}

async function appendShotPackageToZip(
  zip: JSZip,
  project: LocationProject,
  shot: Shot,
  args: {
    shotIndex: number;
    tracker: ProgressTracker;
    signal?: AbortSignal;
  },
): Promise<string[]> {
  const { shotIndex, tracker, signal } = args;
  const emit = (
    phase: PackageExportPhase,
    message: string,
    extras?: { unitFraction?: number; indeterminate?: boolean },
  ) => {
    tracker.report({
      phase,
      message,
      shotIndex,
      shot,
      completedUnits: tracker.completedUnits,
      unitFraction: extras?.unitFraction,
      indeterminate: extras?.indeterminate,
    });
  };
  const finishUnit = (phase: PackageExportPhase, message: string) => {
    tracker.advance(1);
    emit(phase, message);
  };

  throwIfAborted(signal);
  emit('preparing', `Preparing Shot ${shot.shotNumber}…`, { indeterminate: true });

  const manifestPreview = createShotPackageManifest(project, shot);
  const rootFolder = manifestPreview.rootFolder;
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const canonicalPano = project.panoRefs.find((pano) => pano.isCanonical);
  const grayboxPano = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const canonicalAsset = canonicalPano ? project.assets.assets[canonicalPano.imageAssetId] : undefined;
  const grayboxAsset = grayboxPano ? project.assets.assets[grayboxPano.imageAssetId] : undefined;
  const linkedPanoAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const aiResultAssetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;
  const cameraMoveVideoAsset = shot.assets.cameraMoveVideoAssetId
    ? project.assets.assets[shot.assets.cameraMoveVideoAssetId]
    : undefined;

  if (shot.exportSettings.includeViewport) {
    throwIfAborted(signal);
    emit('rendering', 'Rendering clay viewport…', { indeterminate: true });
    const viewport = await renderShotFrame(project, shot);
    addDataUrl(zip, `${rootFolder}/inputs/viewport_clay.png`, viewport.dataUrl);
    finishUnit('rendering', 'Clay viewport ready');
  }

  // Dual clay + projected when requested and a styled projector exists.
  // Soft-skip projected when no eligible pano so clay-only packages still succeed.
  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(project)) {
    throwIfAborted(signal);
    emit('rendering', 'Rendering projected viewport…', { indeterminate: true });
    try {
      const projected = await renderShotProjectedFrame(project, shot);
      addDataUrl(zip, `${rootFolder}/inputs/viewport_projected.png`, projected.dataUrl);
      finishUnit('rendering', 'Projected viewport ready');
    } catch (error) {
      throw new ShotPackageError(
        error instanceof Error
          ? error.message
          : 'Projected viewport export failed. Import a styled panorama or disable projected export.',
      );
    }
  }

  if (shot.exportSettings.includeAiResultFrame && aiResultAssetId) {
    throwIfAborted(signal);
    const aiResultAsset = project.assets.assets[aiResultAssetId];
    if (aiResultAsset) {
      emit('packaging', 'Adding AI result frame…');
      addDataUrl(zip, `${rootFolder}/outputs/ai_result_frame.png`, aiResultAsset.uri);
      finishUnit('packaging', 'AI result frame added');
    }
  }

  if (shot.exportSettings.includeCameraMoveVideo) {
    if (cameraMoveVideoAsset?.uri) {
      throwIfAborted(signal);
      emit('packaging', 'Adding clay camera-move video…');
      addBinaryToZip(zip, `${rootFolder}/inputs/viewport_clay_motion.mp4`, cameraMoveVideoAsset.uri);
      finishUnit('packaging', 'Clay camera-move video added');
    } else if (hasRenderableCameraMove(shot.cameraKeyframes)) {
      throwIfAborted(signal);
      emit('encoding', 'Encoding clay camera move…', { indeterminate: true });
      try {
        const video = await renderShotCameraMoveMp4(project, shot, {
          mode: 'render',
          resolutionPreset: '1080p',
          frameRate: 30,
          appearance: 'clay',
          includeDataUrl: false,
          signal,
          onProgress: (progress) => {
            const info = normalizeCameraMoveProgress(progress);
            emit('encoding', info.message || 'Encoding clay camera move…', {
              unitFraction: info.progress,
            });
          },
        });
        zip.file(`${rootFolder}/inputs/viewport_clay_motion.mp4`, video.blob);
        finishUnit('encoding', 'Clay camera-move video ready');
      } catch (error) {
        if (isPackageExportCancelled(error)) throw error;
        throw new ShotPackageError(
          error instanceof Error
            ? error.message
            : 'Camera move MP4 export failed. Try Chrome or Edge, or disable “Camera move MP4” in export settings.',
        );
      }
    }
  }

  if (
    shot.exportSettings.includeProjectedCameraMoveVideo
    && canUseProjectedAppearance(project)
    && hasRenderableCameraMove(shot.cameraKeyframes)
  ) {
    throwIfAborted(signal);
    emit('encoding', 'Encoding projected camera move…', { indeterminate: true });
    try {
      const video = await renderShotCameraMoveMp4(project, shot, {
        mode: 'render',
        resolutionPreset: '1080p',
        frameRate: 30,
        appearance: 'projected',
        occlusionFilter: 'fast',
        includeDataUrl: false,
        signal,
        onProgress: (progress) => {
          const info = normalizeCameraMoveProgress(progress);
          emit('encoding', info.message || 'Encoding projected camera move…', {
            unitFraction: info.progress,
          });
        },
      });
      zip.file(`${rootFolder}/inputs/viewport_projected_motion.mp4`, video.blob);
      finishUnit('encoding', 'Projected camera-move video ready');
    } catch (error) {
      if (isPackageExportCancelled(error)) throw error;
      throw new ShotPackageError(
        error instanceof Error
          ? error.message
          : 'Projected camera-move MP4 failed. Import a styled panorama or disable projected motion.',
      );
    }
  }

  const cameraMoveReferenceFrames = shot.exportSettings.includeCameraMoveReferenceFrames
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  if (cameraMoveReferenceFrames.length > 0) {
    throwIfAborted(signal);
    emit('preparing', 'Loading figure model…', { indeterminate: true });
    await ensureHumanMannequinModel();
    for (let index = 0; index < cameraMoveReferenceFrames.length; index += 1) {
      throwIfAborted(signal);
      const frame = cameraMoveReferenceFrames[index];
      emit(
        'rendering',
        `Rendering clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length}…`,
        { unitFraction: 0, indeterminate: true },
      );
      const clay = await renderViewportClay(
        project,
        frame.camera,
        shot.exportSettings.width,
        shot.exportSettings.height,
      );
      addDataUrl(zip, `${rootFolder}/inputs/camera_move/clay_${frame.id}.png`, clay.dataUrl);
      finishUnit(
        'rendering',
        `Clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length} ready`,
      );
    }
  }

  const projectedMoveFrames = (
    shot.exportSettings.includeProjectedCameraMoveReferenceFrames
    && canUseProjectedAppearance(project)
  )
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  if (projectedMoveFrames.length > 0) {
    for (let index = 0; index < projectedMoveFrames.length; index += 1) {
      throwIfAborted(signal);
      const frame = projectedMoveFrames[index];
      emit(
        'rendering',
        `Rendering projected reference frame ${index + 1} of ${projectedMoveFrames.length}…`,
        { indeterminate: true },
      );
      try {
        const projected = await renderViewportProjected(
          project,
          frame.camera,
          shot.exportSettings.width,
          shot.exportSettings.height,
        );
        addDataUrl(zip, `${rootFolder}/inputs/camera_move/projected_${frame.id}.png`, projected.dataUrl);
        finishUnit(
          'rendering',
          `Projected reference frame ${index + 1} of ${projectedMoveFrames.length} ready`,
        );
      } catch (error) {
        throw new ShotPackageError(
          error instanceof Error
            ? error.message
            : 'Projected camera-move frames failed. Disable projected move frames or import a styled panorama.',
        );
      }
    }
  }

  // Full cubemap ships with full-pano exports (canonical preferred, else linked).
  const cubemapSourcePano = (shot.exportSettings.includeFullPano && canonicalPano && canonicalAsset)
    ? { pano: canonicalPano, asset: canonicalAsset }
    : (shot.exportSettings.includeFullPano && linkedPano && linkedPanoAsset)
      ? { pano: linkedPano, asset: linkedPanoAsset }
      : undefined;
  if (cubemapSourcePano) {
    throwIfAborted(signal);
    emit('rendering', 'Rendering cubemap faces…', { indeterminate: true });
    const cubemap = await renderPanoCubemapFaces(cubemapSourcePano.asset.uri, {
      faceSize: DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE,
      panoRotation: cubemapSourcePano.pano.rotation,
    });
    for (let faceIndex = 0; faceIndex < CAMERA_MOVE_CUBEMAP_FACES.length; faceIndex += 1) {
      throwIfAborted(signal);
      const face = CAMERA_MOVE_CUBEMAP_FACES[faceIndex];
      addDataUrl(zip, `${rootFolder}/inputs/cubemap/${face}.png`, cubemap.faces[face].dataUrl);
      finishUnit(
        'rendering',
        `Cubemap face ${faceIndex + 1} of ${CAMERA_MOVE_CUBEMAP_FACES.length}`,
      );
    }
    emit('packaging', 'Stitching cubemap…', { indeterminate: true });
    const stitchedCubemap = await stitchCubemapFacesCrossAsync(cubemap.faces, cubemap.faceSize);
    addDataUrl(zip, `${rootFolder}/inputs/cubemap/cubemap_stitched.png`, stitchedCubemap.dataUrl);
    finishUnit('packaging', 'Cubemap stitch ready');
  }

  if (shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop) {
    if (linkedPanoAsset) {
      throwIfAborted(signal);
      emit('rendering', 'Rendering pano crop…', { indeterminate: true });
      const crop = await renderPanoPerspectiveCrop(linkedPanoAsset.uri, shot.panoCrop, linkedPano.rotation);
      addDataUrl(zip, `${rootFolder}/inputs/pano_crop.png`, crop.dataUrl);
      finishUnit('rendering', 'Pano crop ready');
    }
  }

  if (shot.exportSettings.includeFullPano && canonicalAsset && canonicalPano) {
    throwIfAborted(signal);
    emit('packaging', 'Preparing styled reference panorama…', { indeterminate: true });
    const exportUrl = await preparePanoExportDataUrl(
      canonicalAsset.uri,
      canonicalPano.width,
      canonicalPano.height,
      {
        letterboxEnabled: project.settings.panoLetterboxExports169,
        targetWidth: project.settings.defaultShotWidth,
        targetHeight: project.settings.defaultShotHeight,
      },
    );
    addDataUrl(zip, `${rootFolder}/inputs/global_reference.png`, exportUrl);
    finishUnit('packaging', 'Styled reference panorama added');
  }

  if (shot.exportSettings.includeGrayboxPano && grayboxAsset && grayboxPano) {
    throwIfAborted(signal);
    emit('packaging', 'Preparing graybox panorama…', { indeterminate: true });
    const exportUrl = await preparePanoExportDataUrl(
      grayboxAsset.uri,
      grayboxPano.width,
      grayboxPano.height,
      {
        letterboxEnabled: project.settings.panoLetterboxExports169,
        targetWidth: project.settings.defaultShotWidth,
        targetHeight: project.settings.defaultShotHeight,
      },
    );
    addDataUrl(zip, `${rootFolder}/inputs/global_graybox.png`, exportUrl);
    finishUnit('packaging', 'Graybox panorama added');
  }

  if (shot.exportSettings.includeMetadata) {
    throwIfAborted(signal);
    emit('packaging', 'Writing metadata…');
    const metadata = buildShotMetadata(project, shot, linkedPano);
    zip.file(`${rootFolder}/metadata/shot.json`, JSON.stringify(shot, null, 2));
    zip.file(`${rootFolder}/metadata/camera.json`, JSON.stringify(shot.camera, null, 2));
    if (shot.cameraKeyframes.length > 0) {
      zip.file(`${rootFolder}/metadata/camera_keyframes.json`, JSON.stringify(shot.cameraKeyframes, null, 2));
    }
    if (cameraMoveReferenceFrames.length > 0) {
      zip.file(`${rootFolder}/metadata/camera_move_reference_frames.json`, JSON.stringify(cameraMoveReferenceFrames, null, 2));
    }
    zip.file(`${rootFolder}/metadata/landmarks.json`, JSON.stringify(metadata.landmarks, null, 2));
    zip.file(`${rootFolder}/metadata/location.json`, JSON.stringify(metadata.project, null, 2));
    finishUnit('packaging', 'Metadata written');
  }

  if (shot.exportSettings.includePrompt) {
    throwIfAborted(signal);
    emit('packaging', 'Writing prompts…');
    zip.file(`${rootFolder}/prompts/image_gen_prompt.txt`, generateImagePrompt(project, shot));
    zip.file(`${rootFolder}/prompts/video_gen_prompt.txt`, generateVideoPrompt(shot));
    zip.file(`${rootFolder}/prompts/negative_prompt.txt`, shot.promptOverrides.negativePrompt || '');
    finishUnit('packaging', 'Prompts written');
  }

  throwIfAborted(signal);
  emit('packaging', 'Writing manifest…');
  const manifest = createShotPackageManifest(project, shot);
  zip.file(`${rootFolder}/manifest.json`, JSON.stringify(manifest, null, 2));
  finishUnit('packaging', `Shot ${shot.shotNumber} packaged`);
  return manifest.files.map((file) => file.path);
}

function normalizeCameraMoveProgress(
  progress: number | CameraMoveExportProgress,
): { progress: number; message: string } {
  if (typeof progress === 'number') {
    return {
      progress: Math.min(1, Math.max(0, progress)),
      message: 'Encoding camera move…',
    };
  }
  return {
    progress: Math.min(1, Math.max(0, progress.progress)),
    message: progress.message || 'Encoding camera move…',
  };
}

function addDataUrl(zip: JSZip, path: string, dataUrl: string) {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  zip.file(path, payload, { base64: /;base64/i.test(dataUrl.slice(0, Math.max(0, comma))) });
}

/** Add a data URL or opaque URI payload to the zip (data URLs are written as binary). */
function addBinaryToZip(zip: JSZip, path: string, uri: string) {
  if (uri.startsWith('data:')) {
    addDataUrl(zip, path, uri);
    return;
  }
  // Non-data URIs are unexpected for in-app video assets; store as text so the path exists.
  zip.file(path, uri);
}
