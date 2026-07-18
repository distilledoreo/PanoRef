import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureModelAssetStoreForTests,
  deleteModelAsset,
  getModelAsset,
  putModelAsset,
  resetModelAssetStoreForTests,
  restoreModelAssetWrites,
} from '../src/engine/modelAssetStore';
import { createDefaultProject, createTransform } from '../src/domain/defaults';
import { encodeBinaryGrayboxMesh, encodePackedGrayboxMesh, MODEL_ASSET_URI_PREFIX } from '../src/engine/importedMesh';
import { createProjectPackage, readProjectFile } from '../src/engine/projectIO';
import JSZip from 'jszip';

describe('binary model asset storage', () => {
  beforeEach(resetModelAssetStoreForTests);

  it('creates, retrieves, and deletes binary geometry without sharing mutable buffers', async () => {
    await putModelAsset('mesh/a', new Uint8Array([1, 2, 3]).buffer);
    const first = new Uint8Array((await getModelAsset('mesh/a'))!);
    first[0] = 9;
    expect(Array.from(new Uint8Array((await getModelAsset('mesh/a'))!))).toEqual([1, 2, 3]);
    await deleteModelAsset('mesh/a');
    expect(await getModelAsset('mesh/a')).toBeUndefined();
  });

  it('does not create an asset when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(putModelAsset('mesh/cancelled', new ArrayBuffer(8), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await getModelAsset('mesh/cancelled')).toBeUndefined();
  });

  it('round-trips a binary-backed model through a project package', async () => {
    const packed = encodeBinaryGrayboxMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
    await putModelAsset('project/mesh', packed.buffer);
    const project = createDefaultProject();
    project.assets.assets.mesh = { id: 'mesh', type: 'model', name: 'mesh.panoref-mesh', uri: `${MODEL_ASSET_URI_PREFIX}project/mesh`, createdAt: new Date(0).toISOString() };
    project.scene.objects.push({ id: 'model-object', name: 'Model', type: 'imported_model', transform: createTransform(), dimensions: [1, 1, 0.001], category: 'architecture', locked: false, visible: true, modelAssetId: 'mesh' });
    const blob = await createProjectPackage(project);
    resetModelAssetStoreForTests();
    const reopened = await readProjectFile(new File([blob], 'scene.panoref-project'));
    expect(reopened.assets.assets.mesh.uri).toBe(`${MODEL_ASSET_URI_PREFIX}project/mesh`);
    expect(Array.from(new Uint8Array((await getModelAsset('project/mesh'))!))).toEqual(Array.from(new Uint8Array(packed.buffer)));
  });

  it('restores several package assets through one bounded operation', async () => {
    const first = encodeBinaryGrayboxMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
    const second = encodeBinaryGrayboxMesh(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), new Uint32Array([0, 1, 2]));
    await restoreModelAssetWrites([
      { assetId: 'asset-a', storageKey: 'project/a', filename: 'a.panoref-mesh', mimeType: 'application/vnd.panoref.graybox-mesh', size: first.buffer.byteLength, bytes: first.buffer },
      { assetId: 'asset-b', storageKey: 'project/b', filename: 'b.panoref-mesh', mimeType: 'application/vnd.panoref.graybox-mesh', size: second.buffer.byteLength, bytes: second.buffer },
    ], { projectId: 'project-1', projectName: 'Several models' });
    expect(await getModelAsset('project/a')).toEqual(first.buffer);
    expect(await getModelAsset('project/b')).toEqual(second.buffer);
  });

  it('preflights quota and reports a structured storage error before writing', async () => {
    configureModelAssetStoreForTests({
      backend: 'indexeddb',
      storageEstimate: async () => ({ usage: 950, quota: 1_000 }),
    });
    const bytes = new Uint8Array(128).buffer;
    const error = await restoreModelAssetWrites([
      { assetId: 'asset-quota', storageKey: 'quota/key', filename: 'throne-room.glb', mimeType: 'model/gltf-binary', size: bytes.byteLength, bytes },
    ], { projectId: 'quota-project', projectName: 'Quota project' }).catch((cause) => cause as unknown as Error & { details?: unknown });
    expect(error).toMatchObject({
      name: 'ModelAssetRestoreError',
      details: expect.objectContaining({
        operation: 'restore model asset bytes while opening project',
        projectId: 'quota-project',
        assetId: 'asset-quota',
        filename: 'throne-room.glb',
        mimeType: 'model/gltf-binary',
        size: 128,
        storageBackend: 'indexeddb',
        underlyingExceptionName: 'QuotaExceededError',
        rollbackSucceeded: true,
      }),
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('No project changes were committed');
  });

  it('rolls back every write from a failed restore and preserves the prior asset', async () => {
    const oldBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const nextBytes = new Uint8Array([8, 9, 10, 11]).buffer;
    await putModelAsset('rollback/a', oldBytes);
    configureModelAssetStoreForTests({
      backend: 'memory',
      beforeWrite: (key) => {
        if (key === 'rollback/b') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    });
    await expect(restoreModelAssetWrites([
      { assetId: 'asset-a', storageKey: 'rollback/a', filename: 'a.panoref-mesh', mimeType: 'application/octet-stream', size: nextBytes.byteLength, bytes: nextBytes },
      { assetId: 'asset-b', storageKey: 'rollback/b', filename: 'b.panoref-mesh', mimeType: 'application/octet-stream', size: nextBytes.byteLength, bytes: nextBytes },
    ], { projectId: 'rollback-project', projectName: 'Rollback project' })).rejects.toMatchObject({
      details: expect.objectContaining({ rollbackSucceeded: true, underlyingExceptionName: 'QuotaExceededError' }),
    });
    expect(await getModelAsset('rollback/a')).toEqual(oldBytes);
    expect(await getModelAsset('rollback/b')).toBeUndefined();
  });

  it('revokes temporary object URLs after a failed restore', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    configureModelAssetStoreForTests({
      backend: 'memory',
      beforeWrite: () => { throw new Error('write failed'); },
    });
    await expect(restoreModelAssetWrites([
      { assetId: 'asset-url', storageKey: 'url/key', filename: 'url.panoref-mesh', mimeType: 'application/octet-stream', size: 1, bytes: new Uint8Array([1]).buffer },
    ], { projectId: 'url-project', projectName: 'URL project', temporaryObjectUrls: ['blob:http://localhost/temporary'] })).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/temporary');
    revoke.mockRestore();
  });

  it('migrates legacy base64 geometry into a binary package on save', async () => {
    const legacy = encodePackedGrayboxMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
    const project = createDefaultProject();
    project.assets.assets.mesh = { id: 'mesh', type: 'model', name: 'legacy.panoref-mesh', uri: legacy.uri, createdAt: new Date(0).toISOString() };
    project.scene.objects.push({ id: 'model-object', name: 'Model', type: 'imported_model', transform: createTransform(), dimensions: [1, 1, 0.001], category: 'architecture', locked: false, visible: true, modelAssetId: 'mesh' });
    const zip = await JSZip.loadAsync(await (await createProjectPackage(project)).arrayBuffer());
    const manifest = await zip.file('project.json')!.async('text');
    expect(manifest).toContain(MODEL_ASSET_URI_PREFIX);
    expect(manifest).not.toContain(';base64,');
  });

  it('reports a recoverable missing binary in a project package', async () => {
    const project = createDefaultProject();
    project.assets.assets.mesh = { id: 'mesh', type: 'model', name: 'missing.panoref-mesh', uri: `${MODEL_ASSET_URI_PREFIX}missing/key`, createdAt: new Date(0).toISOString() };
    project.scene.objects.push({ id: 'model-object', name: 'Model', type: 'imported_model', transform: createTransform(), dimensions: [1, 1, 0.001], category: 'architecture', locked: false, visible: true, modelAssetId: 'mesh' });
    await expect(createProjectPackage(project)).rejects.toThrow('binary model asset missing.panoref-mesh is missing');
  });

  it('converts legacy browser-session model URLs into a relinkable missing asset state', () => {
    const project = createDefaultProject();
    project.assets.assets.mesh = { id: 'mesh', type: 'model', name: 'legacy.glb', uri: 'blob:https://example.test/session', createdAt: new Date(0).toISOString() };
    project.scene.objects.push({ id: 'model-object', name: 'Model', type: 'imported_model', transform: createTransform(), dimensions: [1, 1, 0.001], category: 'architecture', locked: false, visible: true, modelAssetId: 'mesh' });
    const reopened = readProjectFile(new File([serializeProjectForTest(project)], 'legacy.json'));
    return expect(reopened).resolves.toMatchObject({
      assets: { assets: { mesh: { uri: expect.stringContaining('panoref-missing:'), metadata: { relinkRequired: true } } } },
    });
  });
});

function serializeProjectForTest(project: ReturnType<typeof createDefaultProject>) {
  return JSON.stringify(project);
}
