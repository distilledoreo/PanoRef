import type { Vec3 } from '../../domain/types';

export type CoverageOptimizationMode = 'fixed-first' | 'joint-pair';

export interface CoverageTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  geometricNormal: Vec3;
  meshId: number;
  triangleId: number;
  area: number;
}

export interface CoverageBounds {
  min: Vec3;
  max: Vec3;
}

export interface CoverageFloorTriangle {
  triangleIndex: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CoverageSceneData {
  triangles: CoverageTriangle[];
  bounds: CoverageBounds;
  obstacleBounds: CoverageBounds[];
  floorTriangles: CoverageFloorTriangle[];
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

