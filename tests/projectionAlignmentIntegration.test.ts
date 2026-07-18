import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Euler, LocationProject, ProjectedStyleSettings } from '../src/domain/types';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  createProjectionAlignment,
  createProjectionControlPair,
  findProjectionAlignmentForPano,
  resetPairCounterForTests,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { solveProjectionWarp, computeResidualToleranceRadians } from '../src/engine/projectionAlignmentSolver';
import { createWarpTexture, disposeAllProjectionWarpTextures } from '../src/engine/projectionWarpTexture';
import { resolveProjectionWarpForPano, resolveProjectionWarpWithStrengthForProject } from '../src/engine/multiOriginProjection';
import { createProjectedStyleMaterial } from '../src/engine/projectedStyleMaterials';
import { equirectUvToUnitDirection, unitDirectionToEquirectUv } from '../src/engine/projectionAlignmentMath';
import { degreesToRadians } from '../src/engine/sync';
import type { PanoReference } from '../src/domain/types';

const DEG = Math.PI / 180;
const EPSILON = 1e-7;

beforeEach(() => {
  resetPairCounterForTests();
  disposeAllProjectionWarpTextures();
});

afterEach(() => {
  disposeAllProjectionWarpTextures();
});

function makeSettings(overrides?: Partial<ProjectedStyleSettings>): ProjectedStyleSettings {
  return {
    panoId: 'pano-styled-1',
    opacity: 1,
    exposure: 1,
    lightingContribution: 1,
    fallbackMode: 'clay',
    ...overrides,
  };
}

describe('projection alignment integration', () => {
  it('helper creates control pair with unique id', () => {
    const a = createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] });
    const b = createProjectionControlPair({ order: 1, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] });

    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(a.enabled).toBe(true);
    expect(a.targetUv).toEqual([0.5, 0.5]);
    expect(a.sourceUv).toEqual([0.5, 0.5]);
  });

  it('createProjectionAlignment builds valid alignment', () => {
    const pairs = [
      createProjectionControlPair({ order: 0, targetUv: [0.25, 0.5], sourceUv: [0.30, 0.5] }),
    ];
    const alignment = createProjectionAlignment('pano-a', 'pano-b', pairs);

    expect(alignment.version).toBe(1);
    expect(alignment.solver).toBe('spherical-rbf-v1');
    expect(alignment.sourcePanoId).toBe('pano-a');
    expect(alignment.targetGrayboxPanoId).toBe('pano-b');
    expect(alignment.pairs).toHaveLength(1);
    expect(alignment.strength).toBe(1);
    expect(alignment.updatedAt).toBeTruthy();
  });

  it('findProjectionAlignmentForPano finds by sourcePanoId', () => {
    const settings = makeSettings({
      alignments: [
        createProjectionAlignment('pano-a', 'graybox', [createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] })]),
        createProjectionAlignment('pano-b', 'graybox', [createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] })]),
      ],
    });

    const found = findProjectionAlignmentForPano(settings, 'pano-b');
    expect(found).toBeTruthy();
    expect(found!.sourcePanoId).toBe('pano-b');
  });

  it('setProjectionAlignmentForPano adds new alignment', () => {
    const settings = makeSettings();
    const alignment = createProjectionAlignment('pano-a', 'graybox', [createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] })]);
    const updated = setProjectionAlignmentForPano(settings, 'pano-a', alignment);

    expect(updated.alignments).toHaveLength(1);
    expect(updated.alignments![0].sourcePanoId).toBe('pano-a');
  });

  it('setProjectionAlignmentForPano replaces existing alignment', () => {
    const a1 = createProjectionAlignment('pano-a', 'graybox', [
      createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] }),
    ]);
    const settings = makeSettings({ alignments: [a1] });

    const a2 = createProjectionAlignment('pano-a', 'graybox', [
      createProjectionControlPair({ order: 0, targetUv: [0.3, 0.3], sourceUv: [0.4, 0.4] }),
    ]);
    const updated = setProjectionAlignmentForPano(settings, 'pano-a', a2);

    expect(updated.alignments).toHaveLength(1);
    expect(updated.alignments![0].pairs[0].targetUv).toEqual([0.3, 0.3]);
  });

  it('setProjectionAlignmentForPano removes alignment when undefined', () => {
    const a1 = createProjectionAlignment('pano-a', 'graybox', [createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.5, 0.5] })]);
    const settings = makeSettings({ alignments: [a1] });

    const updated = setProjectionAlignmentForPano(settings, 'pano-a', undefined);
    expect(updated.alignments).toBeUndefined();
  });
});

describe('solver to warp texture integration', () => {
  it('solver output encodes into warp texture', () => {
    const alignment = createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
      createProjectionControlPair({
        order: 0,
        targetUv: [0.5, 0.5],
        sourceUv: [0.55, 0.48],
        enabled: true,
      }),
    ]);

    const field = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 10 * DEG,
      width: 16,
      height: 8,
    });

    const tolerance = computeResidualToleranceRadians(field.width, field.height);
    expect(field.width).toBe(16);
    expect(field.height).toBe(8);
    expect(field.displacement.length).toBe(16 * 8 * 2);
    expect(field.maxMarkerErrorRadians).toBeLessThanOrEqual(tolerance + EPSILON);

    const result = createWarpTexture(
      alignment,
      10 * DEG,
      0,
      field.displacement,
      16,
      8,
    );

    expect(result.texture.image.data.length).toBe(16 * 8 * 4);
    expect(result.width).toBe(16);
    expect(result.height).toBe(8);
    result.release();
  });

  it('single marker displacement moves toward target', () => {
    const shiftU = 0.08;
    const alignment = createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
      createProjectionControlPair({
        order: 0,
        targetUv: [0.5, 0.5],
        sourceUv: [0.5 + shiftU, 0.5],
        enabled: true,
      }),
    ]);

    const field = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
      width: 16,
      height: 8,
    });

    const tx = 8;
    const ty = 4;
    const idx = (ty * 16 + tx) * 2;
    const du = field.displacement[idx];

    const tolerance = computeResidualToleranceRadians(field.width, field.height);
    expect(du).toBeGreaterThan(0);
    expect(field.maxMarkerErrorRadians).toBeLessThanOrEqual(tolerance + EPSILON);
  });

  it('resolveProjectionWarpForPano returns texture for alignment', () => {
    const settings = makeSettings({
      alignments: [
        createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
          createProjectionControlPair({
            order: 0,
            targetUv: [0.5, 0.5],
            sourceUv: [0.55, 0.48],
            enabled: true,
          }),
        ]),
      ],
    });
    const rotation: Euler = [0, 10, 0];
    const panoRefs: PanoReference[] = [
      { id: 'pano-graybox-1', rotation: [0, 0, 0] } as PanoReference,
    ];
    const result = resolveProjectionWarpForPano(settings, 'pano-styled-1', rotation, panoRefs, 16, 8);

    expect(result).toBeDefined();
    expect(result!.texture).toBeDefined();
    expect(result!.width).toBe(16);
    expect(result!.height).toBe(8);
    result!.release();
  });

  it('resolveProjectionWarpForPano returns undefined for unknown pano', () => {
    const settings = makeSettings();
    const rotation: Euler = [0, 0, 0];
    const result = resolveProjectionWarpForPano(settings, 'unknown-pano', rotation, []);
    expect(result).toBeUndefined();
  });
});

describe('warp creates non-identity displacement', () => {
  it('shifted marker produces measurable displacement at marker UV', () => {
    const shiftU = 0.1;
    const alignment = createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
      createProjectionControlPair({
        order: 0,
        targetUv: [0.5, 0.5],
        sourceUv: [0.5 + shiftU, 0.5],
        enabled: true,
      }),
    ]);

    const field = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
      width: 32,
      height: 16,
    });

    const markerTx = 16;
    const markerTy = 8;
    const idx = (markerTy * 32 + markerTx) * 2;
    const du = field.displacement[idx];

    expect(Math.abs(du)).toBeGreaterThan(0.001);
  });

  it('identity alignment (sourceUv === targetUv) produces near-zero displacement', () => {
    const alignment = createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
      createProjectionControlPair({
        order: 0,
        targetUv: [0.5, 0.5],
        sourceUv: [0.5, 0.5],
        enabled: true,
      }),
    ]);

    const field = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 0,
      width: 16,
      height: 8,
    });

    const displacement = field.displacement;
    let maxAbsDisp = 0;
    for (let i = 0; i < displacement.length; i++) {
      maxAbsDisp = Math.max(maxAbsDisp, Math.abs(displacement[i]));
    }
    expect(maxAbsDisp).toBeLessThan(0.01);
  });
});

describe('material integration with warp', () => {
  it('creates material with warp texture', () => {
    const alignment = createProjectionAlignment('pano-styled-1', 'pano-graybox-1', [
      createProjectionControlPair({
        order: 0,
        targetUv: [0.5, 0.5],
        sourceUv: [0.55, 0.48],
        enabled: true,
      }),
    ]);

    const field = solveProjectionWarp(alignment, {
      targetYawRadians: 0,
      sourceYawRadians: 10 * DEG,
      width: 16,
      height: 8,
    });

    const warpResult = createWarpTexture(alignment, 10 * DEG, 0, field.displacement, 16, 8);

    const dummyTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    const material = createProjectedStyleMaterial({
      texture: dummyTexture,
      origin: [0, 1.6, 0] as [number, number, number],
      rotation: [0, 10, 0] as [number, number, number],
      settings: makeSettings(),
      fallbackColor: 0xc8cdc8,
      warpMap: warpResult.texture,
      warpMapSize: [16, 8],
      warpStrength: 1,
    });

    expect(material.customProgramCacheKey).toBeDefined();
    const cacheKey = material.customProgramCacheKey!();
    expect(cacheKey).toBe('projected-style');

    dummyTexture.dispose();
    warpResult.release();
    material.dispose();
  });

  it('material cache key is uniform regardless of warp presence', () => {
    const dummyTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);

    const matNoWarp = createProjectedStyleMaterial({
      texture: dummyTexture,
      origin: [0, 1.6, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      settings: makeSettings(),
      fallbackColor: 0xc8cdc8,
    });

    const matWarp = createProjectedStyleMaterial({
      texture: dummyTexture,
      origin: [0, 1.6, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      settings: makeSettings(),
      fallbackColor: 0xc8cdc8,
      warpMap: getIdentityDataTexture(),
      warpMapSize: [1, 1],
      warpStrength: 1,
    });

    expect(matNoWarp.customProgramCacheKey!()).toBe(matWarp.customProgramCacheKey!());

    dummyTexture.dispose();
    matNoWarp.dispose();
    matWarp.dispose();
  });
});

describe('resolveProjectionWarpWithStrengthForProject', () => {
  function buildProject(): { project: LocationProject; styledPanoId: string; grayboxPanoId: string } {
    const project = createDefaultProject();
    const grayAsset = createPanoAsset({ name: 'gray.png', uri: 'data:image/png;base64,GRAY', width: 4096, height: 2048 });
    const styledAsset = createPanoAsset({ name: 'styled.png', uri: 'data:image/png;base64,STYLE', width: 4096, height: 2048 });
    project.assets.assets[grayAsset.id] = grayAsset;
    project.assets.assets[styledAsset.id] = styledAsset;

    const grayboxPano = createPanoReference({
      name: 'Graybox',
      assetId: grayAsset.id,
      type: 'graybox_render',
      origin: [0, 1.6, 0],
      width: 4096,
      height: 2048,
      isCanonical: true,
    });
    const styledPano = createPanoReference({
      name: 'Styled',
      assetId: styledAsset.id,
      type: 'ai_global_reference',
      origin: [0, 1.6, 0],
      rotation: [0, 10, 0],
      width: 4096,
      height: 2048,
      isCanonical: false,
    });
    project.panoRefs = [grayboxPano, styledPano];

    const alignment = createProjectionAlignment(styledPano.id, grayboxPano.id, [
      createProjectionControlPair({ order: 0, targetUv: [0.5, 0.5], sourceUv: [0.55, 0.48], enabled: true }),
    ]);
    project.settings.projectedStyle = {
      ...project.settings.projectedStyle!,
      panoId: styledPano.id,
      alignments: [alignment],
    };

    return { project, styledPanoId: styledPano.id, grayboxPanoId: grayboxPano.id };
  }

  it('returns warp + strength for valid project', () => {
    const { project, styledPanoId } = buildProject();
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeDefined();
    expect(result!.warp).toBeDefined();
    expect(result!.warp.texture).toBeDefined();
    expect(typeof result!.strength).toBe('number');
    result!.warp.release();
  });

  it('returns 512x256 for runtime quality', () => {
    const { project, styledPanoId } = buildProject();
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeDefined();
    expect(result!.warp.width).toBe(512);
    expect(result!.warp.height).toBe(256);
    result!.warp.release();
  });

  it('returns 256x128 for preview quality', () => {
    const { project, styledPanoId } = buildProject();
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'preview');
    expect(result).toBeDefined();
    expect(result!.warp.width).toBe(256);
    expect(result!.warp.height).toBe(128);
    result!.warp.release();
  });

  it('returns the saved strength', () => {
    const { project, styledPanoId } = buildProject();
    const alignment = project.settings.projectedStyle!.alignments![0];
    alignment.strength = 0.6;
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeDefined();
    expect(result!.strength).toBe(0.6);
    result!.warp.release();
  });

  it('rejects missing source pano', () => {
    const { project } = buildProject();
    const result = resolveProjectionWarpWithStrengthForProject(project, 'nonexistent-pano', 'runtime');
    expect(result).toBeUndefined();
  });

  it('rejects missing source image asset', () => {
    const { project, styledPanoId } = buildProject();
    const pano = project.panoRefs.find((p) => p.id === styledPanoId)!;
    delete project.assets.assets[pano.imageAssetId];
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeUndefined();
  });

  it('rejects missing target pano', () => {
    const { project, styledPanoId, grayboxPanoId } = buildProject();
    project.panoRefs = project.panoRefs.filter((p) => p.id !== grayboxPanoId);
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeUndefined();
  });

  it('rejects non-graybox target', () => {
    const { project, styledPanoId, grayboxPanoId } = buildProject();
    const pano = project.panoRefs.find((p) => p.id === grayboxPanoId)!;
    pano.type = 'ai_global_reference';
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeUndefined();
  });

  it('rejects missing target image asset', () => {
    const { project, styledPanoId, grayboxPanoId } = buildProject();
    const pano = project.panoRefs.find((p) => p.id === grayboxPanoId)!;
    delete project.assets.assets[pano.imageAssetId];
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeUndefined();
  });

  it('rejects zero enabled pairs', () => {
    const { project, styledPanoId } = buildProject();
    const alignment = project.settings.projectedStyle!.alignments![0];
    for (const pair of alignment.pairs) pair.enabled = false;
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeUndefined();
  });

  it('independent primary and secondary results', () => {
    const { project, styledPanoId, grayboxPanoId } = buildProject();

    // Add a second styled pano as secondary
    const styledAsset2 = createPanoAsset({ name: 'styled2.png', uri: 'data:image/png;base64,STYLE2', width: 4096, height: 2048 });
    project.assets.assets[styledAsset2.id] = styledAsset2;
    const styledPano2 = createPanoReference({
      name: 'Styled 2',
      assetId: styledAsset2.id,
      type: 'ai_global_reference',
      origin: [8, 1.6, 0],
      rotation: [0, 20, 0],
      width: 4096,
      height: 2048,
      isCanonical: false,
    });
    project.panoRefs.push(styledPano2);

    const alignment2 = createProjectionAlignment(styledPano2.id, grayboxPanoId, [
      createProjectionControlPair({ order: 0, targetUv: [0.3, 0.3], sourceUv: [0.35, 0.3], enabled: true }),
    ]);
    project.settings.projectedStyle!.alignments = [
      ...project.settings.projectedStyle!.alignments!,
      alignment2,
    ];

    const primary = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    const secondary = resolveProjectionWarpWithStrengthForProject(project, styledPano2.id, 'runtime');

    expect(primary).toBeDefined();
    expect(secondary).toBeDefined();
    expect(primary!.warp.texture).not.toBe(secondary!.warp.texture);

    primary!.warp.release();
    secondary!.warp.release();
  });

  it('returns diagnostics with warp result', () => {
    const { project, styledPanoId } = buildProject();
    const result = resolveProjectionWarpWithStrengthForProject(project, styledPanoId, 'runtime');
    expect(result).toBeDefined();
    expect(result!.warp.diagnostics).toBeDefined();
    expect(typeof result!.warp.diagnostics!.maxMarkerErrorRadians).toBe('number');
    expect(typeof result!.warp.diagnostics!.conflictCount).toBe('number');
    expect(typeof result!.warp.diagnostics!.maximumRotationRadians).toBe('number');
    result!.warp.release();
  });
});

/** Create a 1x1 identity warp DataTexture (128,0,128,0 → du=0, dv=0). */
function getIdentityDataTexture(): THREE.DataTexture {
  const data = new Uint8Array([128, 0, 128, 0]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
