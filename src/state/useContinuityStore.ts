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
  createOriginShot,
  createPanoAsset,
  createPanoReference,
  createSceneObject,
  createShot,
} from '../domain/defaults';
import {
  getCanonicalPano,
  getPanoCropSettingsForShot,
  linkAllShotsToCanonicalPano,
  panoViewFromCamera,
  withShotPanoLink,
  yawPitchToDirection,
  add,
  multiplyScalar,
} from '../engine/sync';
import { renderGrayboxEquirectangularPano } from '../engine/renderers';
import { createPlacedSceneObject, duplicateSceneObject, getGroundPlacementPosition } from '../engine/sandbox';

export type BuildMode = 'select' | 'place' | 'pano_origin';

interface ContinuityStore {
  project: LocationProject;
  workspace: Workspace;
  selectedObjectId?: string;
  selectedShotId?: string;
  selectedLandmarkId?: string;
  activePanoId?: string;
  panoView: PanoViewState;
  buildMode: BuildMode;
  activePrimitive: SceneObjectType;
  gridSnap: boolean;
  isRenderingGraybox: boolean;
  isExportingPackage: boolean;
  shotCameraFlying: boolean;
  setWorkspace: (workspace: Workspace) => void;
  setProject: (project: LocationProject) => void;
  updateProjectInfo: (updates: Pick<LocationProject, 'name'> | Partial<Pick<LocationProject, 'name' | 'description'>>) => void;
  updateProjectSettings: (updates: Partial<LocationProject['settings']>) => void;
  setBuildMode: (mode: BuildMode) => void;
  setActivePrimitive: (type: SceneObjectType) => void;
  setGridSnap: (value: boolean) => void;
  addObject: (type: SceneObjectType) => void;
  placeObject: (type: SceneObjectType, point: Vec3) => SceneObject;
  selectObject: (id?: string) => void;
  updateObject: (id: string, updates: Partial<SceneObject>) => void;
  moveObjectToGroundPoint: (id: string, point: Vec3) => void;
  duplicateObject: (id: string) => SceneObject | undefined;
  toggleObjectVisibility: (id: string) => void;
  toggleObjectLocked: (id: string) => void;
  removeObject: (id: string) => void;
  setPanoOrigin: (origin: Vec3) => void;
  renderGrayboxPano: () => Promise<PanoReference>;
  importCanonicalPano: (params: { name: string; dataUrl: string; width?: number; height?: number; importNote?: string }) => void;
  setActivePano: (id?: string) => void;
  updatePanoReference: (id: string, updates: Partial<PanoReference>) => void;
  setPanoView: (updates: Partial<PanoViewState>) => void;
  addCamera: () => Shot;
  selectShot: (id?: string) => void;
  setShotCameraFlying: (value: boolean) => void;
  lockShotCamera: () => void;
  updateShot: (id: string, updates: Partial<Shot>) => void;
  removeShot: (id: string) => void;
  attachAiResultFrameToShot: (shotId: string, params: { name: string; dataUrl: string; width?: number; height?: number }) => ProjectAsset;
  addLandmark: () => Landmark;
  updateLandmark: (id: string, updates: Partial<Landmark>) => void;
  toggleShotLandmark: (shotId: string, landmarkId: string) => void;
  setExportingPackage: (value: boolean) => void;
  approveGrayboxForReference: () => void;
  acceptShotFraming: (shotId: string) => void;
  markAiBriefSent: (shotId: string) => void;
  markFinalPackageExported: (shotId: string) => void;
  dismissedWorkflowAdvanceKeys: string[];
  seenObjectiveWorkspaces: Workspace[];
  objectiveModalRequest: number;
  dismissWorkflowAdvance: (promptKey: string) => void;
  markObjectiveSeen: (workspace: Workspace) => void;
  requestObjectiveModal: () => void;
  resetWorkflowSession: () => void;
}

const initialProject = createDefaultProject();

export const useContinuityStore = create<ContinuityStore>((set, get) => ({
  project: initialProject,
  workspace: 'build',
  selectedObjectId: undefined,
  selectedShotId: initialProject.shots[0]?.id,
  selectedLandmarkId: undefined,
  activePanoId: undefined,
  panoView: {
    yawDegrees: 0,
    pitchDegrees: 0,
    fovDegrees: 65,
  },
  buildMode: 'select',
  activePrimitive: 'box',
  gridSnap: true,
  isRenderingGraybox: false,
  isExportingPackage: false,
  shotCameraFlying: true,
  dismissedWorkflowAdvanceKeys: [],
  seenObjectiveWorkspaces: [],
  objectiveModalRequest: 0,

  setWorkspace: (workspace) => set((state) => {
    if (workspace !== 'shots') {
      return { workspace };
    }
    const project = ensureProjectHasCamera(state.project);
    const shot = project.shots.find((item) => item.id === state.selectedShotId)
      ?? project.shots[0];
    return {
      workspace,
      project,
      selectedShotId: shot.id,
      activePanoId: shot.linkedPanoId ?? state.activePanoId,
      panoView: panoViewFromCamera(shot.camera),
      shotCameraFlying: true,
    };
  }),
  setProject: (project) => {
    const linkedProject = linkAllShotsToCanonicalPano(project);
    const canonical = linkedProject.panoRefs.find((pano) => pano.isCanonical) ?? linkedProject.panoRefs[0];
    set({
      project: linkedProject,
      activePanoId: canonical?.id,
      selectedObjectId: project.scene.objects[0]?.id,
      selectedShotId: linkedProject.shots[0]?.id,
      selectedLandmarkId: linkedProject.landmarks[0]?.id,
      buildMode: 'select',
      dismissedWorkflowAdvanceKeys: [],
      seenObjectiveWorkspaces: [],
      objectiveModalRequest: 0,
    });
  },
  updateProjectInfo: (updates) => set((state) => ({
    project: touchProject({ ...state.project, ...updates }),
  })),
  updateProjectSettings: (updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      settings: { ...state.project.settings, ...updates },
    }),
  })),
  setBuildMode: (buildMode) => set({ buildMode }),
  setActivePrimitive: (activePrimitive) => set({
    activePrimitive,
    buildMode: 'place',
    selectedObjectId: undefined,
  }),
  setGridSnap: (gridSnap) => set({ gridSnap }),
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
  placeObject: (type, point) => {
    const state = get();
    const count = state.project.scene.objects.filter((object) => object.type === type).length + 1;
    const object = createPlacedSceneObject({
      type,
      index: count,
      point,
      snapToGrid: state.gridSnap,
    });
    set((current) => ({
      project: touchProject({
        ...current.project,
        scene: {
          ...current.project.scene,
          objects: [...current.project.scene.objects, object],
        },
      }),
      buildMode: 'place',
    }));
    return object;
  },
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
  moveObjectToGroundPoint: (id, point) => set((state) => {
    const object = state.project.scene.objects.find((item) => item.id === id);
    if (!object || object.locked) return state;
    const position = getGroundPlacementPosition(object, point, state.gridSnap);
    return {
      project: touchProject({
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((item) => item.id === id
            ? { ...item, transform: { ...item.transform, position } }
            : item),
        },
      }),
    };
  }),
  duplicateObject: (id) => {
    const state = get();
    const object = state.project.scene.objects.find((item) => item.id === id);
    if (!object) return undefined;
    const count = state.project.scene.objects.filter((item) => item.type === object.type).length + 1;
    const duplicate = duplicateSceneObject(object, count, state.gridSnap);
    set((current) => ({
      project: touchProject({
        ...current.project,
        scene: {
          ...current.project.scene,
          objects: [...current.project.scene.objects, duplicate],
        },
      }),
      selectedObjectId: duplicate.id,
      buildMode: 'select',
    }));
    return duplicate;
  },
  toggleObjectVisibility: (id) => set((state) => ({
    project: touchProject({
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) => object.id === id
          ? { ...object, visible: !object.visible }
          : object),
      },
    }),
  })),
  toggleObjectLocked: (id) => set((state) => ({
    project: touchProject({
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) => object.id === id
          ? { ...object, locked: !object.locked }
          : object),
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
        project: touchProject(linkAllShotsToCanonicalPano({
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
        })),
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
      notes: params.importNote ?? 'Imported canonical global environment reference.',
    });
    return {
      project: touchProject(linkAllShotsToCanonicalPano({
        ...state.project,
        assets: { assets: { ...state.project.assets.assets, [asset.id]: asset } },
        panoRefs: [...state.project.panoRefs.map((existing) => ({ ...existing, isCanonical: false })), pano],
      })),
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
        if (!linkedPano) return shot;
        const mergedPano = { ...linkedPano, ...updates };
        return {
          ...shot,
          panoCrop: getPanoCropSettingsForShot(
            shot.camera,
            mergedPano,
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
  addCamera: () => {
    const state = get();
    const originShot = createOriginShot(state.project, state.project.shots.length + 1);
    const pano = getActivePano(state.project, state.activePanoId);
    return addShotWithCamera(originShot.camera, pano?.id, originShot.name);
  },
  selectShot: (id) => set((state) => {
    const shot = state.project.shots.find((item) => item.id === id);
    if (!shot) return { selectedShotId: id, shotCameraFlying: false };
    return {
      selectedShotId: id,
      activePanoId: shot.linkedPanoId ?? state.activePanoId,
      panoView: panoViewFromCamera(shot.camera),
      shotCameraFlying: true,
    };
  }),
  setShotCameraFlying: (value) => set((state) => {
    if (!value) return { shotCameraFlying: false };
    const shotId = state.selectedShotId;
    if (!shotId) return { shotCameraFlying: true };
    const accepted = { ...state.project.workflow.shotFramingAcceptedAtByShotId };
    delete accepted[shotId];
    return {
      shotCameraFlying: true,
      project: touchProject({
        ...state.project,
        workflow: { ...state.project.workflow, shotFramingAcceptedAtByShotId: accepted },
      }),
    };
  }),
  lockShotCamera: () => {
    if (document.pointerLockElement) document.exitPointerLock();
    set({ shotCameraFlying: false });
  },
  updateShot: (id, updates) => set((state) => ({
    project: touchProject({
      ...state.project,
      shots: state.project.shots.map((shot) => {
        if (shot.id !== id) return shot;
        const updated = { ...shot, ...updates, updatedAt: new Date().toISOString() };
        return withShotPanoLink(state.project, updated);
      }),
    }),
  })),
  removeShot: (id) => set((state) => {
    if (state.project.shots.length <= 1) return state;
    const shots = state.project.shots.filter((shot) => shot.id !== id);
    const nextSelected = state.selectedShotId === id ? shots[0]?.id : state.selectedShotId;
    const nextShot = shots.find((shot) => shot.id === nextSelected);
    return {
      project: touchProject({ ...state.project, shots }),
      selectedShotId: nextSelected,
      panoView: nextShot ? panoViewFromCamera(nextShot.camera) : state.panoView,
    };
  }),
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
  approveGrayboxForReference: () => set((state) => ({
    project: touchProject({
      ...state.project,
      workflow: {
        ...state.project.workflow,
        grayboxApprovedForReferenceAt: new Date().toISOString(),
      },
    }),
  })),
  acceptShotFraming: (shotId) => set((state) => ({
    project: touchProject({
      ...state.project,
      workflow: {
        ...state.project.workflow,
        shotFramingAcceptedAtByShotId: {
          ...state.project.workflow.shotFramingAcceptedAtByShotId,
          [shotId]: new Date().toISOString(),
        },
      },
    }),
  })),
  markAiBriefSent: (shotId) => set((state) => ({
    project: touchProject({
      ...state.project,
      workflow: {
        ...state.project.workflow,
        aiBriefSentAtByShotId: {
          ...state.project.workflow.aiBriefSentAtByShotId,
          [shotId]: new Date().toISOString(),
        },
      },
    }),
  })),
  markFinalPackageExported: (shotId) => set((state) => ({
    project: touchProject({
      ...state.project,
      workflow: {
        ...state.project.workflow,
        finalPackageExportedAtByShotId: {
          ...state.project.workflow.finalPackageExportedAtByShotId,
          [shotId]: new Date().toISOString(),
        },
      },
    }),
  })),
  dismissWorkflowAdvance: (promptKey) => set((state) => ({
    dismissedWorkflowAdvanceKeys: state.dismissedWorkflowAdvanceKeys.includes(promptKey)
      ? state.dismissedWorkflowAdvanceKeys
      : [...state.dismissedWorkflowAdvanceKeys, promptKey],
  })),
  markObjectiveSeen: (workspace) => set((state) => ({
    seenObjectiveWorkspaces: state.seenObjectiveWorkspaces.includes(workspace)
      ? state.seenObjectiveWorkspaces
      : [...state.seenObjectiveWorkspaces, workspace],
  })),
  requestObjectiveModal: () => set((state) => ({
    objectiveModalRequest: state.objectiveModalRequest + 1,
  })),
  resetWorkflowSession: () => set({
    dismissedWorkflowAdvanceKeys: [],
    seenObjectiveWorkspaces: [],
    objectiveModalRequest: 0,
  }),
}));

function touchProject(project: LocationProject): LocationProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

function ensureProjectHasCamera(project: LocationProject): LocationProject {
  const withShots = project.shots.length > 0
    ? project
    : touchProject({ ...project, shots: [createOriginShot(project)] });
  return linkAllShotsToCanonicalPano(withShots);
}

function getActivePano(project: LocationProject, activePanoId?: string): PanoReference | undefined {
  return project.panoRefs.find((pano) => pano.id === activePanoId)
    ?? project.panoRefs.find((pano) => pano.isCanonical)
    ?? project.panoRefs[0];
}

function addShotWithCamera(camera: CameraData, linkedPanoId?: string, name?: string): Shot {
  const state = useContinuityStore.getState();
  const linkedPano = linkedPanoId
    ? state.project.panoRefs.find((pano) => pano.id === linkedPanoId)
    : getCanonicalPano(state.project);
  const shot = withShotPanoLink(
    state.project,
    createShot({
      index: state.project.shots.length + 1,
      camera,
      linkedPanoId: linkedPano?.id,
    }),
    linkedPano,
  );
  if (name) shot.name = name;

  useContinuityStore.setState((current) => ({
    project: touchProject({
      ...current.project,
      shots: [...current.project.shots, shot],
    }),
    selectedShotId: shot.id,
    workspace: 'shots',
    shotCameraFlying: true,
  }));

  return shot;
}
