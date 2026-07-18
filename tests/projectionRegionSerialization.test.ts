import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createProjectionAlignment,
  createProjectionControlPair,
  createProjectionRegion,
  createProjectionRegionAlignment,
  createProjectionRegionVertexPair,
  findProjectionRegionAlignmentForPano,
  normalizeProjectedStyleSettings,
  normalizeProjectionRegionAlignment,
  setProjectionRegionAlignmentForPano,
} from '../src/domain/defaults';
import { parseProject, serializeProject } from '../src/engine/projectIO';
import { validateProjectionRegionSchema } from '../src/domain/schema';

function triangle(name = 'Canopy') {
  return createProjectionRegion([
    createProjectionRegionVertexPair([0.9, 0.2], [1.1, -1], 'v1'),
    createProjectionRegionVertexPair([0.1, 0.2], [-0.1, 0.2], 'v2'),
    createProjectionRegionVertexPair([0.5, 0.4], [0.5, 2], 'v3'),
  ], name);
}

describe('paired-mask Region Fit domain model', () => {
  it('normalizes wrapping, clamping, order, softness, strength, and enabled state', () => {
    const first = { ...triangle('First'), id: 'b', order: 8, enabled: false, edgeSoftness: 99 };
    const second = { ...triangle('Second'), id: 'a', order: -4, edgeSoftness: -1 };
    const normalized = normalizeProjectionRegionAlignment({
      ...createProjectionRegionAlignment('styled', 'graybox', [first, second]),
      strength: 2,
    })!;
    expect(normalized.strength).toBe(1);
    expect(normalized.regions.map((region) => [region.name, region.order])).toEqual([['Second', 0], ['First', 1]]);
    expect(normalized.regions[1].enabled).toBe(false);
    expect(normalized.regions[1].edgeSoftness).toBe(0.25);
    expect(normalized.regions[0].edgeSoftness).toBe(0);
    expect(normalized.regions[0].vertices[0].sourceUv).toEqual([0.10000000000000009, 0]);
    expect(normalized.regions[0].vertices[2].sourceUv).toEqual([0.5, 1]);
  });

  it('keeps duplicate IDs and short regions repairable while exposing shared topology records', () => {
    const invalid = { ...triangle(), vertices: [
      createProjectionRegionVertexPair([0, 0], [0, 0], 'same'),
      createProjectionRegionVertexPair([0.2, 0], [0.3, 0], 'same'),
    ] };
    const normalized = normalizeProjectionRegionAlignment(createProjectionRegionAlignment('styled', 'graybox', [invalid]))!;
    expect(normalized.regions[0].vertices).toHaveLength(2);
    expect(normalized.regions[0].vertices.map((vertex) => vertex.id)).toEqual(['same', 'same']);
    expect(normalized.regions[0].vertices[0]).toHaveProperty('targetUv');
    expect(normalized.regions[0].vertices[0]).toHaveProperty('sourceUv');
    expect(validateProjectionRegionSchema(normalized.regions[0])).toMatchObject({
      valid: false,
      duplicateVertexIds: ['same'],
    });
  });

  it('persists primary and secondary independently and preserves legacy point data', () => {
    const legacy = createProjectionAlignment('primary', 'graybox', [
      createProjectionControlPair({ targetUv: [0.2, 0.2], sourceUv: [0.3, 0.2] }),
    ]);
    let settings = normalizeProjectedStyleSettings({ alignments: [legacy] });
    settings = setProjectionRegionAlignmentForPano(settings, 'primary', createProjectionRegionAlignment('primary', 'graybox', [triangle()]));
    settings = setProjectionRegionAlignmentForPano(settings, 'secondary', createProjectionRegionAlignment('secondary', 'graybox', [triangle('Wall')]));
    const project = createDefaultProject();
    project.name = 'Region serialization';
    project.settings.projectedStyle = settings;
    const reloaded = parseProject(serializeProject(project));
    const restored = normalizeProjectedStyleSettings(reloaded.settings.projectedStyle);
    expect(findProjectionRegionAlignmentForPano(restored, 'primary')?.regions[0].name).toBe('Canopy');
    expect(findProjectionRegionAlignmentForPano(restored, 'secondary')?.regions[0].name).toBe('Wall');
    expect(restored.alignments?.[0]).toEqual(legacy);
  });

  it('deduplicates alignments by source panorama', () => {
    const normalized = normalizeProjectedStyleSettings({
      regionAlignments: [
        createProjectionRegionAlignment('styled', 'graybox', [triangle('Old')]),
        createProjectionRegionAlignment('styled', 'graybox', [triangle('New')]),
      ],
    });
    expect(normalized.regionAlignments).toHaveLength(1);
    expect(normalized.regionAlignments?.[0].regions[0].name).toBe('New');
  });
});
