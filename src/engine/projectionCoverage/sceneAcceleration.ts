import type { Vec3 } from '../../domain/types';
import type { CoverageBounds, CoverageTriangle } from './types';

interface BvhNode {
  bounds: CoverageBounds;
  left?: BvhNode;
  right?: BvhNode;
  triangleIndices?: number[];
}

const LEAF_TRIANGLE_COUNT = 12;

function triangleBounds(triangle: CoverageTriangle): CoverageBounds {
  return {
    min: [
      Math.min(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.min(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.min(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
    max: [
      Math.max(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.max(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.max(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
  };
}

function unionBounds(indices: number[], boundsByTriangle: CoverageBounds[]): CoverageBounds {
  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const index of indices) {
    const bounds = boundsByTriangle[index];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return { min, max };
}

function centroid(triangle: CoverageTriangle, axis: number): number {
  return (triangle.a[axis] + triangle.b[axis] + triangle.c[axis]) / 3;
}

function buildNode(
  indices: number[],
  triangles: CoverageTriangle[],
  boundsByTriangle: CoverageBounds[],
): BvhNode {
  const bounds = unionBounds(indices, boundsByTriangle);
  if (indices.length <= LEAF_TRIANGLE_COUNT) return { bounds, triangleIndices: indices };
  const extents = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const axis = extents[1] > extents[0]
    ? (extents[2] > extents[1] ? 2 : 1)
    : (extents[2] > extents[0] ? 2 : 0);
  indices.sort((a, b) => centroid(triangles[a], axis) - centroid(triangles[b], axis));
  const midpoint = Math.floor(indices.length / 2);
  return {
    bounds,
    left: buildNode(indices.slice(0, midpoint), triangles, boundsByTriangle),
    right: buildNode(indices.slice(midpoint), triangles, boundsByTriangle),
  };
}

function segmentIntersectsBounds(
  origin: Vec3,
  direction: Vec3,
  maximumDistance: number,
  bounds: CoverageBounds,
): boolean {
  let tMin = 0;
  let tMax = maximumDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-12) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return false;
      continue;
    }
    const inverse = 1 / component;
    let near = (bounds.min[axis] - origin[axis]) * inverse;
    let far = (bounds.max[axis] - origin[axis]) * inverse;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= maximumDistance;
}

/** Double-sided Moller-Trumbore segment/triangle test. */
function segmentIntersectsTriangle(
  origin: Vec3,
  direction: Vec3,
  maximumDistance: number,
  triangle: CoverageTriangle,
  minimumDistance: number,
): boolean {
  const edge1: Vec3 = [
    triangle.b[0] - triangle.a[0],
    triangle.b[1] - triangle.a[1],
    triangle.b[2] - triangle.a[2],
  ];
  const edge2: Vec3 = [
    triangle.c[0] - triangle.a[0],
    triangle.c[1] - triangle.a[1],
    triangle.c[2] - triangle.a[2],
  ];
  const p: Vec3 = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ];
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (Math.abs(determinant) < 1e-10) return false;
  const inverse = 1 / determinant;
  const tVector: Vec3 = [
    origin[0] - triangle.a[0],
    origin[1] - triangle.a[1],
    origin[2] - triangle.a[2],
  ];
  const u = (tVector[0] * p[0] + tVector[1] * p[1] + tVector[2] * p[2]) * inverse;
  if (u < 0 || u > 1) return false;
  const q: Vec3 = [
    tVector[1] * edge1[2] - tVector[2] * edge1[1],
    tVector[2] * edge1[0] - tVector[0] * edge1[2],
    tVector[0] * edge1[1] - tVector[1] * edge1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  return distance > minimumDistance && distance < maximumDistance;
}

export interface SceneAccelerationStructure {
  triangles: CoverageTriangle[];
  raycastAny(
    origin: Vec3,
    direction: Vec3,
    maximumDistance: number,
    excludedTriangleIndex?: number,
    minimumDistance?: number,
  ): boolean;
}

/** Compact in-memory BVH with first-hit segment traversal. */
export function buildSceneAcceleration(
  triangles: CoverageTriangle[],
): SceneAccelerationStructure {
  if (triangles.length === 0) throw new Error('Cannot build coverage acceleration without triangles.');
  const boundsByTriangle = triangles.map(triangleBounds);
  const root = buildNode(triangles.map((_, index) => index), triangles, boundsByTriangle);

  return {
    triangles,
    raycastAny(origin, direction, maximumDistance, excludedTriangleIndex, minimumDistance = 1e-6) {
      if (!(maximumDistance > minimumDistance)) return false;
      const stack: BvhNode[] = [root];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (!segmentIntersectsBounds(origin, direction, maximumDistance, node.bounds)) continue;
        if (node.triangleIndices) {
          for (const triangleIndex of node.triangleIndices) {
            if (triangleIndex === excludedTriangleIndex) continue;
            if (segmentIntersectsTriangle(
              origin,
              direction,
              maximumDistance,
              triangles[triangleIndex],
              minimumDistance,
            )) return true;
          }
          continue;
        }
        if (node.left) stack.push(node.left);
        if (node.right) stack.push(node.right);
      }
      return false;
    },
  };
}

