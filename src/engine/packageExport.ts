import JSZip from 'jszip';
import { LocationProject, Shot } from '../domain/types';
import { buildShotMetadata, createShotPackageManifest } from './exportManifest';
import { generateImagePrompt, generateVideoPrompt } from './prompts';
import { renderContinuityControlView, renderPanoPerspectiveCrop, renderViewportClay } from './renderers';

export interface ShotPackageResult {
  blob: Blob;
  fileName: string;
  manifestPaths: string[];
}

export async function buildShotPackage(project: LocationProject, shot: Shot): Promise<ShotPackageResult> {
  const zip = new JSZip();
  const manifest = createShotPackageManifest(project, shot);
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const canonicalPano = project.panoRefs.find((pano) => pano.isCanonical);
  const grayboxPano = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const canonicalAsset = canonicalPano ? project.assets.assets[canonicalPano.imageAssetId] : undefined;
  const grayboxAsset = grayboxPano ? project.assets.assets[grayboxPano.imageAssetId] : undefined;
  const linkedPanoAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const aiResultAssetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;

  if (shot.exportSettings.includeViewport) {
    const viewport = await renderViewportClay(project, shot.camera, shot.exportSettings.width, shot.exportSettings.height);
    addDataUrl(zip, `${manifest.rootFolder}/inputs/viewport_clay.png`, viewport.dataUrl);
  }

  if (shot.exportSettings.includeAiResultFrame && aiResultAssetId) {
    const aiResultAsset = project.assets.assets[aiResultAssetId];
    if (aiResultAsset) {
      addDataUrl(zip, `${manifest.rootFolder}/outputs/ai_result_frame.png`, aiResultAsset.uri);
    }
  }

  if (shot.exportSettings.includeContinuityControlView && linkedPano && linkedPanoAsset) {
    const controlView = await renderContinuityControlView(
      project,
      shot.camera,
      linkedPano,
      linkedPanoAsset.uri,
      shot.exportSettings.width,
      shot.exportSettings.height,
    );
    addDataUrl(zip, `${manifest.rootFolder}/inputs/continuity_control_view.png`, controlView.dataUrl);
  }

  if (shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop) {
    if (linkedPanoAsset) {
      const crop = await renderPanoPerspectiveCrop(linkedPanoAsset.uri, shot.panoCrop, linkedPano.rotation);
      addDataUrl(zip, `${manifest.rootFolder}/inputs/pano_crop.png`, crop.dataUrl);
    }
  }

  if (shot.exportSettings.includeFullPano && canonicalAsset) {
    addDataUrl(zip, `${manifest.rootFolder}/inputs/global_reference.png`, canonicalAsset.uri);
  }

  if (shot.exportSettings.includeGrayboxPano && grayboxAsset) {
    addDataUrl(zip, `${manifest.rootFolder}/inputs/global_graybox.png`, grayboxAsset.uri);
  }

  if (shot.exportSettings.includeMetadata) {
    const metadata = buildShotMetadata(project, shot, linkedPano);
    zip.file(`${manifest.rootFolder}/metadata/shot.json`, JSON.stringify(shot, null, 2));
    zip.file(`${manifest.rootFolder}/metadata/camera.json`, JSON.stringify(shot.camera, null, 2));
    zip.file(`${manifest.rootFolder}/metadata/landmarks.json`, JSON.stringify(metadata.landmarks, null, 2));
    zip.file(`${manifest.rootFolder}/metadata/location.json`, JSON.stringify(metadata.project, null, 2));
  }

  if (shot.exportSettings.includePrompt) {
    zip.file(`${manifest.rootFolder}/prompts/image_gen_prompt.txt`, generateImagePrompt(project, shot));
    zip.file(`${manifest.rootFolder}/prompts/video_gen_prompt.txt`, generateVideoPrompt(shot));
    zip.file(`${manifest.rootFolder}/prompts/negative_prompt.txt`, shot.promptOverrides.negativePrompt || '');
  }

  zip.file(`${manifest.rootFolder}/manifest.json`, JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    blob,
    fileName: `${manifest.rootFolder}_package.zip`,
    manifestPaths: manifest.files.map((file) => file.path),
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function addDataUrl(zip: JSZip, path: string, dataUrl: string) {
  const [, payload = ''] = dataUrl.split(',');
  zip.file(path, payload, { base64: true });
}
