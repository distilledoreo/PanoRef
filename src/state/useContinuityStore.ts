import { create } from 'zustand';
import {
  CameraData,
  Landmark,
  LocationProject,
  PanoReference,
  PanoViewState,
  ProjectAsset,
  SceneObject,
  SceneObjectType,
  Shot,
  Vec3,
  Workspace,
} from '../domain/types';
import {
  createDefaultProject,
  createLandmark,
  createPanoAsset,
  createPanoReference,
  createSceneObject,
  createShot,
} from '../domain/defaults';
import { getPanoCropSettingsForShot, createCameraFromPanoView, yawPitchToDirection, add, multiplyScalar } from '../engine/sync';
import { renderGrayboxEquirectangularPano } from '../engine/renderers';

interface ContinuityStore {
  project: LocationProject;
  workspace: Workspace;
  selectedObjectId?: string;
  selectedShotId?: string;
  selectedLandmarkId?: string;
  activePanoId?: string;
  panoView: PanoViewState;
  isRenderingGraybox: boolean;
  isExportingPackage: boolean;
  setWorkspace: (workspace: Workspace) => void;
  setProject: (project: LocationProject) => void;
  updateProjectInfo: (updates: Pick<LocationProject, 'name'> | Partial<Pick<LocationProject, 'name' | 'description'>>) => void;
  addObject: (type: SceneObjectType) => void;
  selectObject: (id?: string) => void;
  updateObject: (id: string, updates: Partial<SceneObject>) => void;
  removeObject: (id: string) => void;
  setPanoOrigin: (origin: Vec3) => void;
  renderGrayboxPano: () => Promise<PanoReference>;
  importCanonicalPano: (params: { name: string; dataUrl: string; width?: number; height?: number }) => void;
  setActivePano: (id?: string) => void;
  updatePanoReference: (id: string, updates: Partial<PanoReference>) => void;
  setPanoView: (updates: Partial<PanoViewState>) => void;
  createShotFromCurrentPanoView: () => Shot | undefined;
  createPresetShot: (preset: ShotPresetId) => Shot | undefined;
  createMainStructureWideShot: () => Shot | undefined;
  selectShot: (id?: string) => void;
  updateShot: (id: string, updates: Partial<Shot>) => void;
  removeShot: (id: string) => void;
  attachAiResultFrameToShot: (shotId: string, params: { name: string; dataUrl: string; width?: number; height?: number }) => ProjectAsset;
  addLandmark: () => Landmark;
  updateLandmark: (id: string, updates: Partial<Landmark>) => void;
  toggleShotLandmark: (shotId: string, landmarkId: string) => void;
  setExportingPackage: (value: boolean) => void;
}

export type ShotPresetId =
  | 'wide_establishing'
  | 'medium_frontal'
  | 'low_angle'
  | 'doorway_view'
  | 'insert_detail';

export const shotPresets: Record<ShotPresetId, { label: string; position: Vec3; target: Vec3; fov: number }> = {
  wide_establishing: {
    label: 'Wide Establishing',
    position: [0, 1.7, -6],
    target: [0, 1.5, 4.5],
    fov: 65,
  },
  medium_frontal: {
    label: 'Medium Frontal',
    position: [0.85, 1.55, -3.3],
    target: [-0.45, 1.45, 3.6],
    fov: 46,
  },
  low_angle: {
    label: 'Low Angle',
    position: [-1.8, 0.75, -4.4],
    target: [0, 2.2, 4.8],
    fov: 52,
  },
  doorway_view: {
    label: 'Doorway View',
    position: [-4.2, 1.55, -1.5],
    target: [0.2, 1.6, 4.8],
    fov: 58,
  },
  insert_detail: {
    label: 'Insert Detail',
    position: [2.2, 1.35, -2.6],
    target: [0.2, 1.2, 4.4],
    fov: 32,
  },
};

export const shotPresetOptions = Object.entries(shotPresets).map(([id, preset]) => ({
  id: id as ShotPresetId,
  label: preset.label,
}));

export const useContinuityStore = create<ContinuityStore>((set, get) => ({
  project: createDefaultProject(),
  workspace: 'build',
  selectedObjectId: undefined,
  selectedShotId: undefined,
  selectedLandmarkId: undefined,
  activePanoId: undefined,
  panoView: {
    yawDegrees: 0,
    pitchDegrees: 0,
    fovDegrees: 65,
  },
  isRenderingGraybox: false,
  isExportingPackage: false,

  setWorkspace: (workspace) => set({ workspace }),
  setProject: (project) => {
    const canonical = project.panoRefs.find((pano) => pano.isCanonical) ?? project.panoRefs[0];
    set({
      project,
      activePanoId: canonical?.id,
      selectedObjectId: project.scene.objects[0]?.id,
      selectedShotId: project.shots[0]?.id,
      selectedLandmarkId: project.landmarks[0]?.id,
    });
  },
  updateProjectInfo: (updates) => set((state) => ({
    project: touchProject({ ...state.project, ...updates }),
  })),
  addObject: (type) => set((state) => {
    const count = state.project.scene.objects.filter((object) => object.type === type).length + 1;
    const object = createSceneObject(type, count);
    return {
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [...state.project.scene.objects, object],
        },
      }),
      selectedObjectId: object.id,
    };
  }),
  selectObject: (id) => set({ selectedObjectId: id }),
  updateObject: (id, updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) => object.id === id ? { ...object, ...updates } : object),
      },
    }),
  })),
  removeObject: (id) => set((state) => ({
    project: touchProject({
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.filter((object) => object.id !== id),
      },
    }),
    selectedObjectId: state.selectedObjectId === id ? undefined : state.selectedObjectId,
  })),
  setPanoOrigin: (origin) => set((state) => ({
    project: touchProject({
      ...state.project,
      scene: { ...state.project.scene, panoOrigin: origin },
    }),
  })),
  renderGrayboxPano: async () => {
    set({ isRenderingGraybox: true });
    try {
      const state = get();
      const render = await renderGrayboxEquirectangularPano(state.project, 2048, 1024);
      const asset = createPanoAsset({
        name: 'global_graybox.png',
        uri: render.dataUrl,
        width: render.width,
        height: render.height,
        metadata: { source: 'graybox_scene' },
      });
      const pano = createPanoReference({
        name: 'Graybox 360',
        assetId: asset.id,
        type: 'graybox_render',
        origin: state.project.scene.panoOrigin,
        rotation: state.project.scene.panoRotation,
        width: render.width,
        height: render.height,
        isCanonical: state.project.panoRefs.length === 0,
        notes: 'Rendered from the Build workspace graybox set.',
      });

      set((current) => ({
        project: touchProject({
          ...current.project,
          assets: {
            assets: {
              ...current.project.assets.assets,
              [asset.id]: asset,
            },
          },
          panoRefs: [
            ...current.project.panoRefs.map((existing) => (
              pano.isCanonical ? { ...existing, isCanonical: false } : existing
            )),
            pano,
          ],
        }),
        activePanoId: pano.id,
      }));
      return pano;
    } finally {
      set({ isRenderingGraybox: false });
    }
  },
  importCanonicalPano: (params) => set((state) => {
    const asset = createPanoAsset({
      name: params.name,
      uri: params.dataUrl,
      width: params.width ?? 4096,
      height: params.height ?? 2048,
      metadata: { source: 'user_import' },
    });
    const graybox = state.project.panoRefs.find((pano) => pano.type === 'graybox_render');
    const pano = createPanoReference({
      name: params.name.replace(/\.[^.]+$/, '') || 'Canonical Global Reference',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: state.project.scene.panoOrigin,
      rotation: state.project.scene.panoRotation,
      width: asset.width ?? 4096,
      height: asset.height ?? 2048,
      isCanonical: true,
      sourcePanoId: graybox?.id,
      notes: 'Imported canonical global environment reference.',
    });
    return {
      project: touchProject({
        ...state.project,
        assets: { assets: { ...state.project.assets.assets, [asset.id]: asset } },
        panoRefs: [...state.project.panoRefs.map((existing) => ({ ...existing, isCanonical: false })), pano],
      }),
      activePanoId: pano.id,
    };
  }),
  setActivePano: (id) => set({ activePanoId: id }),
  updatePanoReference: (id, updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      panoRefs: state.project.panoRefs.map((pano) => pano.id === id ? { ...pano, ...updates } : pano),
      shots: state.project.shots.map((shot) => {
        if (shot.linkedPanoId !== id) return shot;
        const linkedPano = state.project.panoRefs.find((pano) => pano.id === id);
        if (!linkedPano || !shot.panoCrop) return shot;
        return {
          ...shot,
          panoCrop: getPanoCropSettingsForShot(
            shot.camera,
            { ...linkedPano, ...updates },
            shot.exportSettings.width,
            shot.exportSettings.height,
          ),
          updatedAt: new Date().toISOString(),
        };
      }),
    }),
  })),
  setPanoView: (updates) => set((state) => ({
    panoView: { ...state.panoView, ...updates },
  })),
  createShotFromCurrentPanoView: () => {
    const state = get();
    const pano = getActivePano(state.project, state.activePanoId);
    if (!pano) return undefined;
    const camera = createCameraFromPanoView({
      pano,
      yawDegrees: state.panoView.yawDegrees,
      pitchDegrees: state.panoView.pitchDegrees,
      fovDegrees: state.panoView.fovDegrees,
      aspectRatio: state.project.settings.defaultShotWidth / state.project.settings.defaultShotHeight,
    });
    return addShotWithCamera(camera, pano.id);
  },
  createPresetShot: (presetId) => {
    const state = get();
    const pano = getActivePano(state.project, state.activePanoId);
    const preset = shotPresets[presetId];
    const camera: CameraData = {
      position: preset.position,
      target: preset.target,
      fovDegrees: preset.fov,
      aspectRatio: state.project.settings.defaultShotWidth / state.project.settings.defaultShotHeight,
      near: 0.1,
      far: 100,
    };
    return addShotWithCamera(camera, pano?.id);
  },
  createMainStructureWideShot: () => {
    const state = get();
    const pano = state.project.panoRefs.find((item) => item.isCanonical)
      ?? state.project.panoRefs.find((item) => item.type === 'ai_global_reference')
      ?? getActivePano(state.project, state.activePanoId);
    const camera: CameraData = {
      position: [0, 1.55, -5.8],
      target: [0, 1.55, 4.4],
      fovDegrees: 72,
      aspectRatio: state.project.settings.defaultShotWidth / state.project.settings.defaultShotHeight,
      near: 0.1,
      far: 100,
    };
    const shot = addShotWithCamera(camera, pano?.id);
    if (!shot) return undefined;
    const criticalLandmarks = state.project.landmarks
      .filter((landmark) => landmark.promptCritical)
      .map((landmark) => landmark.id);
    get().updateShot(shot.id, {
      name: 'Main Structure Wide',
      description: 'Wide hero framing of the central temple gate with the man in frame, facing the camera.',
      landmarkIds: criticalLandmarks,
      promptOverrides: {
        imagePrompt: 'Night Egyptian temple courtyard, warm torch-lit carved stone, moonlit sky, central structure held wide, foreground man facing camera.',
        videoPrompt: 'Hold the wide composition with subtle torch flicker and stable architecture.',
      },
    });
    return useContinuityStore.getState().project.shots.find((item) => item.id === shot.id) ?? shot;
  },
  selectShot: (id) => set((state) => {
    const shot = state.project.shots.find((item) => item.id === id);
    if (!shot) return { selectedShotId: id };
    const direction = yawPitchToDirection(0, 0);
    const forward = [
      shot.camera.target[0] - shot.camera.position[0],
      shot.camera.target[1] - shot.camera.position[1],
      shot.camera.target[2] - shot.camera.position[2],
    ] as Vec3;
    const yaw = Math.atan2(forward[0] || direction[0], forward[2] || direction[2]) * (180 / Math.PI);
    const horizontal = Math.hypot(forward[0], forward[2]);
    const pitch = Math.atan2(forward[1], horizontal) * (180 / Math.PI);
    return {
      selectedShotId: id,
      activePanoId: shot.linkedPanoId ?? state.activePanoId,
      panoView: {
        yawDegrees: yaw,
        pitchDegrees: pitch,
        fovDegrees: shot.camera.fovDegrees,
      },
    };
  }),
  updateShot: (id, updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      shots: state.project.shots.map((shot) => {
        if (shot.id !== id) return shot;
        const updated = { ...shot, ...updates, updatedAt: new Date().toISOString() };
        const linkedPano = state.project.panoRefs.find((pano) => pano.id === updated.linkedPanoId);
        if (linkedPano) {
          updated.panoCrop = getPanoCropSettingsForShot(
            updated.camera,
            linkedPano,
            updated.exportSettings.width,
            updated.exportSettings.height,
          );
        }
        return updated;
      }),
    }),
  })),
  removeShot: (id) => set((state) => ({
    project: touchProject({
      ...state.project,
      shots: state.project.shots.filter((shot) => shot.id !== id),
    }),
    selectedShotId: state.selectedShotId === id ? undefined : state.selectedShotId,
  })),
  attachAiResultFrameToShot: (shotId, params) => {
    const state = get();
    const shot = state.project.shots.find((item) => item.id === shotId);
    if (!shot) throw new Error('Select a shot before importing an AI result frame.');
    const asset = createPanoAsset({
      name: params.name || `shot_${shot.shotNumber}_ai_result_frame.png`,
      uri: params.dataUrl,
      width: params.width ?? shot.exportSettings.width,
      height: params.height ?? shot.exportSettings.height,
      metadata: {
        source: 'external_ai_image_generator',
        shotId: shot.id,
      },
    });
    set((current) => ({
      project: touchProject({
        ...current.project,
        assets: {
          assets: {
            ...current.project.assets.assets,
            [asset.id]: asset,
          },
        },
        shots: current.project.shots.map((item) => item.id === shot.id
          ? {
              ...item,
              assets: {
                ...item.assets,
                finalBaseFrameAssetId: asset.id,
                aiResultFrameAssetId: asset.id,
              },
              status: 'exported',
              updatedAt: new Date().toISOString(),
            }
          : item),
      }),
      workspace: 'review',
    }));
    return asset;
  },
  addLandmark: () => {
    const state = get();
    const forward = yawPitchToDirection(state.panoView.yawDegrees, state.panoView.pitchDegrees);
    const position = add(state.project.scene.panoOrigin, multiplyScalar(forward, 4));
    const landmark = createLandmark(state.project.landmarks.length + 1, position);
    set((current) => ({
      project: touchProject({
        ...current.project,
        landmarks: [...current.project.landmarks, landmark],
      }),
      selectedLandmarkId: landmark.id,
    }));
    return landmark;
  },
  updateLandmark: (id, updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      landmarks: state.project.landmarks.map((landmark) => landmark.id === id ? { ...landmark, ...updates } : landmark),
    }),
  })),
  toggleShotLandmark: (shotId, landmarkId) => set((state) => ({
    project: touchProject({
      ...state.project,
      shots: state.project.shots.map((shot) => {
        if (shot.id !== shotId) return shot;
        const hasLandmark = shot.landmarkIds.includes(landmarkId);
        return {
          ...shot,
          landmarkIds: hasLandmark
            ? shot.landmarkIds.filter((id) => id !== landmarkId)
            : [...shot.landmarkIds, landmarkId],
          updatedAt: new Date().toISOString(),
        };
      }),
    }),
  })),
  setExportingPackage: (value) => set({ isExportingPackage: value }),
}));

function touchProject(project: LocationProject): LocationProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

function getActivePano(project: LocationProject, activePanoId?: string): PanoReference | undefined {
  return project.panoRefs.find((pano) => pano.id === activePanoId)
    ?? project.panoRefs.find((pano) => pano.isCanonical)
    ?? project.panoRefs[0];
}

function addShotWithCamera(camera: CameraData, linkedPanoId?: string): Shot {
  const state = useContinuityStore.getState();
  const linkedPano = state.project.panoRefs.find((pano) => pano.id === linkedPanoId);
  const shot = createShot({
    index: state.project.shots.length + 1,
    camera,
    linkedPanoId,
    panoCrop: linkedPano
      ? getPanoCropSettingsForShot(camera, linkedPano, state.project.settings.defaultShotWidth, state.project.settings.defaultShotHeight)
      : undefined,
  });
  shot.landmarkIds = state.project.landmarks
    .filter((landmark) => landmark.promptCritical)
    .map((landmark) => landmark.id);

  useContinuityStore.setState((current) => ({
    project: touchProject({
      ...current.project,
      shots: [...current.project.shots, shot],
    }),
    selectedShotId: shot.id,
    workspace: 'shots',
  }));

  return shot;
}
