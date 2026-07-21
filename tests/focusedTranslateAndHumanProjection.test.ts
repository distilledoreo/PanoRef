import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDefaultProject } from '../src/domain/defaults';
import type { SceneObject } from '../src/domain/types';
import {
  computeProjectorOcclusionKey,
  shouldContributeProjectionOcclusion,
} from '../src/engine/projectorOcclusion';
import { intersectAxisDragPlane } from '../src/engine/transformGizmo';

describe('focused translate gizmo', () => {
  it('intersects the drag plane when the camera is focused on the gizmo origin', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster(
      camera.position.clone(),
      new THREE.Vector3(1, 0, -10).normalize(),
    );
    const hit = intersectAxisDragPlane(
      raycaster,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      camera,
    );

    expect(hit).toBeDefined();
    expect(hit?.x).toBeCloseTo(1, 5);
    expect(hit?.y).toBeCloseTo(0, 5);
    expect(hit?.z).toBeCloseTo(0, 5);
  });
});

describe('human projection occlusion', () => {
  const createPerson = (): SceneObject => ({
    id: 'person-1',
    name: 'Person 1',
    type: 'human_dummy',
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    dimensions: [0.55, 1.8, 0.35],
    category: 'helper',
    locked: false,
    visible: true,
  });

  it('keeps people visible without treating them as projection occluders', () => {
    expect(shouldContributeProjectionOcclusion(createPerson())).toBe(false);
  });

  it('does not regenerate projection occlusion when only a person moves', () => {
    const project = createDefaultProject();
    const person = createPerson();
    project.scene.objects.push(person);

    const before = computeProjectorOcclusionKey(project, [0, 1.6, 0]);
    person.transform.position = [5, 0, -3];
    const afterPersonMove = computeProjectorOcclusionKey(project, [0, 1.6, 0]);

    expect(afterPersonMove).toBe(before);

    const setObject = project.scene.objects.find((object) => object.type !== 'human_dummy');
    expect(setObject).toBeDefined();
    if (!setObject) return;
    setObject.transform.position = [
      setObject.transform.position[0] + 1,
      setObject.transform.position[1],
      setObject.transform.position[2],
    ];

    expect(computeProjectorOcclusionKey(project, [0, 1.6, 0])).not.toBe(before);
  });
});
