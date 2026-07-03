import { LocationProject, PanoReference, Shot } from '../domain/types';
import { getCameraMoveReferenceFrames } from './cameraKeyframes';
import { CAMERA_MOVE_CUBEMAP_FACES, cameraMoveCubemapVisibleStitchedPath, CameraMoveCubemapVisibilityMetadata } from './cameraMoveCubemap';
import { generateImagePrompt, generateVideoPrompt } from './prompts';

export interface ShotPackageManifest {
  rootFolder: string;
  files: Array<{
    path: string;
    kind: 'image' | 'video' | 'json' | 'text';
    required: boolean;
  }>;
}

export const PRIORITY_EXPORT_PATH_MARKERS = ['/outputs/ai_result_frame.png'] as const;

export function selectExportPathPreview(paths: readonly string[], limit: number): string[] {
  if (paths.length <= limit) return [...paths];

  const isPriority = (path: string) => PRIORITY_EXPORT_PATH_MARKERS.some((marker) => path.includes(marker));
  const selected = new Set<string>();

  for (const path of paths) {
    if (isPriority(path)) selected.add(path);
  }
  for (const path of paths) {
    if (selected.size >= limit) break;
    if (!selected.has(path)) selected.add(path);
  }

  return paths.filter((path) => selected.has(path));
}

export function createShotPackageManifest(
  project: LocationProject,
  shot: Shot,
  cameraMoveCubemapVisibility?: CameraMoveCubemapVisibilityMetadata,
): ShotPackageManifest {
  const rootFolder = `shot_${shot.shotNumber}`;
  const canonical = project.panoRefs.find((pano) => pano.isCanonical);
  const graybox = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const aiResultAssetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;
  const cameraMoveReferenceFrames = shot.exportSettings.includeCameraMoveReferenceFrames
    ? getCameraMoveReferenceFrames(shot.cameraKeyframes)
    : [];
  const files: ShotPackageManifest['files'] = [];

  if (shot.exportSettings.includeViewport) {
    files.push({ path: `${rootFolder}/inputs/viewport_clay.png`, kind: 'image', required: true });
  }
  if (shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop) {
    files.push({ path: `${rootFolder}/inputs/pano_crop.png`, kind: 'image', required: true });
  }
  if (shot.exportSettings.includeFullPano && canonical) {
    files.push({ path: `${rootFolder}/inputs/global_reference.png`, kind: 'image', required: true });
  }
  if (shot.exportSettings.includeGrayboxPano && graybox) {
    files.push({ path: `${rootFolder}/inputs/global_graybox.png`, kind: 'image', required: false });
  }
  if (shot.exportSettings.includeAiResultFrame && aiResultAssetId) {
    files.push({ path: `${rootFolder}/outputs/ai_result_frame.png`, kind: 'image', required: false });
  }
  if (shot.exportSettings.includeCameraMoveVideo && shot.assets.cameraMoveVideoAssetId) {
    files.push({ path: `${rootFolder}/inputs/viewport_clay_motion.mp4`, kind: 'video', required: false });
  }
  for (const frame of cameraMoveReferenceFrames) {
    files.push({ path: `${rootFolder}/inputs/camera_move/clay_${frame.id}.png`, kind: 'image', required: false });
  }
  if (linkedPano) {
    if (cameraMoveReferenceFrames.length > 0) {
      for (const face of CAMERA_MOVE_CUBEMAP_FACES) {
        files.push({ path: `${rootFolder}/inputs/camera_move/cubemap/${face}.png`, kind: 'image', required: false });
      }
      files.push({ path: `${rootFolder}/inputs/camera_move/cubemap/cubemap_stitched.png`, kind: 'image', required: false });
      for (const frame of cameraMoveCubemapVisibility?.frames ?? []) {
        if (frame.visibleFaces.length > 0) {
          files.push({ path: `${rootFolder}/${cameraMoveCubemapVisibleStitchedPath(frame.id)}`, kind: 'image', required: false });
        }
      }
    }
  }
  if (shot.exportSettings.includeMetadata) {
    files.push({ path: `${rootFolder}/metadata/shot.json`, kind: 'json', required: true });
    files.push({ path: `${rootFolder}/metadata/camera.json`, kind: 'json', required: true });
    if (shot.cameraKeyframes.length > 0) {
      files.push({ path: `${rootFolder}/metadata/camera_keyframes.json`, kind: 'json', required: false });
    }
    if (cameraMoveReferenceFrames.length > 0) {
      files.push({ path: `${rootFolder}/metadata/camera_move_reference_frames.json`, kind: 'json', required: false });
    }
    if (linkedPano && cameraMoveReferenceFrames.length > 0) {
      files.push({ path: `${rootFolder}/metadata/camera_move_cubemap_visibility.json`, kind: 'json', required: false });
    }
    files.push({ path: `${rootFolder}/metadata/landmarks.json`, kind: 'json', required: true });
    files.push({ path: `${rootFolder}/metadata/location.json`, kind: 'json', required: true });
  }
  if (shot.exportSettings.includePrompt) {
    files.push({ path: `${rootFolder}/prompts/image_gen_prompt.txt`, kind: 'text', required: true });
    files.push({ path: `${rootFolder}/prompts/video_gen_prompt.txt`, kind: 'text', required: true });
    files.push({ path: `${rootFolder}/prompts/negative_prompt.txt`, kind: 'text', required: false });
  }

  return { rootFolder, files };
}

export function buildShotMetadata(project: LocationProject, shot: Shot, linkedPano?: PanoReference) {
  return {
    project: {
      id: project.id,
      name: project.name,
      schemaVersion: project.schemaVersion,
      units: project.units,
    },
    shot,
    linkedPano,
    landmarks: project.landmarks.filter((landmark) => shot.landmarkIds.includes(landmark.id)),
    prompts: {
      image: generateImagePrompt(project, shot),
      video: generateVideoPrompt(shot),
      negative: shot.promptOverrides.negativePrompt || '',
    },
  };
}
