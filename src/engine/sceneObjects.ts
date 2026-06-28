import * as THREE from 'three';
import { Landmark, LocationProject, SceneObject, SceneObjectType } from '../domain/types';
import { degreesToRadians } from './sync';

const materialByCategory: Record<SceneObject['category'], THREE.MeshStandardMaterial> = {
  architecture: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 }),
  environment: new THREE.MeshStandardMaterial({ color: 0x8ba888, roughness: 0.85 }),
  helper: new THREE.MeshStandardMaterial({ color: 0xd6b15d, roughness: 0.75 }),
  landmark: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.6 }),
};

const selectedMaterial = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.55 });
const panoOriginMaterial = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x4a1d00 });
const landmarkMaterial = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x052e16 });
const robeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9a27e, roughness: 0.9 });
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 0.7 });
const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });

export function buildScene(
  project: LocationProject,
  options: { selectedObjectId?: string; showHelpers?: boolean; hiddenObjectTypes?: SceneObjectType[] } = {},
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);
  const hiddenTypes = new Set(options.hiddenObjectTypes ?? []);

  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 6, 3);
  scene.add(sun);

  const grid = new THREE.GridHelper(14, 14, 0x475569, 0x27313f);
  grid.position.y = 0.002;
  scene.add(grid);

  for (const object of project.scene.objects) {
    if (!object.visible) continue;
    if (hiddenTypes.has(object.type)) continue;
    const mesh = createObject3D(object, object.id === options.selectedObjectId);
    mesh.userData.sceneObjectId = object.id;
    scene.add(mesh);
  }

  if (options.showHelpers !== false) {
    scene.add(createPanoOrigin(project.scene.panoOrigin));
    for (const landmark of project.landmarks) {
      if (landmark.visible) scene.add(createLandmarkMarker(landmark));
    }
    for (const shot of project.shots) {
      const camera = new THREE.PerspectiveCamera(
        shot.camera.fovDegrees,
        shot.camera.aspectRatio,
        shot.camera.near,
        shot.camera.far,
      );
      camera.position.fromArray(shot.camera.position);
      camera.lookAt(new THREE.Vector3().fromArray(shot.camera.target));
      camera.updateProjectionMatrix();
      const helper = new THREE.CameraHelper(camera);
      helper.name = `Frustum ${shot.shotNumber}`;
      scene.add(helper);
    }
  }

  return scene;
}

export function createObject3D(object: SceneObject, selected = false): THREE.Object3D {
  let node: THREE.Object3D;
  const material = selected ? selectedMaterial : materialByCategory[object.category];
  const [w, h, d] = object.dimensions;

  switch (object.type) {
    case 'floor':
    case 'wall':
    case 'box':
    case 'background_card':
      node = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      break;
    case 'column':
      node = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, d / 2, h, 24), material);
      break;
    case 'arch':
      node = createArch(object, material);
      break;
    case 'doorway':
      node = createDoorway(object, material);
      break;
    case 'stairs':
      node = createStairs(object, material);
      break;
    case 'tree_blob':
      node = createTreeBlob(object);
      break;
    case 'terrain_mass':
      node = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), material);
      break;
    case 'human_dummy':
      node = createHumanDummy(object);
      break;
    case 'sun_marker':
      node = createSunMarker(object);
      break;
    default:
      node = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  }

  node.name = object.name;
  node.position.fromArray(object.transform.position);
  node.rotation.set(
    degreesToRadians(object.transform.rotation[0]),
    degreesToRadians(object.transform.rotation[1]),
    degreesToRadians(object.transform.rotation[2]),
  );
  node.scale.fromArray(object.transform.scale);
  if (!['arch', 'doorway', 'stairs', 'tree_blob', 'human_dummy', 'sun_marker'].includes(object.type)) {
    node.scale.multiply(new THREE.Vector3(1, 1, 1));
  }
  return node;
}

function createArch(object: SceneObject, material: THREE.Material): THREE.Group {
  const [w, h, d] = object.dimensions;
  const group = new THREE.Group();
  const postWidth = w * 0.22;
  const headerHeight = h * 0.22;
  const sideHeight = h - headerHeight;
  const left = new THREE.Mesh(new THREE.BoxGeometry(postWidth, sideHeight, d), material);
  left.position.set(-w / 2 + postWidth / 2, -headerHeight / 2, 0);
  const right = left.clone();
  right.position.x = w / 2 - postWidth / 2;
  const header = new THREE.Mesh(new THREE.BoxGeometry(w, headerHeight, d), material);
  header.position.set(0, sideHeight / 2, 0);
  group.add(left, right, header);
  return group;
}

function createDoorway(object: SceneObject, material: THREE.Material): THREE.Group {
  const [w, h, d] = object.dimensions;
  const group = new THREE.Group();
  const rail = w * 0.16;
  const left = new THREE.Mesh(new THREE.BoxGeometry(rail, h, d), material);
  left.position.x = -w / 2 + rail / 2;
  const right = left.clone();
  right.position.x = w / 2 - rail / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, rail, d), material);
  top.position.y = h / 2 - rail / 2;
  group.add(left, right, top);
  return group;
}

function createStairs(object: SceneObject, material: THREE.Material): THREE.Group {
  const [w, h, d] = object.dimensions;
  const group = new THREE.Group();
  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(w, h / steps, d / steps), material);
    step.position.set(0, -h / 2 + (i + 0.5) * (h / steps), -d / 2 + (i + 0.5) * (d / steps));
    group.add(step);
  }
  return group;
}

function createTreeBlob(object: SceneObject): THREE.Group {
  const [w, h, d] = object.dimensions;
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.12, w * 0.16, h * 0.45, 12),
    new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 0.9 }),
  );
  trunk.position.y = -h * 0.18;
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(w, d) * 0.48, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x6fa36c, roughness: 0.85 }),
  );
  crown.scale.y = 0.85;
  crown.position.y = h * 0.18;
  group.add(trunk, crown);
  return group;
}

function createHumanDummy(object: SceneObject): THREE.Group {
  const [, h] = object.dimensions;
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.23, h * 0.62, 16),
    robeMaterial,
  );
  body.position.y = -h * 0.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), skinMaterial);
  head.position.y = h * 0.32;
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMaterial);
  leftEye.position.set(-0.06, h * 0.35, -0.155);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.06;
  const robeFold = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, h * 0.54, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x80664c, roughness: 0.9 }),
  );
  robeFold.position.set(0, -h * 0.1, -0.21);
  group.add(body, head, leftEye, rightEye, robeFold);
  return group;
}

function createSunMarker(_object: SceneObject): THREE.Group {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), materialByCategory.helper);
  const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), materialByCategory.helper);
  ray.rotation.z = Math.PI / 2;
  ray.position.x = -0.65;
  group.add(sphere, ray);
  return group;
}

function createPanoOrigin(origin: [number, number, number]) {
  const group = new THREE.Group();
  group.name = 'Pano Origin';
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), panoOriginMaterial);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.01, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xf97316 }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(sphere, ring);
  group.position.fromArray(origin);
  return group;
}

function createLandmarkMarker(landmark: Landmark) {
  const group = new THREE.Group();
  group.name = landmark.displayName;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), landmarkMaterial);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), landmarkMaterial);
  stem.position.y = -0.25;
  group.add(sphere, stem);
  group.position.fromArray(landmark.position);
  return group;
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else if (material) material.dispose();
  });
}
