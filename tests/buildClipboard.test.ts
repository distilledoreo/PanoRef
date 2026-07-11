import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/domain/defaults';
import {
  BUILD_CLIPBOARD_KIND,
  BUILD_CLIPBOARD_VERSION,
  createBuildClipboardPayload,
  parseBuildClipboard,
  pasteBuildClipboardObjects,
  pasteBuildClipboardObjectsWithAssets,
  serializeBuildClipboard,
} from '../src/engine/buildClipboard';
import { encodePackedGrayboxMesh } from '../src/engine/importedMesh';
import { AssetRegistry, ProjectAsset, SceneObject } from '../src/domain/types';
import { createTransform } from '../src/domain/defaults';

describe('Build clipboard', () => {
  it('round-trips a versioned, isolated payload', () => {
    const object = createSceneObject('box', 1);
    object.metadata = { source: 'test' };
    const payload = createBuildClipboardPayload('project-a', [object]);
    const parsed = parseBuildClipboard(serializeBuildClipboard(payload));

    expect(parsed?.kind).toBe(BUILD_CLIPBOARD_KIND);
    expect(parsed?.version).toBe(BUILD_CLIPBOARD_VERSION);
    expect(parsed?.sourceProjectId).toBe('project-a');
    expect(parsed?.objects[0]).toEqual(object);
    parsed!.objects[0].name = 'Changed';
    expect(payload.objects[0].name).not.toBe('Changed');
  });

  it('rejects unrelated, malformed, and non-finite clipboard data', () => {
    expect(parseBuildClipboard('plain text')).toBeUndefined();
    expect(parseBuildClipboard('{"kind":"other"}')).toBeUndefined();
    const object = createSceneObject('box', 1);
    const payload = createBuildClipboardPayload('project-a', [object]);
    const value = JSON.parse(serializeBuildClipboard(payload));
    value.objects[0].transform.position[0] = 'NaN';
    expect(parseBuildClipboard(JSON.stringify(value))).toBeUndefined();
  });

  it('pastes fresh, unlocked objects with cascading or in-place coordinates', () => {
    const source = createSceneObject('box', 1);
    source.transform.position = [2, 1, 3];
    source.locked = true;
    source.visible = false;
    const payload = createBuildClipboardPayload('project-a', [source]);

    const first = pasteBuildClipboardObjects({ payload, existingObjects: [source], pasteIndex: 1, snapToGrid: false });
    const second = pasteBuildClipboardObjects({ payload, existingObjects: [source, ...first], pasteIndex: 2, snapToGrid: false });
    const inPlace = pasteBuildClipboardObjects({ payload, existingObjects: [source], pasteIndex: 0, snapToGrid: false, inPlace: true });

    expect(first[0].id).not.toBe(source.id);
    expect(first[0].name).toBe('Box 2');
    expect(first[0].transform.position).toEqual([2.75, 1, 3.75]);
    expect(second[0].transform.position).toEqual([3.5, 1, 4.5]);
    expect(inPlace[0].transform.position).toEqual(source.transform.position);
    expect(first[0]).toMatchObject({ locked: false, visible: true });
  });

  it('includes model assets in payload for imported models', () => {
    const packed = encodePackedGrayboxMesh(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    const asset: ProjectAsset = {
      id: 'model_1',
      type: 'model',
      name: 'chair.panoref-mesh',
      uri: packed.uri,
      createdAt: new Date().toISOString(),
    };
    const obj: SceneObject = {
      id: 'obj_1',
      name: 'Chair',
      type: 'imported_model',
      transform: createTransform([1, 0, 0]),
      dimensions: [1, 1, 0.001],
      category: 'architecture',
      locked: false,
      visible: true,
      modelAssetId: asset.id,
    };
    const registry: AssetRegistry = { assets: { [asset.id]: asset } };
    const payload = createBuildClipboardPayload('project-a', [obj], registry);

    expect(payload.assets).toBeTruthy();
    expect(payload.assets![asset.id].uri).toBe(asset.uri);

    const parsed = parseBuildClipboard(serializeBuildClipboard(payload));
    expect(parsed).toBeTruthy();
    expect(parsed?.assets?.[asset.id].uri).toBe(asset.uri);
  });

  it('pastes imported objects with asset remapping and dedup', () => {
    const packed = encodePackedGrayboxMesh(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    const asset: ProjectAsset = {
      id: 'model_1',
      type: 'model',
      name: 'chair.panoref-mesh',
      uri: packed.uri,
      createdAt: new Date().toISOString(),
    };
    const obj: SceneObject = {
      id: 'obj_1',
      name: 'Chair',
      type: 'imported_model',
      transform: createTransform([1, 0, 0]),
      dimensions: [1, 1, 0.001],
      category: 'architecture',
      locked: false,
      visible: true,
      modelAssetId: asset.id,
    };
    const registry: AssetRegistry = { assets: { [asset.id]: asset } };
    const payload = createBuildClipboardPayload('project-a', [obj], registry);

    // Cross-project paste – no existing assets
    const crossResult = pasteBuildClipboardObjectsWithAssets({
      payload,
      existingObjects: [],
      existingAssets: { assets: {} },
      pasteIndex: 1,
      snapToGrid: false,
    });
    expect(crossResult.objects).toHaveLength(1);
    expect(Object.keys(crossResult.assets)).toHaveLength(1);
    expect(crossResult.objects[0].modelAssetId).toBe('model_1');

    // Same-project reuse – existing asset with same URI
    const sameResult = pasteBuildClipboardObjectsWithAssets({
      payload,
      existingObjects: [],
      existingAssets: registry,
      pasteIndex: 1,
      snapToGrid: false,
    });
    expect(Object.keys(sameResult.assets)).toHaveLength(0); // reused, no new asset
    expect(sameResult.objects[0].modelAssetId).toBe('model_1');

    // Collision with different URI – new ID created
    const collidingAsset: ProjectAsset = {
      id: 'model_1',
      type: 'model',
      name: 'other.panoref-mesh',
      uri: encodePackedGrayboxMesh(
        new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
        new Uint32Array([0, 1, 2]),
      ).uri,
      createdAt: new Date().toISOString(),
    };
    const collisionResult = pasteBuildClipboardObjectsWithAssets({
      payload,
      existingObjects: [],
      existingAssets: { assets: { [collidingAsset.id]: collidingAsset } },
      pasteIndex: 1,
      snapToGrid: false,
    });
    expect(Object.keys(collisionResult.assets)).toHaveLength(1);
    expect(collisionResult.objects[0].modelAssetId).not.toBe('model_1');
  });

  it('rejects v1 payload that references model assets (old buggy placeholder)', () => {
    const payload = {
      kind: BUILD_CLIPBOARD_KIND,
      version: 1,
      sourceProjectId: 'project-a',
      copiedAt: new Date().toISOString(),
      anchor: [0, 0, 0],
      objects: [
        {
          id: 'obj_1',
          name: 'Chair',
          type: 'imported_model',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          dimensions: [1, 1, 1],
          category: 'architecture',
          locked: false,
          visible: true,
          modelAssetId: 'model_1',
        },
      ],
    };
    expect(parseBuildClipboard(JSON.stringify(payload))).toBeUndefined();
  });
});
