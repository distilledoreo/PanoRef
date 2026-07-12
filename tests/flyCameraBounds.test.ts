import { describe, expect, it } from 'vitest';
import { createDefaultProject, createSceneObject } from '../src/domain/defaults';
import {
  clampFlyCameraPosition,
  computeSceneFlyBounds,
} from '../src/engine/flyCameraBounds';
import { sceneEnvelope } from '../src/engine/buildSelection';
import type { SceneData } from '../src/domain/types';

describe('fly camera bounds', () => {
  it('uses rotated dimensions and scale when computing the scene envelope', () => {
    const object = createSceneObject('box', 1, [20, 1, 0]);
    object.dimensions = [2, 1, 8];
    object.transform.rotation = [0, 45, 0];
    object.transform.scale = [2, 1, 0.5];
    const scene = { ...createDefaultProject().scene, objects: [object] };
    const envelope = sceneEnvelope(scene);

    expect(envelope.max.x).toBeGreaterThan(20 + 1);
    expect(envelope.max.z).toBeGreaterThan(2);
  });

  it('derives navigable bounds from the full object envelope plus outward margin', () => {
    const project = createDefaultProject();
    const bounds = computeSceneFlyBounds(project.scene, {
      horizontalMarginMeters: 3,
      verticalMarginMeters: 1,
    });
    const qualifyingObjects = project.scene.objects.filter((object) => object.visible && object.type !== 'sun_marker');
    const envelope = sceneEnvelope(project.scene, qualifyingObjects);

    expect(bounds.min[0]).toBeCloseTo(envelope.min.x - 3, 5);
    expect(bounds.max[0]).toBeCloseTo(envelope.max.x + 3, 5);
    expect(bounds.min[2]).toBeCloseTo(envelope.min.z - 3, 5);
    expect(bounds.max[2]).toBeGreaterThan(8);
    expect(bounds.min[1]).toBeGreaterThanOrEqual(0.45);
    expect(bounds.max[1]).toBeGreaterThan(project.scene.panoOrigin[1]);
  });

  it('falls back to a pano-centered volume when the scene has no qualifying objects', () => {
    const scene: SceneData = {
      worldUp: 'Y',
      objects: [],
      panoOrigin: [1, 1.65, -2],
      panoRotation: [0, 0, 0],
    };
    const bounds = computeSceneFlyBounds(scene, {
      fallbackHalfExtent: [5, 2, 5],
    });

    expect(bounds.min).toEqual([1 - 5, 0.45, -2 - 5]);
    expect(bounds.max).toEqual([1 + 5, 1.65 + 2, -2 + 5]);
  });

  it('excludes sun markers so helper lights do not define the stage volume', () => {
    const project = createDefaultProject();
    const sunMarkerOnly = computeSceneFlyBounds({
      ...project.scene,
      objects: project.scene.objects.filter((object) => object.type === 'sun_marker'),
    }, {
      fallbackHalfExtent: [4, 2, 4],
    });

    expect(sunMarkerOnly.min).toEqual([
      project.scene.panoOrigin[0] - 4,
      0.45,
      project.scene.panoOrigin[2] - 4,
    ]);
    expect(sunMarkerOnly.max).toEqual([
      project.scene.panoOrigin[0] + 4,
      project.scene.panoOrigin[1] + 2,
      project.scene.panoOrigin[2] + 4,
    ]);
  });

  it('allows sustained forward movement beyond the central wall and gate', () => {
    const project = createDefaultProject();
    const bounds = computeSceneFlyBounds(project.scene);
    const clamped = clampFlyCameraPosition([0, project.scene.panoOrigin[1], 100], bounds);

    expect(clamped[2]).toBe(bounds.max[2]);
    expect(bounds.max[2]).toBeGreaterThan(12);
  });

  it('scales the default horizontal movement volume with scene size', () => {
    const project = createDefaultProject();
    const bounds = computeSceneFlyBounds(project.scene);
    const farthestObjectZ = Math.max(
      ...project.scene.objects
        .filter((object) => object.visible && object.type !== 'sun_marker')
        .map((object) => object.transform.position[2] + object.dimensions[2] / 2),
      project.scene.panoOrigin[2],
    );

    expect(bounds.max[2]).toBeGreaterThan(farthestObjectZ);
    expect(bounds.max[2] - farthestObjectZ).toBeGreaterThanOrEqual(4);
  });

  it('clamps fly movement inside the computed bounds without changing look state', () => {
    const bounds = computeSceneFlyBounds(createDefaultProject().scene);
    const clamped = clampFlyCameraPosition([100, -5, -100], bounds);

    expect(clamped[0]).toBe(bounds.max[0]);
    expect(clamped[1]).toBe(bounds.min[1]);
    expect(clamped[2]).toBe(bounds.min[2]);
  });

  it('keeps in-bounds positions unchanged', () => {
    const bounds = computeSceneFlyBounds(createDefaultProject().scene);
    const position = [0, 1.65, 1.2] as const;
    expect(clampFlyCameraPosition([...position], bounds)).toEqual([...position]);
  });
});
