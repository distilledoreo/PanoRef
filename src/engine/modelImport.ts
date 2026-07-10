import * as THREE from 'three';
import {
  ImportedModelSourceApplication,
  ProjectAsset,
  SceneObject,
  Vec3,
} from '../domain/types';
import { createTransform } from '../domain/defaults';
import { createId } from '../utils/ids';
import { encodePackedGrayboxMesh } from './importedMesh';

export const DIRECT_MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx'] as const;
export type DirectModelFormat = typeof DIRECT_MODEL_EXTENSIONS[number];

export const NATIVE_SCENE_EXTENSIONS = ['blend', 'ma', 'mb', 'uproject', 'umap', 'uasset'] as const;
export const MODEL_IMPORT_ACCEPT = [
  ...DIRECT_MODEL_EXTENSIONS.map((extension) => `.${extension}`),
  ...NATIVE_SCENE_EXTENSIONS.map((extension) => `.${extension}`),
  '.panoscene',
  '.zip',
].join(',');

export const MAX_SOURCE_MODEL_BYTES = 200 * 1024 * 1024;
export const MAX_IMPORT_VERTICES = 3_000_000;
export const MAX_IMPORT_TRIANGLES = 3_000_000;
export const IMPORT_WARNING_BYTES = 50 * 1024 * 1024;
export const IMPORT_WARNING_TRIANGLES = 500_000;
export const SCENE_BUNDLE_MANIFEST = 'panoref-scene.json';

const MAX_BUNDLE_ENTRIES = 64;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BUNDLE_COMPRESSION_RATIO = 200;
const EMPTY_TEXTURE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

const TEXTURE_ONLY_GLTF_EXTENSIONS = new Set([
  'EXT_texture_avif',
  'EXT_texture_webp',
  'KHR_texture_basisu',
  'KHR_texture_transform',
]);

export interface ModelImportPlanIssue {
  fileName: string;
  tone: 'warning' | 'error';
  message: string;
}

export type ModelImportJob =
  | {
    kind: 'file';
    file: File;
    sourceApplication?: ImportedModelSourceApplication;
    sourceSceneName?: string;
  }
  | {
    kind: 'bundle';
    file: File;
  };

export interface ModelImportPlan {
  jobs: ModelImportJob[];
  issues: ModelImportPlanIssue[];
}

export interface ModelImportResult {
  asset: ProjectAsset;
  object: SceneObject;
}

interface LoadedModel {
  root: THREE.Object3D;
  materialCount: number;
  textureCount: number;
  animationCount: number;
  warnings: string[];
}

interface ExtractedGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  center: Vec3;
  dimensions: Vec3;
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  warnings: string[];
  sourceBounds: { min: Vec3; max: Vec3 };
}

interface SceneBundleManifestData {
  schemaVersion: 1 | '1';
  entry: string;
  geometryOnly?: boolean;
  source?: {
    application?: ImportedModelSourceApplication;
    file?: string;
    version?: string;
  };
}

export function createModelImportPlan(files: readonly File[]): ModelImportPlan {
  const directFiles = files.filter((file) => directFormatForFile(file));
  const nativeFiles = files.filter((file) => nativeApplicationForFile(file));
  const bundleFiles = files.filter(isSceneBundleFile);
  const recognized = new Set([...directFiles, ...nativeFiles, ...bundleFiles]);
  const usedDirect = new Set<File>();
  const jobs: ModelImportJob[] = bundleFiles.map((file) => ({ kind: 'bundle', file }));
  const issues: ModelImportPlanIssue[] = [];

  for (const nativeFile of nativeFiles) {
    const application = nativeApplicationForFile(nativeFile)!;
    const stem = fileStem(nativeFile.name);
    const sameStem = directFiles.find((candidate) => (
      !usedDirect.has(candidate) && fileStem(candidate.name).toLowerCase() === stem.toLowerCase()
    ));
    const onlyAvailable = nativeFiles.length === 1
      ? directFiles.find((candidate) => !usedDirect.has(candidate))
      : undefined;
    const bridge = sameStem ?? onlyAvailable;
    if (!bridge) {
      issues.push({
        fileName: nativeFile.name,
        tone: 'error',
        message: nativeBridgeMessage(application),
      });
      continue;
    }
    usedDirect.add(bridge);
    jobs.push({
      kind: 'file',
      file: bridge,
      sourceApplication: application,
      sourceSceneName: nativeFile.name,
    });
  }

  directFiles.forEach((file) => {
    if (!usedDirect.has(file)) jobs.push({ kind: 'file', file });
  });

  files.forEach((file) => {
    if (recognized.has(file)) return;
    const extension = fileExtension(file.name);
    if (extension === 'mtl' || extension === 'bin') {
      issues.push({
        fileName: file.name,
        tone: 'warning',
        message: extension === 'mtl'
          ? 'Material sidecars are ignored because imports are always texture-free graybox geometry.'
          : 'External .bin sidecars are not loaded yet. Export an embedded .gltf or, preferably, a single .glb.',
      });
      return;
    }
    issues.push({
      fileName: file.name,
      tone: 'error',
      message: 'This file type is not supported by the lightweight importer.',
    });
  });

  return { jobs, issues };
}

export async function importModelJob(job: ModelImportJob): Promise<ModelImportResult> {
  if (job.kind === 'bundle') {
    const bundled = await readSceneBundle(job.file);
    return importDirectModel(
      bundled.file,
      bundled.manifest.source?.application,
      bundled.manifest.source?.file,
      bundled.manifest.geometryOnly === false
        ? ['The bundle was not marked geometry-only; all materials and textures were stripped during import.']
        : [],
    );
  }
  return importDirectModel(job.file, job.sourceApplication, job.sourceSceneName);
}

export function nativeBridgeMessage(application: ImportedModelSourceApplication): string {
  if (application === 'blender') {
    return 'Blender .blend files need a companion geometry-only .glb with the same name, or a PanoRef scene bundle.';
  }
  if (application === 'maya') {
    return 'Maya .ma/.mb files need a companion geometry-only .fbx or .glb with the same name, or a PanoRef scene bundle.';
  }
  return 'Unreal scenes/assets need a companion geometry-only level/actor .glb or .fbx, or a PanoRef scene bundle.';
}

async function importDirectModel(
  file: File,
  sourceApplication?: ImportedModelSourceApplication,
  sourceSceneName?: string,
  initialWarnings: string[] = [],
): Promise<ModelImportResult> {
  assertSourceFileSize(file);
  const format = directFormatForFile(file);
  if (!format) throw new Error(`Unsupported model format: ${file.name}`);

  const loaded = await loadModel(file, format);
  try {
    const extracted = extractGeometry(loaded.root);
    const packed = encodePackedGrayboxMesh(extracted.positions, extracted.indices);
    const warnings = uniqueWarnings([
      ...initialWarnings,
      ...loaded.warnings,
      ...extracted.warnings,
      ...(loaded.materialCount > 0 || loaded.textureCount > 0
        ? [`Removed ${loaded.materialCount} material${loaded.materialCount === 1 ? '' : 's'} and ${loaded.textureCount} texture reference${loaded.textureCount === 1 ? '' : 's'} for graybox rendering.`]
        : []),
      ...(loaded.animationCount > 0
        ? [`Ignored ${loaded.animationCount} animation clip${loaded.animationCount === 1 ? '' : 's'}; imported the static scene pose.`]
        : []),
      ...(['obj', 'stl', 'ply'].includes(format)
        ? ['This format has no reliable unit metadata; 1 source unit is treated as 1 meter.']
        : []),
      ...(file.size >= IMPORT_WARNING_BYTES
        ? [`Large source file (${formatBytes(file.size)}); initial conversion may take longer on low-power devices.`]
        : []),
      ...(extracted.triangleCount >= IMPORT_WARNING_TRIANGLES
        ? [`Heavy geometry (${extracted.triangleCount.toLocaleString()} triangles) was imported unchanged.`]
        : []),
      ...(extracted.meshCount > 1
        ? [`Flattened ${extracted.meshCount} mesh nodes into one selectable graybox object without removing triangles.`]
        : []),
    ]);

    const assetId = createId('model');
    const sourceKind = sourceApplication || extracted.meshCount > 1 ? 'scene' : 'model';
    const sourceName = sourceSceneName ?? file.name;
    const now = new Date().toISOString();
    const asset: ProjectAsset = {
      id: assetId,
      type: 'model',
      name: `${fileStem(sourceName)}.panoref-mesh`,
      uri: packed.uri,
      mimeType: 'application/vnd.panoref.graybox-mesh',
      createdAt: now,
      metadata: {
        sourceName,
        bridgeFileName: sourceSceneName ? file.name : undefined,
        sourceFormat: format,
        sourceApplication,
        vertexCount: extracted.vertexCount,
        triangleCount: extracted.triangleCount,
        meshCount: extracted.meshCount,
        packedBytes: packed.byteLength,
        sourceBounds: extracted.sourceBounds,
        geometrySimplified: false,
        hierarchyFlattened: true,
      },
    };
    const object: SceneObject = {
      id: createId('obj'),
      name: fileStem(sourceName),
      type: 'imported_model',
      transform: createTransform(extracted.center),
      dimensions: extracted.dimensions,
      category: 'architecture',
      locked: false,
      visible: true,
      modelAssetId: assetId,
      importedModel: {
        sourceName,
        sourceFormat: format,
        sourceKind,
        sourceApplication,
        sourceSceneName,
        vertexCount: extracted.vertexCount,
        triangleCount: extracted.triangleCount,
        meshCount: extracted.meshCount,
        geometrySimplified: false,
        hierarchyFlattened: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
    return { asset, object };
  } finally {
    disposeLoadedRoot(loaded.root);
  }
}

async function loadModel(file: File, format: DirectModelFormat): Promise<LoadedModel> {
  if (format === 'glb' || format === 'gltf') return loadGltf(file, format);
  if (format === 'obj') {
    const [{ OBJLoader }, text] = await Promise.all([
      import('three/addons/loaders/OBJLoader.js'),
      file.text(),
    ]);
    return describeLoadedRoot(new OBJLoader().parse(text));
  }
  if (format === 'stl') {
    const [{ STLLoader }, buffer] = await Promise.all([
      import('three/addons/loaders/STLLoader.js'),
      file.arrayBuffer(),
    ]);
    const geometry = new STLLoader().parse(buffer);
    return describeLoadedRoot(new THREE.Mesh(geometry));
  }
  if (format === 'ply') {
    const [{ PLYLoader }, buffer] = await Promise.all([
      import('three/addons/loaders/PLYLoader.js'),
      file.arrayBuffer(),
    ]);
    const geometry = new PLYLoader().parse(buffer);
    return describeLoadedRoot(new THREE.Mesh(geometry));
  }

  const [{ FBXLoader }, buffer] = await Promise.all([
    import('three/addons/loaders/FBXLoader.js'),
    file.arrayBuffer(),
  ]);
  const manager = textureBlockingManager();
  const root = new FBXLoader(manager).parse(buffer, '');
  return describeLoadedRoot(root);
}

async function loadGltf(file: File, format: 'glb' | 'gltf'): Promise<LoadedModel> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader(textureBlockingManager());
  let sanitized: string | ArrayBuffer;
  let strippedMaterialCount = 0;
  let strippedTextureCount = 0;

  if (format === 'glb') {
    const result = sanitizeGlb(await file.arrayBuffer());
    sanitized = result.buffer;
    strippedMaterialCount = result.materialCount;
    strippedTextureCount = result.textureCount;
  } else {
    const document = parseGltfJson(await file.text());
    assertEmbeddedGltfBuffers(document);
    const result = sanitizeGltfDocument(document);
    sanitized = JSON.stringify(result.document);
    strippedMaterialCount = result.materialCount;
    strippedTextureCount = result.textureCount;
  }

  let gltf: Awaited<ReturnType<InstanceType<typeof GLTFLoader>['parseAsync']>>;
  try {
    gltf = await loader.parseAsync(sanitized, '');
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not parse ${file.name}: ${error.message}`
        : `Could not parse ${file.name}.`,
    );
  }
  const described = describeLoadedRoot(gltf.scene);
  described.materialCount += strippedMaterialCount;
  described.textureCount += strippedTextureCount;
  described.animationCount = gltf.animations.length;
  return described;
}

function extractGeometry(root: THREE.Object3D): ExtractedGeometry {
  type Part = {
    geometry: THREE.BufferGeometry;
    matrix: THREE.Matrix4;
    vertexCount: number;
    indexCount: number;
    flipWinding: boolean;
  };
  const parts: Part[] = [];
  const warnings: string[] = [];
  let totalVertices = 0;
  let totalIndices = 0;
  let meshCount = 0;
  let sawSkinnedMesh = false;
  let sawMorphTargets = false;

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position || position.itemSize < 3 || position.count === 0) return;
    const indexCount = mesh.geometry.index?.count ?? position.count;
    if (indexCount === 0 || indexCount % 3 !== 0) {
      throw new Error(`Mesh "${mesh.name || 'unnamed'}" is not triangle geometry.`);
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) sawSkinnedMesh = true;
    if (Object.keys(mesh.geometry.morphAttributes).length > 0) sawMorphTargets = true;

    const addPart = (matrix: THREE.Matrix4) => {
      totalVertices += position.count;
      totalIndices += indexCount;
      meshCount += 1;
      if (totalVertices > MAX_IMPORT_VERTICES || totalIndices / 3 > MAX_IMPORT_TRIANGLES) {
        throw new Error(
          `Geometry exceeds the safety limit of ${MAX_IMPORT_VERTICES.toLocaleString()} vertices or ${MAX_IMPORT_TRIANGLES.toLocaleString()} triangles. No geometry was simplified.`,
        );
      }
      parts.push({
        geometry: mesh.geometry,
        matrix,
        vertexCount: position.count,
        indexCount,
        flipWinding: matrix.determinant() < 0,
      });
    };

    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      const instanceMatrix = new THREE.Matrix4();
      for (let index = 0; index < instanced.count; index += 1) {
        instanced.getMatrixAt(index, instanceMatrix);
        addPart(new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix));
      }
    } else {
      addPart(mesh.matrixWorld.clone());
    }
  });

  if (parts.length === 0) throw new Error('No triangle meshes were found in this file.');
  if (sawSkinnedMesh) warnings.push('Skinned geometry was imported in its static bind pose.');
  if (sawMorphTargets) warnings.push('Morph target animation was ignored; base geometry was imported.');

  const positions = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new THREE.Vector3();
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const part of parts) {
    const sourcePosition = part.geometry.getAttribute('position');
    for (let index = 0; index < part.vertexCount; index += 1) {
      vertex.set(sourcePosition.getX(index), sourcePosition.getY(index), sourcePosition.getZ(index));
      vertex.applyMatrix4(part.matrix);
      if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) {
        throw new Error('Imported geometry contains a non-finite transformed vertex.');
      }
      const target = (vertexOffset + index) * 3;
      positions[target] = vertex.x;
      positions[target + 1] = vertex.y;
      positions[target + 2] = vertex.z;
      min.min(vertex);
      max.max(vertex);
    }
    const sourceIndex = part.geometry.index;
    for (let index = 0; index < part.indexCount; index += 3) {
      const a = (sourceIndex?.getX(index) ?? index) + vertexOffset;
      const b = (sourceIndex?.getX(index + 1) ?? index + 1) + vertexOffset;
      const c = (sourceIndex?.getX(index + 2) ?? index + 2) + vertexOffset;
      indices[indexOffset + index] = a;
      indices[indexOffset + index + 1] = part.flipWinding ? c : b;
      indices[indexOffset + index + 2] = part.flipWinding ? b : c;
    }
    vertexOffset += part.vertexCount;
    indexOffset += part.indexCount;
  }

  // Keep source-space placement exactly: center local vertices and place the wrapper at that center.
  const centerVector = min.clone().add(max).multiplyScalar(0.5);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= centerVector.x;
    positions[index + 1] -= centerVector.y;
    positions[index + 2] -= centerVector.z;
  }
  const size = max.clone().sub(min);
  const dimensions: Vec3 = [
    Math.max(size.x, 0.001),
    Math.max(size.y, 0.001),
    Math.max(size.z, 0.001),
  ];

  return {
    positions,
    indices,
    center: centerVector.toArray() as Vec3,
    dimensions,
    meshCount,
    vertexCount: totalVertices,
    triangleCount: totalIndices / 3,
    warnings,
    sourceBounds: {
      min: min.toArray() as Vec3,
      max: max.toArray() as Vec3,
    },
  };
}

function describeLoadedRoot(root: THREE.Object3D): LoadedModel {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
          textures.add(value as THREE.Texture);
        }
      });
    });
  });
  return {
    root,
    materialCount: materials.size,
    textureCount: textures.size,
    animationCount: 0,
    warnings: [],
  };
}

function sanitizeGlb(buffer: ArrayBuffer): {
  buffer: ArrayBuffer;
  materialCount: number;
  textureCount: number;
} {
  if (buffer.byteLength < 20) throw new Error('GLB file is too small.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error('Only valid glTF 2.0 GLB files are supported.');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB file length is invalid.');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + jsonLength > buffer.byteLength) {
    throw new Error('GLB JSON chunk is invalid.');
  }

  const jsonBytes = new Uint8Array(buffer, 20, jsonLength);
  const document = parseGltfJson(new TextDecoder().decode(jsonBytes).replace(/[\u0000\s]+$/g, ''));
  const sanitized = sanitizeGltfDocument(document);
  const encoded = new TextEncoder().encode(JSON.stringify(sanitized.document));
  const paddedJsonLength = (encoded.byteLength + 3) & ~3;
  const oldRestOffset = 20 + jsonLength;
  const rest = new Uint8Array(buffer, oldRestOffset);
  const output = new ArrayBuffer(20 + paddedJsonLength + rest.byteLength);
  const outputView = new DataView(output);
  outputView.setUint32(0, GLB_MAGIC, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.byteLength, true);
  outputView.setUint32(12, paddedJsonLength, true);
  outputView.setUint32(16, GLB_JSON_CHUNK, true);
  const outputBytes = new Uint8Array(output);
  outputBytes.fill(0x20, 20, 20 + paddedJsonLength);
  outputBytes.set(encoded, 20);
  outputBytes.set(rest, 20 + paddedJsonLength);
  return {
    buffer: output,
    materialCount: sanitized.materialCount,
    textureCount: sanitized.textureCount,
  };
}

function sanitizeGltfDocument(document: Record<string, unknown>): {
  document: Record<string, unknown>;
  materialCount: number;
  textureCount: number;
} {
  assertSupportedGltfFeatures(document);
  const materials = Array.isArray(document.materials) ? document.materials : [];
  const textures = Array.isArray(document.textures) ? document.textures : [];
  const images = Array.isArray(document.images) ? document.images : [];
  const meshes = Array.isArray(document.meshes) ? document.meshes : [];
  meshes.forEach((mesh) => {
    if (!mesh || typeof mesh !== 'object') return;
    const primitives = Array.isArray((mesh as { primitives?: unknown[] }).primitives)
      ? (mesh as { primitives: Array<Record<string, unknown>> }).primitives
      : [];
    primitives.forEach((primitive) => {
      delete primitive.material;
      const extensions = primitive.extensions as Record<string, unknown> | undefined;
      if (extensions) delete extensions.KHR_materials_variants;
    });
  });
  delete document.materials;
  delete document.textures;
  delete document.images;
  delete document.samplers;
  document.extensionsUsed = filterGltfExtensions(document.extensionsUsed);
  document.extensionsRequired = filterGltfExtensions(document.extensionsRequired);
  return {
    document,
    materialCount: materials.length,
    textureCount: Math.max(textures.length, images.length),
  };
}

function assertSupportedGltfFeatures(document: Record<string, unknown>) {
  const required = Array.isArray(document.extensionsRequired) ? document.extensionsRequired : [];
  const compressed = required.filter((extension) => (
    extension === 'KHR_draco_mesh_compression' || extension === 'EXT_meshopt_compression'
  ));
  if (compressed.length > 0) {
    throw new Error(
      `Compressed glTF geometry (${compressed.join(', ')}) is not enabled in the lightweight importer. Export an uncompressed geometry-only GLB.`,
    );
  }
}

function assertEmbeddedGltfBuffers(document: Record<string, unknown>) {
  const buffers = Array.isArray(document.buffers) ? document.buffers : [];
  const external = buffers.some((buffer) => {
    const uri = buffer && typeof buffer === 'object' ? (buffer as { uri?: unknown }).uri : undefined;
    return typeof uri === 'string' && !uri.startsWith('data:');
  });
  if (external) {
    throw new Error('External .gltf buffer files are not loaded yet. Export an embedded .gltf or a single .glb.');
  }
}

function filterGltfExtensions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((extension): extension is string => (
    typeof extension === 'string'
    && !TEXTURE_ONLY_GLTF_EXTENSIONS.has(extension)
    && extension !== 'KHR_materials_variants'
  ));
}

function parseGltfJson(text: string): Record<string, unknown> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('glTF JSON is invalid.');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('glTF JSON root is invalid.');
  }
  const asset = (document as { asset?: { version?: unknown } }).asset;
  if (!asset || asset.version !== '2.0') throw new Error('Only glTF 2.0 is supported.');
  return document as Record<string, unknown>;
}

async function readSceneBundle(file: File): Promise<{ file: File; manifest: SceneBundleManifestData }> {
  assertSourceFileSize(file);
  const { default: JSZip } = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name} is not a valid PanoRef scene bundle.`);
  }
  const entries = Object.keys(zip.files);
  if (entries.length > MAX_BUNDLE_ENTRIES) {
    throw new Error(`Scene bundle contains more than ${MAX_BUNDLE_ENTRIES} entries.`);
  }
  const manifestEntry = zip.file(SCENE_BUNDLE_MANIFEST);
  if (!manifestEntry) throw new Error(`Scene bundle is missing ${SCENE_BUNDLE_MANIFEST}.`);
  const manifestSizes = zipEntrySizes(manifestEntry);
  if (manifestSizes.uncompressed > MAX_MANIFEST_BYTES) {
    throw new Error('Scene bundle manifest is too large.');
  }
  const manifestText = await manifestEntry.async('string');
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Scene bundle manifest is too large.');
  }
  const manifest = parseSceneBundleManifest(manifestText);
  const modelEntry = zip.file(manifest.entry);
  if (!modelEntry) throw new Error(`Scene bundle entry ${manifest.entry} is missing.`);
  const entrySizes = zipEntrySizes(modelEntry);
  if (entrySizes.uncompressed > MAX_SOURCE_MODEL_BYTES) {
    throw new Error(`Bundled model is above the ${formatBytes(MAX_SOURCE_MODEL_BYTES)} safety limit.`);
  }
  if (entrySizes.compressed > 0 && entrySizes.uncompressed / entrySizes.compressed > MAX_BUNDLE_COMPRESSION_RATIO) {
    throw new Error('Scene bundle entry has an unsafe compression ratio.');
  }
  const bytes = await modelEntry.async('uint8array');
  if (bytes.byteLength > MAX_SOURCE_MODEL_BYTES) {
    throw new Error(`Bundled model is above the ${formatBytes(MAX_SOURCE_MODEL_BYTES)} safety limit.`);
  }
  const name = manifest.entry.split('/').at(-1) ?? manifest.entry;
  const modelFile = new File([bytes], name);
  if (!directFormatForFile(modelFile)) {
    throw new Error('Scene bundle entry must be GLB, embedded glTF, OBJ, STL, PLY, or FBX.');
  }
  return { file: modelFile, manifest };
}

function parseSceneBundleManifest(text: string): SceneBundleManifestData {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error('Scene bundle manifest is not valid JSON.');
  }
  if (!manifest || typeof manifest !== 'object') throw new Error('Scene bundle manifest is invalid.');
  const value = manifest as SceneBundleManifestData;
  if (String(value.schemaVersion) !== '1') throw new Error('Unsupported scene bundle schema version.');
  if (!isSafeBundlePath(value.entry)) throw new Error('Scene bundle entry path is unsafe or missing.');
  if (value.source?.application && !['blender', 'maya', 'unreal'].includes(value.source.application)) {
    throw new Error('Scene bundle source application is invalid.');
  }
  return value;
}

function textureBlockingManager() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:application/') || url.startsWith('data:application/octet-stream')) return url;
    return EMPTY_TEXTURE_DATA_URL;
  });
  return manager;
}

function disposeLoadedRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (!mesh.material) return;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
          textures.add(value as THREE.Texture);
        }
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function directFormatForFile(file: Pick<File, 'name'>): DirectModelFormat | undefined {
  const extension = fileExtension(file.name);
  return DIRECT_MODEL_EXTENSIONS.find((format) => format === extension);
}

function nativeApplicationForFile(file: Pick<File, 'name'>): ImportedModelSourceApplication | undefined {
  const extension = fileExtension(file.name);
  if (extension === 'blend') return 'blender';
  if (extension === 'ma' || extension === 'mb') return 'maya';
  if (extension === 'uproject' || extension === 'umap' || extension === 'uasset') return 'unreal';
  return undefined;
}

function isSceneBundleFile(file: Pick<File, 'name'>) {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.panoscene') || lower.endsWith('.panoscene.zip');
}

function isSafeBundlePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/).includes('..');
}

function zipEntrySizes(entry: unknown): { compressed: number; uncompressed: number } {
  const data = (entry as {
    _data?: { compressedSize?: unknown; uncompressedSize?: unknown };
  })._data;
  return {
    compressed: typeof data?.compressedSize === 'number' ? data.compressedSize : 0,
    uncompressed: typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : 0,
  };
}

function assertSourceFileSize(file: File) {
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_SOURCE_MODEL_BYTES) {
    throw new Error(
      `${file.name} is ${formatBytes(file.size)}, above the ${formatBytes(MAX_SOURCE_MODEL_BYTES)} safety limit. No geometry was simplified.`,
    );
  }
}

function fileExtension(name: string) {
  return name.toLowerCase().split('.').at(-1) ?? '';
}

function fileStem(name: string) {
  return name.replace(/\.(panoscene\.zip|[^.]+)$/i, '') || 'Imported model';
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings.filter(Boolean))];
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
