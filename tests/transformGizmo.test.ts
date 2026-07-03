import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/domain/defaults';
import { createObject3D, resolveObjectMaterial } from '../src/engine/sceneObjects';
import {
  GIZMO_SCALE_MAX,
  GIZMO_SCALE_MIN,
  computeGizmoAnchor,
  computeGizmoScale,
  createGizmoGroup,
} from '../src/engine/transformGizmo';

describe('build selection visuals', () => {
  it('centers human mannequin geometry on its local origin', () => {
    const person = createSceneObject('human_dummy', 1);
    person.transform.position = [0, 0, 0];
    const mesh = createObject3D(person, false, 'light');
    const bounds = new THREE.Box3().setFromObject(mesh);
    const center = bounds.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 2);
    expect(center.y).toBeCloseTo(0, 2);
    expect(center.z).toBeCloseTo(0, 2);
  });

  it('builds a two-arm mannequin without duplicated limb segments', () => {
    const person = createSceneObject('human_dummy', 1);
    person.transform.position = [0, 0, 0];
    const mesh = createObject3D(person, false, 'light') as THREE.Group;
    const offsetLimbs = mesh.children.filter((child) => Math.abs(child.position.x) > 0.12 * (person.dimensions[1] / 1.75));
    expect(offsetLimbs).toHaveLength(4);
  });

  it('keeps selected objects on their category material instead of a teal fill', () => {
    const floor = createSceneObject('floor', 1);
    const box = createSceneObject('box', 2);

    const selectedFloorMaterial = (createObject3D(floor, true, 'light') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const selectedBoxMaterial = (createObject3D(box, true, 'light') as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(selectedFloorMaterial).toBe(resolveObjectMaterial(floor, 'light'));
    expect(selectedBoxMaterial).toBe(resolveObjectMaterial(box, 'light'));
    expect(selectedFloorMaterial.color.getHex()).toBe(0xd8ddd8);
    expect(selectedBoxMaterial.color.getHex()).toBe(0xc8cdc8);
    expect(selectedFloorMaterial.color.getHex()).not.toBe(0x14b8a6);
  });

  it('clamps gizmo scale for large floors and small cubes', () => {
    const floorScale = computeGizmoScale(new THREE.Vector3(12, 0.08, 12));
    const boxScale = computeGizmoScale(new THREE.Vector3(1.4, 1.4, 1.4));
    const tinyScale = computeGizmoScale(new THREE.Vector3(0.08, 0.08, 0.08));

    expect(floorScale).toBe(GIZMO_SCALE_MAX);
    expect(boxScale).toBeGreaterThanOrEqual(GIZMO_SCALE_MIN);
    expect(boxScale).toBeLessThan(GIZMO_SCALE_MAX);
    expect(tinyScale).toBe(GIZMO_SCALE_MIN);
  });

  it('creates translate, rotate, and scale gizmo groups with mode metadata', () => {
    expect(createGizmoGroup('translate').userData.gizmoMode).toBe('translate');
    expect(createGizmoGroup('rotate').userData.gizmoMode).toBe('rotate');
    expect(createGizmoGroup('scale').userData.gizmoMode).toBe('scale');
  });

  it('anchors floor gizmos to the slab top while keeping regular objects centered', () => {
    const floorBox = new THREE.Box3(
      new THREE.Vector3(-6, 0, -6),
      new THREE.Vector3(6, 0.08, 6),
    );
    const cubeBox = new THREE.Box3(
      new THREE.Vector3(-0.7, 0, -0.7),
      new THREE.Vector3(0.7, 1.4, 0.7),
    );

    const floorAnchor = computeGizmoAnchor(floorBox, 'floor');
    const cubeAnchor = computeGizmoAnchor(cubeBox, 'box');
    expect(floorAnchor.x).toBeCloseTo(0);
    expect(floorAnchor.y).toBeCloseTo(0.08);
    expect(floorAnchor.z).toBeCloseTo(0);
    expect(cubeAnchor.x).toBeCloseTo(0);
    expect(cubeAnchor.y).toBeCloseTo(0.7);
    expect(cubeAnchor.z).toBeCloseTo(0);
  });
});