import type {
  CameraKeyframe,
  SceneObject,
  ShotObjectOverride,
  ShotObjectOverrides,
  Transform,
} from '../domain/types';
import { cloneTransform } from './shotSceneState';
import { getSortedCameraKeyframes } from './cameraKeyframes';

export function cloneShotObjectOverrides(
  overrides: ShotObjectOverrides | undefined,
): ShotObjectOverrides {
  if (!overrides) return {};
  const next: ShotObjectOverrides = {};
  for (const [objectId, override] of Object.entries(overrides)) {
    next[objectId] = cloneShotObjectOverride(override);
  }
  return next;
}

export function cloneShotObjectOverride(override: ShotObjectOverride): ShotObjectOverride {
  return {
    ...(override.transform ? { transform: cloneTransform(override.transform) } : {}),
    ...(override.visible !== undefined ? { visible: override.visible } : {}),
  };
}

/** True when at least one camera keyframe carries a staged-object snapshot. */
export function cameraKeyframesHaveObjectAnimation(
  keyframes: readonly CameraKeyframe[] = [],
): boolean {
  return getSortedCameraKeyframes(keyframes).some(
    (keyframe) => Boolean(keyframe.objectOverrides && Object.keys(keyframe.objectOverrides).length > 0),
  );
}

/**
 * Interpolate staged-object overrides between the surrounding camera keyframes.
 * Falls back to `fallbackOverrides` (usually the shot's live objectOverrides) when
 * keyframes do not carry snapshots.
 */
export function interpolateObjectOverrides(
  keyframes: readonly CameraKeyframe[],
  timeSeconds: number,
  fallbackOverrides: ShotObjectOverrides | undefined = {},
  baseObjects: readonly Pick<SceneObject, 'id' | 'transform' | 'visible'>[] = [],
): ShotObjectOverrides {
  const sorted = getSortedCameraKeyframes(keyframes);
  const fallback = fallbackOverrides ?? {};
  if (sorted.length === 0) return cloneShotObjectOverrides(fallback);

  const baseById = new Map(baseObjects.map((object) => [object.id, object]));

  if (sorted.length === 1 || timeSeconds <= sorted[0].timeSeconds) {
    return resolveKeyframeOverrides(sorted[0], fallback);
  }
  const last = sorted[sorted.length - 1];
  if (timeSeconds >= last.timeSeconds) {
    return resolveKeyframeOverrides(last, fallback);
  }

  const nextIndex = sorted.findIndex((keyframe) => keyframe.timeSeconds >= timeSeconds);
  const start = sorted[Math.max(0, nextIndex - 1)];
  const end = sorted[nextIndex];
  const span = Math.max(end.timeSeconds - start.timeSeconds, Number.EPSILON);
  const t = (timeSeconds - start.timeSeconds) / span;

  const startOverrides = resolveKeyframeOverrides(start, fallback);
  const endOverrides = resolveKeyframeOverrides(end, fallback);
  const ids = new Set([
    ...Object.keys(startOverrides),
    ...Object.keys(endOverrides),
    ...Object.keys(fallback),
    ...baseObjects.map((object) => object.id),
  ]);

  // Only emit overrides for objects that actually participate in keyframe/fallback staging.
  const stagedIds = new Set([
    ...Object.keys(startOverrides),
    ...Object.keys(endOverrides),
    ...Object.keys(fallback),
  ]);

  const result: ShotObjectOverrides = {};
  for (const id of ids) {
    if (!stagedIds.has(id)) continue;
    const startOverride = startOverrides[id];
    const endOverride = endOverrides[id];
    const base = baseById.get(id);
    const startTransform = startOverride?.transform ?? base?.transform;
    const endTransform = endOverride?.transform ?? base?.transform;
    const startVisible = startOverride?.visible ?? base?.visible;
    const endVisible = endOverride?.visible ?? base?.visible;

    const override: ShotObjectOverride = {};
    if (startTransform && endTransform) {
      override.transform = lerpTransform(startTransform, endTransform, t);
    } else if (endTransform) {
      override.transform = cloneTransform(endTransform);
    } else if (startTransform) {
      override.transform = cloneTransform(startTransform);
    }

    if (startVisible !== undefined || endVisible !== undefined) {
      // Discrete visibility snap at midpoint — avoids half-visible props.
      const from = startVisible ?? endVisible ?? true;
      const to = endVisible ?? startVisible ?? true;
      override.visible = t < 0.5 ? from : to;
    }

    if (override.transform || override.visible !== undefined) {
      result[id] = override;
    }
  }
  return result;
}

function resolveKeyframeOverrides(
  keyframe: CameraKeyframe,
  fallback: ShotObjectOverrides,
): ShotObjectOverrides {
  if (keyframe.objectOverrides && Object.keys(keyframe.objectOverrides).length > 0) {
    return cloneShotObjectOverrides(keyframe.objectOverrides);
  }
  return cloneShotObjectOverrides(fallback);
}

function lerpTransform(start: Transform, end: Transform, t: number): Transform {
  return {
    position: [
      lerp(start.position[0], end.position[0], t),
      lerp(start.position[1], end.position[1], t),
      lerp(start.position[2], end.position[2], t),
    ],
    rotation: [
      lerp(start.rotation[0], end.rotation[0], t),
      lerp(start.rotation[1], end.rotation[1], t),
      lerp(start.rotation[2], end.rotation[2], t),
    ],
    scale: [
      lerp(start.scale[0], end.scale[0], t),
      lerp(start.scale[1], end.scale[1], t),
      lerp(start.scale[2], end.scale[2], t),
    ],
  };
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
