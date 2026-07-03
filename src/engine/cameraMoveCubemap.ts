import * as THREE from 'three';
import { CameraData, LocationProject, PanoReference, Shot, Vec3 } from '../domain/types';
import { CameraMoveReferenceFrame } from './cameraKeyframes';
import { buildScene, disposeScene } from './sceneObjects';
import { degreesToRadians, flyCameraFromCamera, length, normalize, subtract } from './sync';

export const DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE = 1024;
export const CAMERA_MOVE_CUBEMAP_SAMPLE_COLUMNS = 13;
export const CAMERA_MOVE_CUBEMAP_SAMPLE_ROWS = 7;
export const CAMERA_MOVE_CUBEMAP_CROP_PADDING_FRACTION = 0.08;

export const CAMERA_MOVE_CUBEMAP_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;

export type CameraMoveCubemapFaceId = typeof CAMERA_MOVE_CUBEMAP_FACES[number];

export interface CameraMoveCubemapFaceUv {
  face: CameraMoveCubemapFaceId;
  u: number;
  v: number;
}

export interface CameraMoveCubemapPixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraMoveCubemapVisibleFace {
  face: CameraMoveCubemapFaceId;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
  sampleCount: number;
  crop: CameraMoveCubemapPixelCrop;
  cropPath?: string;
}

export interface CameraMoveCubemapVisibilityFrame {
  id: CameraMoveReferenceFrame['id'];
  label: CameraMoveReferenceFrame['label'];
  timeSeconds: number;
  camera: CameraData;
  sampleCount: number;
  hitCount: number;
  visibleFaces: CameraMoveCubemapVisibleFace[];
}

export interface CameraMoveCubemapVisibilityMetadata {
  sourcePanoId: string;
  sourcePanoName: string;
  origin: Vec3;
  rotation: Vec3;
  faceSize: number;
  sampling: {
    columns: number;
    rows: number;
    cropPaddingFraction: number;
  };
  frames: CameraMoveCubemapVisibilityFrame[];
}

interface MutableFaceBounds {
  face: CameraMoveCubemapFaceId;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
  sampleCount: number;
}

export function directionToCubemapFaceUv(direction: Vec3): CameraMoveCubemapFaceUv {
  const [x, y, z] = normalize(direction);
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);
  let face: CameraMoveCubemapFaceId;
  let sc = 0;
  let tc = 0;

  if (absX >= absY && absX >= absZ) {
    if (x >= 0) {
      face = 'px';
      sc = -z / absX;
      tc = y / absX;
    } else {
      face = 'nx';
      sc = z / absX;
      tc = y / absX;
    }
  } else if (absY >= absX && absY >= absZ) {
    if (y >= 0) {
      face = 'py';
      sc = x / absY;
      tc = -z / absY;
    } else {
      face = 'ny';
      sc = x / absY;
      tc = z / absY;
    }
  } else if (z >= 0) {
    face = 'pz';
    sc = x / absZ;
    tc = y / absZ;
  } else {
    face = 'nz';
    sc = -x / absZ;
    tc = y / absZ;
  }

  return {
    face,
    u: clamp01((sc + 1) / 2),
    v: clamp01((1 - tc) / 2),
  };
}

export function applyInversePanoYaw(direction: Vec3, panoRotation: Vec3): Vec3 {
  const yaw = degreesToRadians(panoRotation[1] ?? 0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return normalize([
    direction[0] * cos - direction[2] * sin,
    direction[1],
    direction[2] * cos + direction[0] * sin,
  ]);
}

export function cubemapUvBoundsToPixelCrop(
  bounds: Pick<CameraMoveCubemapVisibleFace, 'uMin' | 'vMin' | 'uMax' | 'vMax'>,
  faceSize: number,
  paddingFraction = CAMERA_MOVE_CUBEMAP_CROP_PADDING_FRACTION,
): CameraMoveCubemapPixelCrop {
  const padding = Math.max(0, Math.round(faceSize * paddingFraction));
  const left = clampInt(Math.floor(bounds.uMin * faceSize) - padding, 0, faceSize - 1);
  const top = clampInt(Math.floor(bounds.vMin * faceSize) - padding, 0, faceSize - 1);
  const right = clampInt(Math.ceil(bounds.uMax * faceSize) + padding, left + 1, faceSize);
  const bottom = clampInt(Math.ceil(bounds.vMax * faceSize) + padding, top + 1, faceSize);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function addCameraMoveCubemapCropPaths(
  metadata: CameraMoveCubemapVisibilityMetadata,
): CameraMoveCubemapVisibilityMetadata {
  return {
    ...metadata,
    frames: metadata.frames.map((frame) => ({
      ...frame,
      visibleFaces: frame.visibleFaces.map((visibleFace) => ({
        ...visibleFace,
        cropPath: cameraMoveCubemapVisibleCropPath(frame.id, visibleFace.face),
      })),
    })),
  };
}

export function cameraMoveCubemapVisibleCropPath(
  frameId: CameraMoveReferenceFrame['id'],
  face: CameraMoveCubemapFaceId,
): string {
  return `inputs/camera_move/cubemap_visible/${frameId}_${face}.png`;
}

/**
 * Returns the export path for the stitched visible-faces image for a single frame.
 * Visible crops are placed in the same continuous cubemap cross layout as the master stitch.
 */
export function cameraMoveCubemapVisibleStitchedPath(
  frameId: CameraMoveReferenceFrame['id'],
): string {
  return `inputs/camera_move/cubemap_visible/${frameId}_stitched.png`;
}


export function buildCameraMoveCubemapVisibility(
  project: LocationProject,
  shot: Shot,
  pano: PanoReference,
  frames: CameraMoveReferenceFrame[],
  options: {
    faceSize?: number;
    columns?: number;
    rows?: number;
    cropPaddingFraction?: number;
  } = {},
): CameraMoveCubemapVisibilityMetadata {
  const faceSize = options.faceSize ?? DEFAULT_CAMERA_MOVE_CUBEMAP_FACE_SIZE;
  const columns = options.columns ?? CAMERA_MOVE_CUBEMAP_SAMPLE_COLUMNS;
  const rows = options.rows ?? CAMERA_MOVE_CUBEMAP_SAMPLE_ROWS;
  const cropPaddingFraction = options.cropPaddingFraction ?? CAMERA_MOVE_CUBEMAP_CROP_PADDING_FRACTION;
  const scene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });
  const camera = new THREE.PerspectiveCamera(
    shot.camera.fovDegrees,
    shot.exportSettings.width / shot.exportSettings.height,
    shot.camera.near,
    shot.camera.far,
  );
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  try {
    return {
      sourcePanoId: pano.id,
      sourcePanoName: pano.name,
      origin: [...pano.origin],
      rotation: [...pano.rotation],
      faceSize,
      sampling: {
        columns,
        rows,
        cropPaddingFraction,
      },
      frames: frames.map((frame) => {
        const boundsByFace = new Map<CameraMoveCubemapFaceId, MutableFaceBounds>();
        let hitCount = 0;
        applyCameraDataToPerspectiveCamera(
          camera,
          frame.camera,
          shot.exportSettings.width / shot.exportSettings.height,
        );

        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            ndc.set(
              ((column + 0.5) / columns) * 2 - 1,
              1 - ((row + 0.5) / rows) * 2,
            );
            raycaster.setFromCamera(ndc, camera);
            const hit = raycaster
              .intersectObjects(scene.children, true)
              .find((candidate) => Boolean(findSceneObjectId(candidate.object)));

            if (!hit) continue;
            const direction = subtract(hit.point.toArray() as Vec3, pano.origin);
            if (length(direction) <= Number.EPSILON) continue;
            hitCount += 1;
            const faceUv = directionToCubemapFaceUv(applyInversePanoYaw(direction, pano.rotation));
            includeFaceSample(boundsByFace, faceUv);
          }
        }

        return {
          id: frame.id,
          label: frame.label,
          timeSeconds: frame.timeSeconds,
          camera: frame.camera,
          sampleCount: columns * rows,
          hitCount,
          visibleFaces: [...boundsByFace.values()]
            .map((bounds) => finalizeFaceBounds(bounds, faceSize, cropPaddingFraction))
            .sort((a, b) => CAMERA_MOVE_CUBEMAP_FACES.indexOf(a.face) - CAMERA_MOVE_CUBEMAP_FACES.indexOf(b.face)),
        };
      }),
    };
  } finally {
    disposeScene(scene);
  }
}

function applyCameraDataToPerspectiveCamera(
  camera: THREE.PerspectiveCamera,
  cameraData: CameraData,
  aspect: number,
) {
  const fly = flyCameraFromCamera(cameraData);
  camera.fov = cameraData.fovDegrees;
  camera.aspect = aspect;
  camera.near = cameraData.near;
  camera.far = cameraData.far;
  camera.position.set(fly.position[0], fly.position[1], fly.position[2]);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = degreesToRadians(fly.yawDegrees);
  camera.rotation.x = degreesToRadians(fly.pitchDegrees);
  camera.rotation.z = 0;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function includeFaceSample(
  boundsByFace: Map<CameraMoveCubemapFaceId, MutableFaceBounds>,
  faceUv: CameraMoveCubemapFaceUv,
) {
  const existing = boundsByFace.get(faceUv.face);
  if (!existing) {
    boundsByFace.set(faceUv.face, {
      face: faceUv.face,
      uMin: faceUv.u,
      vMin: faceUv.v,
      uMax: faceUv.u,
      vMax: faceUv.v,
      sampleCount: 1,
    });
    return;
  }

  existing.uMin = Math.min(existing.uMin, faceUv.u);
  existing.vMin = Math.min(existing.vMin, faceUv.v);
  existing.uMax = Math.max(existing.uMax, faceUv.u);
  existing.vMax = Math.max(existing.vMax, faceUv.v);
  existing.sampleCount += 1;
}

function finalizeFaceBounds(
  bounds: MutableFaceBounds,
  faceSize: number,
  cropPaddingFraction: number,
): CameraMoveCubemapVisibleFace {
  const rounded = {
    face: bounds.face,
    uMin: roundUnit(bounds.uMin),
    vMin: roundUnit(bounds.vMin),
    uMax: roundUnit(bounds.uMax),
    vMax: roundUnit(bounds.vMax),
    sampleCount: bounds.sampleCount,
  };

  return {
    ...rounded,
    crop: cubemapUvBoundsToPixelCrop(rounded, faceSize, cropPaddingFraction),
  };
}

function findSceneObjectId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.sceneObjectId === 'string') return current.userData.sceneObjectId;
    current = current.parent;
  }
  return undefined;
}

function roundUnit(value: number): number {
  return Number(clamp01(value).toFixed(6));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
