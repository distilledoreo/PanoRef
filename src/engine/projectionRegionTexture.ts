import type { ProjectionRegionAlignment, Vec2 } from '../domain/types';
import { applyYawRotation, unitDirectionToEquirectUv } from './projectionAlignmentMath';
import { regionToCommonPlane, tangentPlaneToUnitDirection } from './projectionRegionCoordinates';
import { createProjectionRegionMesh, type ProjectionRegionMeshDiagnostics } from './projectionRegionMesh';

export type ProjectionRegionTextureQuality = 'preview' | 'runtime' | 'export';
export const PROJECTION_REGION_TEXTURE_SIZE: Record<ProjectionRegionTextureQuality, [number, number]> = { preview: [256, 128], runtime: [512, 256], export: [1024, 512] };
export const PROJECTION_REGION_ALGORITHM_VERSION = 1;
export interface ProjectionRegionTextureResult { width: number; height: number; displacement: Uint16Array; weight: Uint8Array; diagnostics: ProjectionRegionMeshDiagnostics[]; cacheKey: string; release: () => void }
interface CacheEntry { result: Omit<ProjectionRegionTextureResult, 'release'>; references: number }
const cache = new Map<string, CacheEntry>();
const shortestU = (from: number, to: number) => { let delta = to - from; if (delta > 0.5) delta -= 1; if (delta < -0.5) delta += 1; return delta; };
const encodeU = (delta: number) => Math.round((Math.max(-0.5, Math.min(0.5, delta)) + 0.5) * 65535);
const encodeV = (delta: number) => Math.round((Math.max(-1, Math.min(1, delta)) + 1) * 0.5 * 65535);
export const decodeRegionDisplacement = (u: number, v: number): Vec2 => [u / 65535 - 0.5, (v / 65535) * 2 - 1];

export function projectionRegionTextureCacheKey(alignment: ProjectionRegionAlignment, options: { sourceYawRadians: number; targetYawRadians: number; quality: ProjectionRegionTextureQuality }): string {
  return JSON.stringify({ algorithm: PROJECTION_REGION_ALGORITHM_VERSION, sourcePanoId: alignment.sourcePanoId, targetPanoId: alignment.targetGrayboxPanoId, sourceYaw: options.sourceYawRadians, targetYaw: options.targetYawRadians, quality: options.quality, regions: alignment.regions.map((region) => ({ id: region.id, order: region.order, enabled: region.enabled, edgeSoftness: region.edgeSoftness, vertices: region.vertices.map((vertex) => [vertex.id, vertex.targetUv, vertex.sourceUv]) })) });
}
function barycentric(point: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] | undefined { const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(denominator) < 1e-12) return undefined; const x = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator; const y = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator; const z = 1 - x - y; return x >= -1e-6 && y >= -1e-6 && z >= -1e-6 ? [x, y, z] : undefined; }
function unwrapTriangle(points: Vec2[]): Vec2[] { const first = points[0][0]; return points.map(([u, v]) => { let value = u; while (value - first > 0.5) value -= 1; while (value - first < -0.5) value += 1; return [value, v]; }); }

export function generateProjectionRegionTexture(alignment: ProjectionRegionAlignment, options: { sourceYawRadians: number; targetYawRadians: number; quality: ProjectionRegionTextureQuality; sourceOrigin?: [number, number, number]; targetOrigin?: [number, number, number] }): ProjectionRegionTextureResult {
  const cacheKey = projectionRegionTextureCacheKey(alignment, options); const existing = cache.get(cacheKey);
  if (existing) { existing.references += 1; let released = false; return { ...existing.result, release: () => { if (released) return; released = true; existing.references -= 1; if (existing.references <= 0) cache.delete(cacheKey); } }; }
  const [width, height] = PROJECTION_REGION_TEXTURE_SIZE[options.quality]; const displacement = new Uint16Array(width * height * 2); const weight = new Uint8Array(width * height); displacement.fill(32768); const diagnostics: ProjectionRegionMeshDiagnostics[] = [];
  for (const region of [...alignment.regions].filter((item) => item.enabled).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    const plane = regionToCommonPlane(region, options); if (!plane.diagnostics.valid) { diagnostics.push({ valid: false, flippedTriangleCount: 0, collapsedTriangleCount: 0, maximumScale: 0, maximumShear: 0, message: plane.diagnostics.message }); continue; }
    const mesh = createProjectionRegionMesh(plane.target, plane.source, region.edgeSoftness); diagnostics.push(mesh.diagnostics); if (!mesh.diagnostics.valid) continue;
    const output = mesh.vertices.map((vertex) => unitDirectionToEquirectUv(applyYawRotation(tangentPlaneToUnitDirection(vertex.target, plane.basis), -options.sourceYawRadians)));
    const source = mesh.vertices.map((vertex) => unitDirectionToEquirectUv(applyYawRotation(tangentPlaneToUnitDirection(vertex.source, plane.basis), -options.sourceYawRadians)));
    for (const { indices } of mesh.triangles) {
      const out = unwrapTriangle(indices.map((index) => output[index])); const src = unwrapTriangle(indices.map((index) => source[index]));
      const minX = Math.floor(Math.min(...out.map((point) => point[0])) * width); const maxX = Math.ceil(Math.max(...out.map((point) => point[0])) * width); const minY = Math.max(0, Math.floor(Math.min(...out.map((point) => point[1])) * height)); const maxY = Math.min(height - 1, Math.ceil(Math.max(...out.map((point) => point[1])) * height));
      for (let py = minY; py <= maxY; py += 1) for (let px = minX; px <= maxX; px += 1) { const coefficients = barycentric([(px + 0.5) / width, (py + 0.5) / height], out[0], out[1], out[2]); if (!coefficients) continue; const wrappedX = ((px % width) + width) % width; const offset = py * width + wrappedX; const natural: Vec2 = [((out[0][0] * coefficients[0] + out[1][0] * coefficients[1] + out[2][0] * coefficients[2]) % 1 + 1) % 1, out[0][1] * coefficients[0] + out[1][1] * coefficients[1] + out[2][1] * coefficients[2]]; const sampled: Vec2 = [((src[0][0] * coefficients[0] + src[1][0] * coefficients[1] + src[2][0] * coefficients[2]) % 1 + 1) % 1, src[0][1] * coefficients[0] + src[1][1] * coefficients[1] + src[2][1] * coefficients[2]]; displacement[offset * 2] = encodeU(shortestU(natural[0], sampled[0])); displacement[offset * 2 + 1] = encodeV(sampled[1] - natural[1]); weight[offset] = Math.round(Math.max(0, Math.min(1, mesh.vertices[indices[0]].weight * coefficients[0] + mesh.vertices[indices[1]].weight * coefficients[1] + mesh.vertices[indices[2]].weight * coefficients[2])) * 255); }
    }
  }
  const result = { width, height, displacement, weight, diagnostics, cacheKey }; const entry: CacheEntry = { result, references: 1 }; cache.set(cacheKey, entry); let released = false;
  return { ...result, release: () => { if (released) return; released = true; entry.references -= 1; if (entry.references <= 0) cache.delete(cacheKey); } };
}
export const projectionRegionTextureCacheSize = () => cache.size;
