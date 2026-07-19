import type { CoverageSceneData } from './types';

export type TriangleCoordinates = Float64Array;

export function triangleCount(scene: CoverageSceneData): number {
  return Math.floor(scene.indices.length / 3);
}

function writeWorldVertex(
  scene: CoverageSceneData,
  vertexIndex: number,
  meshId: number,
  out: TriangleCoordinates,
  offset: number,
): void {
  const positionOffset = vertexIndex * 3;
  const matrixOffset = meshId * 16;
  const x = scene.positions[positionOffset];
  const y = scene.positions[positionOffset + 1];
  const z = scene.positions[positionOffset + 2];
  const matrix = scene.meshMatrices;
  out[offset] = matrix[matrixOffset] * x
    + matrix[matrixOffset + 4] * y
    + matrix[matrixOffset + 8] * z
    + matrix[matrixOffset + 12];
  out[offset + 1] = matrix[matrixOffset + 1] * x
    + matrix[matrixOffset + 5] * y
    + matrix[matrixOffset + 9] * z
    + matrix[matrixOffset + 13];
  out[offset + 2] = matrix[matrixOffset + 2] * x
    + matrix[matrixOffset + 6] * y
    + matrix[matrixOffset + 10] * z
    + matrix[matrixOffset + 14];
}

export function readWorldTriangle(
  scene: CoverageSceneData,
  triangleIndex: number,
  out: TriangleCoordinates,
): TriangleCoordinates {
  const indexOffset = triangleIndex * 3;
  const meshId = scene.triangleMeshIds[triangleIndex];
  writeWorldVertex(scene, scene.indices[indexOffset], meshId, out, 0);
  writeWorldVertex(scene, scene.indices[indexOffset + 1], meshId, out, 3);
  writeWorldVertex(scene, scene.indices[indexOffset + 2], meshId, out, 6);
  return out;
}

/** Returns triangle area and writes a normalized geometric face normal. */
export function triangleAreaNormal(
  triangle: TriangleCoordinates,
  normal: Float64Array,
): number {
  const abx = triangle[3] - triangle[0];
  const aby = triangle[4] - triangle[1];
  const abz = triangle[5] - triangle[2];
  const acx = triangle[6] - triangle[0];
  const acy = triangle[7] - triangle[1];
  const acz = triangle[8] - triangle[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz);
  if (length <= 1e-16) {
    normal[0] = 0;
    normal[1] = 0;
    normal[2] = 0;
    return 0;
  }
  normal[0] = nx / length;
  normal[1] = ny / length;
  normal[2] = nz / length;
  return length * 0.5;
}

export function writeTriangleBounds(
  triangle: TriangleCoordinates,
  out: Float32Array,
  offset: number,
): void {
  out[offset] = Math.min(triangle[0], triangle[3], triangle[6]);
  out[offset + 1] = Math.min(triangle[1], triangle[4], triangle[7]);
  out[offset + 2] = Math.min(triangle[2], triangle[5], triangle[8]);
  out[offset + 3] = Math.max(triangle[0], triangle[3], triangle[6]);
  out[offset + 4] = Math.max(triangle[1], triangle[4], triangle[7]);
  out[offset + 5] = Math.max(triangle[2], triangle[5], triangle[8]);
}

export function floorHeightAt(
  triangle: TriangleCoordinates,
  x: number,
  z: number,
): number | undefined {
  const ax = triangle[0];
  const az = triangle[2];
  const bx = triangle[3];
  const bz = triangle[5];
  const cx = triangle[6];
  const cz = triangle[8];
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = x - ax;
  const v2z = z - az;
  const denominator = v0x * v1z - v1x * v0z;
  if (Math.abs(denominator) < 1e-10) return undefined;
  const u = (v2x * v1z - v1x * v2z) / denominator;
  const v = (v0x * v2z - v2x * v0z) / denominator;
  const w = 1 - u - v;
  const tolerance = 1e-7;
  if (u < -tolerance || v < -tolerance || w < -tolerance) return undefined;
  return triangle[1] * w + triangle[4] * u + triangle[7] * v;
}
