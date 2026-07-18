import type { ProjectionRegion, ProjectionRegionVertexPair, Vec2 } from '../domain/types';
import { createProjectionRegionVertexPair } from '../domain/defaults';

export const MAX_REGION_ANGULAR_SPAN_DEGREES = 100;
const EPSILON = 1e-8;

export interface ProjectionRegionPolygonDiagnostics {
  valid: boolean;
  targetSelfIntersects: boolean;
  sourceSelfIntersects: boolean;
  nearZeroArea: boolean;
  duplicateConsecutiveVertices: boolean;
  excessiveAngularExtent: boolean;
  unstablePoleRegion: boolean;
  messages: string[];
}

export const targetLoopFromRegion = (region: ProjectionRegion): Vec2[] => region.vertices.map((vertex) => [...vertex.targetUv]);
export const sourceLoopFromRegion = (region: ProjectionRegion): Vec2[] => region.vertices.map((vertex) => [...vertex.sourceUv]);

export function signedPolygonArea(points: Vec2[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -EPSILON && cdA * cdB < -EPSILON;
}

export function polygonSelfIntersects(points: Vec2[]): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return true;
    }
  }
  return false;
}

export function pointInsidePolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function polygonBounds(points: Vec2[]): { min: Vec2; max: Vec2 } {
  return points.reduce((bounds, point) => ({
    min: [Math.min(bounds.min[0], point[0]), Math.min(bounds.min[1], point[1])],
    max: [Math.max(bounds.max[0], point[0]), Math.max(bounds.max[1], point[1])],
  }), { min: [Infinity, Infinity] as Vec2, max: [-Infinity, -Infinity] as Vec2 });
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  const area = signedPolygonArea(points);
  if (Math.abs(area) < EPSILON) return points.reduce<Vec2>((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  let x = 0; let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    x += (point[0] + next[0]) * cross;
    y += (point[1] + next[1]) * cross;
  });
  return [x / (6 * area), y / (6 * area)];
}

export function unwrapRegionU(points: Vec2[]): Vec2[] {
  if (!points.length) return [];
  const result: Vec2[] = [[...points[0]]];
  for (let index = 1; index < points.length; index += 1) {
    let u = points[index][0];
    while (u - result[index - 1][0] > 0.5) u -= 1;
    while (u - result[index - 1][0] < -0.5) u += 1;
    result.push([u, points[index][1]]);
  }
  return result;
}

export const rewrapRegionU = (points: Vec2[]): Vec2[] => points.map(([u, v]) => [((u % 1) + 1) % 1, Math.min(1, Math.max(0, v))]);
const interpolate = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function insertPairedVertex(region: ProjectionRegion, edgeStartVertexId: string, edgeT: number): ProjectionRegion {
  const index = region.vertices.findIndex((vertex) => vertex.id === edgeStartVertexId);
  if (index < 0) return region;
  const next = region.vertices[(index + 1) % region.vertices.length];
  const t = Math.min(1, Math.max(0, edgeT));
  const target = unwrapRegionU([region.vertices[index].targetUv, next.targetUv]);
  const source = unwrapRegionU([region.vertices[index].sourceUv, next.sourceUv]);
  const inserted = createProjectionRegionVertexPair(rewrapRegionU([interpolate(target[0], target[1], t)])[0], rewrapRegionU([interpolate(source[0], source[1], t)])[0]);
  const vertices = [...region.vertices];
  vertices.splice(index + 1, 0, inserted);
  return { ...region, vertices, updatedAt: new Date().toISOString() };
}

export function removePairedVertex(region: ProjectionRegion, vertexId: string): ProjectionRegion {
  if (region.vertices.length <= 3 || !region.vertices.some((vertex) => vertex.id === vertexId)) return region;
  return { ...region, vertices: region.vertices.filter((vertex) => vertex.id !== vertexId), updatedAt: new Date().toISOString() };
}

function mapSource(region: ProjectionRegion, transform: (point: Vec2, index: number) => Vec2): ProjectionRegion {
  const unwrapped = unwrapRegionU(sourceLoopFromRegion(region));
  const transformed = rewrapRegionU(unwrapped.map(transform));
  return { ...region, vertices: region.vertices.map((vertex, index) => ({ ...vertex, sourceUv: transformed[index] })), updatedAt: new Date().toISOString() };
}

export const translateSourceMask = (region: ProjectionRegion, delta: Vec2) => mapSource(region, (point) => [point[0] + delta[0], point[1] + delta[1]]);
export function scaleSourceMask(region: ProjectionRegion, scale: number, center = polygonCentroid(unwrapRegionU(sourceLoopFromRegion(region)))): ProjectionRegion {
  return mapSource(region, (point) => [center[0] + (point[0] - center[0]) * scale, center[1] + (point[1] - center[1]) * scale]);
}
export function rotateSourceMask(region: ProjectionRegion, radians: number, center = polygonCentroid(unwrapRegionU(sourceLoopFromRegion(region)))): ProjectionRegion {
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return mapSource(region, (point) => { const x = point[0] - center[0]; const y = point[1] - center[1]; return [center[0] + x * cosine - y * sine, center[1] + x * sine + y * cosine]; });
}
export function translateSelectedSourceVertices(region: ProjectionRegion, selectedIds: string[], delta: Vec2): ProjectionRegion {
  const selected = new Set(selectedIds);
  return mapSource(region, (point, index) => selected.has(region.vertices[index].id) ? [point[0] + delta[0], point[1] + delta[1]] : point);
}

export function diagnoseProjectionRegionPolygon(region: ProjectionRegion): ProjectionRegionPolygonDiagnostics {
  const target = unwrapRegionU(targetLoopFromRegion(region));
  const source = unwrapRegionU(sourceLoopFromRegion(region));
  const targetSelfIntersects = polygonSelfIntersects(target);
  const sourceSelfIntersects = polygonSelfIntersects(source);
  const nearZeroArea = Math.abs(signedPolygonArea(target)) < EPSILON || Math.abs(signedPolygonArea(source)) < EPSILON;
  const duplicateConsecutiveVertices = region.vertices.some((vertex, index) => vertex.id === region.vertices[(index + 1) % region.vertices.length]?.id);
  const bounds = polygonBounds([...target, ...source]);
  const excessiveAngularExtent = (bounds.max[0] - bounds.min[0]) * 360 > MAX_REGION_ANGULAR_SPAN_DEGREES || (bounds.max[1] - bounds.min[1]) * 180 > MAX_REGION_ANGULAR_SPAN_DEGREES;
  const unstablePoleRegion = [...target, ...source].some((point) => point[1] < 0.01 || point[1] > 0.99);
  const messages = [targetSelfIntersects && 'Graybox outline crosses itself.', sourceSelfIntersects && 'Styled outline crosses itself.', nearZeroArea && 'Region has near-zero area.', duplicateConsecutiveVertices && 'Region has duplicate consecutive handles.', excessiveAngularExtent && 'This region is too large for one fit. Split it into smaller regions.', unstablePoleRegion && 'This region is too close to a panorama pole.'].filter((message): message is string => Boolean(message));
  return { valid: messages.length === 0, targetSelfIntersects, sourceSelfIntersects, nearZeroArea, duplicateConsecutiveVertices, excessiveAngularExtent, unstablePoleRegion, messages };
}
