import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { clampFlyCameraPosition, computeSceneFlyBounds } from '../src/engine/flyCameraBounds';
import type { SceneData } from '../src/domain/types';

describe('fly camera bounds', () => {
  it('derives navigable bounds from floor footprint and stage objects with inset margin', () => {
    const project = createDefaultProject();
    const bounds = computeSceneFlyBounds(project.scene, { margin: [2, 1, 2] });

    expect(bounds.min[0]).toBeCloseTo(-6 + 2, 5);
    expect(bounds.max[0]).toBeCloseTo(6 - 2, 5);
    expect(bounds.min[2]).toBeCloseTo(-6 + 2, 5);
    expect(bounds.max[2]).toBeLessThan(4.5);
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
      margin: [0, 0, 0],
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
      margin: [0, 0, 0],
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

  it('clamps sustained forward movement before the central front wall and gate', () => {
    const project = createDefaultProject();
    const bounds = computeSceneFlyBounds(project.scene);
    const clamped = clampFlyCameraPosition([0, project.scene.panoOrigin[1], 100], bounds);

    expect(clamped[2]).toBeLessThan(4.5);
    expect(clamped[2]).toBeGreaterThan(3.5);
    expect(bounds.max[2]).toBeLessThan(4.5);
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