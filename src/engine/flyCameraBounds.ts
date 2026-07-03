import { SceneData, SceneObject, SceneObjectType, Vec3 } from '../domain/types';
import { clamp } from './sync';

export interface FlyCameraBounds {
  min: Vec3;
  max: Vec3;
}

const DEFAULT_MARGIN: Vec3 = [2.5, 1.75, 2.5];
const FALLBACK_HALF_EXTENT: Vec3 = [8, 3.5, 8];
const MIN_EYE_HEIGHT_METERS = 0.45;
const FRONT_BLOCKER_STANDOFF_METERS = 0.3;
const CENTER_CORRIDOR_HALF_WIDTH_METERS = 2;

const EXCLUDED_BOUND_TYPES = new Set<SceneObjectType>(['sun_marker']);
const FLOOR_TYPES = new Set<SceneObjectType>(['floor', 'terrain_mass']);
const FRONT_BLOCKER_TYPES = new Set<SceneObjectType>(['wall', 'arch', 'doorway', 'background_card']);

interface ObjectExtents {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function objectExtents(object: SceneObject): ObjectExtents {
  const [px, py, pz] = object.transform.position;
  const halfWidth = object.dimensions[0] / 2;
  const halfHeight = object.dimensions[1] / 2;
  const halfDepth = object.dimensions[2] / 2;
  return {
    minX: px - halfWidth,
    minY: py - halfHeight,
    minZ: pz - halfDepth,
    maxX: px + halfWidth,
    maxY: py + halfHeight,
    maxZ: pz + halfDepth,
  };
}

function isQualifyingObject(object: SceneObject): boolean {
  return object.visible && !EXCLUDED_BOUND_TYPES.has(object.type);
}

function isFrontBlocker(object: SceneObject, originX: number, originZ: number): boolean {
  if (!FRONT_BLOCKER_TYPES.has(object.type)) return false;
  const { minX, maxX, minZ } = objectExtents(object);
  if (minZ <= originZ) return false;
  const corridorMinX = originX - CENTER_CORRIDOR_HALF_WIDTH_METERS;
  const corridorMaxX = originX + CENTER_CORRIDOR_HALF_WIDTH_METERS;
  return maxX >= corridorMinX && minX <= corridorMaxX;
}

function expandVerticalBounds(
  minY: number,
  maxY: number,
  extents: ObjectExtents,
): [number, number] {
  return [
    Math.min(minY, extents.minY),
    Math.max(maxY, extents.maxY),
  ];
}

export function computeSceneFlyBounds(
  scene: SceneData,
  options?: {
    margin?: Vec3;
    fallbackHalfExtent?: Vec3;
  },
): FlyCameraBounds {
  const margin = options?.margin ?? DEFAULT_MARGIN;
  const fallbackHalf = options?.fallbackHalfExtent ?? FALLBACK_HALF_EXTENT;
  const [originX, originY, originZ] = scene.panoOrigin;

  const qualifyingObjects = scene.objects.filter(isQualifyingObject);
  if (qualifyingObjects.length === 0) {
    return {
      min: [
        originX - fallbackHalf[0],
        Math.max(originY - fallbackHalf[1], MIN_EYE_HEIGHT_METERS),
        originZ - fallbackHalf[2],
      ],
      max: [
        originX + fallbackHalf[0],
        originY + fallbackHalf[1],
        originZ + fallbackHalf[2],
      ],
    };
  }

  const floors = qualifyingObjects.filter((object) => FLOOR_TYPES.has(object.type));
  const stageObjects = qualifyingObjects.filter((object) => !FLOOR_TYPES.has(object.type));

  let minY = originY;
  let maxY = originY;
  for (const object of stageObjects) {
    [minY, maxY] = expandVerticalBounds(minY, maxY, objectExtents(object));
  }

  let minX: number;
  let maxX: number;
  let minZ: number;
  let maxZ: number;

  if (floors.length > 0) {
    let floorMinX = Infinity;
    let floorMinZ = Infinity;
    let floorMaxX = -Infinity;
    let floorMaxZ = -Infinity;

    for (const floor of floors) {
      const extents = objectExtents(floor);
      floorMinX = Math.min(floorMinX, extents.minX);
      floorMinZ = Math.min(floorMinZ, extents.minZ);
      floorMaxX = Math.max(floorMaxX, extents.maxX);
      floorMaxZ = Math.max(floorMaxZ, extents.maxZ);
    }

    minX = floorMinX + margin[0];
    maxX = floorMaxX - margin[0];
    minZ = floorMinZ + margin[2];
    maxZ = floorMaxZ;
  } else {
    let stageMinX = originX;
    let stageMinZ = originZ;
    let stageMaxX = originX;
    let stageMaxZ = originZ;

    for (const object of stageObjects) {
      const extents = objectExtents(object);
      stageMinX = Math.min(stageMinX, extents.minX);
      stageMinZ = Math.min(stageMinZ, extents.minZ);
      stageMaxX = Math.max(stageMaxX, extents.maxX);
      stageMaxZ = Math.max(stageMaxZ, extents.maxZ);
    }

    minX = stageMinX + margin[0];
    maxX = stageMaxX - margin[0];
    minZ = stageMinZ + margin[2];
    maxZ = stageMaxZ;
  }

  for (const object of qualifyingObjects) {
    if (!isFrontBlocker(object, originX, originZ)) continue;
    maxZ = Math.min(
      maxZ,
      objectExtents(object).minZ - FRONT_BLOCKER_STANDOFF_METERS,
    );
  }

  maxZ = Math.max(maxZ, originZ);

  return {
    min: [
      minX,
      Math.max(minY - margin[1], MIN_EYE_HEIGHT_METERS),
      minZ,
    ],
    max: [
      maxX,
      maxY + margin[1],
      maxZ,
    ],
  };
}

export function clampFlyCameraPosition(position: Vec3, bounds: FlyCameraBounds): Vec3 {
  return [
    clamp(position[0], bounds.min[0], bounds.max[0]),
    clamp(position[1], bounds.min[1], bounds.max[1]),
    clamp(position[2], bounds.min[2], bounds.max[2]),
  ];
}