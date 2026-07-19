export { extractCoverageScene, sampleMeshSurface, coverageAnalysisDiagonal, pointIsInCoverageRegions } from './surfaceSampler';
export { optimizeProjectionCoverage, resolveCoverageOptions } from './optimizer';
export { runCoverageOptimization } from './coverageClient';
export type { CoverageOptimizationTask } from './coverageClient';
export { buildSceneAcceleration } from './sceneAcceleration';
export { evaluateOrigin } from './originEvaluator';
export {
  candidateClearance,
  generateOriginCandidates,
  isCandidatePositionValid,
  projectCandidateToFloor,
} from './candidateGenerator';
export { compareOriginPair, unionCoverage } from './coverageBitset';
export { rankSecondOrigins } from './secondOriginOptimizer';
export { rankAllPairs } from './jointPairOptimizer';
export type * from './types';
