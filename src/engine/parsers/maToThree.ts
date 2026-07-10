import * as THREE from 'three';
import { Vec3 } from '../../domain/types';
import { MAX_IMPORT_TRIANGLES, MAX_IMPORT_VERTICES } from '../modelImport';
import { MaMeshRaw, MaScene, MaTransformRaw } from './maParser';

export interface MaMeshExtraction {
  name: string;
  parentTransformName?: string;
  parentChain: string[];
  positions: Float32Array; // centered local
  indices: Uint32Array;
  center: Vec3;
  dimensions: Vec3;
  vertexCount: number;
  triangleCount: number;
  sourceBounds: { min: Vec3; max: Vec3 };
  warnings: string[];
  unitScale: number;
}

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function buildLocalMatrix(tr: MaTransformRaw, unitScale: number): THREE.Matrix4 {
  const translation = new THREE.Vector3(
    tr.translation[0] * unitScale,
    tr.translation[1] * unitScale,
    tr.translation[2] * unitScale,
  );
  const euler = new THREE.Euler(
    degToRad(tr.rotation[0]),
    degToRad(tr.rotation[1]),
    degToRad(tr.rotation[2]),
    'XYZ',
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(tr.scale[0], tr.scale[1], tr.scale[2]);
  // Guard against zero scale
  if (Math.abs(scale.x) < 1e-9) scale.x = 1e-9;
  if (Math.abs(scale.y) < 1e-9) scale.y = 1e-9;
  if (Math.abs(scale.z) < 1e-9) scale.z = 1e-9;
  const m = new THREE.Matrix4();
  m.compose(translation, quat, scale);
  return m;
}

function computeWorldMatrices(
  transforms: Map<string, MaTransformRaw>,
  unitScale: number,
): Map<string, THREE.Matrix4> {
  const world = new Map<string, THREE.Matrix4>();
  const visiting = new Set<string>();

  function resolve(name: string): THREE.Matrix4 {
    if (world.has(name)) return world.get(name)!;
    if (visiting.has(name)) {
      // Cycle
      return new THREE.Matrix4().identity();
    }
    visiting.add(name);
    const node = transforms.get(name);
    if (!node) {
      const id = new THREE.Matrix4().identity();
      world.set(name, id);
      visiting.delete(name);
      return id;
    }
    const local = buildLocalMatrix(node, unitScale);
    if (node.parentName) {
      const parentWorld = resolve(node.parentName);
      const combined = new THREE.Matrix4().multiplyMatrices(parentWorld, local);
      world.set(name, combined);
      visiting.delete(name);
      return combined;
    }
    world.set(name, local);
    visiting.delete(name);
    return local;
  }

  for (const key of transforms.keys()) {
    resolve(key);
  }
  return world;
}

function collectParentChain(
  startName: string | undefined,
  transforms: Map<string, MaTransformRaw>,
): string[] {
  const chain: string[] = [];
  let cur = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(cur);
    const node = transforms.get(cur);
    cur = node?.parentName;
  }
  return chain;
}

function triangulateFaces(
  faces: number[][],
  vertexCount: number,
  warnings: string[],
): { indices: number[]; triCount: number; nGonCount: number } {
  const indices: number[] = [];
  let nGonCount = 0;
  for (const face of faces) {
    if (face.length < 3) {
      warnings.push(`Skipped degenerate face with ${face.length} verts.`);
      continue;
    }
    for (const vi of face) {
      if (vi < 0 || vi >= vertexCount) {
        throw new Error(`Face index ${vi} out of range (vertex count ${vertexCount}).`);
      }
    }
    if (face.length === 3) {
      indices.push(face[0], face[1], face[2]);
    } else {
      nGonCount++;
      // fan triangulation
      for (let i = 1; i < face.length - 1; i++) {
        indices.push(face[0], face[i], face[i + 1]);
      }
    }
  }
  return { indices, triCount: indices.length / 3, nGonCount };
}

export function extractMaGeometry(ma: MaScene): MaMeshExtraction[] {
  const warningsGlobal = [...ma.warnings];
  const unitScale = ma.unitScale;
  const worldMatrices = computeWorldMatrices(ma.transforms, unitScale);
  const extractions: MaMeshExtraction[] = [];

  let totalVerts = 0;
  let totalTris = 0;

  for (const mesh of ma.meshes.values()) {
    const localWarnings: string[] = [];
    if (mesh.vertices.length === 0) {
      warningsGlobal.push(`Mesh "${mesh.name}" has no vertices, skipping.`);
      continue;
    }
    if (mesh.faces.length === 0) {
      warningsGlobal.push(`Mesh "${mesh.name}" has no faces, skipping.`);
      continue;
    }

    const parentTransform = mesh.parentName ? ma.transforms.get(mesh.parentName) : undefined;
    const worldMatrix = mesh.parentName ? (worldMatrices.get(mesh.parentName) ?? new THREE.Matrix4()) : new THREE.Matrix4();
    const parentChain = collectParentChain(mesh.parentName, ma.transforms);

    // world space vertex positions
    const vertCount = mesh.vertices.length;
    const tri = triangulateFaces(mesh.faces, vertCount, localWarnings);
    if (tri.triCount === 0) {
      warningsGlobal.push(`Mesh "${mesh.name}" produced no triangles.`);
      continue;
    }
    if (tri.nGonCount > 0) {
      localWarnings.push(`Triangulated ${tri.nGonCount} n-gon${tri.nGonCount === 1 ? '' : 's'} via fan.`);
    }

    // safety limits
    if (totalVerts + vertCount > MAX_IMPORT_VERTICES) {
      throw new Error(
        `Geometry exceeds safety limit of ${MAX_IMPORT_VERTICES.toLocaleString()} vertices across the .ma file.`,
      );
    }
    if (totalTris + tri.triCount > MAX_IMPORT_TRIANGLES) {
      throw new Error(
        `Geometry exceeds safety limit of ${MAX_IMPORT_TRIANGLES.toLocaleString()} triangles across the .ma file.`,
      );
    }

    const flipWinding = worldMatrix.determinant() < 0;

    const positionsWorld = new Float32Array(vertCount * 3);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const tmp = new THREE.Vector3();
    const srcMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const srcMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    for (let i = 0; i < vertCount; i++) {
      const v = mesh.vertices[i];
      const scaled: Vec3 = [v[0] * unitScale, v[1] * unitScale, v[2] * unitScale];
      tmp.set(scaled[0], scaled[1], scaled[2]);
      tmp.applyMatrix4(worldMatrix);
      if (![tmp.x, tmp.y, tmp.z].every(Number.isFinite)) {
        throw new Error(`Mesh "${mesh.name}" contains non-finite transformed vertex.`);
      }
      positionsWorld[i * 3] = tmp.x;
      positionsWorld[i * 3 + 1] = tmp.y;
      positionsWorld[i * 3 + 2] = tmp.z;
      min.min(tmp);
      max.max(tmp);
      srcMin.min(tmp);
      srcMax.max(tmp);
    }

    // center
    const centerVec = min.clone().add(max).multiplyScalar(0.5);
    const centeredPos = new Float32Array(positionsWorld.length);
    for (let i = 0; i < positionsWorld.length; i += 3) {
      centeredPos[i] = positionsWorld[i] - centerVec.x;
      centeredPos[i + 1] = positionsWorld[i + 1] - centerVec.y;
      centeredPos[i + 2] = positionsWorld[i + 2] - centerVec.z;
    }
    const size = max.clone().sub(min);
    const dimensions: Vec3 = [
      Math.max(size.x, 0.001),
      Math.max(size.y, 0.001),
      Math.max(size.z, 0.001),
    ];

    // indices with optional flip
    const rawIdx = tri.indices;
    const indices = new Uint32Array(rawIdx.length);
    for (let i = 0; i < rawIdx.length; i += 3) {
      const a = rawIdx[i];
      const b = rawIdx[i + 1];
      const c = rawIdx[i + 2];
      indices[i] = a;
      indices[i + 1] = flipWinding ? c : b;
      indices[i + 2] = flipWinding ? b : c;
    }

    totalVerts += vertCount;
    totalTris += tri.triCount;

    // Use parent transform name as display name if present else mesh shape name stripped of 'Shape' suffix
    const displayName = (() => {
      const parent = mesh.parentName ?? mesh.name;
      // common Maya: pCube1 | pCubeShape1 -> want pCube1
      if (mesh.parentName) return mesh.parentName;
      return mesh.name.replace(/Shape\d*$/i, '') || mesh.name;
    })();

    const srcWarnings = [...warningsGlobal, ...localWarnings];

    extractions.push({
      name: displayName,
      parentTransformName: mesh.parentName,
      parentChain,
      positions: centeredPos,
      indices,
      center: centerVec.toArray() as Vec3,
      dimensions,
      vertexCount: vertCount,
      triangleCount: tri.triCount,
      sourceBounds: {
        min: srcMin.toArray() as Vec3,
        max: srcMax.toArray() as Vec3,
      },
      warnings: srcWarnings.length > 0 ? srcWarnings : [],
      unitScale,
    });

    // clear global per-mesh to avoid duplication
    warningsGlobal.length = 0;
  }

  if (extractions.length === 0) {
    throw new Error('No usable polygon meshes found in .ma file.');
  }

  // Post-unit warning
  if (unitScale !== 1) {
    const w = `Maya scene unit "${ma.unit}" converted to meters (scale ${unitScale}).`;
    extractions.forEach((e) => {
      if (!e.warnings.includes(w)) e.warnings.unshift(w);
    });
  } else if (ma.unit && ma.unit.toLowerCase() !== 'm' && ma.unit.toLowerCase() !== 'meter') {
    // we still converted cm default 0.01 - already added via scale? Actually unitScale captures. So add generic.
    const w = `Maya file unit "${ma.unit}" assumed; 1 unit treated as ${unitScale} meters.`;
    // Only add if not already added and unitScale !=0.01? Keep concise.
    if (unitScale !== 1) {
      // already added
    } else {
      extractions[0].warnings.push(w);
    }
  }

  return extractions;
}

export function buildMaGroupForDebug(ma: MaScene): THREE.Group {
  // For future visual debugging.
  const ext = extractMaGeometry(ma);
  const group = new THREE.Group();
  for (const e of ext) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(e.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(e.indices, 1));
    const mesh = new THREE.Mesh(geom);
    mesh.name = e.name;
    mesh.position.fromArray(e.center);
    group.add(mesh);
  }
  return group;
}
