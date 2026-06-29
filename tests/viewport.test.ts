import { describe, expect, it } from 'vitest';
import { computeCenteredFrameRendererRects, computeFullCssRendererRect } from '../src/engine/viewport';

describe('scene viewport renderer rectangles', () => {
  it('uses CSS-pixel dimensions for the full Build viewport', () => {
    expect(computeFullCssRendererRect(1200, 800)).toEqual({
      left: 0,
      bottom: 0,
      width: 1200,
      height: 800,
    });
  });

  it('keeps the centered frame in CSS pixels so overlays and pointer raycasts stay aligned', () => {
    const devicePixelRatio = 2;
    const { clear, frame } = computeCenteredFrameRendererRects(2000, 900, 16 / 9);

    expect(clear).toEqual({
      left: 0,
      bottom: 0,
      width: 2000,
      height: 900,
    });
    expect(frame).toEqual({
      left: 200,
      bottom: 0,
      width: 1600,
      height: 900,
    });
    expect(frame.width).not.toBe(1600 * devicePixelRatio);
  });
});
