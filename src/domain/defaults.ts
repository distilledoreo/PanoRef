import {
  CameraData,
  CameraKeyframe,
  Landmark,
  LocationProject,
  PanoCropSettings,
  PanoReference,
  ProjectAsset,
  ProjectionAlignment,
  ProjectionRegion,
  ProjectionRegionAlignment,
  ProjectionRegionVertexPair,
  ProjectionControlPair,
  SceneObject,
  SceneObjectType,
  ProjectedStyleSettings,
  ProjectSettings,
  ProjectWorkflow,
  Shot,
  ShotExportSettings,
  Transform,
  Vec2,
  Vec3,
} from './types';
import { createId } from '../utils/ids';

const nowIso = () => new Date().toISOString();

const primitiveDefaults: Record<SceneObjectType, { dimensions: Vec3; category: SceneObject['category'] }> = {
  floor: { dimensions: [12, 0.08, 12], category: 'architecture' },
  wall: { dimensions: [6, 3, 0.18], category: 'architecture' },
  box: { dimensions: [1.4, 1.4, 1.4], category: 'architecture' },
  arch: { dimensions: [3, 3.4, 0.35], category: 'architecture' },
  doorway: { dimensions: [2, 2.8, 0.25], category: 'architecture' },
  column: { dimensions: [0.6, 3, 0.6], category: 'architecture' },
  stairs: { dimensions: [2.8, 1.2, 2.4], category: 'architecture' },
  tree_blob: { dimensions: [1.8, 3.2, 1.8], category: 'environment' },
  terrain_mass: { dimensions: [3.5, 0.8, 2.4], category: 'environment' },
  background_card: { dimensions: [8, 4, 0.08], category: 'environment' },
  human_dummy: { dimensions: [0.55, 1.75, 0.55], category: 'helper' },
  sun_marker: { dimensions: [0.8, 0.8, 0.8], category: 'helper' },
  imported_model: { dimensions: [1, 1, 1], category: 'architecture' },
};

export const DEFAULT_CAMERA_LENS_MM = 35;
export const DEFAULT_CAMERA_FOV_DEGREES = 54.4;
export const DEFAULT_CAMERA_HEIGHT_METERS = 1.65;
export const DEFAULT_CAMERA_ASPECT_RATIO = 16 / 9;
/** 4K equirectangular (2:1) — graybox / canonical 360 panoramas. */
export const DEFAULT_GRAYBOX_PANO_WIDTH = 4096;
export const DEFAULT_GRAYBOX_PANO_HEIGHT = 2048;
/** 4K UHD 16:9 — shot stills, camera-move video, letterboxed pano exports. */
export const DEFAULT_SHOT_WIDTH = 3840;
export const DEFAULT_SHOT_HEIGHT = 2160;

export const defaultProjectedStyleSettings: ProjectedStyleSettings = {
  opacity: 1,
  exposure: 1,
  lightingContribution: 0,
  fallbackMode: 'clay',
  blendMode: 'primary_only',
};

export const defaultProjectSettings = {
  defaultShotWidth: DEFAULT_SHOT_WIDTH,
  defaultShotHeight: DEFAULT_SHOT_HEIGHT,
  defaultShotFovDegrees: DEFAULT_CAMERA_FOV_DEGREES,
  defaultCameraLensMm: DEFAULT_CAMERA_LENS_MM,
  defaultCameraHeightMeters: DEFAULT_CAMERA_HEIGHT_METERS,
  panoGoodMatchMeters: 1.5,
  panoModerateMatchMeters: 4,
  panoLetterboxExports169: true,
  projectedStyle: { ...defaultProjectedStyleSettings },
} satisfies ProjectSettings;

export const defaultProjectWorkflow: ProjectWorkflow = {
  shotFramingAcceptedAtByShotId: {},
  aiBriefSentAtByShotId: {},
  finalPackageExportedAtByShotId: {},
};

export function normalizeProjectWorkflow(workflow?: Partial<ProjectWorkflow>): ProjectWorkflow {
  return {
    grayboxApprovedForReferenceAt: workflow?.grayboxApprovedForReferenceAt,
    referenceAlignmentAcceptedForPanoId: workflow?.referenceAlignmentAcceptedForPanoId,
    shotFramingAcceptedAtByShotId: { ...workflow?.shotFramingAcceptedAtByShotId },
    aiBriefSentAtByShotId: { ...workflow?.aiBriefSentAtByShotId },
    finalPackageExportedAtByShotId: { ...workflow?.finalPackageExportedAtByShotId },
  };
}

export function normalizeProjectedStyleSettings(
  settings?: Partial<ProjectedStyleSettings> | null,
): ProjectedStyleSettings {
  const opacity = Number(settings?.opacity);
  const exposure = Number(settings?.exposure);
  const lightingContribution = Number(settings?.lightingContribution);
  const blendModes = new Set(['primary_only', 'secondary_only', 'primary_dominant', 'secondary_dominant']);
  const blendMode = settings?.blendMode && blendModes.has(settings.blendMode)
    ? settings.blendMode
    : defaultProjectedStyleSettings.blendMode;
  const panoId = typeof settings?.panoId === 'string' && settings.panoId.length > 0
    ? settings.panoId
    : undefined;
  let secondaryPanoId = typeof settings?.secondaryPanoId === 'string' && settings.secondaryPanoId.length > 0
    ? settings.secondaryPanoId
    : undefined;
  if (secondaryPanoId && panoId && secondaryPanoId === panoId) {
    secondaryPanoId = undefined;
  }
  return {
    panoId,
    secondaryPanoId,
    blendMode,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : defaultProjectedStyleSettings.opacity,
    exposure: Number.isFinite(exposure) ? Math.min(4, Math.max(0.25, exposure)) : defaultProjectedStyleSettings.exposure,
    lightingContribution: Number.isFinite(lightingContribution)
      ? Math.min(1, Math.max(0, lightingContribution))
      : defaultProjectedStyleSettings.lightingContribution,
    fallbackMode: settings?.fallbackMode === 'neutral' ? 'neutral' : 'clay',
    alignments: normalizeProjectionAlignments(settings?.alignments),
    regionAlignments: normalizeProjectionRegionAlignments(settings?.regionAlignments),
  };
}

// --- Projection Alignment ---

function isValidVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && Number.isFinite(v[0]) && typeof v[1] === 'number' && Number.isFinite(v[1]);
}

function clampUvCoord(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wrapU(value: number): number {
  return ((value % 1) + 1) % 1;
}

function normalizeRegionVertex(raw: unknown): ProjectionRegionVertexPair | null {
  if (!raw || typeof raw !== 'object') return null;
  const vertex = raw as Partial<ProjectionRegionVertexPair>;
  if (typeof vertex.id !== 'string' || vertex.id.length === 0) return null;
  if (!isValidVec2(vertex.targetUv) || !isValidVec2(vertex.sourceUv)) return null;
  return {
    id: vertex.id,
    targetUv: [wrapU(vertex.targetUv[0]), clampUvCoord(vertex.targetUv[1])],
    sourceUv: [wrapU(vertex.sourceUv[0]), clampUvCoord(vertex.sourceUv[1])],
  };
}

export const MAX_REGION_EDGE_SOFTNESS = 0.25;

export function normalizeProjectionRegion(region: unknown, fallbackOrder = 0): ProjectionRegion | null {
  if (!region || typeof region !== 'object') return null;
  const raw = region as Partial<ProjectionRegion>;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || !Array.isArray(raw.vertices)) return null;
  const vertices = raw.vertices.map(normalizeRegionVertex).filter((vertex): vertex is ProjectionRegionVertexPair => Boolean(vertex));
  const order = Number(raw.order);
  const softness = Number(raw.edgeSoftness);
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Region',
    order: Number.isFinite(order) ? order : fallbackOrder,
    enabled: raw.enabled !== false,
    vertices,
    edgeSoftness: Number.isFinite(softness) ? Math.min(MAX_REGION_EDGE_SOFTNESS, Math.max(0, softness)) : 0.03,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function normalizeProjectionRegionAlignment(alignment: unknown): ProjectionRegionAlignment | null {
  if (!alignment || typeof alignment !== 'object') return null;
  const raw = alignment as Partial<ProjectionRegionAlignment>;
  if (raw.version !== 1 || raw.method !== 'paired-mask-region-v1') return null;
  if (typeof raw.sourcePanoId !== 'string' || !raw.sourcePanoId || typeof raw.targetGrayboxPanoId !== 'string' || !raw.targetGrayboxPanoId) return null;
  if (!Array.isArray(raw.regions)) return null;
  const regions = raw.regions
    .map((region, index) => normalizeProjectionRegion(region, index))
    .filter((region): region is ProjectionRegion => Boolean(region))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((region, order) => ({ ...region, order }));
  const strength = Number(raw.strength);
  return {
    version: 1,
    method: 'paired-mask-region-v1',
    sourcePanoId: raw.sourcePanoId,
    targetGrayboxPanoId: raw.targetGrayboxPanoId,
    regions,
    strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function normalizeProjectionRegionAlignments(value: unknown): ProjectionRegionAlignment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const bySource = new Map<string, ProjectionRegionAlignment>();
  for (const raw of value) {
    const alignment = normalizeProjectionRegionAlignment(raw);
    if (alignment) bySource.set(alignment.sourcePanoId, alignment);
  }
  const result = [...bySource.values()];
  return result.length ? result : undefined;
}

export function findProjectionRegionAlignmentForPano(settings: ProjectedStyleSettings, sourcePanoId: string): ProjectionRegionAlignment | undefined {
  return settings.regionAlignments?.find((alignment) => alignment.sourcePanoId === sourcePanoId);
}

export function setProjectionRegionAlignmentForPano(settings: ProjectedStyleSettings, sourcePanoId: string, alignment: ProjectionRegionAlignment | undefined): ProjectedStyleSettings {
  const others = (settings.regionAlignments ?? []).filter((item) => item.sourcePanoId !== sourcePanoId);
  const regionAlignments = alignment ? [...others, alignment] : others;
  return { ...settings, regionAlignments: regionAlignments.length ? regionAlignments : undefined };
}

export function createProjectionRegionVertexPair(targetUv: Vec2, sourceUv: Vec2 = targetUv, id = createId('region-vertex')): ProjectionRegionVertexPair {
  return { id, targetUv: [...targetUv], sourceUv: [...sourceUv] };
}

export function createProjectionRegion(vertices: ProjectionRegionVertexPair[], name = 'Region'): ProjectionRegion {
  const timestamp = nowIso();
  return { id: createId('projection-region'), name, order: 0, enabled: true, vertices, edgeSoftness: 0.03, createdAt: timestamp, updatedAt: timestamp };
}

export function createProjectionRegionAlignment(sourcePanoId: string, targetGrayboxPanoId: string, regions: ProjectionRegion[] = []): ProjectionRegionAlignment {
  return { version: 1, method: 'paired-mask-region-v1', sourcePanoId, targetGrayboxPanoId, regions, strength: 1, updatedAt: nowIso() };
}

function normalizePair(
  pair: Partial<ProjectionControlPair> | undefined | null,
): ProjectionControlPair | null {
  if (!pair) return null;
  if (typeof pair.id !== 'string' || pair.id.length === 0) return null;
  if (!isValidVec2(pair.targetUv)) return null;
  if (!isValidVec2(pair.sourceUv)) return null;
  return {
    id: pair.id,
    order: typeof pair.order === 'number' && Number.isFinite(pair.order) ? pair.order : 0,
    targetUv: [clampUvCoord(pair.targetUv[0]), clampUvCoord(pair.targetUv[1])],
    sourceUv: [clampUvCoord(pair.sourceUv[0]), clampUvCoord(pair.sourceUv[1])],
    enabled: pair.enabled !== false,
  };
}

function normalizeAlignment(
  alignment: Partial<ProjectionAlignment> | undefined | null,
): ProjectionAlignment | null {
  if (!alignment) return null;
  if (alignment.version !== 1) return null;
  if (alignment.solver !== 'spherical-rbf-v1') return null;
  if (typeof alignment.sourcePanoId !== 'string' || alignment.sourcePanoId.length === 0) return null;
  if (typeof alignment.targetGrayboxPanoId !== 'string' || alignment.targetGrayboxPanoId.length === 0) return null;
  if (!Array.isArray(alignment.pairs)) return null;

  const pairs: ProjectionControlPair[] = [];
  for (const raw of alignment.pairs) {
    const p = normalizePair(raw);
    if (p) pairs.push(p);
  }

  if (pairs.length === 0) return null;

  const strength = typeof alignment.strength === 'number' && Number.isFinite(alignment.strength)
    ? Math.min(1, Math.max(0, alignment.strength))
    : 1;

  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: alignment.sourcePanoId,
    targetGrayboxPanoId: alignment.targetGrayboxPanoId,
    pairs,
    strength,
    updatedAt: typeof alignment.updatedAt === 'string' ? alignment.updatedAt : '',
  };
}

export function normalizeProjectionAlignments(
  alignments: unknown,
): ProjectionAlignment[] | undefined {
  if (!Array.isArray(alignments) || alignments.length === 0) return undefined;
  const dedup = new Map<string, ProjectionAlignment>();
  for (const raw of alignments) {
    const normalized = normalizeAlignment(raw);
    if (normalized) dedup.set(normalized.sourcePanoId, normalized);
  }
  const result = Array.from(dedup.values());
  return result.length > 0 ? result : undefined;
}

export function findProjectionAlignmentForPano(
  settings: ProjectedStyleSettings,
  sourcePanoId: string,
): ProjectionAlignment | undefined {
  if (!settings.alignments) return undefined;
  return settings.alignments.find((a) => a.sourcePanoId === sourcePanoId);
}

export function setProjectionAlignmentForPano(
  settings: ProjectedStyleSettings,
  sourcePanoId: string,
  alignment: ProjectionAlignment | undefined,
): ProjectedStyleSettings {
  const current = settings.alignments ?? [];
  let next: ProjectionAlignment[];
  if (!alignment) {
    next = current.filter((a) => a.sourcePanoId !== sourcePanoId);
  } else {
    const filtered = current.filter((a) => a.sourcePanoId !== sourcePanoId);
    next = [...filtered, alignment];
  }
  return {
    ...settings,
    alignments: next.length > 0 ? next : undefined,
  };
}

let pairCounter = 0;
export function resetPairCounterForTests(): void {
  pairCounter = 0;
}

export function createProjectionControlPair(params: {
  targetUv: Vec2;
  sourceUv: Vec2;
  id?: string;
  order?: number;
  enabled?: boolean;
}): ProjectionControlPair {
  const id = params.id ?? `pair-${Date.now()}-${++pairCounter}`;
  return {
    id,
    order: params.order ?? 0,
    targetUv: params.targetUv,
    sourceUv: params.sourceUv,
    enabled: params.enabled ?? true,
  };
}

export function createProjectionAlignment(
  sourcePanoId: string,
  targetGrayboxPanoId: string,
  pairs: ProjectionControlPair[],
): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId,
    targetGrayboxPanoId,
    pairs,
    strength: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function updateProjectionAlignmentPairs(
  alignment: ProjectionAlignment,
  pairs: ProjectionControlPair[],
): ProjectionAlignment {
  return {
    ...alignment,
    pairs,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeProjectSettings(settings?: Partial<ProjectSettings>): ProjectSettings {
  return {
    ...defaultProjectSettings,
    ...settings,
    panoLetterboxExports169: settings?.panoLetterboxExports169 ?? defaultProjectSettings.panoLetterboxExports169,
    projectedStyle: normalizeProjectedStyleSettings(
      settings?.projectedStyle ?? defaultProjectSettings.projectedStyle,
    ),
  };
}

export const defaultShotExportSettings: ShotExportSettings = {
  width: DEFAULT_SHOT_WIDTH,
  height: DEFAULT_SHOT_HEIGHT,
  includeViewport: true,
  /** Include projected stills alongside clay when a styled pano is available. */
  includeProjectedViewport: true,
  includeProjectedCameraMoveReferenceFrames: true,
  includeProjectedCameraMoveVideo: true,
  includeAiResultFrame: true,
  includePanoCrop: true,
  includeFullPano: true,
  includeGrayboxPano: true,
  includeCameraMoveVideo: true,
  includeCameraMoveReferenceFrames: true,
  includeMetadata: true,
  includePrompt: true,
};

export function createTransform(position: Vec3 = [0, 0, 0]): Transform {
  return {
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

export function createSceneObject(type: SceneObjectType, index = 1, position?: Vec3): SceneObject {
  const defaults = primitiveDefaults[type];
  const object: SceneObject = {
    id: createId('obj'),
    name: `${objectDisplayName(type)} ${index}`,
    type,
    transform: createTransform(position ?? defaultPositionForType(type, index)),
    dimensions: defaults.dimensions,
    category: defaults.category,
    locked: false,
    visible: true,
  };

  if (type === 'wall') object.transform.position = [0, 1.5, 5];
  if (type === 'background_card') object.transform.position = [0, 2, 6.5];
  if (type === 'sun_marker') object.transform.position = [3.5, 5, -2.5];
  if (type === 'human_dummy') object.transform.position = [-1.25, 0.875, 0.9];
  return object;
}

export function objectDisplayName(type: SceneObjectType): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function defaultPositionForType(type: SceneObjectType, index: number): Vec3 {
  if (type === 'floor') return [0, 0, 0];
  const column = (index % 5) - 2;
  const row = Math.floor(index / 5);
  return [column * 1.6, 0.7, row * 1.4 - 1.4];
}

export function createLandmark(index: number, position: Vec3 = [0, 1.2, 0]): Landmark {
  return {
    id: createId('landmark'),
    name: `landmark_${index}`,
    displayName: `Landmark ${index}`,
    position,
    description: '',
    tags: [],
    promptCritical: true,
    visible: true,
  };
}

export function createCameraData(position: Vec3, target: Vec3, fovDegrees = 55): CameraData {
  return {
    position,
    target,
    fovDegrees,
    aspectRatio: 16 / 9,
    near: 0.1,
    far: 100,
  };
}

export function createOriginShot(
  project: Pick<LocationProject, 'scene' | 'settings'>,
  index = 1,
): Shot {
  const origin = project.scene.panoOrigin;
  const camera = createCameraData(
    [...origin],
    [origin[0], origin[1], origin[2] + 10],
    project.settings.defaultShotFovDegrees,
  );
  camera.aspectRatio = DEFAULT_CAMERA_ASPECT_RATIO;
  const shot = createShot({ index, camera });
  shot.name = `Camera ${String(index).padStart(3, '0')}`;
  return shot;
}

export function createShot(params: {
  index: number;
  camera: CameraData;
  linkedPanoId?: string;
  panoCrop?: PanoCropSettings;
}): Shot {
  const shotNumber = String(params.index).padStart(3, '0');
  const now = nowIso();
  return {
    id: createId('shot'),
    shotNumber,
    name: `Shot ${shotNumber}`,
    description: '',
    camera: params.camera,
    cameraKeyframes: [],
    linkedPanoId: params.linkedPanoId,
    panoCrop: params.panoCrop,
    landmarkIds: [],
    exportSettings: { ...defaultShotExportSettings },
    promptOverrides: {},
    status: 'planned',
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createPanoAsset(params: {
  name: string;
  uri: string;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
}): ProjectAsset {
  return {
    id: createId('asset'),
    type: 'image',
    name: params.name,
    uri: params.uri,
    mimeType: 'image/png',
    width: params.width,
    height: params.height,
    createdAt: nowIso(),
    metadata: params.metadata,
  };
}

export function createVideoAsset(params: {
  name: string;
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
}): ProjectAsset {
  return {
    id: createId('asset'),
    type: 'video',
    name: params.name,
    uri: params.uri,
    mimeType: params.mimeType,
    width: params.width,
    height: params.height,
    createdAt: nowIso(),
    metadata: params.metadata,
  };
}

export function createCameraKeyframe(params: {
  label: string;
  timeSeconds: number;
  camera: CameraData;
}): CameraKeyframe {
  return {
    id: createId('keyframe'),
    label: params.label,
    timeSeconds: params.timeSeconds,
    camera: cloneCamera(params.camera),
  };
}

export function createPanoReference(params: {
  name: string;
  assetId: string;
  type: PanoReference['type'];
  origin: Vec3;
  rotation?: Vec3;
  width: number;
  height: number;
  isCanonical?: boolean;
  sourcePanoId?: string;
  notes?: string;
}): PanoReference {
  return {
    id: createId('pano'),
    name: params.name,
    imageAssetId: params.assetId,
    type: params.type,
    projection: 'equirectangular',
    origin: params.origin,
    rotation: params.rotation ?? [0, 0, 0],
    width: params.width,
    height: params.height,
    isCanonical: params.isCanonical ?? false,
    sourcePanoId: params.sourcePanoId,
    notes: params.notes,
    createdAt: nowIso(),
  };
}

function cloneCamera(camera: CameraData): CameraData {
  return {
    position: [...camera.position],
    target: [...camera.target],
    fovDegrees: camera.fovDegrees,
    aspectRatio: camera.aspectRatio,
    near: camera.near,
    far: camera.far,
  };
}

export function createDefaultProject(): LocationProject {
  const now = nowIso();
  const starterObjects = [
    createSceneObject('floor', 1),
    createSceneObject('wall', 1),
    createSceneObject('arch', 1, [0, 1.7, 4.95]),
    createSceneObject('column', 1, [-3.4, 1.5, 3.8]),
    createSceneObject('column', 2, [3.4, 1.5, 3.8]),
    createSceneObject('wall', 2),
    createSceneObject('wall', 3),
    createSceneObject('human_dummy', 1),
    createSceneObject('sun_marker', 1),
  ];

  starterObjects[0].name = 'Ground Slab';
  starterObjects[0].locked = true;
  starterObjects[1].name = 'Main Temple Wall';
  starterObjects[1].dimensions = [5.4, 2.8, 0.2];
  starterObjects[2].name = 'Main Temple Gate';
  starterObjects[2].dimensions = [3.2, 3.2, 0.38];
  starterObjects[5].name = 'Left Courtyard Wall';
  starterObjects[5].dimensions = [3.2, 2.3, 0.18];
  starterObjects[5].transform.position = [-5.4, 1.15, 2.4];
  starterObjects[5].transform.rotation = [0, 36, 0];
  starterObjects[6].name = 'Right Courtyard Wall';
  starterObjects[6].dimensions = [3.2, 2.3, 0.18];
  starterObjects[6].transform.position = [5.4, 1.15, 2.4];
  starterObjects[6].transform.rotation = [0, -36, 0];
  starterObjects[7].name = 'Man Facing Camera';
  starterObjects[7].transform.position = [-1.2, 0.875, 0.85];

  const settings = { ...defaultProjectSettings };
  const scene = {
    worldUp: 'Y' as const,
    objects: starterObjects,
    panoOrigin: [0, DEFAULT_CAMERA_HEIGHT_METERS, 0] as Vec3,
    panoRotation: [0, 0, 0] as Vec3,
  };

  return {
    schemaVersion: '0.1',
    id: createId('project'),
    name: 'Untitled Location',
    description: '',
    units: 'meters',
    createdAt: now,
    updatedAt: now,
    scene,
    panoRefs: [],
    landmarks: [
      {
        ...createLandmark(1, [0, 1.8, 4.95]),
        name: 'main_temple_gate',
        displayName: 'Main Temple Gate',
        description: 'Central architectural anchor visible straight ahead in the wide shot.',
      },
      {
        ...createLandmark(2, [-1.2, 1.1, 0.85]),
        name: 'man_facing_camera',
        displayName: 'Man Facing Camera',
        description: 'Foreground human scale figure that should face the camera.',
      },
    ],
    shots: [createOriginShot({ scene, settings })],
    assets: { assets: {} },
    settings,
    workflow: { ...defaultProjectWorkflow },
  };
}
