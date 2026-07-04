import {
  createCameraData,
  createDefaultProject,
  createOriginShot,
  createPanoAsset,
  createPanoReference,
  createShot,
  DEFAULT_CAMERA_ASPECT_RATIO,
} from '../domain/defaults';
import {
  CameraData,
  Euler,
  LocationProject,
  SceneObject,
  SceneObjectType,
  Shot,
  Vec3,
} from '../domain/types';
import { getCanonicalPano } from '../domain/selectors';
import { createPlacedSceneObject } from '../engine/sandbox';
import { linkAllShotsToCanonicalPano, withShotPanoLink } from '../engine/sync';
import type { ImageRenderResult } from '../engine/renderers';

export function touchProject(project: LocationProject): LocationProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function createAgentProject(params: {
  name: string;
  description?: string;
  videoBrief?: string;
}): LocationProject {
  const project = createDefaultProject();
  const description = [params.description, params.videoBrief]
    .filter((value) => value?.trim())
    .join('\n\n')
    .trim();

  return touchProject({
    ...project,
    name: params.name.trim() || project.name,
    description: description || project.description,
  });
}

export interface PlaceObjectSpec {
  type: SceneObjectType;
  name?: string;
  position?: Vec3;
  rotation?: Euler;
  scale?: Vec3;
  dimensions?: Vec3;
  locked?: boolean;
  visible?: boolean;
}

export function placeObjects(
  project: LocationProject,
  objects: PlaceObjectSpec[],
  options: { snapToGrid?: boolean } = {},
): LocationProject {
  const snapToGrid = options.snapToGrid ?? true;
  let next = project;

  for (const spec of objects) {
    const count = next.scene.objects.filter((object) => object.type === spec.type).length + 1;
    const point = spec.position ?? [0, 0, 0];
    const placed = createPlacedSceneObject({
      type: spec.type,
      index: count,
      point,
      snapToGrid,
    });

    const object: SceneObject = {
      ...placed,
      name: spec.name?.trim() || placed.name,
      dimensions: spec.dimensions ?? placed.dimensions,
      locked: spec.locked ?? placed.locked,
      visible: spec.visible ?? placed.visible,
      transform: {
        ...placed.transform,
        position: spec.position ?? placed.transform.position,
        rotation: spec.rotation ?? placed.transform.rotation,
        scale: spec.scale ?? placed.transform.scale,
      },
    };

    next = touchProject({
      ...next,
      scene: {
        ...next.scene,
        objects: [...next.scene.objects, object],
      },
    });
  }

  return next;
}

export function setPanoOrigin(project: LocationProject, position: Vec3): LocationProject {
  return touchProject({
    ...project,
    scene: {
      ...project.scene,
      panoOrigin: [...position] as Vec3,
    },
  });
}

export interface ShotPlanSpec {
  name: string;
  description?: string;
  camera: {
    position: Vec3;
    target: Vec3;
    fovDegrees?: number;
  };
}

export function planShots(project: LocationProject, shots: ShotPlanSpec[]): LocationProject {
  if (shots.length === 0) return project;

  const canonical = getCanonicalPano(project);
  const plannedShots: Shot[] = shots.map((spec, index) => {
    const camera = createCameraData(
      [...spec.camera.position] as Vec3,
      [...spec.camera.target] as Vec3,
      spec.camera.fovDegrees ?? project.settings.defaultShotFovDegrees,
    );
    camera.aspectRatio = DEFAULT_CAMERA_ASPECT_RATIO;

    const shot = withShotPanoLink(
      project,
      createShot({
        index: index + 1,
        camera,
        linkedPanoId: canonical?.id,
      }),
      canonical,
    );

    shot.name = spec.name.trim() || shot.name;
    shot.description = spec.description?.trim() || shot.description;
    return shot;
  });

  return touchProject(linkAllShotsToCanonicalPano({
    ...project,
    shots: plannedShots,
  }));
}

export function applyGrayboxRender(
  project: LocationProject,
  render: ImageRenderResult,
): LocationProject {
  const asset = createPanoAsset({
    name: 'global_graybox.png',
    uri: render.dataUrl,
    width: render.width,
    height: render.height,
    metadata: { source: 'graybox_scene', renderer: 'mcp' },
  });

  const pano = createPanoReference({
    name: 'Graybox 360',
    assetId: asset.id,
    type: 'graybox_render',
    origin: project.scene.panoOrigin,
    rotation: project.scene.panoRotation,
    width: render.width,
    height: render.height,
    isCanonical: project.panoRefs.length === 0,
    notes: 'Rendered by the Continuity Stage MCP render bridge.',
  });

  return touchProject(linkAllShotsToCanonicalPano({
    ...project,
    assets: {
      assets: {
        ...project.assets.assets,
        [asset.id]: asset,
      },
    },
    panoRefs: [
      ...project.panoRefs.map((existing) => (
        pano.isCanonical ? { ...existing, isCanonical: false } : existing
      )),
      pano,
    ],
  }));
}

export interface ShotRenderResult {
  shotId: string;
  shotNumber: string;
  render: ImageRenderResult;
}

export function applyShotRenders(
  project: LocationProject,
  renders: ShotRenderResult[],
): LocationProject {
  let next = project;

  for (const item of renders) {
    const shot = next.shots.find((candidate) => candidate.id === item.shotId);
    if (!shot) continue;

    const asset = createPanoAsset({
      name: `shot_${item.shotNumber}_viewport_clay.png`,
      uri: item.render.dataUrl,
      width: item.render.width,
      height: item.render.height,
      metadata: { source: 'viewport_clay', renderer: 'mcp', shotId: item.shotId },
    });

    next = touchProject({
      ...next,
      assets: {
        assets: {
          ...next.assets.assets,
          [asset.id]: asset,
        },
      },
      shots: next.shots.map((candidate) => candidate.id === item.shotId
        ? {
          ...candidate,
          assets: {
            ...candidate.assets,
            viewportRenderAssetId: asset.id,
          },
          updatedAt: new Date().toISOString(),
        }
        : candidate),
    });
  }

  return next;
}

export function ensureOriginShot(project: LocationProject): LocationProject {
  if (project.shots.length > 0) return project;
  return touchProject({
    ...project,
    shots: [createOriginShot(project)],
  });
}

export function summarizeProject(project: LocationProject) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    objectCount: project.scene.objects.length,
    shotCount: project.shots.length,
    panoRefCount: project.panoRefs.length,
    hasGrayboxPano: project.panoRefs.some((pano) => pano.type === 'graybox_render'),
    shots: project.shots.map((shot) => ({
      id: shot.id,
      shotNumber: shot.shotNumber,
      name: shot.name,
      description: shot.description,
      hasViewportRender: Boolean(shot.assets.viewportRenderAssetId),
    })),
  };
}