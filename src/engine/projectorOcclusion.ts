import * as THREE from 'three';
import {
  LocationProject,
  SceneObjectType,
  Vec3,
} from '../domain/types';
import {
  computeGrayboxPanoFarPlane,
} from './renderers';
import { buildScene } from './sceneObjects';

const DEFAULT_OCCLUSION_FACE_SIZE = 512;
const DEFAULT_OCCLUSION_NEAR = 0.05;

/** Packed-depth clear: R=G=1, B=0 (no hit). Alpha is set separately. */
const NO_HIT_CLEAR = new THREE.Color(1, 1, 0);

export interface ProjectorOcclusionMap {
  target: THREE.WebGLCubeRenderTarget;
  texture: THREE.CubeTexture;
  origin: Vec3;
  nearMeters: number;
  farMeters: number;
  faceSize: number;
  key: string;
  dispose(): void;
}

export interface ProjectorOcclusionOptions {
  faceSize?: number;
  nearMeters?: number;
  hiddenObjectTypes?: SceneObjectType[];
}

export interface ProjectorOcclusionSet {
  primary?: ProjectorOcclusionMap;
  secondary?: ProjectorOcclusionMap;
  dispose(): void;
}

function cloneAsCubeTexture(target: THREE.WebGLCubeRenderTarget): THREE.CubeTexture {
  // The cube render target's texture IS a CubeTexture subclass in three.js.
  return target.texture as unknown as THREE.CubeTexture;
}

/**
 * Build an occluder scene that contains only solid, opaque geometry from the
 * current project: architecture, environment, imported models, and the human
 * dummy. Editor helpers (grid, pano origin, landmarks, shot frustums, sun
 * marker) are excluded so they never cast occlusion shadows.
 */
function buildOccluderScene(
  project: LocationProject,
  hiddenObjectTypes: SceneObjectType[] = ['sun_marker'],
): THREE.Scene {
  const hiddenTypes = [...new Set([...hiddenObjectTypes, 'sun_marker'])] as SceneObjectType[];
  const scene = buildScene(project, {
    appearance: 'projected',
    showHelpers: false,
    showSceneGuides: false,
    showPanoOrigin: false,
    hiddenObjectTypes: hiddenTypes,
    fog: false,
    // Provide a placeholder so buildScene accepts the projected branch without
    // attaching real projected materials (we override all materials below).
    projected: undefined,
  });

  // The depth material is assigned per-map in generateProjectorOcclusionMap.
  return scene;
}

function createRadialDepthMaterial(
  origin: Vec3,
  nearMeters: number,
  farMeters: number,
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      occlusionOrigin: { value: new THREE.Vector3(...origin) },
      occlusionNear: { value: nearMeters },
      occlusionFar: { value: farMeters },
    },
    vertexShader: /* glsl */`
      varying vec3 vOcclusionWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vOcclusionWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 occlusionOrigin;
      uniform float occlusionNear;
      uniform float occlusionFar;
      varying vec3 vOcclusionWorldPosition;

      vec2 packDepth16(float value) {
        float scaled = floor(clamp(value, 0.0, 1.0) * 65535.0 + 0.5);
        float highByte = floor(scaled / 256.0);
        float lowByte = scaled - highByte * 256.0;
        return vec2(highByte, lowByte) / 255.0;
      }

      void main() {
        float distanceMeters = length(vOcclusionWorldPosition - occlusionOrigin);
        float normalizedDepth = clamp(
          (distanceMeters - occlusionNear) /
          max(occlusionFar - occlusionNear, 0.0001),
          0.0,
          1.0
        );
        // Blue channel = valid hit flag (1.0). Green/Red pack the normalized depth.
        gl_FragColor = vec4(packDepth16(normalizedDepth), 1.0, 1.0);
      }
    `,
  });
  return material;
}

/**
 * Far plane for a projector-origin depth cubemap: enclose all visible geometry
 * from that specific origin. Each projector may use a different far distance.
 */
export function computeProjectorFarPlane(
  scene: THREE.Scene,
  projectorOrigin: Vec3,
  nearMeters = DEFAULT_OCCLUSION_NEAR,
): number {
  return computeGrayboxPanoFarPlane(scene, projectorOrigin, nearMeters);
}

export function generateProjectorOcclusionMap(
  renderer: THREE.WebGLRenderer,
  project: LocationProject,
  origin: Vec3,
  options: ProjectorOcclusionOptions = {},
): ProjectorOcclusionMap {
  const faceSize = options.faceSize ?? DEFAULT_OCCLUSION_FACE_SIZE;
  const nearMeters = options.nearMeters ?? DEFAULT_OCCLUSION_NEAR;

  const occluderScene = buildOccluderScene(project, options.hiddenObjectTypes);

  const farMeters = computeProjectorFarPlane(occluderScene, origin, nearMeters);

  const target = new THREE.WebGLCubeRenderTarget(faceSize, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  // Packed-depth data, not color: no sRGB conversion, no filtering.
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  (target.texture as THREE.CubeTexture).mapping = THREE.CubeReflectionMapping;

  // The depth material must be re-created per origin/far so its uniforms match.
  const depthMaterial = createRadialDepthMaterial(origin, nearMeters, farMeters);
  occluderScene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = depthMaterial;
  });

  const previousClearColor = new THREE.Color();
  const previousClearAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const previousToneMapping = renderer.toneMapping;
  const previousOutputColorSpace = renderer.outputColorSpace;
  renderer.getClearColor(previousClearColor);

  const cubeCamera = new THREE.CubeCamera(nearMeters, farMeters, target);
  cubeCamera.position.set(origin[0], origin[1], origin[2]);

  try {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.NoColorSpace;
    renderer.autoClear = true;
    renderer.setClearColor(NO_HIT_CLEAR, 1);
    cubeCamera.update(renderer, occluderScene);
  } finally {
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.toneMapping = previousToneMapping;
    renderer.outputColorSpace = previousOutputColorSpace;
  }

  const key = computeProjectorOcclusionKey(project, origin);

  // Dispose occluder scene resources (geometry + shared depth material).
  occluderScene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
  depthMaterial.dispose();

  return {
    target,
    texture: cloneAsCubeTexture(target),
    origin: [...origin] as Vec3,
    nearMeters,
    farMeters,
    faceSize,
    key,
    dispose() {
      target.dispose();
    },
  };
}

// --- Stable, geometry-only occlusion generation key -------------------------

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic key covering only geometry + projector origin. Color/exposure/
 * camera/selections do NOT affect occlusion, so maps do not regenerate on those
 * changes.
 */
export function computeProjectorOcclusionKey(
  project: LocationProject,
  primaryOrigin: Vec3,
  secondaryOrigin?: Vec3,
): string {
  const objects = [...project.scene.objects]
    .filter((object) => object.visible)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const parts: string[] = [];
  for (const object of objects) {
    const imported = object.importedModel;
    parts.push(JSON.stringify({
      id: object.id,
      type: object.type,
      visible: object.visible,
      position: object.transform.position,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
      dimensions: object.dimensions,
      modelAssetId: object.modelAssetId,
      importedRevision: imported
        ? [imported.sourceImportId, imported.meshCount, imported.vertexCount, imported.triangleCount]
        : null,
    }));
  }

  const payload = JSON.stringify({
    o: project.scene.panoOrigin,
    p: primaryOrigin,
    s: secondaryOrigin ?? null,
    objects: parts,
  });
  return fnv1aHash(payload);
}

export { DEFAULT_OCCLUSION_FACE_SIZE, DEFAULT_OCCLUSION_NEAR };
