import { compareOriginPair } from './coverageBitset';
import type { OriginEvaluation, PairMetrics } from './types';

export interface RankedSecondOrigin {
  evaluation: OriginEvaluation;
  metrics: PairMetrics;
  addedCoverage: number;
}

const COVERAGE_TIE_TOLERANCE = 0.0025;

export function rankSecondOrigins(
  first: OriginEvaluation,
  candidates: OriginEvaluation[],
  minimumOriginSeparation = 0,
): RankedSecondOrigin[] {
  return candidates
    .filter((candidate) => candidate !== first && Math.hypot(
      candidate.position[0] - first.position[0],
      candidate.position[1] - first.position[1],
      candidate.position[2] - first.position[2],
    ) >= minimumOriginSeparation)
    .map((evaluation) => {
      const metrics = compareOriginPair(first, evaluation);
      return {
        evaluation,
        metrics,
        addedCoverage: Math.max(0, metrics.unionCoverage - first.individualCoverage),
      };
    })
    .sort((a, b) => {
      const coverageDelta = b.metrics.unionCoverage - a.metrics.unionCoverage;
      if (Math.abs(coverageDelta) > COVERAGE_TIE_TOLERANCE) return coverageDelta;
      const qualityDelta = b.metrics.qualityGain - a.metrics.qualityGain;
      if (Math.abs(qualityDelta) > 1e-8) return qualityDelta;
      const overlapDelta = a.metrics.overlapCoverage - b.metrics.overlapCoverage;
      if (Math.abs(overlapDelta) > 1e-8) return overlapDelta;
      return b.evaluation.clearance - a.evaluation.clearance;
    });
}

export function optimizeSecondOrigin(
  first: OriginEvaluation,
  candidates: OriginEvaluation[],
  minimumOriginSeparation = 0,
): RankedSecondOrigin {
  const best = rankSecondOrigins(first, candidates, minimumOriginSeparation)[0];
  if (!best) throw new Error('No valid secondary origin candidates.');
  return best;
}
