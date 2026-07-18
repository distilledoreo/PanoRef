import type { ProjectionRegion } from './types';

export interface ProjectionRegionSchemaDiagnostics {
  valid: boolean;
  duplicateVertexIds: string[];
  duplicateConsecutiveVertexIds: string[];
  message?: string;
}

/** Persistence keeps invalid outlines repairable; runtime callers gate on this check. */
export function validateProjectionRegionSchema(region: ProjectionRegion): ProjectionRegionSchemaDiagnostics {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  const consecutive = new Set<string>();
  for (let index = 0; index < region.vertices.length; index += 1) {
    const vertex = region.vertices[index];
    if (ids.has(vertex.id)) duplicates.add(vertex.id);
    ids.add(vertex.id);
    const next = region.vertices[(index + 1) % region.vertices.length];
    if (next && vertex.id === next.id) consecutive.add(vertex.id);
  }
  const finite = region.vertices.every((vertex) =>
    [...vertex.targetUv, ...vertex.sourceUv].every(Number.isFinite));
  const valid = region.vertices.length >= 3 && ids.size >= 3 && duplicates.size === 0 && finite;
  return {
    valid,
    duplicateVertexIds: [...duplicates],
    duplicateConsecutiveVertexIds: [...consecutive],
    message: valid ? undefined : 'Region topology needs attention.',
  };
}
