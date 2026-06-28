import * as THREE from 'three';
import { CameraData, Euler, LocationProject, PanoCropSettings, PanoReference, ProjectionStamp } from '../domain/types';
import { PROJECTION_MIN_FACING, PROJECTION_OCCLUSION_BIAS_METERS } from './projection';
import { buildScene, disposeScene } from './sceneObjects';
import { degreesToRadians } from './sync';

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
  camera.position.fromArray(cameraData.position);
  camera.lookAt(new THREE.Vector3().fromArray(cameraData.target));
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeScene(scene);
  renderer.dispose();

  return { dataUrl, width, height };
}

export async function renderContinuityControlView(
  project: LocationProject,
  cameraData: CameraData,
  pano: PanoReference,
  panoImageUrl: string,
  width: number,
  height: number,
): Promise<ImageRenderResult> {
  const renderer = createRenderer(width, height);
  const scene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });
  const panoOrigin = new THREE.Vector3().fromArray(pano.origin);
  const maxDistance = Math.max(cameraData.far, 100);

  const occlusionTarget = new THREE.WebGLCubeRenderTarget(512, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, maxDistance, occlusionTarget);
  cubeCamera.position.copy(panoOrigin);

  const distanceMaterial = createProjectionDistanceMaterial(panoOrigin, maxDistance);
  scene.overrideMaterial = distanceMaterial;
  cubeCamera.update(renderer, scene);
  scene.overrideMaterial = null;

  const panoTexture = await loadTexture(panoImageUrl);
  panoTexture.colorSpace = THREE.SRGBColorSpace;
  panoTexture.wrapS = THREE.RepeatWrapping;
  panoTexture.wrapT = THREE.ClampToEdgeWrapping;

  const projectionMaterial = createProjectedPanoMaterial({
    panoTexture,
    occlusionTexture: occlusionTarget.texture,
    panoOrigin,
    panoYawDegrees: pano.rotation[1],
    maxDistance,
  });
  const stampedMaterials = createStampedProjectionMaterials({
    project,
    pano,
    panoTexture,
    occlusionTexture: occlusionTarget.texture,
    panoOrigin,
    maxDistance,
  });
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });
  applyProjectionMaterials(scene, project, projectionMaterial, clayMaterial, stampedMaterials);

  const camera = new THREE.PerspectiveCamera(
    cameraData.fovDegrees,
    width / height,
    cameraData.near,
    cameraData.far,
  );
  camera.position.fromArray(cameraData.position);
  camera.lookAt(new THREE.Vector3().fromArray(cameraData.target));
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeScene(scene);
  distanceMaterial.dispose();
  panoTexture.dispose();
  occlusionTarget.dispose();
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

function applyProjectionMaterials(
  scene: THREE.Scene,
  project: LocationProject,
  projectionMaterial: THREE.Material,
  clayMaterial: THREE.Material,
  stampedMaterials: Map<string, THREE.Material>,
) {
  const sceneObjects = new Map(project.scene.objects.map((object) => [object.id, object]));
  const hasStampedMaterials = stampedMaterials.size > 0;
  for (const root of scene.children) {
    const objectId = root.userData.sceneObjectId as string | undefined;
    if (!objectId) continue;

    const sceneObject = sceneObjects.get(objectId);
    const stampedMaterial = stampedMaterials.get(objectId);
    const shouldProject = !hasStampedMaterials && (sceneObject?.category === 'architecture' || sceneObject?.category === 'environment');
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = stampedMaterial ?? (shouldProject ? projectionMaterial : clayMaterial);
    });
  }
}

function createStampedProjectionMaterials(params: {
  project: LocationProject;
  pano: PanoReference;
  panoTexture: THREE.Texture;
  occlusionTexture: THREE.CubeTexture;
  panoOrigin: THREE.Vector3;
  maxDistance: number;
}) {
  const materials = new Map<string, THREE.Material>();
  for (const object of params.project.scene.objects) {
    if (!object.projectionStamp || object.projectionStamp.panoId !== params.pano.id) continue;
    if (object.category !== 'architecture' && object.category !== 'environment') continue;
    materials.set(object.id, createStampedPanoMaterial({
      stamp: object.projectionStamp,
      panoTexture: params.panoTexture,
      occlusionTexture: params.occlusionTexture,
      panoOrigin: params.panoOrigin,
      maxDistance: params.maxDistance,
    }));
  }
  return materials;
}

function createProjectionDistanceMaterial(panoOrigin: THREE.Vector3, maxDistance: number) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      panoOrigin: { value: panoOrigin },
      maxDistance: { value: maxDistance },
    },
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 panoOrigin;
      uniform float maxDistance;
      varying vec3 vWorldPosition;

      void main() {
        float normalizedDistance = clamp(length(vWorldPosition - panoOrigin) / maxDistance, 0.0, 1.0);
        gl_FragColor = vec4(vec3(normalizedDistance), 1.0);
      }
    `,
  });
}

function createProjectedPanoMaterial(params: {
  panoTexture: THREE.Texture;
  occlusionTexture: THREE.CubeTexture;
  panoOrigin: THREE.Vector3;
  panoYawDegrees: number;
  maxDistance: number;
}) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      panoMap: { value: params.panoTexture },
      occlusionMap: { value: params.occlusionTexture },
      panoOrigin: { value: params.panoOrigin },
      panoYawRadians: { value: degreesToRadians(params.panoYawDegrees) },
      maxDistance: { value: params.maxDistance },
      clayColor: { value: new THREE.Color(0x9aa0a6) },
      minFacing: { value: PROJECTION_MIN_FACING },
      occlusionBias: { value: PROJECTION_OCCLUSION_BIAS_METERS },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D panoMap;
      uniform samplerCube occlusionMap;
      uniform vec3 panoOrigin;
      uniform float panoYawRadians;
      uniform float maxDistance;
      uniform vec3 clayColor;
      uniform float minFacing;
      uniform float occlusionBias;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      const float PI = 3.141592653589793;

      void main() {
        vec3 fromPano = vWorldPosition - panoOrigin;
        float hitDistance = length(fromPano);
        vec3 direction = normalize(fromPano);
        vec3 towardPano = -direction;
        float facingConfidence = clamp(dot(normalize(vWorldNormal), towardPano), 0.0, 1.0);
        float nearestDistance = textureCube(occlusionMap, direction).r * maxDistance;
        float occlusionConfidence = hitDistance <= nearestDistance + occlusionBias ? 1.0 : 0.0;

        float yaw = atan(direction.x, direction.z);
        float pitch = asin(clamp(direction.y, -1.0, 1.0));
        float localYaw = atan(sin(yaw - panoYawRadians), cos(yaw - panoYawRadians));
        vec2 uv = vec2(localYaw / (2.0 * PI) + 0.5, pitch / PI + 0.5);
        vec3 projectedColor = texture2D(panoMap, uv).rgb;

        float useProjection = facingConfidence >= minFacing && occlusionConfidence > 0.5 ? 1.0 : 0.0;
        gl_FragColor = vec4(mix(clayColor, projectedColor, useProjection), 1.0);
      }
    `,
  });
}

function createStampedPanoMaterial(params: {
  stamp: ProjectionStamp;
  panoTexture: THREE.Texture;
  occlusionTexture: THREE.CubeTexture;
  panoOrigin: THREE.Vector3;
  maxDistance: number;
}) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      panoMap: { value: params.panoTexture },
      occlusionMap: { value: params.occlusionTexture },
      panoOrigin: { value: params.panoOrigin },
      panoYawRadians: { value: degreesToRadians(params.stamp.panoYawDegrees) },
      stampYawRadians: { value: degreesToRadians(params.stamp.yawDegrees) },
      stampPitchRadians: { value: degreesToRadians(params.stamp.pitchDegrees) },
      stampViewFovRadians: { value: degreesToRadians(clampFovDegrees(params.stamp.viewFovDegrees)) },
      stampPanoFovRadians: { value: degreesToRadians(clampFovDegrees(params.stamp.panoFovDegrees)) },
      stampAspectRatio: { value: safeAspectRatio(params.stamp.aspectRatio) },
      stampOpacity: { value: clamp01(params.stamp.opacity) },
      maxDistance: { value: params.maxDistance },
      clayColor: { value: new THREE.Color(0x9aa0a6) },
      minFacing: { value: PROJECTION_MIN_FACING },
      occlusionBias: { value: PROJECTION_OCCLUSION_BIAS_METERS },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D panoMap;
      uniform samplerCube occlusionMap;
      uniform vec3 panoOrigin;
      uniform float panoYawRadians;
      uniform float stampYawRadians;
      uniform float stampPitchRadians;
      uniform float stampViewFovRadians;
      uniform float stampPanoFovRadians;
      uniform float stampAspectRatio;
      uniform float stampOpacity;
      uniform float maxDistance;
      uniform vec3 clayColor;
      uniform float minFacing;
      uniform float occlusionBias;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      const float PI = 3.141592653589793;

      void main() {
        vec3 fromPano = vWorldPosition - panoOrigin;
        float hitDistance = length(fromPano);
        vec3 direction = normalize(fromPano);
        vec3 towardPano = -direction;
        float facingConfidence = clamp(dot(normalize(vWorldNormal), towardPano), 0.0, 1.0);
        float nearestDistance = textureCube(occlusionMap, direction).r * maxDistance;
        float occlusionConfidence = hitDistance <= nearestDistance + occlusionBias ? 1.0 : 0.0;

        vec3 forward = normalize(vec3(
          sin(stampYawRadians) * cos(stampPitchRadians),
          sin(stampPitchRadians),
          cos(stampYawRadians) * cos(stampPitchRadians)
        ));
        vec3 right = normalize(vec3(cos(stampYawRadians), 0.0, -sin(stampYawRadians)));
        vec3 up = normalize(cross(forward, right));

        float localZ = dot(direction, forward);
        float viewHalfTan = tan(stampViewFovRadians * 0.5);
        float ndcX = (dot(direction, right) / max(localZ, 0.0001)) / (viewHalfTan * stampAspectRatio);
        float ndcY = (dot(direction, up) / max(localZ, 0.0001)) / viewHalfTan;
        float insideStampFrame = localZ > 0.0 && abs(ndcX) <= 1.0 && abs(ndcY) <= 1.0 ? 1.0 : 0.0;

        float panoHalfTan = tan(stampPanoFovRadians * 0.5);
        vec3 sampledDirection = normalize(
          forward
          + right * ndcX * panoHalfTan * stampAspectRatio
          + up * ndcY * panoHalfTan
        );

        float yaw = atan(sampledDirection.x, sampledDirection.z);
        float pitch = asin(clamp(sampledDirection.y, -1.0, 1.0));
        float localYaw = atan(sin(yaw - panoYawRadians), cos(yaw - panoYawRadians));
        vec2 uv = vec2(localYaw / (2.0 * PI) + 0.5, pitch / PI + 0.5);
        vec3 projectedColor = texture2D(panoMap, uv).rgb;

        float useProjection = facingConfidence >= minFacing && occlusionConfidence > 0.5 && insideStampFrame > 0.5 ? stampOpacity : 0.0;
        gl_FragColor = vec4(mix(clayColor, projectedColor, useProjection), 1.0);
      }
    `,
  });
}

function clampFovDegrees(value: number) {
  if (!Number.isFinite(value)) return 65;
  return Math.max(18, Math.min(120, value));
}

function safeAspectRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return value;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
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
