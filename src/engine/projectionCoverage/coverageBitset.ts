import type { OriginEvaluation, PairMetrics } from './types';

export function createCoverageBitset(sampleCount: number): Uint32Array {
  return new Uint32Array(Math.ceil(sampleCount / 32));
}

export function setCoverageBit(bits: Uint32Array, index: number): void {
  bits[index >>> 5] |= (1 << (index & 31)) >>> 0;
}

export function hasCoverageBit(bits: Uint32Array, index: number): boolean {
  return Boolean(bits[index >>> 5] & ((1 << (index & 31)) >>> 0));
}

export function popcount32(value: number): number {
  let word = value >>> 0;
  word -= (word >>> 1) & 0x55555555;
  word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
  return (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function countCoverageBits(bits: Uint32Array): number {
  let count = 0;
  for (const word of bits) count += popcount32(word);
  return count;
}

export function unionCoverage(
  a: Uint32Array,
  b: Uint32Array,
  sampleCount: number,
): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) count += popcount32(a[i] | b[i]);
  return sampleCount > 0 ? count / sampleCount : 0;
}

export function reachableCoverage(
  evaluations: OriginEvaluation[],
  sampleCount: number,
): number {
  if (evaluations.length === 0 || sampleCount === 0) return 0;
  const reachable = createCoverageBitset(sampleCount);
  for (const evaluation of evaluations) {
    for (let word = 0; word < reachable.length; word += 1) {
      reachable[word] |= evaluation.coverageBits[word];
    }
  }
  return countCoverageBits(reachable) / sampleCount;
}

export function compareOriginPair(
  a: OriginEvaluation,
  b: OriginEvaluation,
): PairMetrics {
  const sampleCount = a.quality.length;
  if (sampleCount === 0 || b.quality.length !== sampleCount) {
    return {
      unionCoverage: 0,
      overlapCoverage: 0,
      aOnlyCoverage: 0,
      bOnlyCoverage: 0,
      averageQuality: 0,
      qualityGain: 0,
    };
  }

  let union = 0;
  let overlap = 0;
  let aOnly = 0;
  let bOnly = 0;
  let maxQuality = 0;
  let qualityGain = 0;

  for (let i = 0; i < sampleCount; i += 1) {
    const coveredA = hasCoverageBit(a.coverageBits, i);
    const coveredB = hasCoverageBit(b.coverageBits, i);
    if (coveredA || coveredB) union += 1;
    if (coveredA && coveredB) overlap += 1;
    if (coveredA && !coveredB) aOnly += 1;
    if (!coveredA && coveredB) bOnly += 1;
    maxQuality += Math.max(a.quality[i], b.quality[i]);
    qualityGain += Math.max(0, b.quality[i] - a.quality[i]);
  }

  return {
    unionCoverage: union / sampleCount,
    overlapCoverage: overlap / sampleCount,
    aOnlyCoverage: aOnly / sampleCount,
    bOnlyCoverage: bOnly / sampleCount,
    averageQuality: maxQuality / (255 * sampleCount),
    qualityGain: qualityGain / (255 * sampleCount),
  };
}

