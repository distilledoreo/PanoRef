import * as THREE from 'three';
import { Euler, SceneObject, SceneObjectType, Vec3 } from '../domain/types';

export type GizmoAxis = 'x' | 'y' | 'z';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export type GizmoHit =
  | { kind: 'translate'; axis: GizmoAxis }
  | { kind: 'rotate'; axis: GizmoAxis }
  | { kind: 'scale'; axis: GizmoAxis | 'uniform' };

export const GIZMO_SCALE_MIN = 0.55;
export const GIZMO_SCALE_MAX = 1.35;

const GIZMO_COLORS: Record<GizmoAxis, number> = {
  x: 0xef4444,
  y: 0x14b8a6,
  z: 0x3b82f6,
};

export function createGizmoGroup(mode: GizmoMode): THREE.Group {
  const group = new THREE.Group();
  group.name = `${mode}Gizmo`;
  group.userData.gizmoMode = mode;

  if (mode === 'translate') {
    (['x', 'y', 'z'] as const).forEach((axis) => group.add(createTranslateAxis(axis)));
  } else if (mode === 'rotate') {
    (['x', 'y', 'z'] as const).forEach((axis) => group.add(createRotateAxis(axis)));
  } else {
    group.add(createUniformScaleHandle());
    (['x', 'y', 'z'] as const).forEach((axis) => group.add(createScaleAxis(axis)));
  }

  group.traverse((node) => {
    node.userData.isTransformGizmo = true;
  });

  return group;
}

function createTranslateAxis(axis: GizmoAxis): THREE.Group {
  const group = new THREE.Group();
  group.userData.gizmoAxis = axis;
  group.userData.gizmoKind = 'translate';

  const color = GIZMO_COLORS[axis];
  const length = 1.15;
  const shaftLength = length - 0.16;
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.94,
  });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, shaftLength, 10), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.16, 12), material);
  if (axis === 'x') {
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = shaftLength / 2;
    head.rotation.z = -Math.PI / 2;
    head.position.x = length;
  } else if (axis === 'y') {
    shaft.position.y = shaftLength / 2;
    head.position.y = length;
  } else {
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = shaftLength / 2;
    head.rotation.x = Math.PI / 2;
    head.position.z = length;
  }

  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.09, 0.09),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  if (axis === 'x') handle.position.x = length + 0.08;
  else if (axis === 'y') handle.position.y = length + 0.08;
  else handle.position.z = length + 0.08;
  handle.userData.gizmoAxis = axis;
  handle.userData.gizmoKind = 'translate';
  handle.userData.isGizmoHandle = true;

  group.add(shaft, head, handle);
  return group;
}

function createRotateAxis(axis: GizmoAxis): THREE.Group {
  const group = new THREE.Group();
  group.userData.gizmoAxis = axis;
  group.userData.gizmoKind = 'rotate';

  const color = GIZMO_COLORS[axis];
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.018, 8, 48), material);
  if (axis === 'x') ring.rotation.y = Math.PI / 2;
  else if (axis === 'y') ring.rotation.x = Math.PI / 2;
  ring.userData.gizmoAxis = axis;
  ring.userData.gizmoKind = 'rotate';
  ring.userData.isGizmoHandle = true;
  group.add(ring);
  return group;
}

function createScaleAxis(axis: GizmoAxis): THREE.Group {
  const group = new THREE.Group();
  group.userData.gizmoAxis = axis;
  group.userData.gizmoKind = 'scale';

  const color = GIZMO_COLORS[axis];
  const length = 0.95;
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, length, 8), material);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), material);
  if (axis === 'x') {
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = length / 2;
    handle.position.x = length + 0.05;
  } else if (axis === 'y') {
    shaft.position.y = length / 2;
    handle.position.y = length + 0.05;
  } else {
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = length / 2;
    handle.position.z = length + 0.05;
  }
  handle.userData.gizmoAxis = axis;
  handle.userData.gizmoKind = 'scale';
  handle.userData.isGizmoHandle = true;
  group.add(shaft, handle);
  return group;
}

function createUniformScaleHandle(): THREE.Mesh {
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  handle.userData.gizmoAxis = 'uniform';
  handle.userData.gizmoKind = 'scale';
  handle.userData.isGizmoHandle = true;
  return handle;
}

/** @deprecated Use createGizmoGroup('translate') */
export function createTransformGizmoGroup(): THREE.Group {
  return createGizmoGroup('translate');
}

export function createSelectionOutline(objectMesh: THREE.Object3D): THREE.BoxHelper {
  const helper = new THREE.BoxHelper(objectMesh, 0x14b8a6);
  helper.name = 'SelectionOutline';
  helper.renderOrder = 18;
  const material = helper.material as THREE.LineBasicMaterial;
  material.depthTest = false;
  material.transparent = true;
  material.opacity = 0.9;
  return helper;
}

export function computeGizmoScale(size: THREE.Vector3): number {
  const largestDimension = Math.max(size.x, size.y, size.z);
  const rawScale = largestDimension * 0.5;
  return THREE.MathUtils.clamp(rawScale, GIZMO_SCALE_MIN, GIZMO_SCALE_MAX);
}

export function computeGizmoAnchor(box: THREE.Box3, objectType: SceneObjectType): THREE.Vector3 {
  const anchor = box.getCenter(new THREE.Vector3());
  if (objectType === 'floor') {
    anchor.y = box.max.y;
  }
  return anchor;
}

export function updateTransformGizmo(
  gizmo: THREE.Group,
  outline: THREE.BoxHelper,
  objectMesh: THREE.Object3D,
  object: SceneObject,
) {
  const box = new THREE.Box3().setFromObject(objectMesh);
  const size = box.getSize(new THREE.Vector3());
  const scale = computeGizmoScale(size);

  gizmo.position.copy(computeGizmoAnchor(box, object.type));
  gizmo.scale.setScalar(scale);
  const mode = gizmo.userData.gizmoMode as GizmoMode | undefined;
  if (mode === 'rotate' || mode === 'scale') {
    gizmo.rotation.set(0, 0, 0);
  } else {
    gizmo.rotation.set(
      THREE.MathUtils.degToRad(object.transform.rotation[0]),
      THREE.MathUtils.degToRad(object.transform.rotation[1]),
      THREE.MathUtils.degToRad(object.transform.rotation[2]),
    );
  }

  outline.update();
}

export function findGizmoHit(
  raycaster: THREE.Raycaster,
  gizmo: THREE.Object3D | null,
  mode: GizmoMode,
): GizmoHit | undefined {
  if (!gizmo) return undefined;
  const hits = raycaster.intersectObject(gizmo, true);
  for (const hit of hits) {
    const resolved = resolveGizmoHit(hit.object, mode);
    if (resolved) return resolved;
  }
  return undefined;
}

/** @deprecated Use findGizmoHit */
export function findGizmoAxisHit(
  raycaster: THREE.Raycaster,
  gizmo: THREE.Object3D | null,
): GizmoAxis | undefined {
  const hit = findGizmoHit(raycaster, gizmo, 'translate');
  return hit?.kind === 'translate' ? hit.axis : undefined;
}

function resolveGizmoHit(object: THREE.Object3D, mode: GizmoMode): GizmoHit | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const axis = current.userData.gizmoAxis;
    const kind = current.userData.gizmoKind;
    if (kind === 'translate' && mode === 'translate' && isAxis(axis)) {
      return { kind: 'translate', axis };
    }
    if (kind === 'rotate' && mode === 'rotate' && isAxis(axis)) {
      return { kind: 'rotate', axis };
    }
    if (kind === 'scale' && mode === 'scale') {
      if (axis === 'uniform') return { kind: 'scale', axis: 'uniform' };
      if (isAxis(axis)) return { kind: 'scale', axis };
    }
    current = current.parent;
  }
  return undefined;
}

function isAxis(value: unknown): value is GizmoAxis {
  return value === 'x' || value === 'y' || value === 'z';
}

export function axisWorldVector(axis: GizmoAxis, gizmo: THREE.Object3D): THREE.Vector3 {
  const local = new THREE.Vector3(
    axis === 'x' ? 1 : 0,
    axis === 'y' ? 1 : 0,
    axis === 'z' ? 1 : 0,
  );
  return local.applyQuaternion(gizmo.quaternion).normalize();
}

export function intersectAxisDragPlane(
  raycaster: THREE.Raycaster,
  axisOrigin: THREE.Vector3,
  axisDirection: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
): THREE.Vector3 | undefined {
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  let planeNormal = new THREE.Vector3().crossVectors(axisDirection, cameraDirection);
  if (planeNormal.lengthSq() < 1e-6) {
    planeNormal = new THREE.Vector3().crossVectors(axisDirection, new THREE.Vector3(0, 0, 1));
  }
  if (planeNormal.lengthSq() < 1e-6) {
    planeNormal = new THREE.Vector3().crossVectors(axisDirection, new THREE.Vector3(1, 0, 0));
  }
  planeNormal.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, axisOrigin);
  const intersection = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, intersection)) return undefined;
  const delta = intersection.clone().sub(axisOrigin);
  const projected = axisDirection.clone().multiplyScalar(delta.dot(axisDirection));
  return axisOrigin.clone().add(projected);
}

export function angleInAxisPlane(
  raycaster: THREE.Raycaster,
  axisOrigin: THREE.Vector3,
  axisDirection: THREE.Vector3,
): number | undefined {
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisDirection.clone().normalize(), axisOrigin);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return undefined;

  const reference = Math.abs(axisDirection.dot(new THREE.Vector3(0, 1, 0))) > 0.85
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(axisDirection, reference).normalize();
  const bitangent = new THREE.Vector3().crossVectors(axisDirection, tangent).normalize();
  const offset = hit.clone().sub(axisOrigin);
  return Math.atan2(offset.dot(bitangent), offset.dot(tangent));
}

export function applyAxisRotationDelta(rotation: Euler, axis: GizmoAxis, deltaRadians: number): Euler {
  const next: Euler = [...rotation] as Euler;
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  next[index] = normalizeDegrees(next[index] + THREE.MathUtils.radToDeg(deltaRadians));
  return next;
}

export function applyAxisScaleDelta(dimensions: Vec3, axis: GizmoAxis | 'uniform', delta: number): Vec3 {
  const next = [...dimensions] as Vec3;
  const clampedDelta = delta * 1.35;
  if (axis === 'uniform') {
    return next.map((value) => Math.max(0.05, Number((value + clampedDelta).toFixed(2)))) as Vec3;
  }
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  next[index] = Math.max(0.05, Number((next[index] + clampedDelta).toFixed(2)));
  return next;
}

export function vec3FromVector3(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

export function findSceneObjectMesh(scene: THREE.Scene, objectId: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  scene.traverse((node) => {
    if (node.userData.sceneObjectId === objectId) found = node;
  });
  return found;
}

export function disposeGizmoNodes(nodes: THREE.Object3D[]) {
  nodes.forEach((node) => {
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  });
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}