import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultProjectedStyleSettings,
  findProjectionAlignmentForPano,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { ProjectionAlignment, ProjectedStyleSettings } from '../src/domain/types';

function alignment(sourcePanoId: string, targetGrayboxPanoId: string, id: string): ProjectionAlignment {
  return {
    version: 1,
    solver: 'spherical-rbf-v1',
    sourcePanoId,
    targetGrayboxPanoId,
    pairs: [{
      id,
      order: 0,
      targetUv: [0.5, 0.5],
      sourceUv: [0.55, 0.5],
      enabled: true,
    }],
    strength: 0.8,
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('Projection Assist per-projector controls', () => {
  it('keeps alignment ownership with panorama IDs when slots and blend mode change', () => {
    const primary = alignment('styled-a', 'graybox-a', 'match-a');
    const secondary = alignment('styled-b', 'graybox-b', 'match-b');
    const settings: ProjectedStyleSettings = {
      ...defaultProjectedStyleSettings,
      panoId: 'styled-a',
      secondaryPanoId: 'styled-b',
      blendMode: 'primary_dominant',
      alignments: [primary, secondary],
    };

    const swapped = {
      ...settings,
      panoId: 'styled-b',
      secondaryPanoId: 'styled-a',
      blendMode: 'secondary_dominant' as const,
    };
    const secondaryRemoved = { ...swapped, secondaryPanoId: undefined };
    const readded = { ...secondaryRemoved, secondaryPanoId: 'styled-a' };

    expect(findProjectionAlignmentForPano(swapped, 'styled-a')).toEqual(primary);
    expect(findProjectionAlignmentForPano(swapped, 'styled-b')).toEqual(secondary);
    expect(findProjectionAlignmentForPano(secondaryRemoved, 'styled-a')).toEqual(primary);
    expect(findProjectionAlignmentForPano(readded, 'styled-a')).toEqual(primary);
  });

  it('changes one panorama strength without replacing its matches or the other alignment', () => {
    const primary = alignment('styled-a', 'graybox-a', 'match-a');
    const secondary = alignment('styled-b', 'graybox-b', 'match-b');
    const settings: ProjectedStyleSettings = {
      ...defaultProjectedStyleSettings,
      alignments: [primary, secondary],
    };
    const next = setProjectionAlignmentForPano(settings, 'styled-a', {
      ...primary,
      strength: 0.25,
    });

    expect(findProjectionAlignmentForPano(next, 'styled-a')).toMatchObject({
      strength: 0.25,
      targetGrayboxPanoId: 'graybox-a',
      pairs: primary.pairs,
    });
    expect(findProjectionAlignmentForPano(next, 'styled-b')).toEqual(secondary);
  });

  it('exposes independent status, edit, strength, and removal controls in the production panel', () => {
    const panel = readFileSync(new URL('../src/components/common/ProjectedStylePanel.tsx', import.meta.url), 'utf8');
    const editor = readFileSync(new URL('../src/components/reference/ProjectionAlignmentEditor.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('ProjectionAlignmentEditor');
    expect(panel).toContain('data-projection-alignment-card');
    expect(panel).toContain('data-projection-alignment-status');
    expect(panel).toContain('data-projection-alignment-edit');
    expect(panel).toContain('data-projection-alignment-remove');
    expect(panel).toContain('Local fit strength');
    expect(panel).toContain('Some matches conflict');
    expect(panel).toContain('Remove local fit');
    expect(panel).toContain('secondaryActive');
    expect(editor).toContain('panoId: sourcePanoId');
    expect(editor).toContain('secondaryPanoId: undefined');
  });
});
