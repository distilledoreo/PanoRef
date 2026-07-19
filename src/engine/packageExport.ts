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
  renderPanoCubemapFaces,
  renderPanoPerspectiveCrop,
  renderShotCameraMoveMp4,
  renderShotFrame,
  renderShotProjectedFrame,
  renderViewportClay,
  renderViewportProjected,
} from './renderers';

export { downloadBlob };

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

export async function buildShotPackage(project: LocationProject, shot?: Shot): Promise<ShotPackageResult> {
  if (!shot) {
    throw new ShotPackageError('Select a shot before exporting a package.');
  }

  const zip = new JSZip();
  const manifestPaths = await appendShotPackageToZip(zip, project, shot);
  const rootFolder = createShotPackageManifest(project, shot).rootFolder;
  const blob = await zip.generateAsync({ type: 'blob' });
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
): Promise<ShotPackageResult> {
  if (shots.length === 0) {
    throw new ShotPackageError('Select at least one shot before exporting.');
  }
  if (shots.length === 1) {
    return buildShotPackage(project, shots[0]);
  }

  const zip = new JSZip();
  const manifestPaths: string[] = [];
  for (const shot of shots) {
    const paths = await appendShotPackageToZip(zip, project, shot);
    manifestPaths.push(...paths);
  }

  const safeName = (project.name || 'continuity')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || 'continuity';
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    blob,
    fileName: `${safeName}_${shots.length}_shots_package.zip`,
    manifestPaths,
  };
}

async function appendShotPackageToZip(
  zip: JSZip,
  project: LocationProject,
  shot: Shot,
): Promise<string[]> {
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
    const viewport = await renderShotFrame(project, shot);
    addDataUrl(zip, `${rootFolder}/inputs/viewport_clay.png`, viewport.dataUrl);
  }

  // Dual clay + projected when requested and a styled projector exists.
  // Soft-skip projected when no eligible pano so clay-only packages still succeed.
  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(project)) {
    try {
      const projected = await renderShotProjectedFrame(project, shot);
      addDataUrl(zip, `${rootFolder}/inputs/viewport_projected.png`, projected.dataUrl);
    } catch (error) {
      throw new ShotPackageError(
        error instanceof Error
          ? error.message
          : 'Projected viewport export failed. Import a styled panorama or disable projected export.',
      );
    }
  }

  if (shot.exportSettings.includeAiResultFrame && aiResultAssetId) {
    const aiResultAsset = project.assets.assets[aiResultAssetId];
    if (aiResultAsset) {
      addDataUrl(zip, `${rootFolder}/outputs/ai_result_frame.png`, aiResultAsset.uri);
    }
  }

  if (shot.exportSettings.includeCameraMoveVideo) {
    if (cameraMoveVideoAsset?.uri) {
      // Prefer the pre-exported asset from Shots when present.
      addBinaryToZip(zip, `${rootFolder}/inputs/viewport_clay_motion.mp4`, cameraMoveVideoAsset.uri);
    } else if (hasRenderableCameraMove(shot.cameraKeyframes)) {
      // Generate during packaging so keyframed moves still ship without a prior Shots export.
      try {
        const video = await renderShotCameraMoveMp4(project, shot, {
          mode: 'render',
          resolutionPreset: '1080p',
          frameRate: 30,
          appearance: 'clay',
          includeDataUrl: false,
        });
        zip.file(`${rootFolder}/inputs/viewport_clay_motion.mp4`, video.blob);
      } catch (error) {
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
    try {
      const video = await renderShotCameraMoveMp4(project, shot, {
        mode: 'render',
        resolutionPreset: '1080p',
        frameRate: 30,
        appearance: 'projected',
        occlusionFilter: 'fast',
        includeDataUrl: false,
      });
      zip.file(`${rootFolder}/inputs/viewport_projected_motion.mp4`, video.blob);
    } catch (error) {
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
    await ensureHumanMannequinModel();
    for (const frame of cameraMoveReferenceFrames) {
      const clay = await renderViewportClay(
        project,
        frame.camera,
        shot.exportSettings.width,
        shot.exportSettings.height,
      );
      addDataUrl(zip, `${rootFolder}/inputs/camera_move/clay_${frame.id}.png`, clay.dataUrl);
    }
  }

  const projectedMoveFrames = (
    shot.exportSettings.includeProjectedCameraMoveReferenceFrames
    && canUseProjectedAppearance(project)
  )
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  if (projectedMoveFrames.length > 0) {
    for (const frame of projectedMoveFrames) {
      try {
        const projected = await renderViewportProjected(
          project,
          frame.camera,
          shot.exportSettings.width,
          shot.exportSettings.height,
        );
        addDataUrl(zip, `${rootFolder}/inputs/camera_move/projected_${frame.id}.png`, projected.dataUrl);
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
    const cubemap = await renderPanoCubemapFaces(cubemapSourcePano.asset.uri, {
      faceSize: DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE,
      panoRotation: cubemapSourcePano.pano.rotation,
    });
    for (const face of CAMERA_MOVE_CUBEMAP_FACES) {
      addDataUrl(zip, `${rootFolder}/inputs/cubemap/${face}.png`, cubemap.faces[face].dataUrl);
    }
    const stitchedCubemap = await stitchCubemapFacesCrossAsync(cubemap.faces, cubemap.faceSize);
    addDataUrl(zip, `${rootFolder}/inputs/cubemap/cubemap_stitched.png`, stitchedCubemap.dataUrl);
  }

  if (shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop) {
    if (linkedPanoAsset) {
      const crop = await renderPanoPerspectiveCrop(linkedPanoAsset.uri, shot.panoCrop, linkedPano.rotation);
      addDataUrl(zip, `${rootFolder}/inputs/pano_crop.png`, crop.dataUrl);
    }
  }

  if (shot.exportSettings.includeFullPano && canonicalAsset && canonicalPano) {
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
  }

  if (shot.exportSettings.includeGrayboxPano && grayboxAsset && grayboxPano) {
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
  }

  if (shot.exportSettings.includeMetadata) {
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
  }

  if (shot.exportSettings.includePrompt) {
    zip.file(`${rootFolder}/prompts/image_gen_prompt.txt`, generateImagePrompt(project, shot));
    zip.file(`${rootFolder}/prompts/video_gen_prompt.txt`, generateVideoPrompt(shot));
    zip.file(`${rootFolder}/prompts/negative_prompt.txt`, shot.promptOverrides.negativePrompt || '');
  }

  const manifest = createShotPackageManifest(project, shot);
  zip.file(`${rootFolder}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest.files.map((file) => file.path);
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
