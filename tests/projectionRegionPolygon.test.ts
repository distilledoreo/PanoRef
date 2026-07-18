import { describe, expect, it } from 'vitest';
import { createProjectionRegion, createProjectionRegionVertexPair } from '../src/domain/defaults';
import {
  diagnoseProjectionRegionPolygon, insertPairedVertex, pointInsidePolygon,
  polygonBounds, polygonCentroid, polygonSelfIntersects, removePairedVertex,
  rotateSourceMask, scaleSourceMask, signedPolygonArea, sourceLoopFromRegion,
  targetLoopFromRegion, translateSelectedSourceVertices, translateSourceMask,
  unwrapRegionU,
} from '../src/engine/projectionRegionPolygon';

function square() {
  return createProjectionRegion([
    createProjectionRegionVertexPair([0.9, 0.3], [0.9, 0.3], 'v1'),
    createProjectionRegionVertexPair([0.1, 0.3], [0.1, 0.3], 'v2'),
    createProjectionRegionVertexPair([0.1, 0.5], [0.1, 0.5], 'v3'),
    createProjectionRegionVertexPair([0.9, 0.5], [0.9, 0.5], 'v4'),
  ]);
}

describe('paired region polygon utilities', () => {
  it('extracts loops and computes geometry across the seam', () => {
    const region = square();
    const loop = unwrapRegionU(targetLoopFromRegion(region));
    expect(sourceLoopFromRegion(region)).toHaveLength(4);
    expect(Math.abs(signedPolygonArea(loop))).toBeCloseTo(0.04);
    expect(polygonBounds(loop)).toEqual({ min: [0.9, 0.3], max: [1.1, 0.5] });
    expect(polygonCentroid(loop)[0]).toBeCloseTo(1);
    expect(polygonCentroid(loop)[1]).toBeCloseTo(0.4);
    expect(pointInsidePolygon([1, 0.4], loop)).toBe(true);
  });

  it('inserts one shared vertex into paired edges and deletes both sides together', () => {
    const inserted = insertPairedVertex(square(), 'v1', 0.6);
    expect(inserted.vertices).toHaveLength(5);
    expect(inserted.vertices[1].targetUv[0]).toBeCloseTo(0.02);
    expect(inserted.vertices[1].sourceUv[0]).toBeCloseTo(0.02);
    expect(inserted.vertices[1].id).toBeTruthy();
    const removed = removePairedVertex(inserted, inserted.vertices[1].id);
    expect(removed.vertices.map((vertex) => vertex.id)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(removePairedVertex({ ...removed, vertices: removed.vertices.slice(0, 3) }, 'v1').vertices).toHaveLength(3);
  });

  it('transforms only styled positions', () => {
    const original = square();
    const translated = translateSourceMask(original, [0.05, 0.1]);
    expect(translated.vertices[0].sourceUv[0]).toBeCloseTo(0.95);
    expect(translated.vertices[0].sourceUv[1]).toBeCloseTo(0.4);
    expect(translated.vertices[0].targetUv).toEqual(original.vertices[0].targetUv);
    const scaled = scaleSourceMask(original, 2);
    expect(unwrapRegionU(sourceLoopFromRegion(scaled))[0][0]).toBeCloseTo(0.8);
    expect(unwrapRegionU(sourceLoopFromRegion(scaled))[0][1]).toBeCloseTo(0.2);
    const rotated = rotateSourceMask(original, Math.PI);
    expect(sourceLoopFromRegion(rotated)[0][0]).toBeCloseTo(0.1);
    const selected = translateSelectedSourceVertices(original, ['v2', 'v3'], [0.1, 0]);
    expect(selected.vertices[0].sourceUv[0]).toBeCloseTo(original.vertices[0].sourceUv[0]);
    expect(selected.vertices[0].sourceUv[1]).toBeCloseTo(original.vertices[0].sourceUv[1]);
    expect(selected.vertices[1].sourceUv[0]).toBeCloseTo(0.2);
  });

  it('reports self intersections, degenerate outlines, large spans, and poles', () => {
    expect(polygonSelfIntersects([[0, 0], [1, 1], [0, 1], [1, 0]])).toBe(true);
    const invalid = createProjectionRegion([
      createProjectionRegionVertexPair([0, 0], [0, 0], 'same'),
      createProjectionRegionVertexPair([0.5, 0.5], [0.5, 0.5], 'same'),
      createProjectionRegionVertexPair([0, 0.5], [0, 0.5], 'v3'),
      createProjectionRegionVertexPair([0.5, 0], [0.5, 0], 'v4'),
    ]);
    expect(diagnoseProjectionRegionPolygon(invalid)).toMatchObject({
      valid: false,
      targetSelfIntersects: true,
      duplicateConsecutiveVertices: true,
      excessiveAngularExtent: true,
      unstablePoleRegion: true,
    });
  });
});
