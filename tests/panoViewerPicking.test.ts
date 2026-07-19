import { describe, expect, it } from 'vitest';
import {
  isPanoViewerClick,
  panoUvToScreenPoint,
  recenteredPanoViewForUvs,
  screenPointToPanoUv,
  shouldPickPanoViewerPointerUp,
} from '../src/engine/panoViewerPicking';
import { choosePanoGestureOwner, unwrapPanoUToReference } from '../src/components/viewers/PanoViewer';

const viewport = { width: 1000, height: 500 };
const identityRotation: [number, number, number] = [0, 0, 0];
const neutralView = { yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 };

function wrappedDistance(a: number, b: number): number {
  return Math.abs(((a - b + 0.5) % 1 + 1) % 1 - 0.5);
}

describe('PanoViewer picking math', () => {
  it('maps screen center to the current view direction', () => {
    expect(screenPointToPanoUv({ x: 500, y: 250 }, viewport, neutralView, identityRotation))
      .toEqual([0.5, 0.5]);
  });

  it('moves U with positive yaw', () => {
    const uv = screenPointToPanoUv(
      { x: 500, y: 250 },
      viewport,
      { ...neutralView, yawDegrees: 90 },
      identityRotation,
    );
    expect(uv?.[0]).toBeCloseTo(0.75, 6);
  });

  it('moves V with pitch', () => {
    const uv = screenPointToPanoUv(
      { x: 500, y: 250 },
      viewport,
      { ...neutralView, pitchDegrees: 30 },
      identityRotation,
    );
    expect(uv?.[1]).toBeCloseTo(2 / 3, 6);
  });

  it('uses vertical FOV when converting off-center rays', () => {
    const narrow = screenPointToPanoUv(
      { x: 750, y: 250 },
      viewport,
      { ...neutralView, fovDegrees: 40 },
      identityRotation,
    );
    const wide = screenPointToPanoUv(
      { x: 750, y: 250 },
      viewport,
      { ...neutralView, fovDegrees: 100 },
      identityRotation,
    );
    expect(narrow?.[0]).not.toBeCloseTo(wide?.[0], 3);
  });

  it('respects aspect ratio', () => {
    const wideViewport = screenPointToPanoUv(
      { x: 750, y: 250 },
      { width: 1000, height: 500 },
      neutralView,
      identityRotation,
    );
    const tallViewport = screenPointToPanoUv(
      { x: 375, y: 500 },
      { width: 500, height: 1000 },
      neutralView,
      identityRotation,
    );
    expect(wideViewport?.[0]).not.toBeCloseTo(tallViewport?.[0], 3);
  });

  it('respects panorama yaw rotation', () => {
    const uv = screenPointToPanoUv(
      { x: 500, y: 250 },
      viewport,
      neutralView,
      [0, 90, 0],
    );
    expect(uv?.[0]).toBeCloseTo(0.25, 6);
  });

  it('wraps the horizontal seam', () => {
    const zero = panoUvToScreenPoint([0, 0.5], viewport, { ...neutralView, yawDegrees: 180 }, identityRotation);
    const wrapped = panoUvToScreenPoint([1, 0.5], viewport, { ...neutralView, yawDegrees: 180 }, identityRotation);
    expect(zero.visible).toBe(true);
    expect(wrapped.visible).toBe(true);
    expect(wrapped.x).toBeCloseTo(zero.x, 6);
    expect(wrapped.y).toBeCloseTo(zero.y, 6);
  });

  it('keeps near-pole calculations finite', () => {
    const screen = panoUvToScreenPoint([0.13, 0.001], viewport, neutralView, identityRotation);
    const uv = screenPointToPanoUv({ x: 500, y: 1 }, viewport, neutralView, identityRotation);
    expect(Number.isFinite(screen.x)).toBe(true);
    expect(Number.isFinite(screen.y)).toBe(true);
    expect(uv?.every(Number.isFinite)).toBe(true);
  });

  it('round-trips visible UVs through screen space', () => {
    const view = { yawDegrees: 25, pitchDegrees: -10, fovDegrees: 58 };
    const original: [number, number] = [0.62, 0.58];
    const screen = panoUvToScreenPoint(original, viewport, view, [0, 15, 0]);
    expect(screen.visible).toBe(true);
    const roundTrip = screenPointToPanoUv(screen, viewport, view, [0, 15, 0]);
    expect(roundTrip).toBeDefined();
    expect(wrappedDistance(roundTrip![0], original[0])).toBeLessThan(1e-6);
    expect(Math.abs(roundTrip![1] - original[1])).toBeLessThan(1e-6);
  });

  it('hides a marker behind the camera', () => {
    const point = panoUvToScreenPoint([0, 0.5], viewport, neutralView, identityRotation);
    expect(point.visible).toBe(false);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  it('recenters a paired region into a differently rotated panorama', () => {
    const view = recenteredPanoViewForUvs(
      [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6]],
      [0, 180, 0],
    );
    expect(view.yawDegrees).toBeCloseTo(180, 6);
    expect(panoUvToScreenPoint([0.4, 0.4], viewport, view, [0, 180, 0]).visible).toBe(true);
    expect(panoUvToScreenPoint([0.6, 0.6], viewport, view, [0, 180, 0]).visible).toBe(true);
  });
});

describe('PanoViewer pointer gesture classification', () => {
  it('assigns exclusive owners for navigation, masks, bodies, and handles', () => {
    expect(choosePanoGestureOwner('navigate', undefined, false, false)).toBe('view');
    expect(choosePanoGestureOwner('move-outline', undefined, true, false)).toBe('region-transform');
    expect(choosePanoGestureOwner('edit-handles', 'handle', false, false)).toBe('region-handle');
    expect(choosePanoGestureOwner('edit-handles', undefined, false, false)).toBe('none');
    expect(choosePanoGestureOwner('edit-handles', undefined, false, true)).toBe('view');
    expect(choosePanoGestureOwner('draw-region', undefined, false, false)).toBe('region-mask');
    expect(choosePanoGestureOwner('draw-region', 'handle', false, false)).toBe('region-mask');
  });

  it('keeps an active horizontal drag continuous across the panorama seam', () => {
    expect(unwrapPanoUToReference(0.01, 0.99)).toBeCloseTo(1.01, 6);
    expect(unwrapPanoUToReference(0.99, 0.01)).toBeCloseTo(-0.01, 6);
  });

  it('picks a click at or under the five-pixel threshold', () => {
    expect(isPanoViewerClick({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true);
    expect(shouldPickPanoViewerPointerUp('pick', true)).toBe(true);
  });

  it('does not pick a drag over the threshold', () => {
    expect(isPanoViewerClick({ x: 10, y: 10 }, { x: 16, y: 14 })).toBe(false);
    expect(shouldPickPanoViewerPointerUp('pick', false)).toBe(false);
  });

  it('does not pick a cancelled pointer or a multi-pointer gesture', () => {
    expect(shouldPickPanoViewerPointerUp('pick', true, true)).toBe(false);
    expect(isPanoViewerClick({ x: 10, y: 10 }, { x: 10, y: 10 }, true)).toBe(false);
  });

  it('never picks in navigate mode', () => {
    expect(shouldPickPanoViewerPointerUp('navigate', true)).toBe(false);
  });

  it('routes clicks to every Region Fit interaction mode', () => {
    expect(shouldPickPanoViewerPointerUp('draw-region', true)).toBe(true);
    expect(shouldPickPanoViewerPointerUp('edit-region', true)).toBe(true);
    expect(shouldPickPanoViewerPointerUp('transform-region', true)).toBe(true);
  });
});
