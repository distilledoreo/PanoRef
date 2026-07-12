import { computeExportFrameLayout } from './sync';

export interface CssRendererRect {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

export const DEFAULT_BUILD_RENDER_DISTANCE = 200;
export const MIN_BUILD_RENDER_DISTANCE = 40;
export const MAX_BUILD_RENDER_DISTANCE = 500;

export function clampBuildRenderDistance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BUILD_RENDER_DISTANCE;
  return Math.max(MIN_BUILD_RENDER_DISTANCE, Math.min(MAX_BUILD_RENDER_DISTANCE, value));
}

export function computeFullCssRendererRect(containerWidth: number, containerHeight: number): CssRendererRect {
  return roundCssRect({
    left: 0,
    bottom: 0,
    width: Math.max(1, containerWidth),
    height: Math.max(1, containerHeight),
  });
}

export function computeCenteredFrameRendererRects(
  containerWidth: number,
  containerHeight: number,
  frameAspectRatio: number,
): { clear: CssRendererRect; frame: CssRendererRect } {
  const width = Math.max(1, containerWidth);
  const height = Math.max(1, containerHeight);
  const frame = computeExportFrameLayout(width, height, frameAspectRatio);

  return {
    clear: computeFullCssRendererRect(width, height),
    frame: roundCssRect({
      left: frame.left,
      bottom: height - frame.top - frame.height,
      width: frame.width,
      height: frame.height,
    }),
  };
}

function roundCssRect(rect: CssRendererRect): CssRendererRect {
  return {
    left: Math.round(rect.left),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}
