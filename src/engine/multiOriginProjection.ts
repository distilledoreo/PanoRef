import {
  Euler,
  LocationProject,
  PanoReference,
  ProjectedStyleSettings,
  Vec3,
} from '../domain/types';
import { normalizeProjectedStyleSettings } from '../domain/defaults';
import { isEligibleProjectedStylePano, listEligibleProjectedStylePanos } from './projectedStyle';
import { length, subtract } from './sync';

/**
 * Multi-origin projector blend modes (depth-free approximation).
 * "Dominant + fill" uses inverse-distance weights biased toward the dominant origin.
 */
export type ProjectorBlendMode =
  | 'primary_only'
  | 'secondary_only'
  | 'primary_dominant'
  | 'secondary_dominant';

export const PROJECTOR_BLEND_MODE_LABELS: Record<ProjectorBlendMode, string> = {
  primary_only: 'Only primary panorama',
  secondary_only: 'Only secondary panorama',
  primary_dominant: 'Primary dominant · secondary fill far from primary',
  secondary_dominant: 'Secondary dominant · primary fill far from secondary',
};

export const DEFAULT_PROJECTOR_BLEND_MODE: ProjectorBlendMode = 'primary_only';

const BLEND_MODES = new Set<ProjectorBlendMode>([
  'primary_only',
  'secondary_only',
  'primary_dominant',
  'secondary_dominant',
]);

/** True when moving the scene capture origin may desync projection from styled panos. */
export function shouldWarnOnOriginMove(project: Pick<LocationProject, 'panoRefs'>): boolean {
  return project.panoRefs.some((pano) => isEligibleProjectedStylePano(pano));
}

export function originMoveWarningMessage(styledCount: number): string {
  const n = Math.max(1, styledCount);
  return (
    `Moving the capture origin after ${n === 1 ? 'a reference panorama is' : `${n} reference panoramas are`} loaded `
    + 'does not move those panoramas — each stays locked to where it was captured. '
    + 'Use this when you want a second vantage to fill weak areas, then import that second panorama in Reference to blend.'
  );
}

export function countStyledPanoramas(project: Pick<LocationProject, 'panoRefs'>): number {
  return project.panoRefs.filter(isEligibleProjectedStylePano).length;
}

/** Capture origin is treated as "same spot" as a pano when within this distance (meters). */
export const CAPTURE_ORIGIN_NEAR_METERS = 0.25;

export type StyledImportMode = 'first' | 'replace' | 'add_secondary';

export function primaryStyledPano(
  project: Pick<LocationProject, 'panoRefs' | 'settings'>,
): PanoReference | undefined {
  const settings = normalizeProjectedStyleSettings(project.settings?.projectedStyle);
  if (settings.panoId) {
    const explicit = project.panoRefs.find(
      (pano) => pano.id === settings.panoId && isEligibleProjectedStylePano(pano),
    );
    if (explicit) return explicit;
  }
  return project.panoRefs.find((pano) => pano.isCanonical && isEligibleProjectedStylePano(pano))
    ?? project.panoRefs.find((pano) => isEligibleProjectedStylePano(pano));
}

export function isCaptureOriginNearPano(
  captureOrigin: Vec3,
  pano: Pick<PanoReference, 'origin'>,
  nearMeters = CAPTURE_ORIGIN_NEAR_METERS,
): boolean {
  return length(subtract(captureOrigin, pano.origin)) <= nearMeters;
}

/**
 * Decide whether the next styled import replaces the reference or adds a blend partner.
 * Same capture origin as the primary styled pano → replace; moved → add secondary.
 */
export function resolveStyledImportMode(
  project: Pick<LocationProject, 'panoRefs' | 'settings' | 'scene'>,
): StyledImportMode {
  const primary = primaryStyledPano(project);
  if (!primary) return 'first';
  if (isCaptureOriginNearPano(project.scene.panoOrigin, primary)) return 'replace';
  return 'add_secondary';
}

export function styledImportActionLabel(mode: StyledImportMode): string {
  switch (mode) {
    case 'first':
      return 'Import styled pano';
    case 'replace':
      return 'Replace reference';
    case 'add_secondary':
      return 'Add second capture';
  }
}

export function styledImportActionHint(mode: StyledImportMode): string {
  switch (mode) {
    case 'first':
      return 'Import a styled 360 to use as your reference.';
    case 'replace':
      return 'Capture hasn’t moved — this import replaces the current reference.';
    case 'add_secondary':
      return 'Origin moved — this import adds a blend partner at the new capture point.';
  }
}

export function normalizeProjectorBlendMode(
  mode: string | undefined | null,
): ProjectorBlendMode {
  if (mode && BLEND_MODES.has(mode as ProjectorBlendMode)) {
    return mode as ProjectorBlendMode;
  }
  return DEFAULT_PROJECTOR_BLEND_MODE;
}

export interface ProjectorPose {
  panoId: string;
  origin: Vec3;
  rotation: Euler;
}

/** Resolve frozen projector pose from the pano reference itself (never scene origin). */
export function resolveProjectorPose(pano: PanoReference): ProjectorPose {
  return {
    panoId: pano.id,
    origin: [...pano.origin] as Vec3,
    rotation: [...pano.rotation] as Euler,
  };
}

/**
 * Inverse-distance confidence for a world sample relative to a projector origin.
 * Near origin → ~1; far → approaches 0. Deterministic, depth-free proxy for “usable from this pano.”
 */
export function projectorConfidence(
  worldPosition: Vec3,
  origin: Vec3,
  falloffMeters = 6,
): number {
  const distance = length(subtract(worldPosition, origin));
  const falloff = Math.max(0.25, falloffMeters);
  // Soft falloff: 1 at 0m, ~0.5 at falloff, approaches 0 far away.
  return falloff / (falloff + distance);
}

/**
 * Blend weights for primary/secondary projectors.
 * Returns wPrimary in [0,1]; secondary weight is 1 - wPrimary when both active.
 */
export function computeProjectorBlendWeights(params: {
  worldPosition: Vec3;
  primaryOrigin: Vec3;
  secondaryOrigin?: Vec3;
  mode: ProjectorBlendMode;
  falloffMeters?: number;
}): { wPrimary: number; wSecondary: number } {
  const mode = normalizeProjectorBlendMode(params.mode);
  if (mode === 'primary_only' || !params.secondaryOrigin) {
    return { wPrimary: 1, wSecondary: 0 };
  }
  if (mode === 'secondary_only') {
    return { wPrimary: 0, wSecondary: 1 };
  }

  const confPrimary = projectorConfidence(
    params.worldPosition,
    params.primaryOrigin,
    params.falloffMeters,
  );
  const confSecondary = projectorConfidence(
    params.worldPosition,
    params.secondaryOrigin,
    params.falloffMeters,
  );
  const total = confPrimary + confSecondary;
  if (total <= 1e-8) {
    return mode === 'primary_dominant'
      ? { wPrimary: 1, wSecondary: 0 }
      : { wPrimary: 0, wSecondary: 1 };
  }

  // Base inverse-confidence mix, then bias toward the dominant projector.
  let wPrimary = confPrimary / total;
  if (mode === 'primary_dominant') {
    // When primary is strong, use it almost exclusively; fill with secondary only when primary is weak.
    wPrimary = confPrimary >= confSecondary
      ? Math.min(1, 0.55 + confPrimary * 0.55)
      : confPrimary / total;
  } else {
    // secondary_dominant
    wPrimary = confSecondary >= confPrimary
      ? Math.max(0, 0.45 - confSecondary * 0.45)
      : confPrimary / total;
  }
  wPrimary = Math.min(1, Math.max(0, wPrimary));
  return { wPrimary, wSecondary: 1 - wPrimary };
}

export interface ResolvedProjectors {
  primary?: PanoReference;
  secondary?: PanoReference;
  blendMode: ProjectorBlendMode;
}

/**
 * Resolve primary/secondary projectors from settings.
 * Primary defaults to explicit panoId / canonical styled / first eligible.
 * Secondary is explicit secondaryPanoId when different from primary and present.
 */
export function resolveProjectors(
  project: LocationProject,
  settings?: Partial<ProjectedStyleSettings> | null,
): ResolvedProjectors {
  const blendMode = normalizeProjectorBlendMode(settings?.blendMode);
  const eligible = listEligibleProjectedStylePanos(project);
  const all = project.panoRefs;

  const findPano = (id?: string) => (id ? all.find((pano) => pano.id === id) : undefined);

  let primary = findPano(settings?.panoId);
  if (!primary) {
    primary = all.find((pano) => pano.isCanonical && isEligibleProjectedStylePano(pano))
      ?? eligible[0]
      ?? all[0];
  }

  let secondary = findPano(settings?.secondaryPanoId);
  if (secondary && primary && secondary.id === primary.id) {
    secondary = undefined;
  }
  // Auto-pick a secondary when using a dual mode and none set (never auto-pick graybox).
  if (!secondary && primary && (blendMode === 'primary_dominant' || blendMode === 'secondary_dominant' || blendMode === 'secondary_only')) {
    secondary = eligible.find((pano) => pano.id !== primary!.id);
  }

  if (blendMode === 'secondary_only' && !secondary) {
    return { primary, secondary: undefined, blendMode: 'primary_only' };
  }

  return { primary, secondary, blendMode };
}

/** Whether dual-projector blending can run (two distinct panos with assets). */
export function canUseDualProjectorBlend(project: LocationProject, settings?: Partial<ProjectedStyleSettings> | null): boolean {
  const resolved = resolveProjectors(project, settings);
  if (!resolved.primary || !resolved.secondary) return false;
  const a = project.assets.assets[resolved.primary.imageAssetId]?.uri;
  const b = project.assets.assets[resolved.secondary.imageAssetId]?.uri;
  return Boolean(a && b);
}

/**
 * Resolve projector assets for viewport/export projected appearance.
 * Secondary is only included when the blend mode needs it and the asset URI exists.
 */
export function resolveProjectedProjectorAssets(
  project: LocationProject,
  settings?: Partial<ProjectedStyleSettings> | null,
): {
  primary: PanoReference;
  primaryUrl: string;
  secondary?: PanoReference;
  secondaryUrl?: string;
  blendMode: ProjectorBlendMode;
  settings: ProjectedStyleSettings;
} | undefined {
  const normalized = normalizeProjectedStyleSettings(settings ?? project.settings.projectedStyle);
  const resolved = resolveProjectors(project, normalized);
  if (!resolved.primary) return undefined;
  const primaryUrl = project.assets.assets[resolved.primary.imageAssetId]?.uri;
  if (!primaryUrl) return undefined;

  const needsSecondary = resolved.blendMode !== 'primary_only' && Boolean(resolved.secondary);
  let secondaryUrl: string | undefined;
  if (needsSecondary && resolved.secondary) {
    secondaryUrl = project.assets.assets[resolved.secondary.imageAssetId]?.uri;
  }

  return {
    primary: resolved.primary,
    primaryUrl,
    secondary: secondaryUrl ? resolved.secondary : undefined,
    secondaryUrl,
    blendMode: resolved.blendMode,
    settings: {
      ...normalized,
      panoId: resolved.primary.id,
      secondaryPanoId: secondaryUrl && resolved.secondary ? resolved.secondary.id : undefined,
      blendMode: secondaryUrl ? resolved.blendMode : 'primary_only',
    },
  };
}
