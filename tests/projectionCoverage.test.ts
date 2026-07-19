import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/domain/types';
import { createDefaultProject } from '../src/domain/defaults';
import {
  buildSceneAcceleration,
  compareOriginPair,
  evaluateOrigin,
  extractCoverageScene,
  generateOriginCandidates,
  optimizeProjectionCoverage,
  rankAllPairs,
  rankSecondOrigins,
  resolveCoverageOptions,
  sampleMeshSurface,
  type CoverageSceneData,
  type CoverageTriangle,
  type OriginEvaluation,
} from '../src/engine/projectionCoverage';

function triangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3, triangleId: number): CoverageTriangle {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return {
    a,
    b,
    c,
    geometricNormal: normal,
    meshId: triangleId,
    triangleId,
    area: Math.hypot(...cross) * 0.5,
  };
}

function floorScene(): CoverageSceneData {
  const triangles = [
    triangle([-2, 0, -2], [2, 0, -2], [2, 0, 2], [0, 1, 0], 0),
    triangle([-2, 0, -2], [2, 0, 2], [-2, 0, 2], [0, 1, 0], 1),
  ];
  return {
    triangles,
    bounds: { min: [-2, 0, -2], max: [2, 0.1, 2] },
    obstacleBounds: [],
    floorTriangles: [
      { triangleIndex: 0, minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
      { triangleIndex: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    ],
    diagonal: Math.hypot(4, 0.1, 4),
  };
}

function evaluation(bits: number, quality: number[], position: Vec3): OriginEvaluation {
  return {
    position,
    coverageBits: new Uint32Array([bits]),
    visibleBits: new Uint32Array([bits]),
    quality: new Uint8Array(quality),
    individualCoverage: quality.filter((_, index) => Boolean(bits & (1 << index))).length / quality.length,
    averageQuality: quality.reduce((sum, value) => sum + value, 0) / (255 * quality.length),
    clearance: 1,
  };
}

describe('projection coverage engine', () => {
  it('samples world-space surface area deterministically and proportionally', () => {
    const triangles = [
      triangle([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0),
      triangle([2, 0, 0], [6, 0, 0], [2, 2, 0], [0, 0, 1], 1),
    ];
    const first = sampleMeshSurface(triangles, 5_000, 1234);
    const second = sampleMeshSurface(triangles, 5_000, 1234);
    expect(second).toEqual(first);
    const largeCount = first.filter((sample) => sample.triangleIndex === 1).length;
    expect(largeCount / first.length).toBeGreaterThan(0.86);
    expect(largeCount / first.length).toBeLessThan(0.92);
  });

  it('uses double-sided BVH segment hits to reject geometry-hidden samples', () => {
    const wall = triangle([1, -1, -1], [1, 1, -1], [1, 0, 1], [1, 0, 0], 0);
    const target = triangle([2, -1, -1], [2, 0, 1], [2, 1, -1], [-1, 0, 0], 1);
    const acceleration = buildSceneAcceleration([wall, target]);
    expect(acceleration.raycastAny([0, 0, 0], [1, 0, 0], 1.99, 1)).toBe(true);
    const options = resolveCoverageOptions(floorScene(), {
      minimumTexelDensity: 0,
      targetTexelDensity: 1,
    });
    const result = evaluateOrigin(
      { position: [0, 0, 0], clearance: 1 },
      [{
        position: [2, 0, 0],
        geometricNormal: [-1, 0, 0],
        meshId: 1,
        triangleId: 1,
        triangleIndex: 1,
      }],
      acceleration,
      4,
      options,
    );
    expect(result.individualCoverage).toBe(0);
  });

  it('ranks fixed-first marginal union and joint complementary pairs', () => {
    const first = evaluation(0b0011, [220, 220, 0, 0], [0, 0, 0]);
    const redundant = evaluation(0b0011, [255, 255, 0, 0], [1, 0, 0]);
    const complementary = evaluation(0b1100, [0, 0, 200, 200], [2, 0, 0]);
    const partial = evaluation(0b0110, [0, 180, 180, 0], [3, 0, 0]);

    expect(rankSecondOrigins(first, [redundant, complementary, partial])[0].evaluation).toBe(complementary);
    const bestPair = rankAllPairs([redundant, complementary, partial], 0.5, 4, 1)[0];
    expect(new Set([bestPair.evaluationA, bestPair.evaluationB])).toEqual(new Set([redundant, complementary]));
    expect(compareOriginPair(redundant, complementary).unionCoverage).toBe(1);
  });

  it('generates cleared floor candidates and runs both shared search modes', () => {
    const scene = floorScene();
    const options = resolveCoverageOptions(scene, {
      candidateSpacing: 1,
      maximumCandidateCount: 16,
      cameraClearanceRadius: 0.1,
      minimumOriginSeparation: 1,
      coarseSampleCount: 32,
      fineSampleCount: 64,
      coarsePairSeedCount: 4,
      localRefinementLevels: 1,
      minimumTexelDensity: 0,
      targetTexelDensity: 1,
    });
    const candidates = generateOriginCandidates(scene, options);
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.every((candidate) => candidate.position[1] === 1.6)).toBe(true);

    const fixed = optimizeProjectionCoverage({
      mode: 'fixed-first',
      scene,
      firstOrigin: [0, 1.6, 0],
      options,
    });
    const joint = optimizeProjectionCoverage({ mode: 'joint-pair', scene, options });
    expect(fixed.sampleCount).toBe(64);
    expect(fixed.combinedCoverage).toBeGreaterThan(0.9);
    expect(joint.combinedCoverage).toBeGreaterThan(0.9);
    expect(Math.hypot(
      joint.originA[0] - joint.originB[0],
      joint.originA[2] - joint.originB[2],
    )).toBeGreaterThanOrEqual(1);
  });

  it('prefers authored floors over upward-facing prop and roof surfaces', () => {
    const scene = extractCoverageScene(createDefaultProject());
    const floorHeights = scene.floorTriangles.flatMap(({ triangleIndex }) => {
      const floor = scene.triangles[triangleIndex];
      return [floor.a[1], floor.b[1], floor.c[1]];
    });
    expect(floorHeights.length).toBeGreaterThan(0);
    expect(Math.max(...floorHeights)).toBeLessThan(0.25);
  });
});
