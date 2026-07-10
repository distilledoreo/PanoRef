export type Vec3 = [number, number, number];
export type Euler = [number, number, number];
export type ProjectVersion = '0.1';

export type SceneObjectType =
  | 'floor'
  | 'wall'
  | 'box'
  | 'arch'
  | 'doorway'
  | 'column'
  | 'stairs'
  | 'tree_blob'
  | 'terrain_mass'
  | 'background_card'
  | 'human_dummy'
  | 'sun_marker'
  | 'imported_model';

export type ImportedModelSourceApplication = 'blender' | 'maya' | 'unreal';

export interface ImportedModelInfo {
  sourceName: string;
  sourceFormat: string;
  sourceKind: 'model' | 'scene';
  sourceApplication?: ImportedModelSourceApplication;
  sourceSceneName?: string;
  vertexCount: number;
  triangleCount: number;
  meshCount: number;
  /** Imported triangles are preserved exactly; only hierarchy/material data is flattened. */
  geometrySimplified: false;
  hierarchyFlattened: true;
  warnings?: string[];
}

export type PanoReferenceType =
  | 'graybox_render'
  | 'ai_global_reference'
  | 'external_reference';

export type ShotStatus =
  | 'planned'
  | 'exported'
  | 'needs_fix'
  | 'approved'
  | 'rejected';

export type Workspace = 'build' | 'reference' | 'shots' | 'export';

export interface Transform {
  position: Vec3;
  rotation: Euler;
  scale: Vec3;
}

/** Visual surface for graybox objects. Checkerboard tiles are 1m × 1m in world space. */
export type ObjectSurfaceStyle = 'default' | 'solid' | 'checkerboard';

export interface SceneObject {
  id: string;
  name: string;
  type: SceneObjectType;
  transform: Transform;
  dimensions: Vec3;
  category: 'architecture' | 'environment' | 'helper' | 'landmark';
  locked: boolean;
  visible: boolean;
  /** @deprecated Prefer surfaceStyle + color. Kept for older project files. */
  materialId?: string;
  /** default = category clay; solid / checkerboard for identity and scale. */
  surfaceStyle?: ObjectSurfaceStyle;
  /** Primary hex color (#rrggbb) for solid and checkerboard light squares. */
  color?: string;
  /** Secondary hex for checkerboard dark squares. */
  secondaryColor?: string;
  /** Canonical texture-free mesh asset used by imported graybox geometry. */
  modelAssetId?: string;
  importedModel?: ImportedModelInfo;
  metadata?: Record<string, unknown>;
}

export interface SceneData {
  worldUp: 'Y';
  objects: SceneObject[];
  panoOrigin: Vec3;
  panoRotation: Euler;
}

export interface PanoReference {
  id: string;
  name: string;
  imageAssetId: string;
  type: PanoReferenceType;
  projection: 'equirectangular';
  origin: Vec3;
  rotation: Euler;
  width: number;
  height: number;
  isCanonical: boolean;
  sourcePanoId?: string;
  notes?: string;
  createdAt: string;
}

export interface Landmark {
  id: string;
  name: string;
  displayName: string;
  position: Vec3;
  linkedObjectId?: string;
  description: string;
  tags: string[];
  promptCritical: boolean;
  visible: boolean;
}

export interface CameraData {
  position: Vec3;
  target: Vec3;
  fovDegrees: number;
  aspectRatio: number;
  near: number;
  far: number;
}

export interface CameraKeyframe {
  id: string;
  label: string;
  timeSeconds: number;
  camera: CameraData;
}

export interface PanoCropSettings {
  panoId: string;
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
  fovDegrees: number;
  aspectRatio: number;
  width: number;
  height: number;
}

export interface ShotExportSettings {
  width: number;
  height: number;
  includeViewport: boolean;
  includeAiResultFrame: boolean;
  includePanoCrop: boolean;
  includeFullPano: boolean;
  includeGrayboxPano: boolean;
  includeCameraMoveVideo: boolean;
  includeCameraMoveReferenceFrames: boolean;
  includeMetadata: boolean;
  includePrompt: boolean;
}

export interface PromptOverrides {
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  notes?: string;
}

export interface ShotAssetRefs {
  viewportRenderAssetId?: string;
  panoCropAssetId?: string;
  finalBaseFrameAssetId?: string;
  aiResultFrameAssetId?: string;
  cameraMoveVideoAssetId?: string;
}

export interface Shot {
  id: string;
  shotNumber: string;
  name: string;
  description: string;
  camera: CameraData;
  cameraKeyframes: CameraKeyframe[];
  linkedPanoId?: string;
  panoCrop?: PanoCropSettings;
  landmarkIds: string[];
  exportSettings: ShotExportSettings;
  promptOverrides: PromptOverrides;
  status: ShotStatus;
  assets: ShotAssetRefs;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAsset {
  id: string;
  type: 'image' | 'video' | 'model' | 'json' | 'text' | 'other';
  name: string;
  uri: string;
  mimeType?: string;
  width?: number;
  height?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AssetRegistry {
  assets: Record<string, ProjectAsset>;
}

export interface ProjectWorkflow {
  grayboxApprovedForReferenceAt?: string;
  referenceAlignmentAcceptedForPanoId?: string;
  shotFramingAcceptedAtByShotId: Record<string, string>;
  aiBriefSentAtByShotId: Record<string, string>;
  finalPackageExportedAtByShotId: Record<string, string>;
}

export interface ProjectSettings {
  defaultShotWidth: number;
  defaultShotHeight: number;
  defaultShotFovDegrees: number;
  defaultCameraLensMm?: number;
  defaultCameraHeightMeters?: number;
  panoGoodMatchMeters: number;
  panoModerateMatchMeters: number;
  panoLetterboxExports169: boolean;
}

export interface LocationProject {
  schemaVersion: ProjectVersion;
  id: string;
  name: string;
  description: string;
  units: 'meters';
  createdAt: string;
  updatedAt: string;
  scene: SceneData;
  panoRefs: PanoReference[];
  landmarks: Landmark[];
  shots: Shot[];
  assets: AssetRegistry;
  settings: ProjectSettings;
  workflow: ProjectWorkflow;
}

export interface PanoViewState {
  yawDegrees: number;
  pitchDegrees: number;
  fovDegrees: number;
}

export interface WarningItem {
  id: string;
  severity: 'info' | 'warning' | 'danger';
  message: string;
}
