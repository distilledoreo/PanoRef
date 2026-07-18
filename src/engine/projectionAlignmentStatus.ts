import { findProjectionAlignmentForPano, normalizeProjectedStyleSettings } from '../domain/defaults';
import { LocationProject, ProjectionAlignment } from '../domain/types';
import type { ProjectionAlignmentDiagnostics } from './projectionAlignmentDiagnostics';

export type ProjectionAlignmentState =
  | 'none'
  | 'ready'
  | 'stale'
  | 'conflicting'
  | 'error';

export interface ProjectionAlignmentStatus {
  state: ProjectionAlignmentState;
  pairCount: number;
  enabledPairCount: number;
  conflictCount: number;
  maxMarkerErrorRadians?: number;
  message: string;
}

function emptyStatus(
  state: ProjectionAlignmentState,
  message: string,
  pairCount = 0,
  enabledPairCount = 0,
  conflictCount = 0,
): ProjectionAlignmentStatus {
  return { state, pairCount, enabledPairCount, conflictCount, message };
}

function matchLabel(count: number): string {
  return `${count} match${count === 1 ? '' : 'es'}`;
}

function alignmentCounts(alignment: ProjectionAlignment) {
  return {
    pairCount: alignment.pairs.length,
    enabledPairCount: alignment.pairs.filter((pair) => pair.enabled).length,
  };
}

/** Resolve the structural and optionally deferred diagnostic state for one source alignment. */
export function projectionAlignmentStatusForAlignment(
  project: LocationProject,
  sourcePanoId: string,
  alignment: ProjectionAlignment,
  diagnostics?: ProjectionAlignmentDiagnostics,
): ProjectionAlignmentStatus {
  const counts = alignmentCounts(alignment);
  if (counts.enabledPairCount === 0) {
    return emptyStatus('none', 'No local fit', counts.pairCount, counts.enabledPairCount);
  }

  const sourcePano = project.panoRefs.find((pano) => pano.id === sourcePanoId);
  const sourceAsset = sourcePano
    ? project.assets.assets[sourcePano.imageAssetId]
    : undefined;
  const targetPano = project.panoRefs.find((pano) => pano.id === alignment.targetGrayboxPanoId);
  const targetAsset = targetPano
    ? project.assets.assets[targetPano.imageAssetId]
    : undefined;

  if (
    !sourcePano
    || alignment.sourcePanoId !== sourcePanoId
    || !sourceAsset?.uri
    || !targetPano
    || targetPano.type !== 'graybox_render'
    || !targetAsset?.uri
    || !sourcePano.width
    || !sourcePano.height
  ) {
    return emptyStatus(
      'stale',
      'Local fit needs attention',
      counts.pairCount,
      counts.enabledPairCount,
    );
  }

  const conflictCount = diagnostics?.conflictCount ?? 0;
  if (conflictCount > 0) {
    return {
      state: 'conflicting',
      pairCount: counts.pairCount,
      enabledPairCount: counts.enabledPairCount,
      conflictCount,
      maxMarkerErrorRadians: diagnostics?.maxMarkerErrorRadians,
      message: `${conflictCount} match${conflictCount === 1 ? '' : 'es'} conflict`,
    };
  }

  return {
    state: 'ready',
    pairCount: counts.pairCount,
    enabledPairCount: counts.enabledPairCount,
    conflictCount: 0,
    maxMarkerErrorRadians: diagnostics?.maxMarkerErrorRadians,
    message: matchLabel(counts.enabledPairCount),
  };
}

/**
 * Resolve the user-facing state without acquiring a runtime warp texture.
 * Conflict diagnostics can be supplied by a deferred preview-resolution
 * computation when a panel or editor needs them.
 */
export function projectionAlignmentStatusForPano(
  project: LocationProject,
  sourcePanoId: string,
  diagnostics?: ProjectionAlignmentDiagnostics,
): ProjectionAlignmentStatus {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);
  if (!alignment) return emptyStatus('none', 'No local fit');
  return projectionAlignmentStatusForAlignment(project, sourcePanoId, alignment, diagnostics);
}
