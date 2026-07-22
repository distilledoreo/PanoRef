from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one occurrence, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


# Domain model: classify scene objects and persist sparse shot overrides.
replace_once(
    'src/domain/types.ts',
    "export interface Transform {\n  position: Vec3;\n  rotation: Euler;\n  scale: Vec3;\n}\n",
    "export interface Transform {\n  position: Vec3;\n  rotation: Euler;\n  scale: Vec3;\n}\n\nexport type StagingRole = 'set' | 'prop' | 'person';\n\nexport interface ShotObjectOverride {\n  transform?: Transform;\n  visible?: boolean;\n}\n\nexport type ShotObjectOverrides = Record<string, ShotObjectOverride>;\n",
)
replace_once(
    'src/domain/types.ts',
    "  locked: boolean;\n  visible: boolean;\n",
    "  locked: boolean;\n  visible: boolean;\n  /** Set geometry is global; props and people may be staged per shot. */\n  stagingRole?: StagingRole;\n",
)
replace_once(
    'src/domain/types.ts',
    "  camera: CameraData;\n  cameraKeyframes: CameraKeyframe[];\n",
    "  camera: CameraData;\n  cameraKeyframes: CameraKeyframe[];\n  /** Sparse transform/visibility differences from the global Build scene. */\n  objectOverrides?: ShotObjectOverrides;\n",
)

# New objects and shots receive explicit defaults.
replace_once(
    'src/domain/defaults.ts',
    "    locked: false,\n    visible: true,\n  };",
    "    locked: false,\n    visible: true,\n    stagingRole: type === 'human_dummy' ? 'person' : 'set',\n  };",
)
replace_once(
    'src/domain/defaults.ts',
    "    camera: params.camera,\n    cameraKeyframes: [],\n",
    "    camera: params.camera,\n    cameraKeyframes: [],\n    objectOverrides: {},\n",
)

# Backward-compatible project normalization.
replace_once(
    'src/engine/projectIO.ts',
    "import { Euler, LocationProject, PanoReference, SceneObject, Shot, Vec3 } from '../domain/types';",
    "import { Euler, LocationProject, PanoReference, SceneObject, Shot, Transform, Vec3 } from '../domain/types';",
)
replace_once(
    'src/engine/projectIO.ts',
    "    ...normalized,\n    surfaceStyle,\n    color: normalizeHexColor(normalized.color),",
    "    ...normalized,\n    stagingRole: normalizeStagingRole(normalized.stagingRole, normalized.type),\n    surfaceStyle,\n    color: normalizeHexColor(normalized.color),",
)
replace_once(
    'src/engine/projectIO.ts',
    "function normalizeHexColor(value?: string): string | undefined {",
    "function normalizeStagingRole(\n  value: unknown,\n  type: SceneObject['type'],\n): SceneObject['stagingRole'] {\n  if (value === 'set' || value === 'prop' || value === 'person') return value;\n  return type === 'human_dummy' ? 'person' : 'set';\n}\n\nfunction normalizeHexColor(value?: string): string | undefined {",
)
replace_once(
    'src/engine/projectIO.ts',
    "    productionShotId: normalizeProductionShotId(shot.productionShotId),\n    cameraKeyframes: shot.cameraKeyframes ?? [],",
    "    productionShotId: normalizeProductionShotId(shot.productionShotId),\n    cameraKeyframes: shot.cameraKeyframes ?? [],\n    objectOverrides: normalizeShotObjectOverrides(shot.objectOverrides),",
)
replace_once(
    'src/engine/projectIO.ts',
    "function normalizeShot(shot: Shot): Shot {",
    "function normalizeTransform(value: unknown): Transform | undefined {\n  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;\n  const candidate = value as Partial<Transform>;\n  return {\n    position: normalizeVec3(candidate.position, [0, 0, 0]),\n    rotation: normalizeEuler(candidate.rotation, [0, 0, 0]),\n    scale: normalizeVec3(candidate.scale, [1, 1, 1]),\n  };\n}\n\nfunction normalizeShotObjectOverrides(value: unknown): NonNullable<Shot['objectOverrides']> {\n  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};\n  const result: NonNullable<Shot['objectOverrides']> = {};\n  for (const [objectId, rawOverride] of Object.entries(value as Record<string, unknown>)) {\n    if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) continue;\n    const candidate = rawOverride as { transform?: unknown; visible?: unknown };\n    const transform = normalizeTransform(candidate.transform);\n    const visible = typeof candidate.visible === 'boolean' ? candidate.visible : undefined;\n    if (!transform && visible === undefined) continue;\n    result[objectId] = {\n      ...(transform ? { transform } : {}),\n      ...(visible !== undefined ? { visible } : {}),\n    };\n  }\n  return result;\n}\n\nfunction normalizeShot(shot: Shot): Shot {",
)

# Pure resolver and mutation helpers used by previews, exports, and the staging UI.
write(
    'src/engine/shotSceneState.ts',
    """import type {
  LocationProject,
  SceneObject,
  Shot,
  ShotObjectOverride,
  ShotObjectOverrides,
  StagingRole,
  Transform,
} from '../domain/types';

export interface ResolveShotSceneOptions {
  hidePeople?: boolean;
}

export function cloneTransform(transform: Transform): Transform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

export function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    a.position.every((value, index) => value === b.position[index])
    && a.rotation.every((value, index) => value === b.rotation[index])
    && a.scale.every((value, index) => value === b.scale[index])
  );
}

export function getSceneObjectStagingRole(
  object: Pick<SceneObject, 'type' | 'stagingRole'>,
): StagingRole {
  if (object.stagingRole === 'set' || object.stagingRole === 'prop' || object.stagingRole === 'person') {
    return object.stagingRole;
  }
  return object.type === 'human_dummy' ? 'person' : 'set';
}

export function canStageObjectPerShot(object: Pick<SceneObject, 'type' | 'stagingRole'>): boolean {
  return getSceneObjectStagingRole(object) !== 'set';
}

export function resolveSceneObjectsForShot(
  project: Pick<LocationProject, 'scene'>,
  shot: Pick<Shot, 'objectOverrides'>,
  options: ResolveShotSceneOptions = {},
): SceneObject[] {
  const overrides = shot.objectOverrides ?? {};
  return project.scene.objects.map((object) => {
    const override = overrides[object.id];
    const stagingRole = getSceneObjectStagingRole(object);
    return {
      ...object,
      stagingRole,
      transform: cloneTransform(override?.transform ?? object.transform),
      visible: options.hidePeople && stagingRole === 'person'
        ? false
        : (override?.visible ?? object.visible),
    };
  });
}

export function resolveProjectForShot(
  project: LocationProject,
  shot: Pick<Shot, 'objectOverrides'>,
  options: ResolveShotSceneOptions = {},
): LocationProject {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: resolveSceneObjectsForShot(project, shot, options),
    },
  };
}

export function updateShotObjectOverrides(
  shot: Pick<Shot, 'objectOverrides'>,
  baseObject: SceneObject,
  patch: ShotObjectOverride,
): ShotObjectOverrides {
  const next: ShotObjectOverride = {
    ...(shot.objectOverrides?.[baseObject.id] ?? {}),
    ...(patch.transform ? { transform: cloneTransform(patch.transform) } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
  };
  const compact = { ...(shot.objectOverrides ?? {}) };
  const transformMatchesBase = !next.transform || transformsEqual(next.transform, baseObject.transform);
  const visibilityMatchesBase = next.visible === undefined || next.visible === baseObject.visible;
  if (transformMatchesBase && visibilityMatchesBase) {
    delete compact[baseObject.id];
  } else {
    compact[baseObject.id] = next;
  }
  return compact;
}

export function clearShotObjectOverride(
  shot: Pick<Shot, 'objectOverrides'>,
  objectId: string,
): ShotObjectOverrides {
  const next = { ...(shot.objectOverrides ?? {}) };
  delete next[objectId];
  return next;
}
""",
)

# All shot-aware render entry points now resolve the sparse scene snapshot first.
replace_once(
    'src/engine/renderers.ts',
    "import { createFinalRenderSceneOptions } from './finalRenderProfile';",
    "import { createFinalRenderSceneOptions } from './finalRenderProfile';\nimport { resolveProjectForShot } from './shotSceneState';",
)
replace_once(
    'src/engine/renderers.ts',
    "export async function renderShotFrame(project: LocationProject, shot: Shot): Promise<ImageRenderResult> {\n  return renderViewportClay(\n    project,",
    "export async function renderShotFrame(project: LocationProject, shot: Shot): Promise<ImageRenderResult> {\n  return renderViewportClay(\n    resolveProjectForShot(project, shot),",
)
replace_once(
    'src/engine/renderers.ts',
    "export async function renderShotCameraMoveMp4(\n  project: LocationProject,\n  shot: Shot,\n  options: CameraMoveVideoOptions = {},\n): Promise<VideoRenderResult> {\n  const keyframes",
    "export async function renderShotCameraMoveMp4(\n  project: LocationProject,\n  shot: Shot,\n  options: CameraMoveVideoOptions = {},\n): Promise<VideoRenderResult> {\n  const shotProject = resolveProjectForShot(project, shot);\n  const keyframes",
)
replace_once(
    'src/engine/renderers.ts',
    "if (appearance === 'projected' && !canUseProjectedAppearance(project))",
    "if (appearance === 'projected' && !canUseProjectedAppearance(shotProject))",
)
replace_once(
    'src/engine/renderers.ts',
    "return renderShotCameraMoveMp4Deterministic(project, shot, {",
    "return renderShotCameraMoveMp4Deterministic(shotProject, shot, {",
)
replace_once(
    'src/engine/renderers.ts',
    "return renderShotCameraMoveMp4QuickPreview(project, shot, {",
    "return renderShotCameraMoveMp4QuickPreview(shotProject, shot, {",
)
replace_once(
    'src/engine/renderers.ts',
    "  return renderViewportProjected(\n    project,\n    shot.camera,",
    "  return renderViewportProjected(\n    resolveProjectForShot(project, shot),\n    shot.camera,",
)

# Package rendering and metadata use the same resolved scene as the viewfinder.
replace_once(
    'src/engine/packageExport.ts',
    "} from './renderers';",
    "} from './renderers';\nimport { resolveProjectForShot } from './shotSceneState';",
)
package_text = read('src/engine/packageExport.ts')
start = package_text.index('async function appendShotPackageToZip(')
end = package_text.index('\nfunction normalizeCameraMoveProgress(', start)
prefix = package_text[:start]
body = package_text[start:end]
suffix = package_text[end:]
body = body.replace(
    "  const { shotIndex, tracker, signal, rootFolder } = args;\n",
    "  const { shotIndex, tracker, signal, rootFolder } = args;\n  const shotProject = resolveProjectForShot(project, shot);\n",
    1,
)
for old, new in [
    ('createShotPackageManifest(project, shot, rootFolder)', 'createShotPackageManifest(shotProject, shot, rootFolder)'),
    ('canUseProjectedAppearance(project)', 'canUseProjectedAppearance(shotProject)'),
    ('renderShotFrame(project, shot)', 'renderShotFrame(shotProject, shot)'),
    ('renderShotProjectedFrame(project, shot)', 'renderShotProjectedFrame(shotProject, shot)'),
    ('renderShotCameraMoveMp4(project, shot, {', 'renderShotCameraMoveMp4(shotProject, shot, {'),
    ('renderViewportClay(\n        project,', 'renderViewportClay(\n        shotProject,'),
    ('renderViewportProjected(\n          project,', 'renderViewportProjected(\n          shotProject,'),
    ('buildShotMetadata(project, shot, linkedPano)', 'buildShotMetadata(shotProject, shot, linkedPano)'),
    ('generateImagePrompt(project, shot)', 'generateImagePrompt(shotProject, shot)'),
    ('createShotPackageManifest(project, shot, resolvedRootFolder)', 'createShotPackageManifest(shotProject, shot, resolvedRootFolder)'),
]:
    if old not in body:
        raise RuntimeError(f'src/engine/packageExport.ts body missing {old!r}')
    body = body.replace(old, new)
write('src/engine/packageExport.ts', prefix + body + suffix)

# New shots inherit the currently selected staging snapshot for continuity.
replace_once(
    'src/state/useContinuityStore.ts',
    "  const state = useContinuityStore.getState();\n  const linkedPano = linkedPanoId",
    "  const state = useContinuityStore.getState();\n  const sourceShot = state.project.shots.find((item) => item.id === state.selectedShotId);\n  const linkedPano = linkedPanoId",
)
replace_once(
    'src/state/useContinuityStore.ts',
    "  if (name) shot.name = name;\n\n  const navigateToShots",
    "  if (name) shot.name = name;\n  shot.objectOverrides = structuredClone(sourceShot?.objectOverrides ?? {});\n\n  const navigateToShots",
)

# Behavioral regression coverage for the pure staging layer.
write(
    'tests/shotSceneState.test.ts',
    """import { describe, expect, it } from 'vitest';
import { createDefaultProject, createSceneObject } from '../src/domain/defaults';
import {
  canStageObjectPerShot,
  clearShotObjectOverride,
  getSceneObjectStagingRole,
  resolveProjectForShot,
  updateShotObjectOverrides,
} from '../src/engine/shotSceneState';

describe('per-shot scene state', () => {
  it('applies sparse transforms without mutating the Build scene', () => {
    const project = createDefaultProject();
    const person = createSceneObject('human_dummy', 1);
    project.scene.objects.push(person);
    const shot = project.shots[0];
    const stagedTransform = {
      ...person.transform,
      position: [4, 0.875, -2] as [number, number, number],
      rotation: [0, 45, 0] as [number, number, number],
    };
    shot.objectOverrides = updateShotObjectOverrides(shot, person, { transform: stagedTransform });

    const resolved = resolveProjectForShot(project, shot);
    const resolvedPerson = resolved.scene.objects.find((object) => object.id === person.id);

    expect(resolvedPerson?.transform.position).toEqual([4, 0.875, -2]);
    expect(resolvedPerson?.transform.rotation).toEqual([0, 45, 0]);
    expect(person.transform.position).not.toEqual([4, 0.875, -2]);
  });

  it('classifies built-in and imported people consistently for clean plates', () => {
    const project = createDefaultProject();
    const mannequin = createSceneObject('human_dummy', 1);
    const importedPerson = createSceneObject('imported_model', 1);
    importedPerson.stagingRole = 'person';
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    project.scene.objects.push(mannequin, importedPerson, prop);

    const resolved = resolveProjectForShot(project, project.shots[0], { hidePeople: true });
    const byId = new Map(resolved.scene.objects.map((object) => [object.id, object]));

    expect(byId.get(mannequin.id)?.visible).toBe(false);
    expect(byId.get(importedPerson.id)?.visible).toBe(false);
    expect(byId.get(prop.id)?.visible).toBe(true);
    expect(getSceneObjectStagingRole(mannequin)).toBe('person');
    expect(canStageObjectPerShot(prop)).toBe(true);
  });

  it('drops redundant overrides and supports reset to base', () => {
    const project = createDefaultProject();
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    const shot = project.shots[0];

    const redundant = updateShotObjectOverrides(shot, prop, {
      transform: prop.transform,
      visible: prop.visible,
    });
    expect(redundant).toEqual({});

    shot.objectOverrides = updateShotObjectOverrides(shot, prop, { visible: false });
    expect(shot.objectOverrides[prop.id]?.visible).toBe(false);
    expect(clearShotObjectOverride(shot, prop.id)).toEqual({});
  });
});
""",
)

print('Applied per-shot staging foundation.')
