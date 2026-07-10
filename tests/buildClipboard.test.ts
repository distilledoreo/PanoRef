import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/domain/defaults';
import {
  BUILD_CLIPBOARD_KIND,
  createBuildClipboardPayload,
  parseBuildClipboard,
  pasteBuildClipboardObjects,
  serializeBuildClipboard,
} from '../src/engine/buildClipboard';

describe('Build clipboard', () => {
  it('round-trips a versioned, isolated payload', () => {
    const object = createSceneObject('box', 1);
    object.metadata = { source: 'test' };
    const payload = createBuildClipboardPayload('project-a', [object]);
    const parsed = parseBuildClipboard(serializeBuildClipboard(payload));

    expect(parsed?.kind).toBe(BUILD_CLIPBOARD_KIND);
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
});
