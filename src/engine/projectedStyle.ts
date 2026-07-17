import {
  LocationProject,
  PanoReference,
  ProjectionAlignment,
  ProjectionControlPair,
  Vec3,
} from '../domain/types';
import { findProjectionAlignmentForPano, normalizeProjectedStyleSettings } from '../domain/defaults';
import { length, subtract } from './sync';

export type ViewportAppearanceMode = 'clay' | 'projected';
export { findProjectionAlignmentForPano, normalizeProjectedStyleSettings };

/** Styled / imported panos preferred for projection (not the graybox render by default). */
export function isEligibleProjectedStylePano(pano: PanoReference): boolean {
  return pano.type !== 'graybox_render';
}

export function listEligibleProjectedStylePanos(project: LocationProject): PanoReference[] {
  return project.panoRefs.filter(isEligibleProjectedStylePano);
}

/**
 * Resolve the panorama to project:
 * 1. Explicit projectedStyle.panoId when still present and eligible (or any present pano if user picked graybox).
 * 2. Canonical non-graybox styled pano.
 * 3. First eligible styled pano.
 */
export function resolveProjectedStylePano(project: LocationProject): PanoReference | undefined {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  if (settings.panoId) {
    const explicit = project.panoRefs.find((pano) => pano.id === settings.panoId);
    if (explicit) return explicit;
  }
  const styledCanonical = project.panoRefs.find(
    (pano) => pano.isCanonical && isEligibleProjectedStylePano(pano),
  );
  if (styledCanonical) return styledCanonical;
  return listEligibleProjectedStylePanos(project)[0];
}

export function canUseProjectedAppearance(project: LocationProject): boolean {
  const pano = resolveProjectedStylePano(project);
  if (!pano) return false;
  return Boolean(project.assets.assets[pano.imageAssetId]?.uri);
}

export function getProjectedStyleAssetUri(
  project: LocationProject,
  pano = resolveProjectedStylePano(project),
): string | undefined {
  if (!pano) return undefined;
  return project.assets.assets[pano.imageAssetId]?.uri;
}

/** Distance from a world point to the projector origin (for diagnostics / near-origin checks). */
export function distanceToProjectorOrigin(worldPosition: Vec3, pano: PanoReference): number {
  return length(subtract(worldPosition, pano.origin));
}

export function projectedStyleStatusLabel(project: LocationProject): {
  available: boolean;
  panoName?: string;
  originLabel: string;
  reason?: string;
} {
  const pano = resolveProjectedStylePano(project);
  if (!pano) {
    return {
      available: false,
      originLabel: '—',
      reason: 'Import and align a styled panorama first.',
    };
  }
  if (!project.assets.assets[pano.imageAssetId]?.uri) {
    return {
      available: false,
      panoName: pano.name,
      originLabel: formatOrigin(pano.origin),
      reason: 'Projected panorama asset is missing.',
    };
  }
  return {
    available: true,
    panoName: pano.name,
    originLabel: formatOrigin(pano.origin),
  };
}

export interface AlignmentStatus {
  state: 'valid' | 'stale' | 'missing' | 'disabled';
  pairCount: number;
  enabledPairCount: number;
  conflictCount: number;
  message: string;
}

export function isProjectionAlignmentCurrent(
  project: LocationProject,
  alignment: ProjectionAlignment,
): boolean {
  const sourcePano = project.panoRefs.find((p) => p.id === alignment.sourcePanoId);
  if (!sourcePano) return false;
  const targetPano = project.panoRefs.find((p) => p.id === alignment.targetGrayboxPanoId);
  if (!targetPano) return false;
  const assetUri = project.assets.assets[sourcePano.imageAssetId]?.uri;
  if (!assetUri) return false;
  return true;
}

export function projectionAlignmentStatusForPano(
  project: LocationProject,
  sourcePanoId: string,
): AlignmentStatus {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);

  if (!alignment) {
    return {
      state: 'missing',
      pairCount: 0,
      enabledPairCount: 0,
      conflictCount: 0,
      message: 'No local fit configured for this panorama.',
    };
  }

  if (!isProjectionAlignmentCurrent(project, alignment)) {
    const sourceMissing = !project.panoRefs.find((p) => p.id === alignment.sourcePanoId);
    const targetMissing = !project.panoRefs.find((p) => p.id === alignment.targetGrayboxPanoId);
    if (sourceMissing) {
      return {
        state: 'stale',
        pairCount: alignment.pairs.length,
        enabledPairCount: alignment.pairs.filter((p) => p.enabled).length,
        conflictCount: 0,
        message: 'Source panorama has been removed. Recreate the local fit.',
      };
    }
    if (targetMissing) {
      return {
        state: 'stale',
        pairCount: alignment.pairs.length,
        enabledPairCount: alignment.pairs.filter((p) => p.enabled).length,
        conflictCount: 0,
        message: 'Graybox render has changed. Recreate the local fit.',
      };
    }
    return {
      state: 'stale',
      pairCount: alignment.pairs.length,
      enabledPairCount: alignment.pairs.filter((p) => p.enabled).length,
      conflictCount: 0,
      message: 'Local fit assets are missing.',
    };
  }

  const enabledPairs = alignment.pairs.filter((p) => p.enabled);
  if (enabledPairs.length === 0) {
    return {
      state: 'disabled',
      pairCount: alignment.pairs.length,
      enabledPairCount: 0,
      conflictCount: 0,
      message: 'All control pairs are disabled. Enable at least one pair to apply the local fit.',
    };
  }

  return {
    state: 'valid',
    pairCount: alignment.pairs.length,
    enabledPairCount: enabledPairs.length,
    conflictCount: 0,
    message: `${enabledPairs.length} control pair${enabledPairs.length !== 1 ? 's' : ''} active.`,
  };
}

function formatOrigin(origin: Vec3): string {
  return `${origin[0].toFixed(2)}, ${origin[1].toFixed(2)}, ${origin[2].toFixed(2)} m`;
}
