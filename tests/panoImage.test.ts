import { describe, expect, it } from 'vitest';
import {
  analyzeEquirectImage,
  detectCenteredPaddingCrop,
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

  it('keeps non-letterboxed images unchanged when their aspect ratio is not 2:1', () => {
    const analysis = analyzeEquirectImage(1600, 1200);
    expect(analysis.wasLetterboxed).toBe(false);
    expect(analysis.crop).toBeUndefined();
    expect(analysis.width).toBe(1600);
    expect(analysis.height).toBe(1200);
  });

  it('finds black edge padding around a non-2:1 2:1 panorama band', () => {
    const width = 16;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const isPadding = y === 0 || y === height - 1;
        pixels[index] = isPadding ? 0 : 30;
        pixels[index + 1] = isPadding ? 0 : 80;
        pixels[index + 2] = isPadding ? 0 : 120;
        pixels[index + 3] = 255;
      }
    }

    expect(detectCenteredPaddingCrop(pixels, width, height)).toEqual({ x: 0, y: 1, width: 16, height: 8 });
  });

  it('only letterboxes exports for native 2:1 panos when enabled', () => {
    expect(shouldLetterboxPanoExport(2048, 1024, true)).toBe(true);
    expect(shouldLetterboxPanoExport(1920, 1080, true)).toBe(false);
    expect(shouldLetterboxPanoExport(2048, 1024, false)).toBe(false);
  });
});
