import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { createPlacedSceneObject, duplicateSceneObject, snapBuildPoint } from '../src/engine/sandbox';
import { useContinuityStore } from '../src/state/useContinuityStore';

describe('sandbox build interactions', () => {
  it('snaps build points on the floor grid without changing height', () => {
    expect(snapBuildPoint([1.26, 2.4, -0.74], true)).toEqual([1.5, 2.4, -0.5]);
    expect(snapBuildPoint([1.26, 2.4, -0.74], false)).toEqual([1.26, 2.4, -0.74]);
  });

  it('places primitives at clicked floor coordinates while preserving object height defaults', () => {
    const wall = createPlacedSceneObject({
      type: 'wall',
      index: 3,
      point: [2.1, 0, -1.2],
      snapToGrid: true,
    });

    expect(wall.name).toBe('Wall 3');
    expect(wall.transform.position).toEqual([2, 1.5, -1]);
  });

  it('duplicates objects with a new identity and an unlocked visible copy', () => {
    const original = createPlacedSceneObject({
      type: 'column',
      index: 1,
      point: [0.2, 0, 0.2],
      snapToGrid: true,
    });
    const lockedHidden = { ...original, locked: true, visible: false };
    const duplicate = duplicateSceneObject(lockedHidden, 2, true);

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.name).toBe('Column 2');
    expect(duplicate.locked).toBe(false);
    expect(duplicate.visible).toBe(true);
    expect(duplicate.dimensions).toEqual(original.dimensions);
    expect(duplicate.transform.position).toEqual([1, 1.5, 1]);
  });

  it('stamps floor tiles with visible tile dimensions on the ground plane', () => {
    const floor = createPlacedSceneObject({
      type: 'floor',
      index: 2,
      point: [2.2, 0, 1.1],
      snapToGrid: true,
    });

    expect(floor.name).toBe('Floor 2');
    expect(floor.dimensions).toEqual([4, 0.08, 4]);
    expect(floor.transform.position).toEqual([2, 0.04, 1]);
  });

  it('stores placed objects without changing project schema version', () => {
    useContinuityStore.setState({
      project: createDefaultProject(),
      selectedObjectId: undefined,
      gridSnap: true,
      buildMode: 'place',
      activePrimitive: 'box',
    });

    const object = useContinuityStore.getState().placeObject('box', [1.24, 0, 1.26]);
    const state = useContinuityStore.getState();

    expect(state.project.schemaVersion).toBe('0.1');
    expect(state.selectedObjectId).toBeUndefined();
    expect(state.buildMode).toBe('place');
    expect(object.transform.position).toEqual([1, 0.7, 1.5]);
  });

  it('clears the current selection when arming stamp mode', () => {
    const project = createDefaultProject();
    const selected = project.scene.objects[1];
    useContinuityStore.setState({
      project,
      selectedObjectId: selected.id,
      buildMode: 'select',
      activePrimitive: 'box',
    });

    useContinuityStore.getState().setActivePrimitive('wall');

    const state = useContinuityStore.getState();
    expect(state.buildMode).toBe('place');
    expect(state.activePrimitive).toBe('wall');
    expect(state.selectedObjectId).toBeUndefined();
  });

  it('moves unlocked objects to a new ground point when dragged', () => {
    const project = createDefaultProject();
    const object = project.scene.objects[2];
    useContinuityStore.setState({ project, gridSnap: true, selectedObjectId: object.id });

    useContinuityStore.getState().moveObjectToGroundPoint(object.id, [2.4, 0, -1.8]);

    expect(useContinuityStore.getState().project.scene.objects[2].transform.position[0]).toBe(2.5);
    expect(useContinuityStore.getState().project.scene.objects[2].transform.position[2]).toBe(-2);
  });

  it('keeps the starter ground slab locked by default', () => {
    const project = createDefaultProject();
    expect(project.scene.objects[0].type).toBe('floor');
    expect(project.scene.objects[0].locked).toBe(true);
  });

  it('moves unlocked floor tiles when dragged', () => {
    const project = createDefaultProject();
    const floor = createPlacedSceneObject({
      type: 'floor',
      index: 2,
      point: [2, 0, 1],
      snapToGrid: true,
    });
    project.scene.objects.push(floor);
    useContinuityStore.setState({ project, gridSnap: true, selectedObjectId: floor.id });

    useContinuityStore.getState().moveObjectToGroundPoint(floor.id, [4.2, 0, 2.8]);

    const moved = useContinuityStore.getState().project.scene.objects.at(-1);
    expect(moved?.transform.position).toEqual([4, 0.04, 3]);
  });

  it('preserves vertical position when moving objects in space via the translate gizmo', () => {
    const project = createDefaultProject();
    const object = project.scene.objects[2];
    const originalY = object.transform.position[1];
    useContinuityStore.setState({ project, gridSnap: true, selectedObjectId: object.id });

    useContinuityStore.getState().moveObjectPosition(object.id, [2.4, originalY + 1.25, -1.8]);

    const moved = useContinuityStore.getState().project.scene.objects[2];
    expect(moved.transform.position[0]).toBe(2.5);
    expect(moved.transform.position[1]).toBeCloseTo(originalY + 1.25);
    expect(moved.transform.position[2]).toBe(-2);
  });

  it('does not drag locked objects through the sandbox move action', () => {
    const project = createDefaultProject();
    const object = { ...project.scene.objects[1], locked: true };
    project.scene.objects[1] = object;
    useContinuityStore.setState({ project, gridSnap: true, selectedObjectId: object.id });

    useContinuityStore.getState().moveObjectToGroundPoint(object.id, [4.2, 0, -2.8]);

    expect(useContinuityStore.getState().project.scene.objects[1].transform.position).toEqual(object.transform.position);
  });
});
