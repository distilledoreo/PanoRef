import * as THREE from 'three';
import { SceneObject, Vec3 } from '../domain/types';
import { snapBuildPoint } from './sandbox';

export type SelectionMode = 'replace' | 'toggle' | 'range';

export function normalizeSelectedIds(ids: string[], objects: SceneObject[]): string[] {
  const valid = new Set(objects.map((object) => object.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

export function toggleSelectedId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function selectionBounds(objects: SceneObject[]): THREE.Box3 {
  const box = new THREE.Box3();
  if (objects.length === 0) return box;
  objects.forEach((object) => {
    const half = new THREE.Vector3(...object.dimensions).multiplyScalar(0.5);
    const localBox = new THREE.Box3(half.clone().multiplyScalar(-1), half);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...object.transform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(object.transform.rotation[0]),
        THREE.MathUtils.degToRad(object.transform.rotation[1]),
        THREE.MathUtils.degToRad(object.transform.rotation[2]),
        'XYZ',
      )),
      new THREE.Vector3(...object.transform.scale),
    );
    box.union(localBox.applyMatrix4(matrix));
  });
  return box;
}

export function selectionPivot(objects: SceneObject[]): Vec3 {
  const box = selectionBounds(objects);
  if (box.isEmpty()) return [0, 0, 0];
  return box.getCenter(new THREE.Vector3()).toArray() as Vec3;
}

export function translateSelectedObjects(
  objects: SceneObject[],
  selectedIds: string[],
  delta: Vec3,
  snapToGrid: boolean,
): SceneObject[] {
  const selected = new Set(selectedIds);
  return objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const raw: Vec3 = [
      object.transform.position[0] + delta[0],
      object.transform.position[1] + delta[1],
      object.transform.position[2] + delta[2],
    ];
    const horizontal = snapBuildPoint(raw, snapToGrid);
    return {
      ...object,
      transform: { ...object.transform, position: [horizontal[0], raw[1], horizontal[2]] },
    };
  });
}

export function rotateSelectedObjects(
  objects: SceneObject[],
  selectedIds: string[],
  axis: 'x' | 'y' | 'z',
  deltaDegrees: number,
  pivot = selectionPivot(objects.filter((object) => selectedIds.includes(object.id))),
): SceneObject[] {
  const selected = new Set(selectedIds);
  const pivotVector = new THREE.Vector3(...pivot);
  const axisVector = axis === 'x'
    ? new THREE.Vector3(1, 0, 0)
    : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(axisVector, THREE.MathUtils.degToRad(deltaDegrees));
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const position = new THREE.Vector3(...object.transform.position)
      .sub(pivotVector)
      .applyQuaternion(quaternion)
      .add(pivotVector);
    const rotation = [...object.transform.rotation] as Vec3;
    rotation[index] = normalizeDegrees(rotation[index] + deltaDegrees);
    return {
      ...object,
      transform: { ...object.transform, position: position.toArray() as Vec3, rotation },
    };
  });
}

export function scaleSelectedObjects(
  objects: SceneObject[],
  selectedIds: string[],
  factors: Vec3,
  pivot = selectionPivot(objects.filter((object) => selectedIds.includes(object.id))),
): SceneObject[] {
  const selected = new Set(selectedIds);
  return objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const relative = object.transform.position.map((value, index) => value - pivot[index]) as Vec3;
    const position = relative.map((value, index) => pivot[index] + value * factors[index]) as Vec3;
    const dimensions = object.dimensions.map((value, index) => (
      Math.max(0.05, Number((value * factors[index]).toFixed(3)))
    )) as Vec3;
    return { ...object, transform: { ...object.transform, position }, dimensions };
  });
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}
