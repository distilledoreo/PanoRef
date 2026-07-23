import { describe, expect, it } from 'vitest';
import { createDefaultProject, createSceneObject } from '../src/domain/defaults';
import {
  canStageObjectPerShot,
  clearShotObjectOverride,
  getSceneObjectStagingRole,
  resolveProjectForShot,
  updateShotObjectOverrides,
} from '../src/engine/shotSceneState';

describe('per-shot scene state', () => {
  it('applies sparse transforms without mutating the Build scene', () => {
    const project = createDefaultProject();
    const person = createSceneObject('human_dummy', 1);
    project.scene.objects.push(person);
    const shot = project.shots[0];
    const stagedTransform = {
      ...person.transform,
      position: [4, 0.875, -2] as [number, number, number],
      rotation: [0, 45, 0] as [number, number, number],
    };
    shot.objectOverrides = updateShotObjectOverrides(shot, person, { transform: stagedTransform });

    const resolved = resolveProjectForShot(project, shot);
    const resolvedPerson = resolved.scene.objects.find((object) => object.id === person.id);

    expect(resolvedPerson?.transform.position).toEqual([4, 0.875, -2]);
    expect(resolvedPerson?.transform.rotation).toEqual([0, 45, 0]);
    expect(person.transform.position).not.toEqual([4, 0.875, -2]);
  });

  it('classifies built-in and imported people consistently for clean plates', () => {
    const project = createDefaultProject();
    const mannequin = createSceneObject('human_dummy', 1);
    const importedPerson = createSceneObject('imported_model', 1);
    importedPerson.stagingRole = 'person';
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    project.scene.objects.push(mannequin, importedPerson, prop);

    const resolved = resolveProjectForShot(project, project.shots[0], { hidePeople: true });
    const byId = new Map(resolved.scene.objects.map((object) => [object.id, object]));

    expect(byId.get(mannequin.id)?.visible).toBe(false);
    expect(byId.get(importedPerson.id)?.visible).toBe(false);
    expect(byId.get(prop.id)?.visible).toBe(true);
    expect(getSceneObjectStagingRole(mannequin)).toBe('person');
    expect(canStageObjectPerShot(prop)).toBe(true);
  });

  it('drops redundant overrides and supports reset to base', () => {
    const project = createDefaultProject();
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    const shot = project.shots[0];

    const redundant = updateShotObjectOverrides(shot, prop, {
      transform: prop.transform,
      visible: prop.visible,
    });
    expect(redundant).toEqual({});

    shot.objectOverrides = updateShotObjectOverrides(shot, prop, { visible: false });
    expect(shot.objectOverrides[prop.id]?.visible).toBe(false);
    expect(clearShotObjectOverride(shot, prop.id)).toEqual({});
  });
});
