import type { Vec3 } from '../../domain/types';
import {
  candidateClearance,
  generateOriginCandidates,
  isCandidatePositionValid,
  localCandidateOffsets,
} from './candidateGenerator';
import { reachableCoverage } from './coverageBitset';
import { rankAllPairs } from './jointPairOptimizer';
import { evaluateOrigin } from './originEvaluator';
import { buildSceneAcceleration } from './sceneAcceleration';
import { rankSecondOrigins } from './secondOriginOptimizer';
import { sampleMeshSurface } from './surfaceSampler';
import type {
  CoverageOptimizationOptions,
  CoverageOptimizationRequest,
  CoverageOptimizationResult,
  CoverageSceneData,
  OriginCandidate,
  OriginEvaluation,
} from './types';

export function resolveCoverageOptions(
  scene: CoverageSceneData,
  partial: Partial<CoverageOptimizationOptions> = {},
): CoverageOptimizationOptions {
  const candidateSpacing = partial.candidateSpacing
    ?? Math.max(0.5, Math.min(1, scene.diagonal * 0.03));
  return {
    coarseSampleCount: partial.coarseSampleCount ?? 4_096,
    fineSampleCount: partial.fineSampleCount ?? 24_576,
    maximumCandidateCount: partial.maximumCandidateCount ?? 256,
    candidateSpacing,
    panoramaWidth: partial.panoramaWidth ?? 8_192,
    panoramaHeight: partial.panoramaHeight ?? 4_096,
    panoramaHeightMeters: partial.panoramaHeightMeters ?? 1.6,
    minimumFacing: partial.minimumFacing ?? 0.15,
    minimumTexelDensity: partial.minimumTexelDensity ?? 128,
    targetTexelDensity: partial.targetTexelDensity ?? 1_024,
    minimumOriginSeparation: partial.minimumOriginSeparation
      ?? Math.max(2 * candidateSpacing, scene.diagonal * 0.06),
    cameraClearanceRadius: partial.cameraClearanceRadius ?? 0.3,
    coarsePairSeedCount: partial.coarsePairSeedCount ?? 16,
    localRefinementLevels: partial.localRefinementLevels ?? 4,
    seed: partial.seed ?? 0x50414e4f,
  };
}

function candidateKey(position: Vec3): string {
  return position.map((value) => value.toFixed(5)).join(':');
}

function addCandidate(
  destination: OriginCandidate[],
  seen: Set<string>,
  scene: CoverageSceneData,
  position: Vec3,
  options: CoverageOptimizationOptions,
): void {
  const key = candidateKey(position);
  if (seen.has(key)) return;
  if (!isCandidatePositionValid(scene, position, options.cameraClearanceRadius)) return;
  seen.add(key);
  destination.push({ position: [...position], clearance: candidateClearance(scene, position) });
}

function refinedCandidates(
  scene: CoverageSceneData,
  seeds: OriginCandidate[],
  options: CoverageOptimizationOptions,
  refinementSeedCount: number,
): OriginCandidate[] {
  const candidates: OriginCandidate[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    addCandidate(candidates, seen, scene, seed.position, options);
  }
  // The fine pass keeps every coarse survivor, but local pattern search is
  // intentionally bounded to the top four positions (or both ends of the top
  // four pairs). Expanding every offset recursively turns 16 seeds into
  // thousands of fine evaluations without improving the search topology.
  for (const seed of seeds.slice(0, refinementSeedCount)) {
    let step = options.candidateSpacing / 2;
    for (let level = 0; level < options.localRefinementLevels; level += 1) {
      for (const position of localCandidateOffsets(seed.position, step)) {
        addCandidate(candidates, seen, scene, position, options);
      }
      step *= 0.5;
    }
  }
  return candidates;
}

function evaluateCandidates(
  candidates: OriginCandidate[],
  samples: ReturnType<typeof sampleMeshSurface>,
  acceleration: ReturnType<typeof buildSceneAcceleration>,
  scene: CoverageSceneData,
  options: CoverageOptimizationOptions,
): OriginEvaluation[] {
  return candidates.map((candidate) => evaluateOrigin(
    candidate,
    samples,
    acceleration,
    scene.diagonal,
    options,
  ));
}

function buildResult(
  request: CoverageOptimizationRequest,
  evaluationA: OriginEvaluation,
  evaluationB: OriginEvaluation,
  metrics: ReturnType<typeof import('./coverageBitset').compareOriginPair>,
  reachable: number,
  candidateCount: number,
  sampleCount: number,
  startedAt: number,
): CoverageOptimizationResult {
  const combined = metrics.unionCoverage;
  return {
    mode: request.mode,
    originA: [...evaluationA.position],
    originB: [...evaluationB.position],
    originACoverage: evaluationA.individualCoverage,
    originBCoverage: evaluationB.individualCoverage,
    originAOnlyCoverage: metrics.aOnlyCoverage,
    originBOnlyCoverage: metrics.bOnlyCoverage,
    overlapCoverage: metrics.overlapCoverage,
    combinedCoverage: combined,
    averageQuality: metrics.averageQuality,
    addedCoverage: Math.max(0, combined - evaluationA.individualCoverage),
    reachableCoverage: reachable,
    reachableEfficiency: reachable > 0 ? Math.min(1, combined / reachable) : 0,
    estimatedRemainingSurface: Math.max(0, 1 - combined),
    candidateCount,
    sampleCount,
    elapsedMilliseconds: Math.max(0, performance.now() - startedAt),
  };
}

/** Shared coarse-to-fine engine feeding both optimizer strategies. */
export function optimizeProjectionCoverage(
  request: CoverageOptimizationRequest,
): CoverageOptimizationResult {
  const startedAt = performance.now();
  const { scene } = request;
  const options = resolveCoverageOptions(scene, request.options);
  const acceleration = buildSceneAcceleration(scene.triangles);
  const candidates = generateOriginCandidates(scene, options);
  const coarseSamples = sampleMeshSurface(scene.triangles, options.coarseSampleCount, options.seed);
  const coarseEvaluations = evaluateCandidates(candidates, coarseSamples, acceleration, scene, options);
  const reachable = reachableCoverage(coarseEvaluations, coarseSamples.length);

  if (request.mode === 'fixed-first') {
    if (!request.firstOrigin) throw new Error('Fixed-first optimization requires the current panorama origin.');
    const firstCandidate: OriginCandidate = {
      position: [...request.firstOrigin],
      clearance: candidateClearance(scene, request.firstOrigin),
    };
    const coarseFirst = evaluateOrigin(
      firstCandidate,
      coarseSamples,
      acceleration,
      scene.diagonal,
      options,
    );
    const coarseRanking = rankSecondOrigins(coarseFirst, coarseEvaluations);
    const seeds = coarseRanking.slice(0, options.coarsePairSeedCount).map((ranked) => ({
      position: ranked.evaluation.position,
      clearance: ranked.evaluation.clearance,
    }));
    const fineCandidates = refinedCandidates(scene, seeds, options, 4);
    if (fineCandidates.length === 0) fineCandidates.push(...seeds);
    const fineSamples = sampleMeshSurface(scene.triangles, options.fineSampleCount, options.seed + 1);
    const fineFirst = evaluateOrigin(firstCandidate, fineSamples, acceleration, scene.diagonal, options);
    const fineEvaluations = evaluateCandidates(fineCandidates, fineSamples, acceleration, scene, options);
    const best = rankSecondOrigins(fineFirst, fineEvaluations)[0];
    if (!best) throw new Error('No valid secondary origin candidates.');
    return buildResult(
      request,
      fineFirst,
      best.evaluation,
      best.metrics,
      reachable,
      candidates.length,
      fineSamples.length,
      startedAt,
    );
  }

  const coarsePairs = rankAllPairs(
    coarseEvaluations,
    options.minimumOriginSeparation,
    coarseSamples.length,
    options.coarsePairSeedCount,
  );
  if (coarsePairs.length === 0) {
    throw new Error('No valid origin pair satisfies the minimum separation.');
  }
  const seedCandidates: OriginCandidate[] = [];
  const seedKeys = new Set<string>();
  for (const pair of coarsePairs) {
    for (const evaluation of [pair.evaluationA, pair.evaluationB]) {
      const key = candidateKey(evaluation.position);
      if (seedKeys.has(key)) continue;
      seedKeys.add(key);
      seedCandidates.push({ position: evaluation.position, clearance: evaluation.clearance });
    }
  }
  const fineCandidates = refinedCandidates(scene, seedCandidates, options, 8);
  if (fineCandidates.length === 0) fineCandidates.push(...seedCandidates);
  const fineSamples = sampleMeshSurface(scene.triangles, options.fineSampleCount, options.seed + 1);
  const fineEvaluations = evaluateCandidates(fineCandidates, fineSamples, acceleration, scene, options);
  const best = rankAllPairs(
    fineEvaluations,
    options.minimumOriginSeparation,
    fineSamples.length,
    1,
  )[0];
  if (!best) throw new Error('No valid refined origin pair satisfies the minimum separation.');
  return buildResult(
    request,
    best.evaluationA,
    best.evaluationB,
    best.metrics,
    reachable,
    candidates.length,
    fineSamples.length,
    startedAt,
  );
}
