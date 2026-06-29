import { LocationProject, PanoReference, Shot } from '../domain/types';
import { generateImagePrompt, generateVideoPrompt } from './prompts';

export interface ShotPackageManifest {
  rootFolder: string;
  files: Array<{
    path: string;
    kind: 'image' | 'json' | 'text';
    required: boolean;
  }>;
}

export function createShotPackageManifest(project: LocationProject, shot: Shot): ShotPackageManifest {
  const rootFolder = `shot_${shot.shotNumber}`;
  const canonical = project.panoRefs.find((pano) => pano.isCanonical);
  const graybox = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const aiResultAssetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;
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
  if (shot.exportSettings.includeMetadata) {
    files.push({ path: `${rootFolder}/metadata/shot.json`, kind: 'json', required: true });
    files.push({ path: `${rootFolder}/metadata/camera.json`, kind: 'json', required: true });
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
