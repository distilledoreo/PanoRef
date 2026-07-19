import { compareOriginPair, unionCoverage } from './coverageBitset';
import type { OriginEvaluation, PairMetrics } from './types';

export interface RankedOriginPair {
  indexA: number;
  indexB: number;
  evaluationA: OriginEvaluation;
  evaluationB: OriginEvaluation;
  metrics: PairMetrics;
}

const COVERAGE_TIE_TOLERANCE = 0.0025;

function distanceBetween(a: OriginEvaluation, b: OriginEvaluation): number {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
}

export function rankAllPairs(
  evaluations: OriginEvaluation[],
  minimumOriginSeparation: number,
  sampleCount: number,
  maximumResults = Number.POSITIVE_INFINITY,
): RankedOriginPair[] {
  const coarse: Array<{ indexA: number; indexB: number; coverage: number }> = [];
  for (let indexA = 0; indexA < evaluations.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < evaluations.length; indexB += 1) {
      const evaluationA = evaluations[indexA];
      const evaluationB = evaluations[indexB];
      if (distanceBetween(evaluationA, evaluationB) < minimumOriginSeparation) continue;
      coarse.push({
        indexA,
        indexB,
        coverage: unionCoverage(evaluationA.coverageBits, evaluationB.coverageBits, sampleCount),
      });
    }
  }
  coarse.sort((a, b) => b.coverage - a.coverage);
  const detailed = coarse.slice(0, Math.max(maximumResults * 4, maximumResults)).map((pair) => {
    const evaluationA = evaluations[pair.indexA];
    const evaluationB = evaluations[pair.indexB];
    return {
      indexA: pair.indexA,
      indexB: pair.indexB,
      evaluationA,
      evaluationB,
      metrics: compareOriginPair(evaluationA, evaluationB),
    };
  });
  detailed.sort((a, b) => {
    const coverageDelta = b.metrics.unionCoverage - a.metrics.unionCoverage;
    if (Math.abs(coverageDelta) > COVERAGE_TIE_TOLERANCE) return coverageDelta;
    const qualityDelta = b.metrics.averageQuality - a.metrics.averageQuality;
    if (Math.abs(qualityDelta) > 1e-8) return qualityDelta;
    const contributionA = Math.min(a.metrics.aOnlyCoverage, a.metrics.bOnlyCoverage);
    const contributionB = Math.min(b.metrics.aOnlyCoverage, b.metrics.bOnlyCoverage);
    if (Math.abs(contributionB - contributionA) > 1e-8) return contributionB - contributionA;
    return a.metrics.overlapCoverage - b.metrics.overlapCoverage;
  });
  return detailed.slice(0, maximumResults);
}

export function optimizeJointPair(
  evaluations: OriginEvaluation[],
  minimumOriginSeparation: number,
  sampleCount: number,
): RankedOriginPair {
  const best = rankAllPairs(evaluations, minimumOriginSeparation, sampleCount, 1)[0];
  if (!best) throw new Error('No valid origin pair satisfies the minimum separation.');
  return best;
}

