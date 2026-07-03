import * as THREE from 'three';
import { SceneObject, SceneObjectType, Vec3 } from '../domain/types';

export type GizmoAxis = 'x' | 'y' | 'z';

export const GIZMO_SCALE_MIN = 0.55;
export const GIZMO_SCALE_MAX = 1.35;

const GIZMO_COLORS: Record<GizmoAxis, number> = {
  x: 0xef4444,
  y: 0x14b8a6,
  z: 0x3b82f6,
};

export function createTransformGizmoGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'TransformGizmo';

  (['x', 'y', 'z'] as const).forEach((axis) => {
    group.add(createAxisGizmo(axis));
  });

  group.traverse((node) => {
    node.userData.isTransformGizmo = true;
  });

  return group;
}

function createAxisGizmo(axis: GizmoAxis): THREE.Group {
  const group = new THREE.Group();
  group.userData.gizmoAxis = axis;

  const color = GIZMO_COLORS[axis];
  const length = 1.15;
  const shaftLength = length - 0.16;
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.94,
  });

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, shaftLength, 10),
    material,
  );
  if (axis === 'x') {
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = shaftLength / 2;
  } else if (axis === 'y') {
    shaft.position.y = shaftLength / 2;
  } else {
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = shaftLength / 2;
  }

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.065, 0.16, 12),
    material,
  );
  if (axis === 'x') {
    head.rotation.z = -Math.PI / 2;
    head.position.x = length;
  } else if (axis === 'y') {
    head.position.y = length;
  } else {
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
  handle.userData.isGizmoHandle = true;

  group.add(shaft, head, handle);
  return group;
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
  gizmo.rotation.set(
    THREE.MathUtils.degToRad(object.transform.rotation[0]),
    THREE.MathUtils.degToRad(object.transform.rotation[1]),
    THREE.MathUtils.degToRad(object.transform.rotation[2]),
  );

  outline.update();
}

export function findGizmoAxisHit(
  raycaster: THREE.Raycaster,
  gizmo: THREE.Object3D | null,
): GizmoAxis | undefined {
  if (!gizmo) return undefined;
  const hits = raycaster.intersectObject(gizmo, true);
  for (const hit of hits) {
    const axis = findGizmoAxis(hit.object);
    if (axis) return axis;
  }
  return undefined;
}

function findGizmoAxis(object: THREE.Object3D): GizmoAxis | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.gizmoAxis === 'x' || current.userData.gizmoAxis === 'y' || current.userData.gizmoAxis === 'z') {
      return current.userData.gizmoAxis;
    }
    current = current.parent;
  }
  return undefined;
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
  const planeNormal = new THREE.Vector3().crossVectors(axisDirection, cameraDirection);
  if (planeNormal.lengthSq() < 1e-6) {
    planeNormal.crossVectors(axisDirection, new THREE.Vector3(0, 1, 0));
  }
  planeNormal.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, axisOrigin);
  const intersection = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, intersection)) return undefined;
  const delta = intersection.clone().sub(axisOrigin);
  const projected = axisDirection.clone().multiplyScalar(delta.dot(axisDirection));
  return axisOrigin.clone().add(projected);
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