import * as THREE from 'three';
import { CameraData, Euler, LocationProject, PanoCropSettings, Shot } from '../domain/types';
import { buildScene, disposeScene } from './sceneObjects';
import { degreesToRadians, flyCameraFromCamera, type FlyCameraState } from './sync';

export interface ImageRenderResult {
  dataUrl: string;
  width: number;
  height: number;
}

export async function renderGrayboxEquirectangularPano(
  project: LocationProject,
  width = 2048,
  height = 1024,
): Promise<ImageRenderResult> {
  const renderer = createRenderer(width, height);
  const scene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
  cubeCamera.position.fromArray(project.scene.panoOrigin);
  cubeCamera.update(renderer, scene);

  const panoScene = new THREE.Scene();
  const panoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cubeMap: { value: cubeRenderTarget.texture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform samplerCube cubeMap;
      varying vec2 vUv;
      const float PI = 3.141592653589793;
      void main() {
        float theta = vUv.x * 2.0 * PI - PI;
        float phi = vUv.y * PI - PI * 0.5;
        vec3 direction = normalize(vec3(
          sin(theta) * cos(phi),
          sin(phi),
          cos(theta) * cos(phi)
        ));
        gl_FragColor = textureCube(cubeMap, direction);
      }
    `,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  panoScene.add(plane);

  renderer.setSize(width, height, false);
  renderer.render(panoScene, panoCamera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeScene(scene);
  cubeRenderTarget.dispose();
  material.dispose();
  plane.geometry.dispose();
  renderer.dispose();

  return { dataUrl, width, height };
}

export async function renderShotFrame(project: LocationProject, shot: Shot): Promise<ImageRenderResult> {
  return renderViewportClay(
    project,
    shot.camera,
    shot.exportSettings.width,
    shot.exportSettings.height,
  );
}

export function applyFlyCameraToPerspectiveCamera(
  camera: THREE.PerspectiveCamera,
  fly: FlyCameraState,
  fovDegrees: number,
  aspect: number,
  near = 0.1,
  far = 200,
) {
  camera.fov = fovDegrees;
  camera.aspect = aspect;
  camera.near = near;
  camera.far = far;
  camera.position.set(fly.position[0], fly.position[1], fly.position[2]);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = THREE.MathUtils.degToRad(fly.yawDegrees);
  camera.rotation.x = THREE.MathUtils.degToRad(fly.pitchDegrees);
  camera.rotation.z = 0;
  camera.updateProjectionMatrix();
}

export async function renderViewportClay(
  project: LocationProject,
  cameraData: CameraData,
  width: number,
  height: number,
): Promise<ImageRenderResult> {
  const renderer = createRenderer(width, height);
  const scene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });
  const camera = new THREE.PerspectiveCamera(
    cameraData.fovDegrees,
    width / height,
    cameraData.near,
    cameraData.far,
  );
  applyFlyCameraToPerspectiveCamera(
    camera,
    flyCameraFromCamera(cameraData),
    cameraData.fovDegrees,
    width / height,
    cameraData.near,
    cameraData.far,
  );
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeScene(scene);
  renderer.dispose();

  return { dataUrl, width, height };
}

export async function renderPanoPerspectiveCrop(
  imageUrl: string,
  crop: PanoCropSettings,
  panoRotation: Euler = [0, 0, 0],
): Promise<ImageRenderResult> {
  const renderer = createRenderer(crop.width, crop.height);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(crop.fovDegrees, crop.aspectRatio, 0.1, 1000);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = degreesToRadians(crop.yawDegrees - panoRotation[1]);
  camera.rotation.x = degreesToRadians(crop.pitchDegrees);
  camera.rotation.z = degreesToRadians(crop.rollDegrees);
  camera.updateProjectionMatrix();

  const geometry = new THREE.SphereGeometry(500, 80, 48);
  geometry.scale(-1, 1, 1);
  const texture = await loadTexture(imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  geometry.dispose();
  material.dispose();
  texture.dispose();
  renderer.dispose();

  return { dataUrl, width: crop.width, height: crop.height };
}

function createRenderer(width: number, height: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function loadTexture(imageUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(imageUrl, resolve, undefined, reject);
  });
}
