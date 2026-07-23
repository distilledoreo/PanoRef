import type { LocationProject, ProjectAsset, Shot, ShotAssetRefs } from './types';

export type ShotStillAppearance = 'clay' | 'projected';
export type ShotStillPeople = 'with_people' | 'clean_plate';

export interface ShotStillViewSelection {
  appearance: ShotStillAppearance;
  people: ShotStillPeople;
}

export type ShotStillViewKey = `${ShotStillAppearance}_${ShotStillPeople}`;

export const SHOT_STILL_VIEW_ASSET_KEYS: Record<ShotStillViewKey, keyof ShotAssetRefs> = {
  clay_with_people: 'viewportRenderAssetId',
  clay_clean_plate: 'viewportCleanPlateAssetId',
  projected_with_people: 'viewportProjectedAssetId',
  projected_clean_plate: 'viewportProjectedCleanPlateAssetId',
};

export function shotStillViewKey(selection: ShotStillViewSelection): ShotStillViewKey {
  return `${selection.appearance}_${selection.people}`;
}

export function shotStillViewAssetKey(selection: ShotStillViewSelection): keyof ShotAssetRefs {
  return SHOT_STILL_VIEW_ASSET_KEYS[shotStillViewKey(selection)];
}

export function shotStillViewLabel(selection: ShotStillViewSelection): string {
  const appearance = selection.appearance === 'projected' ? 'Projected' : 'Clay';
  const people = selection.people === 'clean_plate' ? 'clean plate' : 'with people';
  return `${appearance} · ${people}`;
}

export function listAvailableShotStillViews(
  project: LocationProject,
  shot: Shot,
): ShotStillViewSelection[] {
  const views: ShotStillViewSelection[] = [];
  for (const appearance of ['clay', 'projected'] as const) {
    for (const people of ['with_people', 'clean_plate'] as const) {
      if (resolveShotStillView(project, shot, { appearance, people })) {
        views.push({ appearance, people });
      }
    }
  }
  return views;
}

export function hasShotStillViewVariants(project: LocationProject, shot: Shot): boolean {
  return listAvailableShotStillViews(project, shot).length > 1;
}

export function resolveShotStillView(
  project: LocationProject,
  shot: Shot,
  selection: ShotStillViewSelection,
): { asset: ProjectAsset; selection: ShotStillViewSelection } | undefined {
  const assetId = shot.assets[shotStillViewAssetKey(selection)];
  if (!assetId) return undefined;
  const asset = project.assets.assets[assetId];
  if (!asset) return undefined;
  return { asset, selection };
}

/** Prefer an available still matching the request; fall back to clay/people, then any still. */
export function resolvePreferredShotStillView(
  project: LocationProject,
  shot: Shot,
  preferred: ShotStillViewSelection,
): { asset: ProjectAsset; selection: ShotStillViewSelection } | undefined {
  const exact = resolveShotStillView(project, shot, preferred);
  if (exact) return exact;

  const fallbacks: ShotStillViewSelection[] = [
    { appearance: 'clay', people: 'with_people' },
    { appearance: 'clay', people: 'clean_plate' },
    { appearance: 'projected', people: 'with_people' },
    { appearance: 'projected', people: 'clean_plate' },
  ];
  for (const candidate of fallbacks) {
    const resolved = resolveShotStillView(project, shot, candidate);
    if (resolved) return resolved;
  }
  return undefined;
}
