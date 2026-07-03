import * as THREE from 'three';
import { Landmark, LocationProject, SceneObject, SceneObjectType } from '../domain/types';
import { degreesToRadians } from './sync';

export type SceneVisualTheme = 'light' | 'dark';

function createArchitectureMaterial(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.04,
  });
}

const materialByTheme: Record<SceneVisualTheme, Record<SceneObject['category'], THREE.MeshStandardMaterial>> = {
  light: {
    architecture: createArchitectureMaterial(0xc8cdc8, 0.74),
    environment: createArchitectureMaterial(0x9aab96, 0.8),
    helper: new THREE.MeshStandardMaterial({ color: 0xc79a48, roughness: 0.72, metalness: 0.02 }),
    landmark: new THREE.MeshStandardMaterial({ color: 0x5f9b7a, roughness: 0.62, metalness: 0.03 }),
  },
  dark: {
    architecture: createArchitectureMaterial(0xb8c0bc, 0.8),
    environment: createArchitectureMaterial(0x8d9892, 0.84),
    helper: new THREE.MeshStandardMaterial({ color: 0xb8843a, roughness: 0.74, metalness: 0.02 }),
    landmark: new THREE.MeshStandardMaterial({ color: 0x4ab49c, roughness: 0.62, metalness: 0.03 }),
  },
};

const lightFloorMaterial = new THREE.MeshStandardMaterial({ color: 0xd8ddd8, roughness: 0.9, metalness: 0.01 });
const darkFloorMaterial = new THREE.MeshStandardMaterial({ color: 0x242c32, roughness: 0.92, metalness: 0.01 });
const panoOriginMaterial = new THREE.MeshStandardMaterial({ color: 0xd08a28, emissive: 0x3a2306 });
const landmarkMaterial = new THREE.MeshStandardMaterial({ color: 0x5f9b7a, emissive: 0x0b2e1e });
const robeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9a27e, roughness: 0.9 });
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 0.7 });
const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });

const SHARED_MATERIALS = new Set<THREE.Material>([
  ...Object.values(materialByTheme.light),
  ...Object.values(materialByTheme.dark),
  lightFloorMaterial,
  darkFloorMaterial,
  panoOriginMaterial,
  landmarkMaterial,
  robeMaterial,
  skinMaterial,
  eyeMaterial,
]);

export function buildScene(
  project: LocationProject,
  options: {
    selectedObjectId?: string;
    selectedShotId?: string;
    hideShotFrustums?: boolean;
    showHelpers?: boolean;
    showSceneGuides?: boolean;
    showPanoOrigin?: boolean;
    hiddenObjectTypes?: SceneObjectType[];
    previewObject?: SceneObject;
    theme?: SceneVisualTheme;
  } = {},
) {
  const theme = options.theme ?? 'light';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme === 'dark' ? 0x0f1419 : 0xf3f6f4);
  scene.fog = new THREE.Fog(
    theme === 'dark' ? 0x0f1419 : 0xf3f6f4,
    18,
    42,
  );
  const hiddenTypes = new Set(options.hiddenObjectTypes ?? []);

  const hemisphere = new THREE.HemisphereLight(
    theme === 'dark' ? 0xb8c4d0 : 0xffffff,
    theme === 'dark' ? 0x1a2228 : 0xd8ddd6,
    theme === 'dark' ? 0.72 : 0.95,
  );
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffffff, theme === 'dark' ? 0.28 : 0.42);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 1.15 : 1.35);
  keyLight.position.set(5.5, 8.5, 4.5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(
    theme === 'dark' ? 0xa8c0d8 : 0xfff8f0,
    theme === 'dark' ? 0.42 : 0.55,
  );
  fillLight.position.set(-4.5, 3.5, -3);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 0.22 : 0.28);
  rimLight.position.set(-2, 2, 6);
  scene.add(rimLight);

  const grid = new THREE.GridHelper(
    14,
    14,
    theme === 'dark' ? 0x2f3a44 : 0x9aa7a2,
    theme === 'dark' ? 0x1b252d : 0xd7dedb,
  );
  grid.position.y = 0.002;
  scene.add(grid);

  for (const object of project.scene.objects) {
    if (!object.visible) continue;
    if (hiddenTypes.has(object.type)) continue;
    const mesh = createObject3D(object, object.id === options.selectedObjectId, theme);
    mesh.userData.sceneObjectId = object.id;
    scene.add(mesh);
  }

  if (options.previewObject) {
    scene.add(createPreviewMesh(options.previewObject));
  }

  const showGuides = options.showSceneGuides ?? (options.showHelpers !== false);
  const showPanoOrigin = options.showPanoOrigin ?? showGuides;

  if (showPanoOrigin) {
    scene.add(createPanoOrigin(project.scene.panoOrigin));
  }
  if (showGuides) {
    for (const landmark of project.landmarks) {
      if (landmark.visible) scene.add(createLandmarkMarker(landmark));
    }
    if (!options.hideShotFrustums) {
      for (const shot of project.shots) {
        if (options.selectedShotId && shot.id !== options.selectedShotId) continue;
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
  }

  return scene;
}

export function resolveObjectMaterial(
  object: SceneObject,
  theme: SceneVisualTheme = 'light',
): THREE.MeshStandardMaterial {
  if (object.type === 'floor') return theme === 'dark' ? darkFloorMaterial : lightFloorMaterial;
  return materialByTheme[theme][object.category];
}

export function createObject3D(object: SceneObject, _selected = false, theme: SceneVisualTheme = 'light'): THREE.Object3D {
  let node: THREE.Object3D;
  const material = resolveObjectMaterial(object, theme);
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
      node = createTreeBlob(object, theme);
      break;
    case 'terrain_mass':
      node = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), material);
      break;
    case 'human_dummy':
      node = createHumanDummy(object, theme);
      break;
    case 'sun_marker':
      node = createSunMarker(object, theme);
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

function createTreeBlob(object: SceneObject, theme: SceneVisualTheme): THREE.Group {
  const [w, h, d] = object.dimensions;
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.12, w * 0.16, h * 0.45, 12),
    new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x6f5b47 : 0x7c5a3a, roughness: 0.9 }),
  );
  trunk.position.y = -h * 0.18;
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(w, d) * 0.48, 20, 14),
    new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x7f8d84 : 0x6fa36c, roughness: 0.85 }),
  );
  crown.scale.y = 0.85;
  crown.position.y = h * 0.18;
  group.add(trunk, crown);
  return group;
}

function createHumanDummy(object: SceneObject, theme: SceneVisualTheme): THREE.Group {
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
    new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x6b5848 : 0x80664c, roughness: 0.9 }),
  );
  robeFold.position.set(0, -h * 0.1, -0.21);
  group.add(body, head, leftEye, rightEye, robeFold);
  return group;
}

function createSunMarker(_object: SceneObject, theme: SceneVisualTheme): THREE.Group {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), materialByTheme[theme].helper);
  const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), materialByTheme[theme].helper);
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
  group.traverse((node) => {
    node.userData.panoOrigin = true;
  });
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

export function createPreviewMesh(object: SceneObject, theme: SceneVisualTheme = 'light'): THREE.Object3D {
  const preview = createObject3D(object, false, theme);
  preview.name = 'Placement Preview';
  preview.userData.previewObject = true;
  applyPreviewMaterial(preview);
  return preview;
}

export function disposePreviewMesh(node: THREE.Object3D) {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    disposeOwnedMaterials(mesh.material);
  });
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    disposeOwnedMaterials(mesh.material);
  });
}

function disposeOwnedMaterials(material: THREE.Material | THREE.Material[] | undefined) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => {
    if (!SHARED_MATERIALS.has(item)) item.dispose();
  });
}

function applyPreviewMaterial(node: THREE.Object3D) {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const material = mesh.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    mesh.material = materials.length === 1
      ? createPreviewMaterial(materials[0])
      : materials.map((item) => createPreviewMaterial(item));
    mesh.renderOrder = 10;
  });
}

function createPreviewMaterial(source: THREE.Material): THREE.Material {
  const clone = source.clone();
  clone.transparent = true;
  clone.opacity = 0.42;
  clone.depthWrite = false;
  clone.side = THREE.DoubleSide;
  if ('color' in clone && clone.color instanceof THREE.Color) {
    clone.color.lerp(new THREE.Color(0x14b8a6), 0.28);
  }
  if (clone instanceof THREE.MeshStandardMaterial) {
    clone.emissive.setHex(0x0a2d28);
    clone.emissiveIntensity = 0.18;
  }
  return clone;
}
