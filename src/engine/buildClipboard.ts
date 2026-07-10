import { objectDisplayName } from '../domain/defaults';
import { SceneObject, SceneObjectType, Vec3 } from '../domain/types';
import { createId } from '../utils/ids';
import { snapBuildPoint } from './sandbox';

export const BUILD_CLIPBOARD_KIND = 'panoref/build-objects';
export const BUILD_CLIPBOARD_VERSION = 1;
export const BUILD_PASTE_OFFSET = 0.75;

const SCENE_OBJECT_TYPES = new Set<SceneObjectType>([
  'floor', 'wall', 'box', 'arch', 'doorway', 'column', 'stairs', 'tree_blob',
  'terrain_mass', 'background_card', 'human_dummy', 'sun_marker', 'imported_model',
]);
const CATEGORIES = new Set<SceneObject['category']>(['architecture', 'environment', 'helper', 'landmark']);

export interface BuildClipboardPayload {
  kind: typeof BUILD_CLIPBOARD_KIND;
  version: typeof BUILD_CLIPBOARD_VERSION;
  sourceProjectId: string;
  copiedAt: string;
  anchor: Vec3;
  objects: SceneObject[];
}

export function createBuildClipboardPayload(
  sourceProjectId: string,
  objects: SceneObject[],
): BuildClipboardPayload {
  if (objects.length === 0) throw new Error('Select at least one Build object to copy.');
  return {
    kind: BUILD_CLIPBOARD_KIND,
    version: BUILD_CLIPBOARD_VERSION,
    sourceProjectId,
    copiedAt: new Date().toISOString(),
    anchor: selectionCenter(objects),
    objects: structuredClone(objects),
  };
}

export function serializeBuildClipboard(payload: BuildClipboardPayload): string {
  return JSON.stringify(payload);
}

export function parseBuildClipboard(text: string): BuildClipboardPayload | undefined {
  if (!text.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.kind !== BUILD_CLIPBOARD_KIND || value.version !== BUILD_CLIPBOARD_VERSION) return undefined;
  if (typeof value.sourceProjectId !== 'string' || typeof value.copiedAt !== 'string') return undefined;
  if (!isVec3(value.anchor) || !Array.isArray(value.objects) || value.objects.length === 0) return undefined;
  if (!value.objects.every(isSceneObject)) return undefined;
  return structuredClone(value) as unknown as BuildClipboardPayload;
}

export function pasteBuildClipboardObjects(params: {
  payload: BuildClipboardPayload;
  existingObjects: SceneObject[];
  pasteIndex: number;
  snapToGrid: boolean;
  inPlace?: boolean;
}): SceneObject[] {
  const distance = params.inPlace ? 0 : BUILD_PASTE_OFFSET * Math.max(1, params.pasteIndex);
  const offset = snapBuildPoint([distance, 0, distance], params.snapToGrid);
  const counts = countTypes(params.existingObjects);
  return params.payload.objects.map((source) => {
    const index = (counts.get(source.type) ?? 0) + 1;
    counts.set(source.type, index);
    const position = snapBuildPoint([
      source.transform.position[0] + offset[0],
      source.transform.position[1],
      source.transform.position[2] + offset[2],
    ], params.snapToGrid);
    return {
      ...structuredClone(source),
      id: createId('obj'),
      name: `${objectDisplayName(source.type)} ${index}`,
      locked: false,
      visible: true,
      transform: {
        position,
        rotation: [...source.transform.rotation] as Vec3,
        scale: [...source.transform.scale] as Vec3,
      },
      dimensions: [...source.dimensions] as Vec3,
    };
  });
}

export function selectionCenter(objects: SceneObject[]): Vec3 {
  if (objects.length === 0) return [0, 0, 0];
  const sum = objects.reduce<Vec3>((result, object) => [
    result[0] + object.transform.position[0],
    result[1] + object.transform.position[1],
    result[2] + object.transform.position[2],
  ], [0, 0, 0]);
  return sum.map((value) => value / objects.length) as Vec3;
}

function countTypes(objects: SceneObject[]) {
  const counts = new Map<SceneObjectType, number>();
  objects.forEach((object) => counts.set(object.type, (counts.get(object.type) ?? 0) + 1));
  return counts;
}

function isSceneObject(value: unknown): value is SceneObject {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!SCENE_OBJECT_TYPES.has(value.type as SceneObjectType)) return false;
  if (!CATEGORIES.has(value.category as SceneObject['category'])) return false;
  if (typeof value.locked !== 'boolean' || typeof value.visible !== 'boolean') return false;
  if (!isVec3(value.dimensions) || value.dimensions.some((number) => number <= 0)) return false;
  if (!isRecord(value.transform)) return false;
  if (!isVec3(value.transform.position) || !isVec3(value.transform.rotation) || !isVec3(value.transform.scale)) return false;
  if (value.metadata !== undefined && !isJsonSafe(value.metadata)) return false;
  return true;
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonSafe(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}
