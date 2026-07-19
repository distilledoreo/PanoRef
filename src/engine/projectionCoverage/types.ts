import type { Vec3 } from '../../domain/types';

export type CoverageOptimizationMode = 'fixed-first' | 'joint-pair';

export interface CoverageBounds {
  min: Vec3;
  max: Vec3;
}

/**
 * Compact indexed geometry. Positions stay in mesh-local space and each
 * triangle references a mesh transform, avoiding nine duplicated world-space
 * numbers and several JavaScript objects per triangle.
 */
export interface CoverageSceneData {
  positions: Float32Array;
  indices: Uint32Array;
  triangleMeshIds: Uint32Array;
  meshMatrices: Float32Array;
  floorTriangleIndices: Uint32Array;
  /** minX, maxX, minZ, maxZ for each floorTriangleIndices entry. */
  floorBounds: Float32Array;
  bounds: CoverageBounds;
  diagonal: number;
}

export interface SurfaceSample {
  position: Vec3;
  geometricNormal: Vec3;
  meshId: number;
  triangleId: number;
  triangleIndex: number;
}

export interface OriginCandidate {
  position: Vec3;
  clearance: number;
}

export interface OriginEvaluation {
  position: Vec3;
  coverageBits: Uint32Array;
  visibleBits: Uint32Array;
  quality: Uint8Array;
  individualCoverage: number;
  averageQuality: number;
  clearance: number;
}

export interface PairMetrics {
  unionCoverage: number;
  overlapCoverage: number;
  aOnlyCoverage: number;
  bOnlyCoverage: number;
  averageQuality: number;
  qualityGain: number;
}

export interface CoverageOptimizationOptions {
  coarseSampleCount: number;
  fineSampleCount: number;
  maximumCandidateCount: number;
  candidateSpacing: number;
  panoramaWidth: number;
  panoramaHeight: number;
  panoramaHeightMeters: number;
  minimumFacing: number;
  minimumTexelDensity: number;
  targetTexelDensity: number;
  minimumOriginSeparation: number;
  cameraClearanceRadius: number;
  coarsePairSeedCount: number;
  localRefinementLevels: number;
  seed: number;
}

export interface CoverageOptimizationRequest {
  mode: CoverageOptimizationMode;
  scene: CoverageSceneData;
  firstOrigin?: Vec3;
  options?: Partial<CoverageOptimizationOptions>;
}

export type CoverageExtractionProgress = (progress: number, message: string) => void;

export interface CoverageOptimizationResult {
  mode: CoverageOptimizationMode;
  originA: Vec3;
  originB: Vec3;
  originACoverage: number;
  originBCoverage: number;
  originAOnlyCoverage: number;
  originBOnlyCoverage: number;
  overlapCoverage: number;
  combinedCoverage: number;
  averageQuality: number;
  addedCoverage: number;
  reachableCoverage: number;
  reachableEfficiency: number;
  estimatedRemainingSurface: number;
  candidateCount: number;
  sampleCount: number;
  elapsedMilliseconds: number;
}
