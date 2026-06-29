import { describe, expect, it } from 'vitest';
import {
  analyzeEquirectImage,
  shouldLetterboxPanoExport,
} from '../src/engine/panoImage';

describe('panoImage', () => {
  it('recognizes native 2:1 equirectangular images', () => {
    const analysis = analyzeEquirectImage(2048, 1024);
    expect(analysis.wasLetterboxed).toBe(false);
    expect(analysis.width).toBe(2048);
    expect(analysis.height).toBe(1024);
  });

  it('detects a centered 2:1 region inside a 16:9 image', () => {
    const analysis = analyzeEquirectImage(1920, 1080);
    expect(analysis.wasLetterboxed).toBe(true);
    expect(analysis.width).toBe(1920);
    expect(analysis.height).toBe(960);
    expect(analysis.crop).toEqual({ x: 0, y: 60, width: 1920, height: 960 });
  });

  it('only letterboxes exports for native 2:1 panos when enabled', () => {
    expect(shouldLetterboxPanoExport(2048, 1024, true)).toBe(true);
    expect(shouldLetterboxPanoExport(1920, 1080, true)).toBe(false);
    expect(shouldLetterboxPanoExport(2048, 1024, false)).toBe(false);
  });
});