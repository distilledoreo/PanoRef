import * as THREE from 'three';
import type { CameraData, Vec3 } from '../domain/types';
import {
  clampShotNearClip,
  DEFAULT_SHOT_NEAR_CLIP_METERS,
  MAX_SHOT_NEAR_CLIP_METERS,
} from './cameraClipping';
import {
  FINAL_RENDER_FAR_SAFETY_MARGIN_METERS,
  FINAL_RENDER_NEAR_SAFE_METERS,
} from './finalRenderProfile';

export interface ExportClippingRange {
  near: number;
  far: number;
}

/**
 * One fixed near/far for an entire camera move.
 * Do not interpolate clipping planes between keyframes — that causes
 * geometry to pop in/out during the move.
 */
export function computeCameraMoveClippingRange(params: {
  scene: THREE.Scene;
  keyframeCameras: readonly CameraData[];
  nearMeters?: number;
  farSafetyMarginMeters?: number;
}): ExportClippingRange {
  const near = clampExportNear(params.nearMeters ?? DEFAULT_SHOT_NEAR_CLIP_METERS);
  const margin = params.farSafetyMarginMeters ?? FINAL_RENDER_FAR_SAFETY_MARGIN_METERS;
  const bounds = new THREE.Box3().setFromObject(params.scene);

  if (bounds.isEmpty() || params.keyframeCameras.length === 0) {
    return { near, far: Math.max(near + 1, 100) };
  }

  const corners = boxCorners(bounds);
  let farthest = 0;
  for (const camera of params.keyframeCameras) {
    const origin = new THREE.Vector3(...camera.position);
    for (const corner of corners) {
      farthest = Math.max(farthest, origin.distanceTo(corner));
    }
    // Also cover the look-at target so long shots never clip mid-move.
    farthest = Math.max(farthest, origin.distanceTo(new THREE.Vector3(...camera.target)));
  }

  return {
    near,
    far: Math.max(near + 1, farthest + margin),
  };
}

/** Distance from a single camera/origin to scene bounds (+ margin). */
export function computeOriginToSceneFarPlane(
  scene: THREE.Scene,
  origin: Vec3,
  near = FINAL_RENDER_NEAR_SAFE_METERS,
  margin = FINAL_RENDER_FAR_SAFETY_MARGIN_METERS,
): number {
  const bounds = new THREE.Box3().setFromObject(scene);
  if (bounds.isEmpty()) return Math.max(near + 1, 100);
  const eye = new THREE.Vector3(...origin);
  let farthest = 0;
  for (const corner of boxCorners(bounds)) {
    farthest = Math.max(farthest, eye.distanceTo(corner));
  }
  return Math.max(near + 1, farthest + margin);
}

/**
 * Allow intentional foreground clipping up to MAX_SHOT_NEAR_CLIP_METERS.
 * Far is derived from scene bounds separately and kept above near.
 */
function clampExportNear(value: number): number {
  return clampShotNearClip(value, MAX_SHOT_NEAR_CLIP_METERS + 0.01);
}

function boxCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const { min, max } = bounds;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}
