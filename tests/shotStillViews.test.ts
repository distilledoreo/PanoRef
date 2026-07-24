import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset } from '../src/domain/defaults';
import {
  hasShotStillViewVariants,
  listAvailableShotStillViews,
  resolvePreferredShotStillView,
  resolveShotStillView,
  shotStillViewAssetKey,
  shotStillViewLabel,
} from '../src/domain/shotStillViews';

describe('shotStillViews', () => {
  it('maps selection keys to asset slots', () => {
    expect(shotStillViewAssetKey({ appearance: 'clay', people: 'with_people' })).toBe('viewportRenderAssetId');
    expect(shotStillViewAssetKey({ appearance: 'clay', people: 'clean_plate' })).toBe('viewportCleanPlateAssetId');
    expect(shotStillViewAssetKey({ appearance: 'projected', people: 'with_people' })).toBe('viewportProjectedAssetId');
    expect(shotStillViewAssetKey({ appearance: 'projected', people: 'clean_plate' })).toBe('viewportProjectedCleanPlateAssetId');
    expect(shotStillViewLabel({ appearance: 'projected', people: 'clean_plate' })).toBe('Projected · clean plate');
  });

  it('lists available still views and falls back when a preferred view is missing', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const clay = createPanoAsset({
      name: 'clay.png',
      uri: 'data:image/png;base64,CLAY',
      width: 100,
      height: 100,
    });
    const projectedClean = createPanoAsset({
      name: 'projected_clean.png',
      uri: 'data:image/png;base64,PROJECTED_CLEAN',
      width: 100,
      height: 100,
    });
    project.assets.assets[clay.id] = clay;
    project.assets.assets[projectedClean.id] = projectedClean;
    shot.assets.viewportRenderAssetId = clay.id;
    shot.assets.viewportProjectedCleanPlateAssetId = projectedClean.id;

    expect(listAvailableShotStillViews(project, shot)).toEqual([
      { appearance: 'clay', people: 'with_people' },
      { appearance: 'projected', people: 'clean_plate' },
    ]);
    expect(hasShotStillViewVariants(project, shot)).toBe(true);
    expect(resolveShotStillView(project, shot, { appearance: 'projected', people: 'with_people' })).toBeUndefined();
    expect(resolvePreferredShotStillView(project, shot, {
      appearance: 'projected',
      people: 'with_people',
    })?.asset.uri).toContain('CLAY');
    expect(resolvePreferredShotStillView(project, shot, {
      appearance: 'projected',
      people: 'clean_plate',
    })?.asset.uri).toContain('PROJECTED_CLEAN');
  });
});
