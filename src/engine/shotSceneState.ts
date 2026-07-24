import type {
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

export function canStageObjectPerShot(object: Pick<SceneObject, 'type' | 'stagingRole' | 'locked'>): boolean {
  if (object.locked) return false;
  // Sun markers are helpers, not shot dressing.
  if (object.type === 'sun_marker') return false;
  return true;
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
