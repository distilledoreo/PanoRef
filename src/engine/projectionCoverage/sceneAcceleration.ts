import type { Vec3 } from '../../domain/types';
import { readWorldTriangle, triangleCount, writeTriangleBounds } from './geometryAccess';
import type { CoverageSceneData } from './types';

const LEAF_TRIANGLE_COUNT = 12;
const STACK_CAPACITY = 128;

function centroid(bounds: Float32Array, triangleIndex: number, axis: number): number {
  const offset = triangleIndex * 6;
  return (bounds[offset + axis] + bounds[offset + axis + 3]) * 0.5;
}

function swap(values: Uint32Array, a: number, b: number): void {
  const value = values[a];
  values[a] = values[b];
  values[b] = value;
}

/** In-place median partition; no recursively allocated/sliced index arrays. */
function quickselect(
  values: Uint32Array,
  leftStart: number,
  rightStart: number,
  target: number,
  axis: number,
  triangleBounds: Float32Array,
): void {
  let left = leftStart;
  let right = rightStart;
  while (left < right) {
    const pivot = centroid(triangleBounds, values[(left + right) >>> 1], axis);
    let i = left;
    let j = right;
    while (i <= j) {
      while (centroid(triangleBounds, values[i], axis) < pivot) i += 1;
      while (centroid(triangleBounds, values[j], axis) > pivot) j -= 1;
      if (i <= j) {
        swap(values, i, j);
        i += 1;
        j -= 1;
      }
    }
    if (target <= j) right = j;
    else if (target >= i) left = i;
    else return;
  }
}

function boundsDistanceSquared(point: Vec3, bounds: Float32Array, offset: number): number {
  const dx = Math.max(bounds[offset] - point[0], 0, point[0] - bounds[offset + 3]);
  const dy = Math.max(bounds[offset + 1] - point[1], 0, point[1] - bounds[offset + 4]);
  const dz = Math.max(bounds[offset + 2] - point[2], 0, point[2] - bounds[offset + 5]);
  return dx * dx + dy * dy + dz * dz;
}

function segmentIntersectsBounds(
  origin: Vec3,
  direction: Vec3,
  maximumDistance: number,
  bounds: Float32Array,
  offset: number,
): boolean {
  let tMin = 0;
  let tMax = maximumDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-12) {
      if (origin[axis] < bounds[offset + axis] || origin[axis] > bounds[offset + axis + 3]) return false;
      continue;
    }
    const inverse = 1 / component;
    let near = (bounds[offset + axis] - origin[axis]) * inverse;
    let far = (bounds[offset + axis + 3] - origin[axis]) * inverse;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= maximumDistance;
}

/** Allocation-free, double-sided Moller-Trumbore segment test. */
function segmentIntersectsTriangle(
  origin: Vec3,
  direction: Vec3,
  maximumDistance: number,
  triangle: Float64Array,
  minimumDistance: number,
): boolean {
  const e1x = triangle[3] - triangle[0];
  const e1y = triangle[4] - triangle[1];
  const e1z = triangle[5] - triangle[2];
  const e2x = triangle[6] - triangle[0];
  const e2y = triangle[7] - triangle[1];
  const e2z = triangle[8] - triangle[2];
  const px = direction[1] * e2z - direction[2] * e2y;
  const py = direction[2] * e2x - direction[0] * e2z;
  const pz = direction[0] * e2y - direction[1] * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(determinant) < 1e-10) return false;
  const inverse = 1 / determinant;
  const tx = origin[0] - triangle[0];
  const ty = origin[1] - triangle[1];
  const tz = origin[2] - triangle[2];
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return distance > minimumDistance && distance < maximumDistance;
}

/** Squared point-to-triangle distance from Real-Time Collision Detection. */
function pointTriangleDistanceSquared(point: Vec3, triangle: Float64Array): number {
  const ax = triangle[0]; const ay = triangle[1]; const az = triangle[2];
  const abx = triangle[3] - ax; const aby = triangle[4] - ay; const abz = triangle[5] - az;
  const acx = triangle[6] - ax; const acy = triangle[7] - ay; const acz = triangle[8] - az;
  const apx = point[0] - ax; const apy = point[1] - ay; const apz = point[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = point[0] - triangle[3]; const bpy = point[1] - triangle[4]; const bpz = point[2] - triangle[5];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const dx = apx - abx * v; const dy = apy - aby * v; const dz = apz - abz * v;
    return dx * dx + dy * dy + dz * dz;
  }

  const cpx = point[0] - triangle[6]; const cpy = point[1] - triangle[7]; const cpz = point[2] - triangle[8];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const dx = apx - acx * w; const dy = apy - acy * w; const dz = apz - acz * w;
    return dx * dx + dy * dy + dz * dz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edgeX = triangle[6] - triangle[3];
    const edgeY = triangle[7] - triangle[4];
    const edgeZ = triangle[8] - triangle[5];
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const dx = bpx - edgeX * w; const dy = bpy - edgeY * w; const dz = bpz - edgeZ * w;
    return dx * dx + dy * dy + dz * dz;
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const dx = apx - abx * v - acx * w;
  const dy = apy - aby * v - acy * w;
  const dz = apz - abz * v - acz * w;
  return dx * dx + dy * dy + dz * dz;
}

export interface SceneAccelerationStructure {
  scene: CoverageSceneData;
  raycastAny(
    origin: Vec3,
    direction: Vec3,
    maximumDistance: number,
    excludedTriangleIndex?: number,
    minimumDistance?: number,
  ): boolean;
  distanceToGeometry(point: Vec3, maximumDistance?: number): number;
}

/** Flat typed-array BVH with in-place partitioning and allocation-free queries. */
export function buildSceneAcceleration(scene: CoverageSceneData): SceneAccelerationStructure {
  const count = triangleCount(scene);
  if (count === 0) throw new Error('Cannot build coverage acceleration without triangles.');
  const triangleBounds = new Float32Array(count * 6);
  const triangleIndices = new Uint32Array(count);
  const triangleScratch = new Float64Array(9);
  for (let index = 0; index < count; index += 1) {
    triangleIndices[index] = index;
    readWorldTriangle(scene, index, triangleScratch);
    writeTriangleBounds(triangleScratch, triangleBounds, index * 6);
  }

  const targetLeaves = Math.ceil(count / LEAF_TRIANGLE_COUNT);
  const maximumLeaves = 2 ** Math.ceil(Math.log2(Math.max(1, targetLeaves)));
  const maximumNodes = maximumLeaves * 2 - 1;
  const nodeBounds = new Float32Array(maximumNodes * 6);
  const nodeLeft = new Int32Array(maximumNodes); nodeLeft.fill(-1);
  const nodeRight = new Int32Array(maximumNodes); nodeRight.fill(-1);
  const nodeStart = new Uint32Array(maximumNodes);
  const nodeCount = new Uint32Array(maximumNodes);
  let nodesUsed = 0;

  const buildNode = (start: number, end: number): number => {
    const node = nodesUsed;
    nodesUsed += 1;
    const boundsOffset = node * 6;
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let offset = start; offset < end; offset += 1) {
      const triangleOffset = triangleIndices[offset] * 6;
      minX = Math.min(minX, triangleBounds[triangleOffset]);
      minY = Math.min(minY, triangleBounds[triangleOffset + 1]);
      minZ = Math.min(minZ, triangleBounds[triangleOffset + 2]);
      maxX = Math.max(maxX, triangleBounds[triangleOffset + 3]);
      maxY = Math.max(maxY, triangleBounds[triangleOffset + 4]);
      maxZ = Math.max(maxZ, triangleBounds[triangleOffset + 5]);
    }
    nodeBounds.set([minX, minY, minZ, maxX, maxY, maxZ], boundsOffset);
    const length = end - start;
    if (length <= LEAF_TRIANGLE_COUNT) {
      nodeStart[node] = start;
      nodeCount[node] = length;
      return node;
    }
    const xExtent = maxX - minX; const yExtent = maxY - minY; const zExtent = maxZ - minZ;
    const axis = yExtent > xExtent ? (zExtent > yExtent ? 2 : 1) : (zExtent > xExtent ? 2 : 0);
    const midpoint = start + Math.floor(length / 2);
    quickselect(triangleIndices, start, end - 1, midpoint, axis, triangleBounds);
    nodeLeft[node] = buildNode(start, midpoint);
    nodeRight[node] = buildNode(midpoint, end);
    return node;
  };
  const root = buildNode(0, count);
  const traversalStack = new Int32Array(STACK_CAPACITY);

  return {
    scene,
    raycastAny(origin, direction, maximumDistance, excludedTriangleIndex, minimumDistance = 1e-6) {
      if (!(maximumDistance > minimumDistance)) return false;
      let stackSize = 1;
      traversalStack[0] = root;
      while (stackSize > 0) {
        const node = traversalStack[--stackSize];
        if (!segmentIntersectsBounds(origin, direction, maximumDistance, nodeBounds, node * 6)) continue;
        if (nodeCount[node] > 0) {
          const end = nodeStart[node] + nodeCount[node];
          for (let offset = nodeStart[node]; offset < end; offset += 1) {
            const triangleIndex = triangleIndices[offset];
            if (triangleIndex === excludedTriangleIndex) continue;
            readWorldTriangle(scene, triangleIndex, triangleScratch);
            if (segmentIntersectsTriangle(origin, direction, maximumDistance, triangleScratch, minimumDistance)) return true;
          }
        } else {
          if (stackSize + 2 > traversalStack.length) throw new Error('Coverage BVH traversal depth exceeded.');
          traversalStack[stackSize++] = nodeLeft[node];
          traversalStack[stackSize++] = nodeRight[node];
        }
      }
      return false;
    },
    distanceToGeometry(point, maximumDistance = Number.POSITIVE_INFINITY) {
      let bestSquared = maximumDistance * maximumDistance;
      let stackSize = 1;
      traversalStack[0] = root;
      while (stackSize > 0) {
        const node = traversalStack[--stackSize];
        if (boundsDistanceSquared(point, nodeBounds, node * 6) >= bestSquared) continue;
        if (nodeCount[node] > 0) {
          const end = nodeStart[node] + nodeCount[node];
          for (let offset = nodeStart[node]; offset < end; offset += 1) {
            readWorldTriangle(scene, triangleIndices[offset], triangleScratch);
            bestSquared = Math.min(bestSquared, pointTriangleDistanceSquared(point, triangleScratch));
          }
        } else {
          if (stackSize + 2 > traversalStack.length) throw new Error('Coverage BVH traversal depth exceeded.');
          traversalStack[stackSize++] = nodeLeft[node];
          traversalStack[stackSize++] = nodeRight[node];
        }
      }
      return Math.sqrt(bestSquared);
    },
  };
}
