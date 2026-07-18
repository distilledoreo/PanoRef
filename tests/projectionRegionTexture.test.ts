import { describe, expect, it } from 'vitest';
import { createProjectionRegion, createProjectionRegionAlignment, createProjectionRegionVertexPair } from '../src/domain/defaults';
import { decodeRegionDisplacement, generateProjectionRegionTexture, projectionRegionTextureCacheKey, projectionRegionTextureCacheSize } from '../src/engine/projectionRegionTexture';
import { ProjectionRegionWorkerCoordinator } from '../src/workers/projectionRegionWorker';

function alignment(offset = 0) { const points: [number, number][] = [[0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55]]; return createProjectionRegionAlignment('styled', 'graybox', [createProjectionRegion(points.map((point, index) => createProjectionRegionVertexPair(point, [point[0] + offset, point[1]], `v${index}`))) ]); }
function pixel(result: ReturnType<typeof generateProjectionRegionTexture>, u: number, v: number) { const index = Math.floor(v * result.height) * result.width + Math.floor(u * result.width); return { delta: decodeRegionDisplacement(result.displacement[index * 2], result.displacement[index * 2 + 1]), weight: result.weight[index] }; }

describe('Region Fit mapping textures', () => {
  it('uses required quality dimensions and keeps identity regions identity', () => {
    const result = generateProjectionRegionTexture(alignment(), { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' });
    expect([result.width, result.height]).toEqual([256, 128]); const center = pixel(result, 0.5, 0.5); expect(center.weight).toBe(255); expect(center.delta[0]).toBeCloseTo(0, 3); expect(pixel(result, 0.1, 0.1).weight).toBe(0); result.release();
  });

  it('encodes localized translation with a soft identity transition', () => {
    const result = generateProjectionRegionTexture(alignment(0.02), { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' });
    expect(pixel(result, 0.5, 0.5).delta[0]).toBeCloseTo(0.02, 2); expect(pixel(result, 0.5, 0.5).weight).toBe(255); expect(pixel(result, 0.1, 0.1).weight).toBe(0); result.release();
  });

  it('orders overlaps deterministically and excludes strength from cache keys', () => {
    const first = alignment(0.01); const second = alignment(-0.03).regions[0]; second.id = 'top'; second.order = 1; first.regions.push(second);
    const result = generateProjectionRegionTexture(first, { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' });
    expect(pixel(result, 0.5, 0.5).delta[0]).toBeCloseTo(-0.03, 2);
    const key = result.cacheKey; first.strength = 0.2; expect(projectionRegionTextureCacheKey(first, { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' })).toBe(key);
    result.release(); expect(projectionRegionTextureCacheSize()).toBe(0);
  });

  it('rejects stale worker jobs', async () => {
    const worker = new ProjectionRegionWorkerCoordinator(); const stale = worker.generate(alignment(0.01), { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' }); const latest = worker.generate(alignment(0.02), { sourceYawRadians: 0, targetYawRadians: 0, quality: 'preview' });
    expect(await stale).toBeUndefined(); const result = await latest; expect(result).toBeDefined(); result?.release();
  });
});
