import { SceneData, SceneObject, SceneObjectType, Vec3 } from '../domain/types';
import { clamp } from './sync';

export interface FlyCameraBounds {
  min: Vec3;
  max: Vec3;
}

export const DEFAULT_FLY_CAMERA_HORIZONTAL_MARGIN_METERS = 10;
const DEFAULT_VERTICAL_MARGIN_METERS = 1.75;
const FALLBACK_HALF_EXTENT: Vec3 = [18, 3.5, 18];
const MIN_EYE_HEIGHT_METERS = 0.45;

const EXCLUDED_BOUND_TYPES = new Set<SceneObjectType>(['sun_marker']);

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
    horizontalMarginMeters?: number;
    verticalMarginMeters?: number;
    fallbackHalfExtent?: Vec3;
  },
): FlyCameraBounds {
  const horizontalMargin = options?.horizontalMarginMeters ?? DEFAULT_FLY_CAMERA_HORIZONTAL_MARGIN_METERS;
  const verticalMargin = options?.verticalMarginMeters ?? DEFAULT_VERTICAL_MARGIN_METERS;
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

  let minX = originX;
  let minY = originY;
  let minZ = originZ;
  let maxX = originX;
  let maxY = originY;
  let maxZ = originZ;

  for (const object of qualifyingObjects) {
    const extents = objectExtents(object);
    minX = Math.min(minX, extents.minX);
    minZ = Math.min(minZ, extents.minZ);
    maxX = Math.max(maxX, extents.maxX);
    maxZ = Math.max(maxZ, extents.maxZ);
    [minY, maxY] = expandVerticalBounds(minY, maxY, extents);
  }

  return {
    min: [
      minX - horizontalMargin,
      Math.max(minY - verticalMargin, MIN_EYE_HEIGHT_METERS),
      minZ - horizontalMargin,
    ],
    max: [
      maxX + horizontalMargin,
      maxY + verticalMargin,
      maxZ + horizontalMargin,
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
