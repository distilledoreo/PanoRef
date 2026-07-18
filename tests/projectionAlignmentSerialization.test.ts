import { describe, expect, it } from 'vitest';
import {
  defaultProjectedStyleSettings,
  normalizeProjectedStyleSettings,
  normalizeProjectionAlignments,
  findProjectionAlignmentForPano,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import {
  ProjectedStyleSettings,
  ProjectionAlignment,
  ProjectionControlPair,
} from '../src/domain/types';

function makePair(overrides?: Partial<ProjectionControlPair>): ProjectionControlPair {
  return {
    id: 'pair-1',
    order: 0,
    targetUv: [0.5, 0.5],
    sourceUv: [0.3, 0.7],
    enabled: true,
    ...overrides,
  };
}

function makeAlignment(overrides?: Partial<ProjectionAlignment>): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId: 'pano-styled-1',
    targetGrayboxPanoId: 'pano-graybox-1',
    pairs: [makePair()],
    strength: 1,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('projection alignment serialization', () => {
  it('existing projects load unchanged', () => {
    const settings: Partial<ProjectedStyleSettings> = {
      opacity: 0.8,
      exposure: 1.2,
      blendMode: 'primary_only',
      fallbackMode: 'clay',
    };
    const normalized = normalizeProjectedStyleSettings(settings);
    expect(normalized.opacity).toBe(0.8);
    expect(normalized.exposure).toBe(1.2);
    expect(normalized.blendMode).toBe('primary_only');
    expect(normalized.fallbackMode).toBe('clay');
    expect(normalized.alignments).toBeUndefined();
  });

  it('existing multi-origin settings survive normalization', () => {
    const settings: Partial<ProjectedStyleSettings> = {
      panoId: 'pano-1',
      secondaryPanoId: 'pano-2',
      blendMode: 'primary_dominant',
      opacity: 1,
      exposure: 1,
      lightingContribution: 0,
      fallbackMode: 'clay',
    };
    const normalized = normalizeProjectedStyleSettings(settings);
    expect(normalized.panoId).toBe('pano-1');
    expect(normalized.secondaryPanoId).toBe('pano-2');
    expect(normalized.blendMode).toBe('primary_dominant');
  });

  it('valid alignments survive save/reload', () => {
    const alignment = makeAlignment();
    const settings: Partial<ProjectedStyleSettings> = {
      ...defaultProjectedStyleSettings,
      alignments: [alignment],
    };
    const normalized = normalizeProjectedStyleSettings(settings);
    expect(normalized.alignments).toHaveLength(1);
    expect(normalized.alignments![0].sourcePanoId).toBe('pano-styled-1');
    expect(normalized.alignments![0].pairs).toHaveLength(1);
    expect(normalized.alignments![0].pairs[0].targetUv).toEqual([0.5, 0.5]);
  });

  it('invalid pairs are discarded', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'valid-1' }),
        { id: '', order: 1, targetUv: [0.5, 0.5], sourceUv: [0.3, 0.7], enabled: true },
        makePair({ id: 'valid-2' }),
      ] as ProjectionControlPair[],
    });
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized).toHaveLength(1);
    expect(normalized![0].pairs).toHaveLength(2);
    expect(normalized![0].pairs[0].id).toBe('valid-1');
    expect(normalized![0].pairs[1].id).toBe('valid-2');
  });

  it('duplicate source IDs are preserved', () => {
    const a1 = makeAlignment({ sourcePanoId: 'pano-1', pairs: [makePair({ id: 'p1' })] });
    const a2 = makeAlignment({ sourcePanoId: 'pano-1', pairs: [makePair({ id: 'p2' })] });
    const a3 = makeAlignment({ sourcePanoId: 'pano-2', pairs: [makePair({ id: 'p3' })] });
    const normalized = normalizeProjectionAlignments([a1, a2, a3]);
    expect(normalized).toHaveLength(3);
    expect(normalized![0].sourcePanoId).toBe('pano-1');
    expect(normalized![0].pairs[0].id).toBe('p1');
    expect(normalized![1].sourcePanoId).toBe('pano-1');
    expect(normalized![1].pairs[0].id).toBe('p2');
    expect(normalized![2].sourcePanoId).toBe('pano-2');
    expect(normalized![2].pairs[0].id).toBe('p3');
  });

  it('updating one panorama alignment preserves the other', () => {
    const a1 = makeAlignment({ sourcePanoId: 'pano-a' });
    const a2 = makeAlignment({ sourcePanoId: 'pano-b' });
    const settings: ProjectedStyleSettings = {
      ...defaultProjectedStyleSettings,
      alignments: [a1, a2],
    };
    const updated = makeAlignment({ sourcePanoId: 'pano-a', pairs: [makePair({ id: 'updated' })] });
    const result = setProjectionAlignmentForPano(settings, 'pano-a', updated);
    expect(result.alignments).toHaveLength(2);
    expect(result.alignments![0].sourcePanoId).toBe('pano-b');
    expect(result.alignments![0].pairs[0].id).toBe('pair-1');
    expect(result.alignments![1].sourcePanoId).toBe('pano-a');
    expect(result.alignments![1].pairs[0].id).toBe('updated');
  });

  it('removing one alignment does not affect the pano or other alignments', () => {
    const a1 = makeAlignment({ sourcePanoId: 'pano-a' });
    const a2 = makeAlignment({ sourcePanoId: 'pano-b' });
    const settings: ProjectedStyleSettings = {
      ...defaultProjectedStyleSettings,
      alignments: [a1, a2],
    };
    const result = setProjectionAlignmentForPano(settings, 'pano-a', undefined);
    expect(result.alignments).toHaveLength(1);
    expect(result.alignments![0].sourcePanoId).toBe('pano-b');
  });

  it('normalization is deterministic', () => {
    const alignment = makeAlignment({
      pairs: [
        makePair({ id: 'p1', order: 0 }),
        makePair({ id: 'p2', order: 1 }),
      ],
    });
    const settings: Partial<ProjectedStyleSettings> = {
      ...defaultProjectedStyleSettings,
      alignments: [alignment],
    };
    const first = normalizeProjectedStyleSettings(settings);
    const second = normalizeProjectedStyleSettings(settings);
    expect(first).toEqual(second);
  });

  it('malformed alignment version is rejected', () => {
    const alignment = { ...makeAlignment(), version: 2 };
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized).toBeUndefined();
  });

  it('malformed alignment solver is rejected', () => {
    const alignment = { ...makeAlignment(), solver: 'other-v1' };
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized).toBeUndefined();
  });

  it('empty string updatedAt preserves as empty', () => {
    const alignment = makeAlignment({ updatedAt: '' });
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized![0].updatedAt).toBe('');
  });

  it('UV coordinates pass through without clamping', () => {
    const alignment = makeAlignment({
      pairs: [makePair({ targetUv: [-0.1, 1.5], sourceUv: [2.0, -0.5] })],
    });
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized![0].pairs[0].targetUv[0]).toBe(-0.1);
    expect(normalized![0].pairs[0].targetUv[1]).toBe(1.5);
    expect(normalized![0].pairs[0].sourceUv[0]).toBe(2.0);
    expect(normalized![0].pairs[0].sourceUv[1]).toBe(-0.5);
  });

  it('strength is clamped to 0-1', () => {
    const alignment = makeAlignment({ strength: 5 });
    const normalized = normalizeProjectionAlignments([alignment]);
    expect(normalized![0].strength).toBe(1);

    const alignment2 = makeAlignment({ strength: -2 });
    const normalized2 = normalizeProjectionAlignments([alignment2]);
    expect(normalized2![0].strength).toBe(0);
  });

  it('findProjectionAlignmentForPano returns correct alignment', () => {
    const a1 = makeAlignment({ sourcePanoId: 'pano-a' });
    const a2 = makeAlignment({ sourcePanoId: 'pano-b' });
    const settings: ProjectedStyleSettings = {
      ...defaultProjectedStyleSettings,
      alignments: [a1, a2],
    };
    expect(findProjectionAlignmentForPano(settings, 'pano-a')?.sourcePanoId).toBe('pano-a');
    expect(findProjectionAlignmentForPano(settings, 'pano-b')?.sourcePanoId).toBe('pano-b');
    expect(findProjectionAlignmentForPano(settings, 'pano-c')).toBeUndefined();
  });
});
