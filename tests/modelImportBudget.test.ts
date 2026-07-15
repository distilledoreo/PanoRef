import { describe, expect, it } from 'vitest';
import { detectImportDeviceProfile, estimateModelImportBudget, IMPORT_BUDGET_POLICY } from '../src/engine/modelImportBudget';

const MIB = 1024 * 1024;
const device = { deviceMemoryGb: 4, isMobile: false, source: 'navigator' as const };

function estimate(outputMb: number, mode: 'separate' | 'combined' = 'separate', overrides = {}) {
  const position = Math.floor(outputMb * MIB * 0.75);
  const index = Math.floor(outputMb * MIB * 0.25);
  return estimateModelImportBudget({ loadedVertexCount: position / 12, triangleCount: index / 12, meshNodeCount: 1, instanceCount: 1, expandedInstanceCount: 0, uniquePositionBytes: position, uniqueIndexBytes: index, outputPositionBytes: position, outputIndexBytes: index, mode, ...overrides }, device);
}

describe('model import memory budget', () => {
  it('accounts for indexed positions, indices, normals, packed storage, and GPU buffers', () => {
    const result = estimateModelImportBudget({ loadedVertexCount: 100, triangleCount: 50, meshNodeCount: 2, instanceCount: 2, expandedInstanceCount: 0, uniquePositionBytes: 1200, uniqueIndexBytes: 600, outputPositionBytes: 1200, outputIndexBytes: 600, mode: 'separate' }, device);
    expect(result.normalBytes).toBe(1200);
    expect(result.packedBytes).toBe(3040);
    expect(result.gpuBytes).toBe(3000);
    expect(result.combinedTemporaryBytes).toBe(0);
  });

  it('accounts for non-indexed geometry and combined-mode temporary output', () => {
    const separate = estimateModelImportBudget({ loadedVertexCount: 3, triangleCount: 1, meshNodeCount: 1, instanceCount: 1, expandedInstanceCount: 0, uniquePositionBytes: 36, uniqueIndexBytes: 12, outputPositionBytes: 36, outputIndexBytes: 12, mode: 'separate' }, device);
    const combined = estimateModelImportBudget({ ...separate, mode: 'combined' }, device);
    expect(combined.combinedTemporaryBytes).toBe(48);
    expect(combined.estimatedPeakHeapBytes - separate.estimatedPeakHeapBytes).toBe(48);
  });

  it('includes exact base64 expansion only for legacy assets', () => {
    const binary = estimate(1);
    const legacy = estimate(1, 'separate', { legacyBase64: true });
    expect(binary.base64Bytes).toBe(0);
    expect(legacy.base64Bytes).toBe(Math.ceil(legacy.packedBytes / 3) * 4);
  });

  it('uses conservative desktop and mobile fallbacks', () => {
    expect(detectImportDeviceProfile({ userAgent: 'Desktop' } as Navigator)).toMatchObject({ deviceMemoryGb: 4, source: 'fallback', isMobile: false });
    expect(detectImportDeviceProfile({ userAgent: 'iPhone Mobile' } as Navigator)).toMatchObject({ deviceMemoryGb: 2, source: 'fallback', isMobile: true });
  });

  it('classifies standard, heavy, extreme, and reject from byte estimates', () => {
    expect(estimate(40).tier).toBe('standard');
    expect(estimate(90).tier).toBe('heavy');
    expect(estimate(160).tier).toBe('extreme');
    expect(estimate(400).tier).toBe('reject');
  });

  it('accounts for expanded instances while shared source bytes remain unique', () => {
    const result = estimate(10, 'separate', { instanceCount: 100, expandedInstanceCount: 99, uniquePositionBytes: 1200, uniqueIndexBytes: 600 });
    expect(result.instanceCount).toBe(100);
    expect(result.expandedInstanceCount).toBe(99);
    expect(result.uniquePositionBytes).toBe(1200);
    expect(result.outputPositionBytes).toBeGreaterThan(result.uniquePositionBytes);
  });

  it('uses inclusive standard boundary and rejects hard packed and typed-array ceilings', () => {
    const safety = estimate(1).safetyBudgetBytes;
    const atBoundary = estimateModelImportBudget({ loadedVertexCount: 1, triangleCount: 1, meshNodeCount: 1, instanceCount: 1, expandedInstanceCount: 0, uniquePositionBytes: 0, uniqueIndexBytes: 0, outputPositionBytes: 0, outputIndexBytes: 0, mode: 'separate' }, device);
    expect(atBoundary.estimatedPeakHeapBytes).toBeLessThanOrEqual(safety * IMPORT_BUDGET_POLICY.standardFraction);
    expect(atBoundary.tier).toBe('standard');
    const rejected = estimateModelImportBudget({ loadedVertexCount: 1, triangleCount: 1, meshNodeCount: 1, instanceCount: 1, expandedInstanceCount: 0, uniquePositionBytes: 1, uniqueIndexBytes: 1, outputPositionBytes: IMPORT_BUDGET_POLICY.maxTypedArrayBytes + 1, outputIndexBytes: 12, mode: 'separate' }, device);
    expect(rejected.tier).toBe('reject');
    expect(rejected.exceeded).toContain('typed-array size');
  });
});
