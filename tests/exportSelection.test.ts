import { describe, expect, it } from 'vitest';
import { reconcileExportSelectedShotIds } from '../src/engine/exportSelection';

describe('reconcileExportSelectedShotIds', () => {
  it('selects all shots when the project changes', () => {
    const next = reconcileExportSelectedShotIds({
      projectChanged: true,
      previousShotIds: ['a'],
      nextShotIds: ['x', 'y'],
      currentSelected: new Set(['a']),
    });
    expect([...next].sort()).toEqual(['x', 'y']);
  });

  it('drops deleted ids, keeps user choices, and selects newly added shots', () => {
    const next = reconcileExportSelectedShotIds({
      projectChanged: false,
      previousShotIds: ['a', 'b', 'c'],
      nextShotIds: ['a', 'c', 'd'],
      currentSelected: new Set(['a', 'b']),
    });
    expect([...next].sort()).toEqual(['a', 'd']);
  });

  it('preserves an empty selection when no shots were added', () => {
    const next = reconcileExportSelectedShotIds({
      projectChanged: false,
      previousShotIds: ['a', 'b'],
      nextShotIds: ['a', 'b'],
      currentSelected: new Set(),
    });
    expect([...next]).toEqual([]);
  });
});
