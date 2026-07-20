import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FOCAL_LENGTH_HUD_FADE_MS,
  FOCAL_LENGTH_HUD_HIDE_DELAY_MS,
  focalLengthFromVerticalFov,
} from '../src/engine/focalLength';

describe('focalLengthFromVerticalFov', () => {
  it('computes full-frame equivalent focal length from vertical FOV and aspect ratio', () => {
    const aspectRatio = 3 / 2;
    const verticalFovDegrees = 2 * (Math.atan((36 / aspectRatio) / (2 * 35)) * 180 / Math.PI);
    expect(focalLengthFromVerticalFov(verticalFovDegrees, aspectRatio)).toBeCloseTo(35, 5);
  });

  it('returns a shorter focal length for a wider vertical FOV', () => {
    const aspectRatio = 16 / 9;
    const narrow = focalLengthFromVerticalFov(35, aspectRatio);
    const wide = focalLengthFromVerticalFov(70, aspectRatio);
    expect(wide).toBeLessThan(narrow);
  });

  it('returns an unrounded focal length from the conversion helper', () => {
    const aspectRatio = 16 / 9;
    const focalLength = focalLengthFromVerticalFov(54.4, aspectRatio);
    expect(Number.isInteger(focalLength)).toBe(false);
  });
});

describe('focal length HUD timing constants', () => {
  it('hides the HUD about one second after scrolling stops', () => {
    expect(FOCAL_LENGTH_HUD_HIDE_DELAY_MS).toBe(1000);
  });

  it('fades the HUD out over a short transition', () => {
    expect(FOCAL_LENGTH_HUD_FADE_MS).toBeGreaterThan(0);
    expect(FOCAL_LENGTH_HUD_FADE_MS).toBeLessThan(FOCAL_LENGTH_HUD_HIDE_DELAY_MS);
  });
});

describe('shot framing focal length HUD wiring', () => {
  it('shows the HUD from scroll-wheel FOV changes without altering stored camera data', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('showFocalLengthHudRef.current(framingFovRef.current)');
    expect(viewport).toContain('focalLengthHudFov={focalLengthHudFov}');
    expect(viewport).toContain('FOCAL_LENGTH_HUD_HIDE_DELAY_MS');
    expect(viewport).toMatch(/framingFovRef\.current = Math\.max\(18, Math\.min\(120, framingFovRef\.current \+ event\.deltaY \* 0\.04\)\)/);
    expect(viewport).toContain('emitFramingCamera()');
  });
});
