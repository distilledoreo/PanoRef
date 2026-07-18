import {
  findProjectionAlignmentForPano,
  normalizeProjectedStyleSettings,
} from '../domain/defaults';
import {
  LocationProject,
  ProjectionAlignment,
} from '../domain/types';
import {
  angularDistanceRadians,
  equirectUvToUnitDirection,
} from './projectionAlignmentMath';
import { solveProjectionWarp } from './projectionAlignmentSolver';
import { degreesToRadians } from './sync';

const DIAGNOSTIC_WIDTH = 256;
const DIAGNOSTIC_HEIGHT = 128;
const CONFLICT_TARGET_DISTANCE_RADIANS = 3 * Math.PI / 180;
const CONFLICT_SOURCE_DISTANCE_RADIANS = 12 * Math.PI / 180;

export interface ProjectionAlignmentDiagnostics {
  conflictingPairIds: string[];
  conflictCount: number;
  maxMarkerErrorRadians: number;
  maximumRotationRadians: number;
}

function enabledPairs(alignment: ProjectionAlignment) {
  return alignment.pairs.filter((pair) => pair.enabled);
}

function conflictingPairIds(alignment: ProjectionAlignment): { ids: string[]; count: number } {
  const pairs = enabledPairs(alignment);
  const targetDirections = pairs.map((pair) => equirectUvToUnitDirection(pair.targetUv));
  const sourceDirections = pairs.map((pair) => equirectUvToUnitDirection(pair.sourceUv));
  const ids = new Set<string>();
  let count = 0;

  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const targetDistance = angularDistanceRadians(targetDirections[i], targetDirections[j]);
      const sourceDistance = angularDistanceRadians(sourceDirections[i], sourceDirections[j]);
      if (
        targetDistance < CONFLICT_TARGET_DISTANCE_RADIANS
        && sourceDistance > CONFLICT_SOURCE_DISTANCE_RADIANS
      ) {
        count += 1;
        ids.add(pairs[i].id);
        ids.add(pairs[j].id);
      }
    }
  }

  return { ids: Array.from(ids), count };
}

function panoForAlignment(
  project: LocationProject,
  alignment: ProjectionAlignment,
): { source: LocationProject['panoRefs'][number]; target: LocationProject['panoRefs'][number] } | undefined {
  const source = project.panoRefs.find((pano) => pano.id === alignment.sourcePanoId);
  const target = project.panoRefs.find((pano) => pano.id === alignment.targetGrayboxPanoId);
  if (!source || !target || target.type !== 'graybox_render') return undefined;
  if (!project.assets.assets[source.imageAssetId]?.uri || !project.assets.assets[target.imageAssetId]?.uri) {
    return undefined;
  }
  return { source, target };
}

/**
 * Compute editor/panel diagnostics without acquiring a GPU texture.
 * The preview bucket is sufficient for conflict and marker-error feedback,
 * and this function is intended to run from an effect or an explicit editor
 * refresh rather than during ordinary React rendering.
 */
export function projectionAlignmentDiagnosticsForAlignment(
  project: LocationProject,
  alignment: ProjectionAlignment,
): ProjectionAlignmentDiagnostics | undefined {
  const panos = panoForAlignment(project, alignment);
  if (!panos) return undefined;

  const field = solveProjectionWarp(alignment, {
    width: DIAGNOSTIC_WIDTH,
    height: DIAGNOSTIC_HEIGHT,
    sourceYawRadians: degreesToRadians(panos.source.rotation[1] ?? 0),
    targetYawRadians: degreesToRadians(panos.target.rotation[1] ?? 0),
  });
  const conflict = conflictingPairIds(alignment);
  return {
    conflictingPairIds: conflict.ids,
    conflictCount: conflict.count,
    maxMarkerErrorRadians: field.maxMarkerErrorRadians,
    maximumRotationRadians: field.maximumRotationRadians,
  };
}

export function projectionAlignmentDiagnosticsForPano(
  project: LocationProject,
  sourcePanoId: string,
): ProjectionAlignmentDiagnostics | undefined {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);
  return alignment
    ? projectionAlignmentDiagnosticsForAlignment(project, alignment)
    : undefined;
}

/** Stable key for deferring diagnostics until relevant alignment inputs change. */
export function projectionAlignmentDiagnosticsKey(
  project: LocationProject,
  sourcePanoId: string,
  alignment: ProjectionAlignment | undefined,
): string {
  const source = project.panoRefs.find((pano) => pano.id === sourcePanoId);
  const target = alignment
    ? project.panoRefs.find((pano) => pano.id === alignment.targetGrayboxPanoId)
    : undefined;
  return JSON.stringify({
    sourcePanoId,
    sourceRotation: source?.rotation,
    sourceAssetId: source?.imageAssetId,
    targetPanoId: alignment?.targetGrayboxPanoId,
    targetRotation: target?.rotation,
    targetAssetId: target?.imageAssetId,
    alignment: alignment
      ? {
          sourcePanoId: alignment.sourcePanoId,
          targetGrayboxPanoId: alignment.targetGrayboxPanoId,
          pairs: alignment.pairs,
        }
      : undefined,
  });
}
