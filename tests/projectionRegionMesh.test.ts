import { describe, expect, it } from 'vitest';
import { createProjectionRegionMesh, triangulatePolygon } from '../src/engine/projectionRegionMesh';

const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
describe('localized paired-mask deformation mesh', () => {
  it('triangulates convex and concave polygons with shared indices', () => {
    expect(triangulatePolygon(square)).toHaveLength(2);
    expect(triangulatePolygon([[0, 0], [1, 0], [0.5, 0.5], [1, 1], [0, 1]])).toHaveLength(3);
  });

  it('creates identity interior plus an identity transition cage', () => {
    const mesh = createProjectionRegionMesh(square, square, 0.1);
    expect(mesh.diagnostics.valid).toBe(true); expect(mesh.vertices).toHaveLength(8); expect(mesh.triangles).toHaveLength(10);
    expect(mesh.vertices.slice(0, 4).every((vertex) => vertex.weight === 1 && vertex.target[0] === vertex.source[0])).toBe(true);
    expect(mesh.vertices.slice(4).every((vertex) => vertex.weight === 0 && vertex.target[0] === vertex.source[0])).toBe(true);
    expect(mesh.supportPadding).toBeCloseTo(Math.SQRT2 * 0.2);
  });

  it('keeps deformation localized while mapping target triangles to paired source triangles', () => {
    const source: [number, number][] = square.map(([x, y]) => [x + 0.2, y]);
    const mesh = createProjectionRegionMesh(square, source, 0.05);
    expect(mesh.diagnostics.valid).toBe(true);
    expect(mesh.vertices[0].source).toEqual([0.2, 0]);
    expect(mesh.vertices.at(-1)?.source).toEqual(mesh.vertices.at(-1)?.target);
  });

  it('blocks reversed and collapsed triangles', () => {
    const folded = createProjectionRegionMesh(square, [[0, 0], [0, 1], [1, 1], [1, 0]], 0.1);
    expect(folded.diagnostics.valid).toBe(false); expect(folded.diagnostics.flippedTriangleCount).toBeGreaterThan(0);
    const collapsed = createProjectionRegionMesh(square, [[0, 0], [1, 0], [2, 0], [3, 0]], 0.1);
    expect(collapsed.diagnostics.valid).toBe(false); expect(collapsed.diagnostics.collapsedTriangleCount).toBeGreaterThan(0);
  });
});
