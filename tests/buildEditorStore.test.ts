import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { createBuildClipboardPayload } from '../src/engine/buildClipboard';
import { useContinuityStore } from '../src/state/useContinuityStore';

describe('Build editor store operations', () => {
  beforeEach(() => {
    const project = createDefaultProject();
    useContinuityStore.setState({
      project,
      selectedObjectIds: [],
      buildClipboard: undefined,
      buildClipboardPasteCount: 0,
      gridSnap: true,
      buildMode: 'select',
      buildHistoryPast: [],
      buildHistoryFuture: [],
      buildHistoryBatchDepth: 0,
      buildHistoryBatchCaptured: false,
      buildHistoryCoalesceActive: false,
      buildTransformPivot: undefined,
    });
  });

  it('supports replace, toggle, range, select-all, and clear selection', () => {
    const store = useContinuityStore.getState();
    const ids = store.project.scene.objects.map((object) => object.id);
    store.selectObject(ids[0]);
    useContinuityStore.getState().selectObject(ids[1], 'toggle');
    expect(useContinuityStore.getState().selectedObjectIds).toEqual([ids[0], ids[1]]);
    useContinuityStore.getState().selectObjectRange(ids.at(-1)!);
    expect(useContinuityStore.getState().selectedObjectIds).toEqual(ids);
    useContinuityStore.getState().clearObjectSelection();
    expect(useContinuityStore.getState().selectedObjectIds).toEqual([]);
    useContinuityStore.getState().selectAllObjects();
    expect(useContinuityStore.getState().selectedObjectIds).toEqual(
      store.project.scene.objects.filter((object) => object.visible && !object.locked).map((object) => object.id),
    );
  });

  it('blocks destructive group operations when any selected object is locked', () => {
    const state = useContinuityStore.getState();
    const [first, second] = state.project.scene.objects;
    const project = structuredClone(state.project);
    project.scene.objects.find((object) => object.id === second.id)!.locked = true;
    useContinuityStore.setState({ project, selectedObjectIds: [first.id, second.id] });

    expect(useContinuityStore.getState().removeSelectedObjects()).toBe(false);
    expect(useContinuityStore.getState().translateSelectedObjectsBy([1, 0, 0])).toBe(false);
    expect(useContinuityStore.getState().project.scene.objects).toHaveLength(state.project.scene.objects.length);
  });

  it('pastes repeatedly with cascading offsets and restores selection through undo', () => {
    const state = useContinuityStore.getState();
    const source = state.project.scene.objects[0];
    const payload = createBuildClipboardPayload(state.project.id, [source]);
    state.setBuildClipboard(payload);

    const first = useContinuityStore.getState().pasteBuildObjects(payload);
    const second = useContinuityStore.getState().pasteBuildObjects(payload);
    expect(first[0].transform.position[0] - source.transform.position[0]).toBe(1);
    expect(second[0].transform.position[0] - source.transform.position[0]).toBe(1.5);
    expect(useContinuityStore.getState().selectedObjectIds).toEqual([second[0].id]);

    expect(useContinuityStore.getState().undoBuild()).toBe(true);
    expect(useContinuityStore.getState().selectedObjectIds).toEqual([first[0].id]);
    expect(useContinuityStore.getState().project.scene.objects.some((object) => object.id === second[0].id)).toBe(false);
  });

  it('duplicates a set as one undoable edit and selects the clones', () => {
    const state = useContinuityStore.getState();
    const selected = state.project.scene.objects.slice(0, 2);
    useContinuityStore.setState({ selectedObjectIds: selected.map((object) => object.id) });
    const duplicates = useContinuityStore.getState().duplicateSelectedObjects();
    expect(duplicates).toHaveLength(2);
    expect(useContinuityStore.getState().selectedObjectIds).toEqual(duplicates.map((object) => object.id));
    expect(useContinuityStore.getState().buildHistoryPast).toHaveLength(1);
  });
});
