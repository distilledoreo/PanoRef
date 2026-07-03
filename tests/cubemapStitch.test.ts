import { describe, expect, it } from 'vitest';
import {
  CUBEMAP_CROSS_FACE_ORIGINS,
  getCubemapCrossCanvasSize,
  getCubemapCrossCropRect,
  getCubemapCrossFaceRect,
  unionPixelRects,
} from '../src/engine/cubemapStitch';

describe('cubemap cross stitch layout', () => {
  it('uses a 4×3 cross with pz at the center of the middle row', () => {
    expect(getCubemapCrossCanvasSize(1024)).toEqual({ width: 4096, height: 3072 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.pz).toEqual({ column: 1, row: 1 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.py).toEqual({ column: 1, row: 0 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.ny).toEqual({ column: 1, row: 2 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.nx).toEqual({ column: 0, row: 1 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.px).toEqual({ column: 2, row: 1 });
    expect(CUBEMAP_CROSS_FACE_ORIGINS.nz).toEqual({ column: 3, row: 1 });
  });

  it('places adjacent faces on shared edges in the cross layout', () => {
    const faceSize = 512;
    const nx = getCubemapCrossFaceRect('nx', faceSize);
    const pz = getCubemapCrossFaceRect('pz', faceSize);
    const px = getCubemapCrossFaceRect('px', faceSize);
    const nz = getCubemapCrossFaceRect('nz', faceSize);
    const py = getCubemapCrossFaceRect('py', faceSize);
    const ny = getCubemapCrossFaceRect('ny', faceSize);

    expect(nx.x + nx.width).toBe(pz.x);
    expect(pz.x + pz.width).toBe(px.x);
    expect(px.x + px.width).toBe(nz.x);
    expect(py.x).toBe(pz.x);
    expect(py.y + py.height).toBe(pz.y);
    expect(ny.x).toBe(pz.x);
    expect(pz.y + pz.height).toBe(ny.y);
  });

  it('offsets visible crops within their face tiles before trimming', () => {
    const faceSize = 100;
    const pzCrop = getCubemapCrossCropRect('pz', { x: 10, y: 20, width: 30, height: 40 }, faceSize);
    const pxCrop = getCubemapCrossCropRect('px', { x: 0, y: 5, width: 25, height: 35 }, faceSize);

    expect(pzCrop).toEqual({ x: 110, y: 120, width: 30, height: 40 });
    expect(pxCrop).toEqual({ x: 200, y: 105, width: 25, height: 35 });

    const bounds = unionPixelRects([pzCrop, pxCrop]);
    expect(bounds).toEqual({ x: 110, y: 105, width: 115, height: 55 });
  });
});