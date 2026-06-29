import * as THREE from 'three';
import { createSceneObject, objectDisplayName } from '../domain/defaults';
import { SceneObject, SceneObjectType, Vec3 } from '../domain/types';
import { createId } from '../utils/ids';

export const BUILD_GRID_SIZE = 0.5;
export const STAMP_FLOOR_TILE_DIMENSIONS: Vec3 = [4, 0.08, 4];

const UP_FACING_THRESHOLD = 0.35;

export function snapBuildPoint(point: Vec3, enabled: boolean, gridSize = BUILD_GRID_SIZE): Vec3 {
  if (!enabled) return [...point] as Vec3;
  return [
    roundToGrid(point[0], gridSize),
    point[1],
    roundToGrid(point[2], gridSize),
  ];
}

export function createPlacedSceneObject(params: {
  type: SceneObjectType;
  index: number;
  point: Vec3;
  snapToGrid: boolean;
}): SceneObject {
  const object = createSceneObject(params.type, params.index);
  const placed: SceneObject = params.type === 'floor'
    ? { ...object, dimensions: STAMP_FLOOR_TILE_DIMENSIONS }
    : object;

  return {
    ...placed,
    transform: {
      ...placed.transform,
      position: getGroundPlacementPosition(placed, params.point, params.snapToGrid),
    },
  };
}

export function resolveStampPoint(
  raycaster: THREE.Raycaster,
  options: {
    snapToGrid: boolean;
    scene?: THREE.Scene | null;
  },
): Vec3 | undefined {
  if (options.scene) {
    const hits = raycaster.intersectObjects(options.scene.children, true);
    for (const hit of hits) {
      if (!isStampSurfaceHit(hit)) continue;
      const snapped = snapBuildPoint([hit.point.x, 0, hit.point.z], options.snapToGrid);
      return [snapped[0], 0, snapped[2]];
    }
  }

  const planeHit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  if (!raycaster.ray.intersectPlane(plane, planeHit)) return undefined;

  const snapped = snapBuildPoint(planeHit.toArray() as Vec3, options.snapToGrid);
  return [snapped[0], 0, snapped[2]];
}

export function getGroundPlacementPosition(
  object: SceneObject,
  point: Vec3,
  snapToGrid: boolean,
): Vec3 {
  const snapped = snapBuildPoint(point, snapToGrid);
  const groundY = object.dimensions[1] / 2;
  return [snapped[0], groundY, snapped[2]];
}

export function duplicateSceneObject(
  object: SceneObject,
  index: number,
  snapToGrid: boolean,
): SceneObject {
  const position = snapBuildPoint([
    object.transform.position[0] + 0.75,
    object.transform.position[1],
    object.transform.position[2] + 0.75,
  ], snapToGrid);

  return {
    ...object,
    id: createId('obj'),
    name: `${objectDisplayName(object.type)} ${index}`,
    transform: {
      ...object.transform,
      position,
      rotation: [...object.transform.rotation] as Vec3,
      scale: [...object.transform.scale] as Vec3,
    },
    dimensions: [...object.dimensions] as Vec3,
    locked: false,
    visible: true,
    metadata: object.metadata ? { ...object.metadata } : undefined,
  };
}

function roundToGrid(value: number, gridSize: number) {
  if (!Number.isFinite(value) || gridSize <= 0) return value;
  return Number((Math.round(value / gridSize) * gridSize).toFixed(3));
}

function isStampSurfaceHit(hit: THREE.Intersection): boolean {
  if (hit.object.userData.previewObject) return false;

  let current: THREE.Object3D | null = hit.object;
  while (current) {
    if (current.userData.panoOrigin === true) return false;
    current = current.parent;
  }

  if (hit.object instanceof THREE.Line || hit.object instanceof THREE.LineSegments) return false;
  if (typeof hit.object.name === 'string' && hit.object.name.startsWith('Frustum ')) return false;
  if (!hit.face) return false;

  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  return normal.y >= UP_FACING_THRESHOLD;
}
