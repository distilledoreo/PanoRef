import * as THREE from 'three';
import JSZip from 'jszip';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject, createTransform } from '../src/domain/defaults';
import { ProjectAsset, SceneObject } from '../src/domain/types';
import { buildScene, disposeScene } from '../src/engine/sceneObjects';
import {
  createModelImportPlan,
  importModelJob,
} from '../src/engine/modelImport';
import {
  encodePackedGrayboxMesh,
  resetImportedMeshCacheForTests,
} from '../src/engine/importedMesh';
import { parseProject, serializeProject } from '../src/engine/projectIO';
import { useContinuityStore } from '../src/state/useContinuityStore';

beforeAll(() => {
  if (typeof ProgressEvent !== 'undefined') return;
  vi.stubGlobal('ProgressEvent', class TestProgressEvent extends Event {
    lengthComputable: boolean;
    loaded: number;
    total: number;

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  });
});

describe('model import planning', () => {
  it('pairs native DCC scenes with a lightweight bridge file', () => {
    const blend = file(['native bytes are not read'], 'courtyard.blend');
    const glb = file(['bridge'], 'courtyard.glb');
    const plan = createModelImportPlan([blend, glb]);

    expect(plan.issues).toEqual([]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]).toMatchObject({
      kind: 'file',
      file: glb,
      sourceApplication: 'blender',
      sourceSceneName: 'courtyard.blend',
    });
  });

  it('does not claim to directly parse binary DCC files', () => {
    const plan = createModelImportPlan([file(['maya binary'], 'set.mb')]);
    expect(plan.jobs).toHaveLength(0);
    expect(plan.issues[0].message).toContain('companion geometry-only');
  });

  it('directly imports Maya ASCII .ma files', () => {
    const maContent = `
      //Maya ASCII 2024 scene
      requires maya "2024";
      currentUnit -l cm;
      createNode transform -n "pCube1";
        setAttr ".t" -type "double3" 10 0 5;
      createNode mesh -n "pCubeShape1" -p "pCube1";
        setAttr -s 4 ".vt[0:3]" -type "float3" 0 0 0 1 0 0 0 1 0 1 1 0;
        setAttr -s 1 ".fc[0]" -type "polyFaces" f 4 0 1 3 2;
    `;
    const plan = createModelImportPlan([file([maContent], 'cube.ma')]);
    expect(plan.issues).toEqual([]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0].file.name).toBe('cube.ma');
  });

  it('imports a portable native-scene handoff bundle', async () => {
    const zip = new JSZip();
    zip.file('panoref-scene.json', JSON.stringify({
      schemaVersion: 1,
      entry: 'geometry/set.obj',
      geometryOnly: true,
      source: { application: 'maya', file: 'set.mb' },
    }));
    zip.file('geometry/set.obj', [
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
    ].join('\n'));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const bundle = file([bytes], 'set.panoscene');

    const results = await importModelJob({ kind: 'bundle', file: bundle });
    const result = results[0];
    expect(result.object.importedModel).toMatchObject({
      sourceApplication: 'maya',
      sourceSceneName: 'set.mb',
      sourceKind: 'scene',
      triangleCount: 1,
      geometrySimplified: false,
    });
  });
});

describe('texture-free model conversion', () => {
  beforeEach(() => resetImportedMeshCacheForTests());

  it('imports OBJ triangles unchanged and preserves source-space placement', async () => {
    const obj = file([
      'o Wall\n',
      'v 10 2 -1\n',
      'v 12 2 -1\n',
      'v 12 4 -1\n',
      'v 10 4 -1\n',
      'f 1 2 3\n',
      'f 1 3 4\n',
    ], 'wall.obj', 'text/plain');

    const results = await importModelJob({ kind: 'file', file: obj });
    const result = results[0];

    expect(result.object.type).toBe('imported_model');
    expect(result.object.importedModel).toMatchObject({
      triangleCount: 2,
      vertexCount: 6,
      geometrySimplified: false,
      hierarchyFlattened: true,
    });
    expect(result.object.transform.position).toEqual([11, 3, -1]);
    expect(result.object.dimensions).toEqual([2, 2, 0.001]);
    expect(result.asset.type).toBe('model');
    expect(result.asset.uri).not.toContain('v 10 2');

    const project = createDefaultProject();
    project.scene.objects = [result.object];
    project.assets.assets[result.asset.id] = result.asset;
    const scene = buildScene(project, { showHelpers: false });
    const imported = scene.getObjectByName('wall') as THREE.Mesh;
    expect(imported).toBeTruthy();
    expect((imported.geometry.index?.count ?? 0) / 3).toBe(2);
    expect(imported.position.toArray()).toEqual([11, 3, -1]);
    const cachedGeometry = imported.geometry;
    disposeScene(scene);
    const rebuiltScene = buildScene(project, { showHelpers: false });
    expect((rebuiltScene.getObjectByName('wall') as THREE.Mesh).geometry).toBe(cachedGeometry);
    disposeScene(rebuiltScene);
  });

  it('strips glTF material and texture references before conversion', async () => {
    const binary = new ArrayBuffer(44);
    new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    new Uint16Array(binary, 36, 3).set([0, 1, 2]);
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 44, uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString('base64')}` }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      images: [{ uri: 'data:image/png;base64,not-decoded' }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };

    const results = await importModelJob({
      kind: 'file',
      file: file([JSON.stringify(gltf)], 'textured.gltf', 'model/gltf+json'),
    });
    const result = results[0];

    expect(result.object.importedModel?.triangleCount).toBe(1);
    expect(result.object.importedModel?.warnings?.join(' ')).toContain('Removed');
    expect(result.asset.uri).not.toContain('not-decoded');
  });

  it('keeps canonical mesh assets through undo and prunes only on saved deletion', () => {
    const packed = encodePackedGrayboxMesh(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    const asset: ProjectAsset = {
      id: 'model_test',
      type: 'model',
      name: 'triangle.panoref-mesh',
      uri: packed.uri,
      createdAt: new Date(0).toISOString(),
    };
    const object: SceneObject = {
      id: 'obj_imported',
      name: 'Triangle',
      type: 'imported_model',
      transform: createTransform([0.5, 0.5, 0]),
      dimensions: [1, 1, 0.001],
      category: 'architecture',
      locked: false,
      visible: true,
      modelAssetId: asset.id,
    };
    const project = createDefaultProject();
    useContinuityStore.setState({
      project,
      selectedObjectIds: [],
      buildHistoryPast: [],
      buildHistoryFuture: [],
    });

    useContinuityStore.getState().addImportedModel({ asset, object });
    expect(useContinuityStore.getState().project.assets.assets[asset.id]).toBe(asset);
    expect(useContinuityStore.getState().undoBuild()).toBe(true);
    expect(useContinuityStore.getState().project.scene.objects).not.toContainEqual(object);
    expect(useContinuityStore.getState().project.assets.assets[asset.id]).toBe(asset);
    expect(useContinuityStore.getState().redoBuild()).toBe(true);
    expect(useContinuityStore.getState().project.scene.objects).toContainEqual(object);

    const saved = parseProject(serializeProject(useContinuityStore.getState().project));
    expect(saved.assets.assets[asset.id]).toBeTruthy();
    saved.scene.objects = saved.scene.objects.filter((candidate) => candidate.id !== object.id);
    expect(serializeProject(saved)).not.toContain(asset.id);
  });
});

describe('Maya ASCII (.ma) direct import', () => {
  beforeEach(() => resetImportedMeshCacheForTests());

  it('parses a single-mesh .ma file and preserves world position via transform', async () => {
    const ma = file([
      '//Maya ASCII 2024 scene\n',
      'requires maya "2024";\n',
      'currentUnit -l cm -a deg -t film;\n',
      'createNode transform -n "pCube1";\n',
      '\tsetAttr ".t" -type "double3" 200 0 100;\n',
      'createNode mesh -n "pCubeShape1" -p "pCube1";\n',
      '\tsetAttr -s 4 ".vt[0:3]" -type "float3" 0 0 0 100 0 0 100 100 0 0 100 0;\n',
      '\tsetAttr -s 1 ".fc[0]" -type "polyFaces" f 4 0 1 2 3;\n',
    ], 'cube.ma', 'text/plain');

    const results = await importModelJob({ kind: 'file', file: ma });
    expect(results).toHaveLength(1);
    const { object, asset } = results[0];
    expect(object.type).toBe('imported_model');
    expect(object.name).toBe('pCube1');
    expect(object.importedModel).toMatchObject({
      sourceFormat: 'ma',
      sourceApplication: 'maya',
      hierarchyFlattened: false,
      vertexCount: 4,
      triangleCount: 2, // quad -> 2 tris
    });
    // 200cm -> 2m + half of 1m quad = 2.5m, Z 100cm ->1m
    expect(object.transform.position[0]).toBeCloseTo(2.5, 1);
    expect(object.transform.position[1]).toBeCloseTo(0.5, 1);
    expect(object.transform.position[2]).toBeCloseTo(1, 1);
    expect(object.dimensions[0]).toBeCloseTo(1, 1);
    expect(asset.type).toBe('model');
    const project = createDefaultProject();
    project.scene.objects = [object];
    project.assets.assets[asset.id] = asset;
    const scene = buildScene(project, { showHelpers: false });
    const imported = scene.getObjectByName('pCube1') as THREE.Mesh;
    expect(imported).toBeTruthy();
    expect((imported.geometry.index?.count ?? 0) / 3).toBe(2);
    disposeScene(scene);
  });

  it('preserves hierarchy with multiple meshes as separate objects', async () => {
    const maMulti = file([
      '//Maya ASCII 2024 scene\n',
      'currentUnit -l cm;\n',
      'createNode transform -n "group1";\n',
      '\tsetAttr ".t" -type "double3" 100 0 0;\n',
      'createNode transform -n "pCube1" -p "group1";\n',
      '\tsetAttr ".t" -type "double3" 0 0 100;\n',
      'createNode transform -n "pSphere1" -p "group1";\n',
      '\tsetAttr ".t" -type "double3" 0 0 -100;\n',
      'createNode mesh -n "pCubeShape1" -p "pCube1";\n',
      '\tsetAttr -s 4 ".vt[0:3]" -type "float3" 0 0 0 100 0 0 100 100 0 0 100 0;\n',
      '\tsetAttr -s 1 ".fc[0]" -type "polyFaces" f 4 0 1 2 3;\n',
      'createNode mesh -n "pSphereShape1" -p "pSphere1";\n',
      '\tsetAttr -s 3 ".vt[0:2]" -type "float3" 0 0 0 200 0 0 100 100 0;\n',
      '\tsetAttr -s 1 ".fc[0]" -type "polyFaces" f 3 0 1 2;\n',
    ], 'scene.ma');

    const results = await importModelJob({ kind: 'file', file: maMulti });
    expect(results.length).toBe(2);
    const names = results.map((r) => r.object.name).sort();
    expect(names).toEqual(['pCube1', 'pSphere1']);
    // Check parent chains
    const cube = results.find((r) => r.object.name === 'pCube1')!;
    expect(cube.object.importedModel?.parentChain).toContain('group1');
    expect(cube.object.importedModel?.hierarchyFlattened).toBe(false);
    expect(cube.object.importedModel?.meshCount).toBe(2);
    // Positions should differ because second transform offset differs via Z
    const sphere = results.find((r) => r.object.name === 'pSphere1')!;
    expect(Math.abs(cube.object.transform.position[2] - sphere.object.transform.position[2])).toBeGreaterThan(1.5);

    // Verify batch add to store selects all
    const project = createDefaultProject();
    useContinuityStore.setState({
      project,
      selectedObjectIds: [],
      buildHistoryPast: [],
      buildHistoryFuture: [],
    });
    const add = useContinuityStore.getState().addImportedModels;
    const added = add(results);
    expect(added).toHaveLength(2);
    expect(useContinuityStore.getState().selectedObjectIds).toHaveLength(2);
  });

  it('supports separate .tx/.ty/.tz attributes', async () => {
    const ma = file([
      '//Maya ASCII\n',
      'currentUnit -l m;\n',
      'createNode transform -n "box1";\n',
      '\tsetAttr ".tx" 5;\n',
      '\tsetAttr ".tz" -2;\n',
      'createNode mesh -n "boxShape1" -p "box1";\n',
      '\tsetAttr -s 3 ".vt[0:2]" -type "float3" 0 0 0 1 0 0 0 1 0;\n',
      '\tsetAttr -s 1 ".fc[0]" -type "polyFaces" f 3 0 1 2;\n',
    ], 'tx.ma');

    const results = await importModelJob({ kind: 'file', file: ma });
    expect(results[0].object.transform.position[0]).toBeCloseTo(5.5, 1);
    expect(results[0].object.transform.position[2]).toBeCloseTo(-2, 1);
  });
});

function file(parts: BlobPart[], name: string, type = 'application/octet-stream'): File {
  return new File(parts, name, { type });
}
