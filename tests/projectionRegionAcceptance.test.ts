import { describe, expect, it } from 'vitest';
import { createProjectionRegion, createProjectionRegionAlignment, createProjectionRegionVertexPair } from '../src/domain/defaults';
import { decodeRegionDisplacement, generateProjectionRegionTexture } from '../src/engine/projectionRegionTexture';

const definitions: Array<[string, number, number, number, number]> = [
  ['Canopy', 0.50, 0.28, 0.025, -0.015], ['Rear wall', 0.25, 0.48, -0.015, 0],
  ['Floor', 0.50, 0.72, 0.01, -0.01], ['Chair', 0.50, 0.50, -0.01, 0.015],
  ['Curtains', 0.76, 0.48, 0.02, 0],
];
function acceptanceAlignment() { return createProjectionRegionAlignment('throne-styled', 'throne-graybox', definitions.map(([name, u, v, du, dv], order) => { const points: [number, number][] = [[u - 0.035, v - 0.035], [u + 0.035, v - 0.035], [u + 0.035, v + 0.035], [u - 0.035, v + 0.035]]; const region = createProjectionRegion(points.map((point, index) => createProjectionRegionVertexPair(point, [point[0] + du, point[1] + dv], `${name}-${index}`)), name); region.order = order; region.edgeSoftness = 0.015; return region; })); }
function sample(result: ReturnType<typeof generateProjectionRegionTexture>, u: number, v: number) { const index = Math.floor(v * result.height) * result.width + Math.floor(u * result.width); return { weight: result.weight[index], delta: decodeRegionDisplacement(result.displacement[index * 2], result.displacement[index * 2 + 1]) }; }

describe('throne-room Region Fit acceptance', () => {
  it('keeps five coherent corrections local and structurally independent at full strength', () => {
    const alignment = acceptanceAlignment(); const result = generateProjectionRegionTexture(alignment, { sourceYawRadians: 0, targetYawRadians: 0, quality: 'runtime' });
    expect(result.diagnostics).toHaveLength(5); expect(result.diagnostics.every((diagnostic) => diagnostic.valid)).toBe(true);
    definitions.forEach(([, u, v, du, dv]) => { const region = sample(result, u, v); expect(region.weight).toBe(255); expect(region.delta[0]).toBeCloseTo(du, 2); expect(region.delta[1]).toBeCloseTo(dv, 2); });
    expect(sample(result, 0.05, 0.85)).toMatchObject({ weight: 0 });
    result.release();
  });

  it('disabling canopy leaves wall and floor corrections while canopy returns to identity', () => {
    const alignment = acceptanceAlignment(); alignment.regions[0].enabled = false; const result = generateProjectionRegionTexture(alignment, { sourceYawRadians: 0, targetYawRadians: 0, quality: 'runtime' });
    expect(sample(result, 0.5, 0.28).weight).toBe(0); expect(sample(result, 0.25, 0.48).weight).toBe(255); expect(sample(result, 0.5, 0.72).weight).toBe(255); result.release();
  });

  it('supports yaw-adjusted side views without global displacement', () => {
    const result = generateProjectionRegionTexture(acceptanceAlignment(), { sourceYawRadians: Math.PI / 6, targetYawRadians: Math.PI / 6, quality: 'preview' });
    const influenced = [...result.weight].filter((weight) => weight > 0).length; expect(influenced).toBeGreaterThan(0); expect(influenced).toBeLessThan(result.width * result.height * 0.2); result.release();
  });
});
