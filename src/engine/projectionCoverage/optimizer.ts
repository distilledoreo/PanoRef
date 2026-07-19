import type { Vec3 } from '../../domain/types';
import {
  candidateClearance,
  generateOriginCandidates,
  isCandidatePositionValid,
  localCandidateOffsets,
  projectCandidateToFloor,
} from './candidateGenerator';
import { compareOriginPair, reachableCoverage } from './coverageBitset';
import { rankAllPairs } from './jointPairOptimizer';
import { evaluateOrigin } from './originEvaluator';
import { buildSceneAcceleration } from './sceneAcceleration';
import { rankSecondOrigins } from './secondOriginOptimizer';
import { coverageAnalysisDiagonal, sampleMeshSurface } from './surfaceSampler';
import type {
  CoverageOptimizationOptions,
  CoverageOptimizationRequest,
  CoverageOptimizationResult,
  CoverageSceneData,
  OriginCandidate,
  OriginEvaluation,
  PairMetrics,
  SurfaceSample,
} from './types';

export function resolveCoverageOptions(
  scene: CoverageSceneData,
  partial: Partial<CoverageOptimizationOptions> = {},
): CoverageOptimizationOptions {
  const analysisDiagonal = coverageAnalysisDiagonal(scene);
  const candidateSpacing = partial.candidateSpacing
    ?? Math.max(0.5, Math.min(1, analysisDiagonal * 0.03));
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
      ?? Math.max(2 * candidateSpacing, analysisDiagonal * 0.06),
    cameraClearanceRadius: partial.cameraClearanceRadius ?? 0.3,
    coarsePairSeedCount: partial.coarsePairSeedCount ?? 16,
    localRefinementLevels: partial.localRefinementLevels ?? 4,
    seed: partial.seed ?? 0x50414e4f,
  };
}

function candidateKey(position: Vec3): string {
  return position.map((value) => value.toFixed(5)).join(':');
}

function localCandidates(
  scene: CoverageSceneData,
  center: OriginEvaluation,
  step: number,
  options: CoverageOptimizationOptions,
  acceleration: ReturnType<typeof buildSceneAcceleration>,
): OriginCandidate[] {
  const candidates: OriginCandidate[] = [];
  const seen = new Set<string>();
  const preferredFloorY = center.position[1] - options.panoramaHeightMeters;
  for (const [x, z] of localCandidateOffsets(center.position, step)) {
    const position = projectCandidateToFloor(
      scene,
      x,
      z,
      options.panoramaHeightMeters,
      preferredFloorY,
    );
    if (!position || seen.has(candidateKey(position))) continue;
    if (!isCandidatePositionValid(
      scene,
      position,
      options.cameraClearanceRadius,
      options.panoramaHeightMeters,
      acceleration,
    )) continue;
    seen.add(candidateKey(position));
    candidates.push({
      position,
      clearance: candidateClearance(scene, position, acceleration),
    });
  }
  return candidates;
}

function evaluateCandidates(
  candidates: OriginCandidate[],
  samples: SurfaceSample[],
  acceleration: ReturnType<typeof buildSceneAcceleration>,
  scene: CoverageSceneData,
  options: CoverageOptimizationOptions,
): OriginEvaluation[] {
  return candidates.map((candidate) => evaluateOrigin(candidate, samples, acceleration, scene.diagonal, options));
}

function pairComparator(
  a: { evaluation: OriginEvaluation; metrics: PairMetrics },
  b: { evaluation: OriginEvaluation; metrics: PairMetrics },
): number {
  const coverageDelta = b.metrics.unionCoverage - a.metrics.unionCoverage;
  if (Math.abs(coverageDelta) > 0.0025) return coverageDelta;
  const qualityDelta = b.metrics.averageQuality - a.metrics.averageQuality;
  if (Math.abs(qualityDelta) > 1e-8) return qualityDelta;
  const aContribution = Math.min(a.metrics.aOnlyCoverage, a.metrics.bOnlyCoverage);
  const bContribution = Math.min(b.metrics.aOnlyCoverage, b.metrics.bOnlyCoverage);
  if (Math.abs(bContribution - aContribution) > 1e-8) return bContribution - aContribution;
  return a.metrics.overlapCoverage - b.metrics.overlapCoverage;
}

function bestJointPartner(
  fixed: OriginEvaluation,
  candidates: OriginEvaluation[],
  minimumSeparation: number,
): OriginEvaluation {
  const ranked = candidates
    .filter((candidate) => Math.hypot(
      candidate.position[0] - fixed.position[0],
      candidate.position[1] - fixed.position[1],
      candidate.position[2] - fixed.position[2],
    ) >= minimumSeparation)
    .map((evaluation) => ({ evaluation, metrics: compareOriginPair(fixed, evaluation) }))
    .sort(pairComparator);
  return ranked[0]?.evaluation ?? candidates[0];
}

function refineSecondOrigin(
  scene: CoverageSceneData,
  first: OriginEvaluation,
  initial: OriginEvaluation,
  fineSamples: SurfaceSample[],
  acceleration: ReturnType<typeof buildSceneAcceleration>,
  options: CoverageOptimizationOptions,
): OriginEvaluation {
  let center = initial;
  let step = options.candidateSpacing / 2;
  for (let level = 0; level < options.localRefinementLevels; level += 1) {
    const local = evaluateCandidates(
      localCandidates(scene, center, step, options, acceleration),
      fineSamples,
      acceleration,
      scene,
      options,
    );
    center = rankSecondOrigins(
      first,
      [center, ...local],
      options.minimumOriginSeparation,
    )[0]?.evaluation ?? center;
    step *= 0.5;
  }
  return center;
}

function refineJointPair(
  scene: CoverageSceneData,
  initialA: OriginEvaluation,
  initialB: OriginEvaluation,
  fineSamples: SurfaceSample[],
  acceleration: ReturnType<typeof buildSceneAcceleration>,
  options: CoverageOptimizationOptions,
): [OriginEvaluation, OriginEvaluation] {
  let originA = initialA;
  let originB = initialB;
  let step = options.candidateSpacing / 2;
  for (let level = 0; level < options.localRefinementLevels; level += 1) {
    const localA = evaluateCandidates(
      localCandidates(scene, originA, step, options, acceleration),
      fineSamples,
      acceleration,
      scene,
      options,
    );
    originA = bestJointPartner(originB, [originA, ...localA], options.minimumOriginSeparation);
    const localB = evaluateCandidates(
      localCandidates(scene, originB, step, options, acceleration),
      fineSamples,
      acceleration,
      scene,
      options,
    );
    originB = bestJointPartner(originA, [originB, ...localB], options.minimumOriginSeparation);
    step *= 0.5;
  }
  return [originA, originB];
}

function buildResult(
  request: CoverageOptimizationRequest,
  evaluationA: OriginEvaluation,
  evaluationB: OriginEvaluation,
  reachableEvaluations: OriginEvaluation[],
  candidateCount: number,
  sampleCount: number,
  startedAt: number,
): CoverageOptimizationResult {
  const metrics = compareOriginPair(evaluationA, evaluationB);
  const reachable = reachableCoverage(
    [...reachableEvaluations, evaluationA, evaluationB],
    sampleCount,
  );
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
    reachableEfficiency: reachable > 0 ? combined / reachable : 0,
    estimatedRemainingSurface: Math.max(0, 1 - combined),
    candidateCount,
    sampleCount,
    elapsedMilliseconds: Math.max(0, performance.now() - startedAt),
  };
}

/** Shared coarse-to-fine engine feeding both optimizer strategies. */
export function optimizeProjectionCoverage(request: CoverageOptimizationRequest): CoverageOptimizationResult {
  const startedAt = performance.now();
  const { scene } = request;
  const options = resolveCoverageOptions(scene, request.options);
  const acceleration = buildSceneAcceleration(scene);
  const candidates = generateOriginCandidates(scene, options, acceleration);
  const coarseSamples = sampleMeshSurface(scene, options.coarseSampleCount, options.seed);
  const fineSamples = sampleMeshSurface(scene, options.fineSampleCount, options.seed + 1);
  if (coarseSamples.length === 0 || fineSamples.length === 0) {
    throw new Error(
      scene.allowedFloorRegions?.length
        ? 'Analysis region contains no usable surface samples. Expand the region so it includes room walls and floors, or clear it to search the whole set.'
        : 'Coverage analysis found no usable surface samples.',
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      scene.allowedFloorRegions?.length
        ? 'No camera candidates fit inside the analysis region. Expand the X/Z bounds or lower the floor Y range.'
        : 'No valid panorama origin candidates were found on eligible floors.',
    );
  }
  const coarseEvaluations = evaluateCandidates(candidates, coarseSamples, acceleration, scene, options);
  // Reported pair and reachable metrics share this exact validation bank.
  const reachableEvaluations = evaluateCandidates(candidates, fineSamples, acceleration, scene, options);

  if (request.mode === 'fixed-first') {
    if (!request.firstOrigin) throw new Error('Fixed-first optimization requires the current panorama origin.');
    const firstCandidate: OriginCandidate = {
      position: [...request.firstOrigin],
      clearance: candidateClearance(scene, request.firstOrigin, acceleration),
    };
    const coarseFirst = evaluateOrigin(firstCandidate, coarseSamples, acceleration, scene.diagonal, options);
    const coarseRanking = rankSecondOrigins(
      coarseFirst,
      coarseEvaluations,
      options.minimumOriginSeparation,
    );
    const seedKeys = new Set(coarseRanking.slice(0, options.coarsePairSeedCount).map((ranked) => candidateKey(ranked.evaluation.position)));
    const fineFirst = evaluateOrigin(firstCandidate, fineSamples, acceleration, scene.diagonal, options);
    const fineSeeds = reachableEvaluations.filter((evaluation) => seedKeys.has(candidateKey(evaluation.position)));
    const initial = rankSecondOrigins(
      fineFirst,
      fineSeeds,
      options.minimumOriginSeparation,
    ).slice(0, 4);
    if (initial.length === 0) throw new Error('No valid secondary origin satisfies the minimum separation.');
    const refined = initial.map((ranked) => refineSecondOrigin(
      scene,
      fineFirst,
      ranked.evaluation,
      fineSamples,
      acceleration,
      options,
    ));
    const best = rankSecondOrigins(
      fineFirst,
      [...fineSeeds, ...refined],
      options.minimumOriginSeparation,
    )[0];
    if (!best) throw new Error('No valid secondary origin candidates.');
    return buildResult(
      request,
      fineFirst,
      best.evaluation,
      [...reachableEvaluations, fineFirst],
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
  if (coarsePairs.length === 0) throw new Error('No valid origin pair satisfies the minimum separation.');
  const fineByPosition = new Map(reachableEvaluations.map((evaluation) => [candidateKey(evaluation.position), evaluation]));
  const seedEvaluations: OriginEvaluation[] = [];
  for (const pair of coarsePairs) {
    for (const endpoint of [pair.evaluationA, pair.evaluationB]) {
      const evaluation = fineByPosition.get(candidateKey(endpoint.position));
      if (evaluation && !seedEvaluations.includes(evaluation)) seedEvaluations.push(evaluation);
    }
  }
  const finePairs = rankAllPairs(
    seedEvaluations,
    options.minimumOriginSeparation,
    fineSamples.length,
    4,
  );
  if (finePairs.length === 0) throw new Error('No valid refined origin pair satisfies the minimum separation.');
  const refinedEndpoints: OriginEvaluation[] = [];
  for (const pair of finePairs) {
    refinedEndpoints.push(...refineJointPair(
      scene,
      pair.evaluationA,
      pair.evaluationB,
      fineSamples,
      acceleration,
      options,
    ));
  }
  const best = rankAllPairs(
    [...seedEvaluations, ...refinedEndpoints],
    options.minimumOriginSeparation,
    fineSamples.length,
    1,
  )[0];
  if (!best) throw new Error('No valid refined origin pair satisfies the minimum separation.');
  return buildResult(
    request,
    best.evaluationA,
    best.evaluationB,
    reachableEvaluations,
    candidates.length,
    fineSamples.length,
    startedAt,
  );
}
