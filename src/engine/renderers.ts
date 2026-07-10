import * as THREE from 'three';
import { CameraData, Euler, LocationProject, PanoCropSettings, Shot } from '../domain/types';
import {
  getCameraMoveDurationSeconds,
  getSortedCameraKeyframes,
  hasRenderableCameraMove,
  interpolateCameraKeyframes,
} from './cameraKeyframes';
import {
  CAMERA_MOVE_CUBEMAP_FACES,
  DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE,
  type CameraMoveCubemapFaceId,
} from './cameraMoveCubemap';
import { DEFAULT_GRAYBOX_PANO_HEIGHT, DEFAULT_GRAYBOX_PANO_WIDTH } from '../domain/defaults';
import { ensureHumanMannequinModel } from './humanMannequinModel';
import { buildScene, disposeScene, type SceneVisualTheme } from './sceneObjects';
import { degreesToRadians, flyCameraFromCamera, type FlyCameraState } from './sync';

export interface ImageRenderResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface VideoRenderResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  mimeType: string;
  fileExtension: 'mp4';
}

export interface PanoCubemapRenderResult {
  faceSize: number;
  faces: Record<CameraMoveCubemapFaceId, ImageRenderResult>;
}

export interface CameraMoveVideoOptions {
  frameRate?: number;
  mimeType?: string;
  videoBitsPerSecond?: number;
  onProgress?: (progress: number) => void;
  /** Optional abort; stops the recorder and rejects. */
  signal?: AbortSignal;
  /** Wall-clock timeout in ms (default 90s). */
  timeoutMs?: number;
}

const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E"',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs="avc1.640028"',
  'video/mp4;codecs=avc1.640028',
  'video/mp4',
] as const;

export function getSupportedCameraMoveMp4MimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return MP4_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export async function renderGrayboxEquirectangularPano(
  project: LocationProject,
  width = DEFAULT_GRAYBOX_PANO_WIDTH,
  height = DEFAULT_GRAYBOX_PANO_HEIGHT,
  theme: SceneVisualTheme = 'light',
): Promise<ImageRenderResult> {
  await ensureHumanMannequinModel();
  const renderer = createRenderer(width, height);
  const scene = buildScene(project, {
    showHelpers: false,
    hiddenObjectTypes: ['sun_marker'],
    theme,
  });
  const cubeFaceSize = Math.min(2048, Math.max(512, Math.round(width / 2)));
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(cubeFaceSize, {
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
  disposeRenderer(renderer);

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

export async function renderShotCameraMoveMp4(
  project: LocationProject,
  shot: Shot,
  options: CameraMoveVideoOptions = {},
): Promise<VideoRenderResult> {
  const keyframes = getSortedCameraKeyframes(shot.cameraKeyframes);
  if (!hasRenderableCameraMove(keyframes)) {
    throw new Error('Capture start and end camera keyframes before exporting MP4.');
  }

  const mimeType = options.mimeType ?? getSupportedCameraMoveMp4MimeType();
  if (!mimeType) {
    throw new Error('MP4 camera move export is not supported in this browser.');
  }

  const frameRate = options.frameRate ?? 30;
  const durationSeconds = getCameraMoveDurationSeconds(keyframes);
  const width = shot.exportSettings.width;
  const height = shot.exportSettings.height;
  await ensureHumanMannequinModel();
  const renderer = createRenderer(width, height);
  const scene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });
  const camera = new THREE.PerspectiveCamera(
    shot.camera.fovDegrees,
    width / height,
    shot.camera.near,
    shot.camera.far,
  );

  const captureStream = renderer.domElement.captureStream?.bind(renderer.domElement);
  if (!captureStream) {
    disposeScene(scene);
    disposeRenderer(renderer);
    throw new Error('Canvas video capture is not supported in this browser.');
  }

  const stream = captureStream(frameRate);
  const chunks: Blob[] = [];
  const timeoutMs = options.timeoutMs ?? 90_000;
  const externalSignal = options.signal;

  try {
    if (externalSignal?.aborted) {
      throw new Error('MP4 export was cancelled.');
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond ?? Math.max(1_000_000, width * height * 2),
    });

    await new Promise<void>((resolve, reject) => {
      let animationFrame = 0;
      let startTime = 0;
      let stopping = false;
      let settled = false;
      let timeoutId = 0;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onAbort);
        fn();
      };

      const stopRecorder = () => {
        if (stopping) return;
        stopping = true;
        cancelAnimationFrame(animationFrame);
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          // ignore stop races
        }
      };

      const onAbort = () => {
        stopRecorder();
        settle(() => reject(new Error('MP4 export was cancelled.')));
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        stopRecorder();
        settle(() => reject(new Error('MP4 recording failed in this browser.')));
      };
      recorder.onstop = () => settle(() => resolve());

      const renderFrame = (now: number) => {
        if (settled) return;
        if (!startTime) startTime = now;
        const elapsedSeconds = Math.min((now - startTime) / 1000, durationSeconds);
        renderCameraMoveFrame(renderer, scene, camera, keyframes, elapsedSeconds, width, height);
        options.onProgress?.(durationSeconds === 0 ? 1 : elapsedSeconds / durationSeconds);

        if (elapsedSeconds >= durationSeconds) {
          // Request a final chunk before stopping so empty-blob silent failures are rare.
          try {
            if (recorder.state === 'recording') recorder.requestData();
          } catch {
            // requestData is best-effort
          }
          stopRecorder();
          return;
        }
        animationFrame = requestAnimationFrame(renderFrame);
      };

      externalSignal?.addEventListener('abort', onAbort);
      timeoutId = window.setTimeout(() => {
        stopRecorder();
        settle(() => reject(new Error(
          `MP4 export timed out after ${Math.round(timeoutMs / 1000)} seconds. Try a shorter move or smaller resolution.`,
        )));
      }, timeoutMs);

      renderCameraMoveFrame(renderer, scene, camera, keyframes, 0, width, height);
      // Timeslice keeps data flowing; some Chromium builds otherwise emit one empty blob.
      recorder.start(250);
      animationFrame = requestAnimationFrame(renderFrame);
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    disposeScene(scene);
    disposeRenderer(renderer);
  }

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) {
    throw new Error(
      'MP4 recording produced an empty file. Try Chrome or Edge, or reduce resolution/duration.',
    );
  }
  return {
    blob,
    dataUrl: await blobToDataUrl(blob),
    width,
    height,
    durationSeconds,
    frameRate,
    mimeType,
    fileExtension: 'mp4',
  };
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

function renderCameraMoveFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  keyframes: ReturnType<typeof getSortedCameraKeyframes>,
  timeSeconds: number,
  width: number,
  height: number,
) {
  const cameraData = interpolateCameraKeyframes(keyframes, timeSeconds);
  applyFlyCameraToPerspectiveCamera(
    camera,
    flyCameraFromCamera(cameraData),
    cameraData.fovDegrees,
    width / height,
    cameraData.near,
    cameraData.far,
  );
  renderer.render(scene, camera);
}

export async function renderViewportClay(
  project: LocationProject,
  cameraData: CameraData,
  width: number,
  height: number,
): Promise<ImageRenderResult> {
  await ensureHumanMannequinModel();
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
  disposeRenderer(renderer);

  return { dataUrl, width, height };
}

export async function renderPanoPerspectiveCrop(
  imageUrl: string,
  crop: PanoCropSettings,
  panoRotation: Euler = [0, 0, 0],
): Promise<ImageRenderResult> {
  const renderer = createRenderer(crop.width, crop.height);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const texture = await loadTexture(imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      panoMap: { value: texture },
      yaw: { value: degreesToRadians(crop.yawDegrees - panoRotation[1]) },
      pitch: { value: degreesToRadians(crop.pitchDegrees) },
      roll: { value: degreesToRadians(crop.rollDegrees) },
      fov: { value: degreesToRadians(crop.fovDegrees) },
      aspect: { value: crop.aspectRatio },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D panoMap;
      uniform float yaw;
      uniform float pitch;
      uniform float roll;
      uniform float fov;
      uniform float aspect;
      varying vec2 vUv;
      const float PI = 3.141592653589793;

      mat3 rotateX(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
      }

      mat3 rotateY(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
      }

      mat3 rotateZ(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
      }

      void main() {
        vec2 ndc = vUv * 2.0 - 1.0;
        float tanHalfFov = tan(fov * 0.5);
        vec3 dir = normalize(vec3(-ndc.x * aspect * tanHalfFov, ndc.y * tanHalfFov, 1.0));
        dir = rotateY(yaw) * rotateX(pitch) * rotateZ(roll) * dir;
        float u = atan(dir.x, dir.z) / (2.0 * PI) + 0.5;
        float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
        gl_FragColor = texture2D(panoMap, vec2(fract(u), clamp(v, 0.0, 1.0)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  plane.geometry.dispose();
  material.dispose();
  texture.dispose();
  disposeRenderer(renderer);

  return { dataUrl, width: crop.width, height: crop.height };
}

export async function renderPanoCubemapFaces(
  imageUrl: string,
  options: {
    faceSize?: number;
    panoRotation?: Euler;
  } = {},
): Promise<PanoCubemapRenderResult> {
  const faceSize = options.faceSize ?? DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE;
  const renderedFaces = await Promise.all(
    CAMERA_MOVE_CUBEMAP_FACES.map(async (face) => [
      face,
      await renderPanoCubemapFace(imageUrl, face, faceSize, options.panoRotation ?? [0, 0, 0]),
    ] as const),
  );

  return {
    faceSize,
    faces: Object.fromEntries(renderedFaces) as Record<CameraMoveCubemapFaceId, ImageRenderResult>,
  };
}

async function renderPanoCubemapFace(
  imageUrl: string,
  face: CameraMoveCubemapFaceId,
  faceSize: number,
  panoRotation: Euler,
): Promise<ImageRenderResult> {
  const renderer = createRenderer(faceSize, faceSize);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const texture = await loadTexture(imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      panoMap: { value: texture },
      faceIndex: { value: CAMERA_MOVE_CUBEMAP_FACES.indexOf(face) },
      panoYaw: { value: degreesToRadians(panoRotation[1] ?? 0) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D panoMap;
      uniform int faceIndex;
      uniform float panoYaw;
      varying vec2 vUv;
      const float PI = 3.141592653589793;

      vec3 applyInversePanoYaw(vec3 direction, float yaw) {
        float s = sin(yaw);
        float c = cos(yaw);
        return normalize(vec3(
          direction.x * c - direction.z * s,
          direction.y,
          direction.z * c + direction.x * s
        ));
      }

      vec3 directionForFace(float sc, float tc) {
        if (faceIndex == 0) return normalize(vec3(1.0, tc, -sc));
        if (faceIndex == 1) return normalize(vec3(-1.0, tc, sc));
        if (faceIndex == 2) return normalize(vec3(sc, 1.0, -tc));
        if (faceIndex == 3) return normalize(vec3(sc, -1.0, tc));
        if (faceIndex == 4) return normalize(vec3(sc, tc, 1.0));
        return normalize(vec3(-sc, tc, -1.0));
      }

      void main() {
        float sc = vUv.x * 2.0 - 1.0;
        float tc = vUv.y * 2.0 - 1.0;
        vec3 direction = applyInversePanoYaw(directionForFace(sc, tc), panoYaw);
        float u = atan(direction.x, direction.z) / (2.0 * PI) + 0.5;
        float v = asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5;
        gl_FragColor = texture2D(panoMap, vec2(fract(u), clamp(v, 0.0, 1.0)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  plane.geometry.dispose();
  material.dispose();
  texture.dispose();
  disposeRenderer(renderer);

  return { dataUrl, width: faceSize, height: faceSize };
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

/** Release GPU resources so offline graybox/shot renders can be re-run without exhausting WebGL contexts. */
function disposeRenderer(renderer: THREE.WebGLRenderer) {
  renderer.dispose();
  renderer.forceContextLoss();
  const canvas = renderer.domElement;
  if (canvas.parentElement) {
    canvas.parentElement.removeChild(canvas);
  }
}

function loadTexture(imageUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(imageUrl, resolve, undefined, reject);
  });
}


function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
