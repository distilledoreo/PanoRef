import { LocationProject, PanoReference, SceneObject, Shot } from '../domain/types';
import { normalizeProjectSettings, normalizeProjectWorkflow } from '../domain/defaults';
import JSZip from 'jszip';
import { MODEL_ASSET_URI_PREFIX } from './importedMesh';
import { deleteModelAsset, getModelAsset, putModelAsset } from './modelAssetStore';

const PROJECT_MANIFEST = 'project.json';

export function serializeProject(project: LocationProject): string {
  return JSON.stringify(withoutOrphanedModelAssets(project), null, 2);
}

export function parseProject(json: string): LocationProject {
  let parsed: LocationProject;
  try {
    parsed = JSON.parse(json) as LocationProject;
  } catch {
    throw new Error('Invalid project file: not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid project file.');
  }
  if (parsed.schemaVersion !== '0.1') {
    throw new Error('Unsupported project schema version.');
  }
  if (!parsed.scene || typeof parsed.scene !== 'object') {
    throw new Error('Invalid project file: missing scene.');
  }
  if (!Array.isArray(parsed.scene.objects)) {
    throw new Error('Invalid project file: scene.objects must be an array.');
  }
  if (!parsed.assets || typeof parsed.assets !== 'object' || !parsed.assets.assets) {
    throw new Error('Invalid project file: missing assets.');
  }
  if (!Array.isArray(parsed.shots)) {
    throw new Error('Invalid project file: shots must be an array.');
  }
  if (!Array.isArray(parsed.panoRefs)) {
    throw new Error('Invalid project file: panoRefs must be an array.');
  }
  try {
    return {
      ...parsed,
      scene: {
        ...parsed.scene,
        objects: parsed.scene.objects.map(normalizeSceneObject),
      },
      panoRefs: parsed.panoRefs.map(normalizePanoReference),
      shots: parsed.shots.map(normalizeShot),
      landmarks: Array.isArray(parsed.landmarks) ? parsed.landmarks : [],
      settings: normalizeProjectSettings(parsed.settings),
      workflow: normalizeProjectWorkflow(parsed.workflow),
    };
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid project file: ${error.message}`
        : 'Invalid project file.',
    );
  }
}

function normalizeSceneObject(object: SceneObject & { projectionStamp?: unknown }): SceneObject {
  const { projectionStamp: _ignored, ...normalized } = object;
  const surfaceStyle = normalized.surfaceStyle === 'solid' || normalized.surfaceStyle === 'checkerboard'
    ? normalized.surfaceStyle
    : normalized.surfaceStyle === 'default'
      ? 'default'
      : undefined;
  return {
    ...normalized,
    surfaceStyle,
    color: normalizeHexColor(normalized.color),
    secondaryColor: normalizeHexColor(normalized.secondaryColor),
  };
}

function normalizeHexColor(value?: string): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return undefined;
}

function normalizePanoReference(pano: PanoReference): PanoReference {
  return {
    ...pano,
    rotation: pano.rotation ?? [0, 0, 0],
  };
}

function normalizeShot(shot: Shot): Shot {
  const legacyExportSettings = shot.exportSettings as Shot['exportSettings'] & {
    includeContinuityControlView?: boolean;
    includeSkinnedFrame?: boolean;
    includeCameraMoveVideo?: boolean;
    includeCameraMoveReferenceFrames?: boolean;
  };
  const legacyAssets = shot.assets as Shot['assets'] & { skinnedFrameAssetId?: string };
  const { includeContinuityControlView: _ignored, includeSkinnedFrame: _ignoredSkinned, ...exportSettings } = legacyExportSettings;
  return {
    ...shot,
    cameraKeyframes: shot.cameraKeyframes ?? [],
    exportSettings: {
      ...exportSettings,
      includeAiResultFrame: legacyExportSettings.includeAiResultFrame ?? legacyExportSettings.includeSkinnedFrame ?? true,
      includeCameraMoveVideo: legacyExportSettings.includeCameraMoveVideo ?? true,
      includeCameraMoveReferenceFrames: legacyExportSettings.includeCameraMoveReferenceFrames ?? true,
    },
    assets: {
      ...shot.assets,
      aiResultFrameAssetId: shot.assets.aiResultFrameAssetId ?? legacyAssets.skinnedFrameAssetId ?? shot.assets.finalBaseFrameAssetId,
    },
  };
}

export async function createProjectPackage(project: LocationProject): Promise<Blob> {
  const portable = structuredClone(withoutOrphanedModelAssets(project));
  const migratedBytes = new Map<string, ArrayBuffer>();
  const legacyPrefix = 'data:application/vnd.panoref.graybox-mesh;base64,';
  for (const asset of Object.values(portable.assets.assets)) {
    if (asset.type !== 'model' || !asset.uri.startsWith(legacyPrefix)) continue;
    const key = `legacy/${portable.id}/${asset.id}`;
    const decoded = atob(asset.uri.slice(legacyPrefix.length));
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
    migratedBytes.set(key, bytes);
    asset.uri = `${MODEL_ASSET_URI_PREFIX}${key}`;
  }
  const binaryAssets = Object.values(portable.assets.assets).filter((asset) => asset.type === 'model' && asset.uri.startsWith(MODEL_ASSET_URI_PREFIX));
  if (binaryAssets.length === 0) return new Blob([serializeProject(portable)], { type: 'application/json' });
  const zip = new JSZip();
  zip.file(PROJECT_MANIFEST, serializeProject(portable));
  for (const asset of binaryAssets) {
    const key = asset.uri.slice(MODEL_ASSET_URI_PREFIX.length);
    const bytes = migratedBytes.get(key) ?? await getModelAsset(key);
    if (!bytes) throw new Error(`Cannot save project: binary model asset ${asset.name} is missing.`);
    zip.file(`model-assets/${encodeURIComponent(key)}.bin`, bytes);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

export async function readProjectFile(file: File): Promise<LocationProject> {
  if (!file.name.toLowerCase().endsWith('.zip') && !file.name.toLowerCase().endsWith('.panoref-project')) return parseProject(await file.text());
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = zip.file(PROJECT_MANIFEST);
  if (!manifest) throw new Error(`Invalid project package: missing ${PROJECT_MANIFEST}.`);
  const project = parseProject(await manifest.async('text'));
  for (const asset of Object.values(project.assets.assets)) {
    if (asset.type !== 'model' || !asset.uri.startsWith(MODEL_ASSET_URI_PREFIX)) continue;
    const key = asset.uri.slice(MODEL_ASSET_URI_PREFIX.length);
    const entry = zip.file(`model-assets/${encodeURIComponent(key)}.bin`);
    if (!entry) throw new Error(`Project package is missing binary model asset ${asset.name}.`);
    const bytes = await entry.async('arraybuffer');
    await putModelAsset(key, bytes);
  }
  return project;
}

export async function downloadProject(project: LocationProject) {
  const blob = await createProjectPackage(project);
  const referenced = new Set(project.scene.objects.map((object) => object.modelAssetId).filter(Boolean));
  await Promise.all(Object.values(project.assets.assets).filter((asset) => asset.type === 'model' && !referenced.has(asset.id) && asset.uri.startsWith(MODEL_ASSET_URI_PREFIX)).map((asset) => deleteModelAsset(asset.uri.slice(MODEL_ASSET_URI_PREFIX.length))));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_continuity_stage.${blob.type === 'application/json' ? 'json' : 'panoref-project'}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function withoutOrphanedModelAssets(project: LocationProject): LocationProject {
  const referencedModelIds = new Set(
    project.scene.objects
      .map((object) => object.modelAssetId)
      .filter((id): id is string => Boolean(id)),
  );
  const assets = Object.fromEntries(
    Object.entries(project.assets.assets).filter(([, asset]) => (
      asset.type !== 'model' || referencedModelIds.has(asset.id)
    )),
  );
  if (Object.keys(assets).length === Object.keys(project.assets.assets).length) return project;
  return {
    ...project,
    assets: { assets },
  };
}
