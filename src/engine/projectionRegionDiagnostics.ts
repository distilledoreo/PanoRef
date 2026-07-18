import type { LocationProject, ProjectionRegionAlignment } from '../domain/types';
import { findProjectionRegionAlignmentForPano, normalizeProjectedStyleSettings } from '../domain/defaults';
import { validateProjectionRegionSchema } from '../domain/schema';
import { diagnoseProjectionRegionPolygon } from './projectionRegionPolygon';
import { regionToCommonPlane } from './projectionRegionCoordinates';
import { createProjectionRegionMesh } from './projectionRegionMesh';
import { degreesToRadians } from './sync';

export type ProjectionRegionStatus = 'none' | 'ready' | 'incomplete' | 'stale' | 'origin-mismatch' | 'too-large' | 'self-intersecting' | 'folded' | 'error';
export interface ProjectionRegionDiagnostics { status: ProjectionRegionStatus; valid: boolean; enabledRegionCount: number; message: string; regionMessages: Record<string, string> }
const messageFor = (status: ProjectionRegionStatus, count: number): string => ({ none: 'No Region Fit', ready: `${count} region${count === 1 ? '' : 's'}`, incomplete: 'Finish adjusting the styled outline', stale: 'Region Fit needs attention', 'origin-mismatch': 'Capture origins do not match', 'too-large': 'Split this into smaller regions', 'self-intersecting': 'This outline crosses itself', folded: 'This region folds over itself', error: 'Region Fit could not be evaluated' }[status]);

export function projectionRegionDiagnosticsForAlignment(project: LocationProject, alignment: ProjectionRegionAlignment | undefined): ProjectionRegionDiagnostics {
  if (!alignment) return { status: 'none', valid: false, enabledRegionCount: 0, message: messageFor('none', 0), regionMessages: {} };
  const enabled = alignment.regions.filter((region) => region.enabled); const source = project.panoRefs.find((pano) => pano.id === alignment.sourcePanoId); const target = project.panoRefs.find((pano) => pano.id === alignment.targetGrayboxPanoId);
  if (!source || !target || target.type !== 'graybox_render' || !project.assets.assets[source.imageAssetId]?.uri || !project.assets.assets[target.imageAssetId]?.uri) return { status: 'stale', valid: false, enabledRegionCount: enabled.length, message: messageFor('stale', enabled.length), regionMessages: {} };
  let status: ProjectionRegionStatus = enabled.length ? 'ready' : 'none'; const regionMessages: Record<string, string> = {};
  try {
    for (const region of enabled) {
      if (!validateProjectionRegionSchema(region).valid) { status = 'incomplete'; regionMessages[region.id] = messageFor(status, enabled.length); break; }
      const polygon = diagnoseProjectionRegionPolygon(region);
      if (polygon.targetSelfIntersects || polygon.sourceSelfIntersects) { status = 'self-intersecting'; regionMessages[region.id] = messageFor(status, enabled.length); break; }
      if (polygon.excessiveAngularExtent) { status = 'too-large'; regionMessages[region.id] = messageFor(status, enabled.length); break; }
      const plane = regionToCommonPlane(region, { sourceYawRadians: degreesToRadians(source.rotation[1] ?? 0), targetYawRadians: degreesToRadians(target.rotation[1] ?? 0), sourceOrigin: source.origin, targetOrigin: target.origin });
      if (!plane.diagnostics.valid) { status = plane.diagnostics.status === 'origin-mismatch' ? 'origin-mismatch' : plane.diagnostics.status === 'too-large' || plane.diagnostics.status === 'unstable-pole' ? 'too-large' : 'error'; regionMessages[region.id] = messageFor(status, enabled.length); break; }
      const mesh = createProjectionRegionMesh(plane.target, plane.source, region.edgeSoftness); if (!mesh.diagnostics.valid) { status = 'folded'; regionMessages[region.id] = messageFor(status, enabled.length); break; }
    }
  } catch { status = 'error'; }
  return { status, valid: status === 'ready', enabledRegionCount: enabled.length, message: messageFor(status, enabled.length), regionMessages };
}

export function projectionRegionDiagnosticsForProject(project: LocationProject, sourcePanoId: string): ProjectionRegionDiagnostics {
  try { return projectionRegionDiagnosticsForAlignment(project, findProjectionRegionAlignmentForPano(normalizeProjectedStyleSettings(project.settings.projectedStyle), sourcePanoId)); } catch { return { status: 'error', valid: false, enabledRegionCount: 0, message: messageFor('error', 0), regionMessages: {} }; }
}
