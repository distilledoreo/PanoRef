import * as THREE from 'three';
import { Euler, PanoViewState, Vec2 } from '../domain/types';
import { degreesToRadians } from './sync';

export const PANOVIEWER_CLICK_THRESHOLD_PX = 5;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PanoScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeU(value: number): number {
  return ((value % 1) + 1) % 1;
}

function normalizedView(view: PanoViewState): PanoViewState {
  return {
    yawDegrees: finiteOr(view.yawDegrees, 0),
    pitchDegrees: clamp(finiteOr(view.pitchDegrees, 0), -89.999, 89.999),
    fovDegrees: clamp(finiteOr(view.fovDegrees, 65), 1, 179),
  };
}

/**
 * The viewer uses an inward-facing SphereGeometry scaled on X. Its texture
 * coordinates therefore describe a direction as atan2(z, x), while the
 * projection engine's equirectangular convention remains unchanged. Keeping
 * this conversion here makes picking and marker placement match the pixels a
 * user sees in PanoViewer.
 */
function textureUvToViewerDirection(uv: Vec2): THREE.Vector3 {
  const u = normalizeU(finiteOr(uv[0], 0));
  const v = clamp(finiteOr(uv[1], 0.5), 0, 1);
  const longitude = u * Math.PI * 2;
  const latitude = (v - 0.5) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  return new THREE.Vector3(
    Math.cos(longitude) * cosLatitude,
    Math.sin(latitude),
    Math.sin(longitude) * cosLatitude,
  ).normalize();
}

function viewerDirectionToTextureUv(direction: THREE.Vector3): Vec2 {
  const normalized = direction.clone().normalize();
  const u = normalizeU(Math.atan2(normalized.z, normalized.x) / (Math.PI * 2));
  const v = clamp(0.5 + Math.asin(clamp(normalized.y, -1, 1)) / Math.PI, 0, 1);
  return [Number.isFinite(u) ? u : 0, Number.isFinite(v) ? v : 0.5];
}

function cameraEuler(view: PanoViewState, panoRotation: Euler): THREE.Euler {
  const normalized = normalizedView(view);
  const panoYaw = finiteOr(panoRotation[1], 0);
  return new THREE.Euler(
    degreesToRadians(normalized.pitchDegrees),
    degreesToRadians(90 - (normalized.yawDegrees - panoYaw)),
    0,
    'YXZ',
  );
}

function cameraRayFromScreenPoint(
  point: ScreenPoint,
  viewport: ViewportSize,
  view: PanoViewState,
  panoRotation: Euler,
): THREE.Vector3 | undefined {
  const width = finiteOr(viewport.width, 0);
  const height = finiteOr(viewport.height, 0);
  if (width <= 0 || height <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return undefined;
  }

  const normalized = normalizedView(view);
  const aspect = width / height;
  const tangent = Math.tan(degreesToRadians(normalized.fovDegrees) * 0.5);
  const ndcX = (point.x / width) * 2 - 1;
  const ndcY = 1 - (point.y / height) * 2;
  const cameraRay = new THREE.Vector3(
    ndcX * tangent * aspect,
    ndcY * tangent,
    -1,
  ).normalize();
  return cameraRay.applyEuler(cameraEuler(normalized, panoRotation)).normalize();
}

/** Convert a CSS-pixel point in the viewer to the displayed panorama UV. */
export function screenPointToPanoUv(
  point: ScreenPoint,
  viewport: ViewportSize,
  view: PanoViewState,
  panoRotation: Euler,
): Vec2 | undefined {
  const direction = cameraRayFromScreenPoint(point, viewport, view, panoRotation);
  return direction ? viewerDirectionToTextureUv(direction) : undefined;
}

/** Convert a displayed panorama UV into CSS-pixel screen coordinates. */
export function panoUvToScreenPoint(
  uv: Vec2,
  viewport: ViewportSize,
  view: PanoViewState,
  panoRotation: Euler,
): PanoScreenPoint {
  const width = finiteOr(viewport.width, 0);
  const height = finiteOr(viewport.height, 0);
  if (width <= 0 || height <= 0) return { x: 0, y: 0, visible: false };

  const camera = cameraEuler(view, panoRotation);
  const quaternion = new THREE.Quaternion().setFromEuler(camera).invert();
  const cameraDirection = textureUvToViewerDirection(uv).applyQuaternion(quaternion).normalize();
  const depth = cameraDirection.z;
  if (!Number.isFinite(depth) || depth >= -1e-8) {
    return { x: 0, y: 0, visible: false };
  }

  const normalized = normalizedView(view);
  const tangent = Math.tan(degreesToRadians(normalized.fovDegrees) * 0.5);
  const aspect = width / height;
  const ndcX = (cameraDirection.x / -depth) / (tangent * aspect);
  const ndcY = (cameraDirection.y / -depth) / tangent;
  const x = (ndcX + 1) * 0.5 * width;
  const y = (1 - ndcY) * 0.5 * height;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    visible: Number.isFinite(x) && Number.isFinite(y),
  };
}

/** Center a panorama viewer on a paired region so the newly-created outline is visible. */
export function recenteredPanoViewForUvs(uvs: readonly Vec2[], panoRotation: Euler): PanoViewState {
  if (!uvs.length) return { yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 };
  const unwrapped: Vec2[] = [[finiteOr(uvs[0][0], 0), clamp(finiteOr(uvs[0][1], 0.5), 0, 1)]];
  for (let index = 1; index < uvs.length; index += 1) {
    let u = finiteOr(uvs[index][0], unwrapped[index - 1][0]);
    while (u - unwrapped[index - 1][0] > 0.5) u -= 1;
    while (u - unwrapped[index - 1][0] < -0.5) u += 1;
    unwrapped.push([u, clamp(finiteOr(uvs[index][1], 0.5), 0, 1)]);
  }
  const minU = Math.min(...unwrapped.map(([u]) => u));
  const maxU = Math.max(...unwrapped.map(([u]) => u));
  const minV = Math.min(...unwrapped.map(([, v]) => v));
  const maxV = Math.max(...unwrapped.map(([, v]) => v));
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  const horizontalSpanDegrees = (maxU - minU) * 360;
  const verticalSpanDegrees = (maxV - minV) * 180;
  const panoYaw = finiteOr(panoRotation[1], 0);
  return {
    yawDegrees: (centerU - 0.5) * 360 + panoYaw,
    pitchDegrees: clamp((centerV - 0.5) * 180, -70, 70),
    fovDegrees: clamp(Math.max(65, horizontalSpanDegrees * 1.35, verticalSpanDegrees * 1.35), 65, 110),
  };
}

/** True when a pointer gesture stayed within the viewer's click threshold. */
export function isPanoViewerClick(
  start: ScreenPoint,
  end: ScreenPoint,
  hadMultiplePointers = false,
): boolean {
  if (hadMultiplePointers) return false;
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= PANOVIEWER_CLICK_THRESHOLD_PX;
}

export function shouldPickPanoViewerPointerUp(
  interactionMode: 'navigate' | 'pick' | 'draw-region' | 'edit-region' | 'transform-region' | 'move-outline' | 'edit-handles',
  isClick: boolean,
  cancelled = false,
): boolean {
  return interactionMode !== 'navigate' && isClick && !cancelled;
}
