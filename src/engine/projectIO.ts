import { LocationProject, PanoReference, SceneObject, Shot } from '../domain/types';
import { normalizeProjectSettings, normalizeProjectWorkflow } from '../domain/defaults';

export function serializeProject(project: LocationProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProject(json: string): LocationProject {
  const parsed = JSON.parse(json) as LocationProject;
  if (parsed.schemaVersion !== '0.1') {
    throw new Error('Unsupported project schema version.');
  }
  if (!parsed.scene || !parsed.assets || !Array.isArray(parsed.shots)) {
    throw new Error('Invalid Continuity Stage project file.');
  }
  return {
    ...parsed,
    scene: {
      ...parsed.scene,
      objects: parsed.scene.objects.map(normalizeSceneObject),
    },
    panoRefs: parsed.panoRefs.map(normalizePanoReference),
    shots: parsed.shots.map(normalizeShot),
    settings: normalizeProjectSettings(parsed.settings),
    workflow: normalizeProjectWorkflow(parsed.workflow),
  };
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

export function downloadProject(project: LocationProject) {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_continuity_stage.json`;
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
