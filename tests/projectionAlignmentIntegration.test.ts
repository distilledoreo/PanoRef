import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Euler, ProjectedStyleSettings } from '../src/domain/types';
import {
  createProjectionAlignment,
  createProjectionControlPair,
  findProjectionAlignmentForPano,
  resetPairCounterForTests,
  setProjectionAlignmentForPano,
} from '../src/domain/defaults';
import { solveProjectionWarp } from '../src/engine/projectionAlignmentSolver';
import { createWarpTexture, disposeAllProjectionWarpTextures } from '../src/engine/projectionWarpTexture';
import { resolveProjectionWarpForPano } from '../src/engine/multiOriginProjection';
import { createProjectedStyleMaterial } from '../src/engine/projectedStyleMaterials';
import { equirectUvToUnitDirection, unitDirectionToEquirectUv } from '../src/engine/projectionAlignmentMath';
import { degreesToRadians } from '../src/engine/sync';
import type { PanoReference } from '../src/domain/types';

const DEG = Math.PI / 180;

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

    expect(field.width).toBe(16);
    expect(field.height).toBe(8);
    expect(field.displacement.length).toBe(16 * 8 * 2);
    expect(field.maxMarkerErrorRadians).toBeLessThan(5 * DEG);

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

    expect(du).toBeGreaterThan(0);
    expect(field.maxMarkerErrorRadians).toBeLessThan(1 * DEG);
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
    expect(cacheKey).toContain('projected-style-v5');
    expect(cacheKey).toContain(':w1');

    dummyTexture.dispose();
    warpResult.release();
    material.dispose();
  });

  it('material cache key differs with and without warp', () => {
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

    expect(matNoWarp.customProgramCacheKey!()).not.toBe(matWarp.customProgramCacheKey!());

    dummyTexture.dispose();
    matNoWarp.dispose();
    matWarp.dispose();
  });
});

/** Create a 1x1 identity warp DataTexture (128,0,128,0 → du=0, dv=0). */
function getIdentityDataTexture(): THREE.DataTexture {
  const data = new Uint8Array([128, 0, 128, 0]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
