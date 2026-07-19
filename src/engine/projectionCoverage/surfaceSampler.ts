import * as THREE from 'three';
import type { LocationProject, Vec3 } from '../../domain/types';
import { releaseImportedGeometry } from '../importedMesh';
import { createObject3D } from '../sceneObjects';
import type {
  CoverageBounds,
  CoverageFloorTriangle,
  CoverageSceneData,
  CoverageTriangle,
  SurfaceSample,
} from './types';

const MIN_TRIANGLE_AREA = 1e-8;

function toVec3(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

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

function disposeExtractedNode(root: THREE.Object3D): void {
  const released = new Set<THREE.BufferGeometry>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || released.has(mesh.geometry)) return;
    released.add(mesh.geometry);
    if (!releaseImportedGeometry(mesh.geometry)) mesh.geometry.dispose();
  });
}

/**
 * Flatten the exact rendered triangle surfaces into deterministic world-space
 * geometry. Helpers and the sun marker are deliberately excluded.
 */
export function extractCoverageScene(project: LocationProject): CoverageSceneData {
  const triangles: CoverageTriangle[] = [];
  const obstacleBounds: CoverageBounds[] = [];
  const explicitFloorTriangles: CoverageFloorTriangle[] = [];
  const inferredFloorTriangles: CoverageFloorTriangle[] = [];
  const sceneBounds = new THREE.Box3();
  let meshId = 0;

  for (const object of project.scene.objects) {
    if (!object.visible || object.type === 'sun_marker' || object.category === 'helper') continue;
    const root = createObject3D(object, false, 'light', project.assets);
    root.updateMatrixWorld(true);
    const objectBounds = new THREE.Box3().setFromObject(root, true);
    if (!objectBounds.isEmpty()) {
      sceneBounds.union(objectBounds);
      if (object.type !== 'floor') {
        obstacleBounds.push({ min: toVec3(objectBounds.min), max: toVec3(objectBounds.max) });
      }
    }

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      if (!position) return;
      const index = geometry.index;
      const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const edgeAB = new THREE.Vector3();
      const edgeAC = new THREE.Vector3();
      const normal = new THREE.Vector3();

      for (let triangleId = 0; triangleId < triangleCount; triangleId += 1) {
        const ia = index ? index.getX(triangleId * 3) : triangleId * 3;
        const ib = index ? index.getX(triangleId * 3 + 1) : triangleId * 3 + 1;
        const ic = index ? index.getX(triangleId * 3 + 2) : triangleId * 3 + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
        edgeAB.subVectors(b, a);
        edgeAC.subVectors(c, a);
        normal.crossVectors(edgeAB, edgeAC);
        const area = normal.length() * 0.5;
        if (!Number.isFinite(area) || area <= MIN_TRIANGLE_AREA) continue;
        normal.normalize();
        const triangle: CoverageTriangle = {
          a: toVec3(a),
          b: toVec3(b),
          c: toVec3(c),
          geometricNormal: toVec3(normal),
          meshId,
          triangleId,
          area,
        };
        const triangleIndex = triangles.push(triangle) - 1;
        if (normal.y > 0.8) {
          const bounds = triangleBounds(triangle);
          const floor = {
            triangleIndex,
            minX: bounds.min[0],
            maxX: bounds.max[0],
            minZ: bounds.min[2],
            maxZ: bounds.max[2],
          };
          if (object.type === 'floor') explicitFloorTriangles.push(floor);
          else inferredFloorTriangles.push(floor);
        }
      }
      meshId += 1;
    });

    disposeExtractedNode(root);
  }

  if (triangles.length === 0 || sceneBounds.isEmpty()) {
    throw new Error('Coverage analysis requires at least one visible solid mesh.');
  }

  return {
    triangles,
    bounds: { min: toVec3(sceneBounds.min), max: toVec3(sceneBounds.max) },
    obstacleBounds,
    // Authored floor objects define the allowed capture region when present.
    // Only infer floors from arbitrary upward faces for imported sets that do
    // not contain an explicit floor object; this prevents tables and rooftops
    // from becoming technically valid but nonsensical camera platforms.
    floorTriangles: explicitFloorTriangles.length > 0
      ? explicitFloorTriangles
      : inferredFloorTriangles,
    diagonal: Math.max(sceneBounds.getSize(new THREE.Vector3()).length(), 1e-3),
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Deterministic area-weighted Monte Carlo surface samples. */
export function sampleMeshSurface(
  triangles: CoverageTriangle[],
  sampleCount: number,
  seed: number,
): SurfaceSample[] {
  if (triangles.length === 0 || sampleCount <= 0) return [];
  const cumulativeArea = new Float64Array(triangles.length);
  let totalArea = 0;
  for (let i = 0; i < triangles.length; i += 1) {
    totalArea += triangles[i].area;
    cumulativeArea[i] = totalArea;
  }
  if (!(totalArea > 0)) return [];

  const rng = mulberry32(seed);
  const samples: SurfaceSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const triangleIndex = lowerBound(cumulativeArea, rng() * totalArea);
    const triangle = triangles[triangleIndex];
    const r1 = rng();
    const r2 = rng();
    const sqrtR1 = Math.sqrt(r1);
    const b0 = 1 - sqrtR1;
    const b1 = sqrtR1 * (1 - r2);
    const b2 = sqrtR1 * r2;
    samples.push({
      position: [
        triangle.a[0] * b0 + triangle.b[0] * b1 + triangle.c[0] * b2,
        triangle.a[1] * b0 + triangle.b[1] * b1 + triangle.c[1] * b2,
        triangle.a[2] * b0 + triangle.b[2] * b1 + triangle.c[2] * b2,
      ],
      geometricNormal: [...triangle.geometricNormal],
      meshId: triangle.meshId,
      triangleId: triangle.triangleId,
      triangleIndex,
    });
  }
  return samples;
}
