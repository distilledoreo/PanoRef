import {
  Euler,
  LocationProject,
  PanoReference,
  ProjectedStyleSettings,
  ProjectionAlignment,
  Vec3,
} from '../domain/types';
import { findProjectionAlignmentForPano, normalizeProjectedStyleSettings } from '../domain/defaults';
import { isEligibleProjectedStylePano, listEligibleProjectedStylePanos } from './projectedStyle';
import { acquireProjectionWarpTexture, type WarpTextureResult } from './projectionWarpTexture';
import { degreesToRadians, length, subtract } from './sync';

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
    + 'will not move those panoramas with it. Projected appearance is locked to each panorama’s own origin, '
    + 'so the projection can look off or inaccurate relative to the new capture origin. '
    + 'Continue only if you intend to capture additional panoramas from a new origin.'
  );
}

export function countStyledPanoramas(project: Pick<LocationProject, 'panoRefs'>): number {
  return project.panoRefs.filter(isEligibleProjectedStylePano).length;
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
  // Auto-pick a secondary when using a dual mode and none set.
  if (!secondary && primary && (blendMode === 'primary_dominant' || blendMode === 'secondary_dominant' || blendMode === 'secondary_only')) {
    secondary = eligible.find((pano) => pano.id !== primary!.id)
      ?? all.find((pano) => pano.id !== primary!.id);
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

/**
 * Explicit warp-map resolution quality buckets. The previous implementation
 * derived runtime resolution from the source pano dimensions (÷16, capped at
 * 512×256), which left the common 4096×2048 panorama at 256×128 — effectively
 * preview quality even for the live viewport. Using explicit buckets keeps
 * preview cheap and promotes the runtime path to a fixed 512×256.
 */
export type WarpRenderQuality = 'preview' | 'runtime';

const WARP_QUALITY_DIMENSIONS: Record<WarpRenderQuality, { width: number; height: number }> = {
  preview: { width: 256, height: 128 },
  runtime: { width: 512, height: 256 },
};

function warpDimensionsForQuality(quality: WarpRenderQuality): { width: number; height: number } {
  return WARP_QUALITY_DIMENSIONS[quality];
}

/**
 * Result of validating a warp resolve request against the project. Each
 * failure explains why no warp can be produced so callers can surface a
 * sensible diagnostic instead of silently falling back to identity.
 */
interface WarpResolveValidation {
  ok: boolean;
  reason?:
    | 'no_alignment'
    | 'no_source_pano'
    | 'no_source_image_asset'
    | 'no_target_pano'
    | 'no_target_image_asset'
    | 'wrong_target_pano_type'
    | 'no_enabled_pairs'
    | 'no_source_dimensions';
  alignment?: ProjectionAlignment;
  sourcePano?: PanoReference;
  targetPano?: PanoReference;
}

function validateWarpResolve(
  project: LocationProject,
  settings: ProjectedStyleSettings,
  sourcePanoId: string,
): WarpResolveValidation {
  const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);
  if (!alignment) {
    return { ok: false, reason: 'no_alignment' };
  }
  const sourcePano = project.panoRefs.find((p) => p.id === sourcePanoId);
  if (!sourcePano) {
    return { ok: false, reason: 'no_source_pano' };
  }
  // Source panorama must have a usable image asset.
  const sourceAssetUri = project.assets.assets[sourcePano.imageAssetId]?.uri;
  if (!sourceAssetUri) {
    return { ok: false, reason: 'no_source_image_asset' };
  }
  // Target panorama must exist…
  const targetPano = project.panoRefs.find((p) => p.id === alignment.targetGrayboxPanoId);
  if (!targetPano) {
    return { ok: false, reason: 'no_target_pano' };
  }
  // …and must be a graybox_render (the solver aligns styled source → graybox target).
  if (targetPano.type !== 'graybox_render') {
    return { ok: false, reason: 'wrong_target_pano_type' };
  }
  // …and its image asset must be reachable.
  const targetAssetUri = project.assets.assets[targetPano.imageAssetId]?.uri;
  if (!targetAssetUri) {
    return { ok: false, reason: 'no_target_image_asset' }
  }
  if (!alignment.pairs.some((p) => p.enabled)) {
    return { ok: false, reason: 'no_enabled_pairs' };
  }
  if (!sourcePano.width || !sourcePano.height) {
    return { ok: false, reason: 'no_source_dimensions' };
  }
  return { ok: true, alignment, sourcePano, targetPano };
}

/**
 * Project-aware warp resolver for the runtime/preview paths.
 *
 * Runs the full validation matrix against the project — alignment must exist,
 * source pano and source image asset must be present, target pano must exist
 * and be a graybox_render with its own image asset, at least one pair must be
 * enabled, and the source pano must declare dimensions — and returns a
 * cached warp texture at a fixed quality bucket.
 *
 * On any validation failure this returns undefined; callers fall back to the
 * shader's identity-warp path (no displacement). The previous fallback that
 * silently substituted default 4096×2048 source dimensions is gone — a
 * missing source pano now means "no warp".
 */
export function resolveProjectionWarpForProject(
  project: LocationProject,
  sourcePanoId: string,
  quality: WarpRenderQuality,
): WarpTextureResult | undefined {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const validation = validateWarpResolve(project, settings, sourcePanoId);
  if (!validation.ok || !validation.alignment || !validation.targetPano || !validation.sourcePano) {
    return undefined;
  }

  const { width, height } = warpDimensionsForQuality(quality);
  const sourceYawRadians = degreesToRadians(validation.sourcePano.rotation[1] ?? 0);
  const targetYawRadians = degreesToRadians(validation.targetPano.rotation[1] ?? 0);

  return acquireProjectionWarpTexture({
    alignment: validation.alignment,
    sourceYawRadians,
    targetYawRadians,
    width,
    height,
  });
}

/** Alignment strength (0..1) carried alongside the warp texture. */
export interface ResolvedWarpWithStrength {
  warp: WarpTextureResult;
  strength: number;
}

/**
 * Like {@link resolveProjectionWarpForProject} but also returns the
 * alignment's saved strength so live rendering and offline exports consume
 * the same warp-strength value instead of the viewport hardcoding 1.
 */
export function resolveProjectionWarpWithStrengthForProject(
  project: LocationProject,
  sourcePanoId: string,
  quality: WarpRenderQuality,
): ResolvedWarpWithStrength | undefined {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const validation = validateWarpResolve(project, settings, sourcePanoId);
  if (!validation.ok || !validation.alignment || !validation.targetPano || !validation.sourcePano) {
    return undefined;
  }

  const { width, height } = warpDimensionsForQuality(quality);
  const sourceYawRadians = degreesToRadians(validation.sourcePano.rotation[1] ?? 0);
  const targetYawRadians = degreesToRadians(validation.targetPano.rotation[1] ?? 0);

  const warp = acquireProjectionWarpTexture({
    alignment: validation.alignment,
    sourceYawRadians,
    targetYawRadians,
    width,
    height,
  });
  return { warp, strength: validation.alignment.strength };
}

/**
 * Resolve a warp map texture for a given projector pano.
 * Finds the alignment, runs the RBF solver, and creates/returns a cached warp texture.
 * Returns undefined when no alignment exists (shader will fall back to identity warp).
 *
 * @deprecated Prefer {@link resolveProjectionWarpForProject} or
 * {@link resolveProjectionWarpWithStrengthForProject}; they validate the full
 * project and use explicit quality buckets instead of ÷16-from-source.
 */
export function resolveProjectionWarpForPano(
  settings: ProjectedStyleSettings,
  sourcePanoId: string,
  sourceRotation: Euler,
  panoRefs: PanoReference[],
  width?: number,
  height?: number,
): WarpTextureResult | undefined {
  const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);
  if (!alignment) return undefined;

  const sourcePano = panoRefs.find((p) => p.id === sourcePanoId);
  const targetPano = panoRefs.find((p) => p.id === alignment.targetGrayboxPanoId);
  if (!targetPano) return undefined;

  const warpWidth = width ?? WARP_QUALITY_DIMENSIONS.runtime.width;
  const warpHeight = height ?? WARP_QUALITY_DIMENSIONS.runtime.height;
  if (!Number.isFinite(warpWidth) || !Number.isFinite(warpHeight)) return undefined;

  const sourceYawRadians = degreesToRadians(sourceRotation[1] ?? 0);
  const targetYawRadians = degreesToRadians(targetPano.rotation[1] ?? 0);

  return acquireProjectionWarpTexture({
    alignment,
    sourceYawRadians,
    targetYawRadians,
    width: warpWidth,
    height: warpHeight,
  });
}
