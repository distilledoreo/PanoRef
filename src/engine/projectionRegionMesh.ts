import type { Vec2 } from '../domain/types';
import { polygonBounds, polygonCentroid, signedPolygonArea } from './projectionRegionPolygon';

const EPSILON = 1e-9;
export interface ProjectionRegionMeshVertex { target: Vec2; source: Vec2; weight: number }
export interface ProjectionRegionMeshTriangle { indices: [number, number, number] }
export interface ProjectionRegionMeshDiagnostics { valid: boolean; flippedTriangleCount: number; collapsedTriangleCount: number; maximumScale: number; maximumShear: number; message?: string }
export interface ProjectionRegionMesh { vertices: ProjectionRegionMeshVertex[]; triangles: ProjectionRegionMeshTriangle[]; diagnostics: ProjectionRegionMeshDiagnostics; supportPadding: number }

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function insideTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean { const x = cross(a, b, point); const y = cross(b, c, point); const z = cross(c, a, point); return (x >= -EPSILON && y >= -EPSILON && z >= -EPSILON) || (x <= EPSILON && y <= EPSILON && z <= EPSILON); }

export function triangulatePolygon(points: Vec2[]): [number, number, number][] {
  if (points.length < 3) return [];
  const order = points.map((_, index) => index); if (signedPolygonArea(points) < 0) order.reverse();
  const triangles: [number, number, number][] = [];
  let guard = points.length * points.length;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < order.length; i += 1) {
      const previous = order[(i - 1 + order.length) % order.length]; const current = order[i]; const next = order[(i + 1) % order.length];
      if (cross(points[previous], points[current], points[next]) <= EPSILON) continue;
      if (order.some((candidate) => candidate !== previous && candidate !== current && candidate !== next && insideTriangle(points[candidate], points[previous], points[current], points[next]))) continue;
      triangles.push([previous, current, next]); order.splice(i, 1); clipped = true; break;
    }
    if (!clipped) return [];
  }
  if (order.length === 3) triangles.push([order[0], order[1], order[2]]);
  return triangles;
}

function triangleMetrics(target: Vec2[], source: Vec2[], indices: [number, number, number]) {
  const [a, b, c] = indices; const targetArea2 = cross(target[a], target[b], target[c]); const sourceArea2 = cross(source[a], source[b], source[c]);
  if (Math.abs(targetArea2) < EPSILON || Math.abs(sourceArea2) < EPSILON) return { flipped: false, collapsed: true, scale: Infinity, shear: Infinity };
  const scale = Math.sqrt(Math.abs(sourceArea2 / targetArea2));
  const edge = (points: Vec2[], i: number, j: number) => Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
  const ratios = [[a, b], [b, c], [c, a]].map(([i, j]) => edge(source, i, j) / Math.max(EPSILON, edge(target, i, j)));
  return { flipped: targetArea2 * sourceArea2 < 0, collapsed: false, scale: Math.max(...ratios, scale), shear: Math.max(...ratios) / Math.max(EPSILON, Math.min(...ratios)) };
}

export function createProjectionRegionMesh(target: Vec2[], source: Vec2[], edgeSoftness: number): ProjectionRegionMesh {
  const empty = (message: string): ProjectionRegionMesh => ({ vertices: [], triangles: [], supportPadding: 0, diagnostics: { valid: false, flippedTriangleCount: 0, collapsedTriangleCount: 0, maximumScale: 0, maximumShear: 0, message } });
  if (target.length < 3 || target.length !== source.length) return empty('Paired outlines must contain the same three or more handles.');
  const interior = triangulatePolygon(target); if (!interior.length) return empty('This outline could not be triangulated.');
  const metrics = interior.map((triangle) => triangleMetrics(target, source, triangle));
  const flippedTriangleCount = metrics.filter((item) => item.flipped).length; const collapsedTriangleCount = metrics.filter((item) => item.collapsed).length;
  const maximumScale = Math.max(...metrics.map((item) => item.scale)); const maximumShear = Math.max(...metrics.map((item) => item.shear));
  if (flippedTriangleCount || collapsedTriangleCount || !Number.isFinite(maximumScale) || maximumScale > 20 || maximumShear > 20) return { vertices: [], triangles: [], supportPadding: 0, diagnostics: { valid: false, flippedTriangleCount, collapsedTriangleCount, maximumScale, maximumShear, message: 'This region folds over itself. Adjust its handles or split it into smaller regions.' } };
  const bounds = polygonBounds([...target, ...source]); const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]); const supportPadding = Math.max(edgeSoftness, diagonal * 0.2);
  const center = polygonCentroid(target); const furthest = Math.max(...[...target, ...source].map((point) => Math.hypot(point[0] - center[0], point[1] - center[1]))); const scale = (furthest + supportPadding) / Math.max(EPSILON, Math.max(...target.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1]))));
  const outer = target.map((point): Vec2 => [center[0] + (point[0] - center[0]) * scale, center[1] + (point[1] - center[1]) * scale]);
  const vertices: ProjectionRegionMeshVertex[] = [
    ...target.map((point, index) => ({ target: [...point] as Vec2, source: [...source[index]] as Vec2, weight: 1 })),
    ...outer.map((point) => ({ target: [...point] as Vec2, source: [...point] as Vec2, weight: 0 })),
  ];
  const triangles: ProjectionRegionMeshTriangle[] = interior.map((indices) => ({ indices })); const count = target.length;
  for (let index = 0; index < count; index += 1) { const next = (index + 1) % count; triangles.push({ indices: [index, next, count + next] }, { indices: [index, count + next, count + index] }); }
  return { vertices, triangles, supportPadding, diagnostics: { valid: true, flippedTriangleCount, collapsedTriangleCount, maximumScale, maximumShear } };
}
