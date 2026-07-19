import { describe, expect, it } from 'vitest';
import {
  estimateRemainingSeconds,
  formatDurationSeconds,
} from '../src/engine/prepareSuggestedSecondCapture';

describe('suggested second capture ETA helpers', () => {
  it('uses phase default until progress is meaningful', () => {
    expect(estimateRemainingSeconds({
      elapsedMs: 2_000,
      progress: 0.02,
      phaseDefaultSeconds: 35,
    })).toBe(33);
  });

  it('extrapolates remaining from progress once underway', () => {
    const remaining = estimateRemainingSeconds({
      elapsedMs: 10_000,
      progress: 0.5,
      phaseDefaultSeconds: 35,
    });
    expect(remaining).toBe(10);
  });

  it('formats durations for the progress UI', () => {
    expect(formatDurationSeconds(12)).toBe('~12s');
    expect(formatDurationSeconds(75)).toBe('~1m 15s');
  });
});
