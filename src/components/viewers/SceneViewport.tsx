import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { objectDisplayName } from '../../domain/defaults';
import { CameraData, Euler, LocationProject, SceneObject, SceneObjectType, Vec3 } from '../../domain/types';
import { isBuildFreeCameraKey } from '../../engine/buildShortcuts';
import {
  createForwardSprintState,
  isForwardSprinting,
  reduceForwardSprint,
  type ForwardSprintState,
} from '../../engine/forwardSprint';
import { BUILD_GRID_SIZE, createPlacedSceneObject, resolveStampPoint } from '../../engine/sandbox';
import { getHumanMannequinRevision, subscribeHumanMannequinReady } from '../../engine/humanMannequinModel';
import {
  resolveProjectedProjectorAssets,
  resolveProjectionWarpWithStrengthForProject,
  type ResolvedWarpWithStrength,
} from '../../engine/multiOriginProjection';
import {
  computeProjectedAppearanceState,
  normalizeProjectedStyleSettings,
  type ViewportAppearanceMode,
} from '../../engine/projectedStyle';
import {
  acquireProjectedStyleTexture,
  disposeProjectedTextureOwnership,
  prepareProjectedTextureRequest,
  resolveProjectedTextureRequest,
  type ProjectedTextureOwnership,
} from '../../engine/projectedStyleMaterials';
import { buildScene, computeBuildFogRange, createPreviewMesh, disposePreviewMesh, disposeScene } from '../../engine/sceneObjects';
import { createAlignmentMarkerOverlay, disposeAlignmentOverlay } from '../../engine/projectionAlignmentDebug';
import { findProjectionAlignmentForPano } from '../../domain/defaults';
import type { WarpTextureResult } from '../../engine/projectionWarpTexture';
import {
  angleInAxisPlane,
  applyAxisRotationDelta,
  applyAxisScaleDelta,
  axisWorldVector,
  computeScreenAxisDragDelta,
  createGizmoGroup,
  createPanoOriginGizmoGroup,
  getGizmoWorldPosition,
  createSelectionOutline,
  disposeGizmoNodes,
  findGizmoHit,
  findSceneObjectMesh,
  intersectAxisDragPlane,
  updateGroupTransformGizmo,
  updateTransformGizmo,
  vec3FromVector3,
  type GizmoAxis,
  type GizmoHit,
  type GizmoMode,
} from '../../engine/transformGizmo';
import { clampFlyCameraPosition, computeSceneFlyBounds } from '../../engine/flyCameraBounds';
import { sceneEnvelope, selectionBounds } from '../../engine/buildSelection';
import { applyFlyCameraToPerspectiveCamera } from '../../engine/renderers';
import {
  cameraFromOrbit,
  cameraOrbitFromCamera,
  cameraFromFlyState,
  flyCameraFromCamera,
  horizontalFlyDirections,
  type FlyCameraState,
} from '../../engine/sync';
import {
  clampBuildRenderDistance,
  computeFullCssRendererRect,
  DEFAULT_BUILD_RENDER_DISTANCE,
  type CssRendererRect,
} from '../../engine/viewport';
import { useThemeStore } from '../../state/useThemeStore';
import { ShotViewfinderOverlay } from './ShotViewfinderOverlay';

type DragKind =
  | 'idle'
  | 'orbit'
  | 'gizmo_translate'
  | 'gizmo_rotate'
  | 'gizmo_scale'
  | 'origin_gizmo_translate'
  | 'origin_gizmo_rotate'
  | 'place'
  | 'shot_framing'
  | 'free_camera';

const FLY_SPEED = 6;
const FLY_SPRINT_MULTIPLIER = 2.4;
const LOOK_SENSITIVITY = 0.12;
const MAX_INTERACTIVE_PIXEL_RATIO = 1.5;

function sceneBoundingRadius(project: LocationProject): number {
  const box = sceneEnvelope(project.scene);
  return Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 2);
}

interface DragState {
  kind: DragKind;
  x: number;
  y: number;
  moved: boolean;
  /** Scene object being manipulated by a gizmo gesture. */
  objectId?: string;
  forceOrbit?: boolean;
  gizmoAxis?: GizmoAxis;
  gizmoScaleAxis?: GizmoAxis | 'uniform';
  gizmoStartPosition?: Vec3;
  gizmoStartRotation?: Vec3;
  gizmoStartDimensions?: Vec3;
  gizmoAxisStartPoint?: THREE.Vector3;
  gizmoRotateStartAngle?: number;
  gizmoUniformStartDistance?: number;
  gizmoScreenStartX?: number;
  gizmoScreenStartY?: number;
  pendingSelectId?: string;
  pendingSelectionMode?: 'replace' | 'toggle';
}

export function SceneViewport({
  project,
  selectedObjectIds = [],
  selectedShotId,
  placementType,
  placementLabel,
  originPlacementActive = false,
  showSceneGuides = false,
  showTransformGizmo = false,
  gizmoMode = 'translate',
  snapToGrid = true,
  freeCameraActive = false,
  renderDistance = DEFAULT_BUILD_RENDER_DISTANCE,
  appearance = 'clay',
  showAlignmentOverlay = false,
  onFreeCameraActiveChange,
  shotFraming,
  onSelectObject,
  onPlaceObject,
  onMoveObject,
  onMoveObjectInSpace,
  onRotateObject,
  onScaleObject,
  onMovePanoOrigin,
  onRotatePanoOrigin,
  onRequestPanoOriginEdit,
  onEditBatchStart,
  onEditBatchEnd,
  frameRequest = 0,
  frameObjectIds = [],
  minHeightClassName = 'min-h-[420px]',
}: {
  project: LocationProject;
  selectedObjectIds?: string[];
  selectedShotId?: string;
  placementType?: SceneObjectType;
  placementLabel?: string;
  originPlacementActive?: boolean;
  showSceneGuides?: boolean;
  showTransformGizmo?: boolean;
  gizmoMode?: GizmoMode;
  snapToGrid?: boolean;
  /** Opt-in Build navigation mode; the default viewport remains orbit/select. */
  freeCameraActive?: boolean;
  /** Build viewport far clipping distance in meters; shot framing keeps its own camera data. */
  renderDistance?: number;
  /** Clay keeps existing materials; Projected applies world-space equirect styling when available. */
  appearance?: ViewportAppearanceMode;
  /** When true, renders alignment marker pins + connecting lines in 3D space. */
  showAlignmentOverlay?: boolean;
  onFreeCameraActiveChange?: (active: boolean) => void;
  shotFraming?: {
    camera: CameraData;
    frameAspectRatio: number;
    frameResolutionLabel: string;
    flyActive: boolean;
    onCameraChange: (camera: CameraData) => void;
    onLockCamera?: () => void;
  };
  onSelectObject?: (id?: string, mode?: 'replace' | 'toggle') => void;
  onPlaceObject?: (type: SceneObjectType, point: Vec3) => void;
  onMoveObject?: (id: string, point: Vec3) => void;
  onMoveObjectInSpace?: (id: string, point: Vec3) => void;
  onRotateObject?: (id: string, rotation: Vec3) => void;
  onScaleObject?: (id: string, dimensions: Vec3) => void;
  onMovePanoOrigin?: (origin: Vec3) => void;
  /** Capture-origin rotation (degrees Euler) while Origin mode gizmo is used. */
  onRotatePanoOrigin?: (rotation: Euler) => void;
  /**
   * Called when the user attempts to start an origin gizmo drag.
   * Return true to allow the edit, false to cancel (no drag, no history).
   * This is the place for the styled-panorama warning to block the interaction.
   */
  onRequestPanoOriginEdit?: () => boolean;
  /** Wrap continuous gizmo / origin drags so undo records one step per gesture. */
  onEditBatchStart?: () => void;
  onEditBatchEnd?: () => void;
  frameRequest?: number;
  frameObjectIds?: string[];
  minHeightClassName?: string;
}) {
  const theme = useThemeStore((state) => state.theme);
  const [mannequinRevision, setMannequinRevision] = useState(getHumanMannequinRevision);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const orbitRef = useRef({ yaw: -34, pitch: 28, distance: 15.5, target: new THREE.Vector3(0, 1.15, 1.25) });
  const freeCameraActiveRef = useRef(freeCameraActive);
  const freeCameraModeRef = useRef(freeCameraActive);
  const renderDistanceRef = useRef(clampBuildRenderDistance(renderDistance));
  const dragRef = useRef<DragState>({ kind: 'idle', x: 0, y: 0, moved: false });
  const lastFloorPointRef = useRef<Vec3 | undefined>();
  const selectedObjectIdsRef = useRef(selectedObjectIds);
  const projectRef = useRef(project);
  const snapToGridRef = useRef(snapToGrid);
  const callbacksRef = useRef({
    onSelectObject,
    onPlaceObject,
    onMoveObject,
    onMoveObjectInSpace,
    onRotateObject,
    onScaleObject,
    onMovePanoOrigin,
    onRotatePanoOrigin,
    onEditBatchStart,
    onEditBatchEnd,
    onFreeCameraActiveChange,
    onRequestPanoOriginEdit,
  });
  const editBatchActiveRef = useRef(false);
  const previewPointRef = useRef<Vec3 | undefined>();
  const previewMeshRef = useRef<THREE.Object3D | null>(null);
  const placementTypeRef = useRef(placementType);
  const shotFramingRef = useRef(shotFraming);
  const framingFovRef = useRef(shotFraming?.camera.fovDegrees ?? 52);
  const flyRef = useRef<FlyCameraState>({
    position: [0, 1.6, -5],
    yawDegrees: 0,
    pitchDegrees: 0,
  });
  const flyKeysRef = useRef(new Set<string>());
  const forwardSprintRef = useRef<ForwardSprintState>(createForwardSprintState());
  /** Continuous axes from touch pad: forward/back, strafe, up/down in [-1, 1]. */
  const flyAxesRef = useRef({ forward: 0, strafe: 0, vertical: 0 });
  const flyBoundsRef = useRef(computeSceneFlyBounds(project.scene));
  const lastFrameTimeRef = useRef(performance.now());
  const flyDirtyRef = useRef(false);
  /** Requested vs owned URL ownership — prevents A→B→C leaks (see prepareProjectedTextureRequest). */
  const primaryOwnershipRef = useRef<ProjectedTextureOwnership>({});
  const secondaryOwnershipRef = useRef<ProjectedTextureOwnership>({});
  /** Current warp texture results; released on effect re-run or unmount. */
  const primaryWarpRef = useRef<WarpTextureResult | undefined>();
  const secondaryWarpRef = useRef<WarpTextureResult | undefined>();
  /** Alignment debug overlay group added to the scene. */
  const alignmentOverlayRef = useRef<THREE.Group | null>(null);

  const [projectedTexture, setProjectedTexture] = useState<THREE.Texture | null>(null);
  const [projectedSecondaryTexture, setProjectedSecondaryTexture] = useState<THREE.Texture | null>(null);
  const [projectedTextureReadyUrl, setProjectedTextureReadyUrl] = useState<string | undefined>();
  const [projectedSecondaryReadyUrl, setProjectedSecondaryReadyUrl] = useState<string | undefined>();
  const [secondaryLoadError, setSecondaryLoadError] = useState(false);
  const gizmoRef = useRef<THREE.Group | null>(null);
  const selectionOutlineRefs = useRef<THREE.BoxHelper[]>([]);
  const showSceneGuidesRef = useRef(showSceneGuides);
  const showTransformGizmoRef = useRef(showTransformGizmo);
  const gizmoModeRef = useRef(gizmoMode);
  const originPlacementActiveRef = useRef(originPlacementActive);

  selectedObjectIdsRef.current = selectedObjectIds;
  projectRef.current = project;
  flyBoundsRef.current = computeSceneFlyBounds(project.scene);
  snapToGridRef.current = snapToGrid;
  freeCameraActiveRef.current = freeCameraActive;
  renderDistanceRef.current = clampBuildRenderDistance(renderDistance);
  placementTypeRef.current = placementType;
  shotFramingRef.current = shotFraming;
  showSceneGuidesRef.current = showSceneGuides;
  showTransformGizmoRef.current = showTransformGizmo;
  gizmoModeRef.current = gizmoMode;
  originPlacementActiveRef.current = originPlacementActive;
  callbacksRef.current = {
    onSelectObject,
    onPlaceObject,
    onMoveObject,
    onMoveObjectInSpace,
    onRotateObject,
    onScaleObject,
    onMovePanoOrigin,
    onRotatePanoOrigin,
    onEditBatchStart,
    onEditBatchEnd,
    onFreeCameraActiveChange,
    onRequestPanoOriginEdit,
  };

  const clearTransformGizmo = useCallback(() => {
    const scene = sceneRef.current;
    const nodes = [gizmoRef.current, ...selectionOutlineRefs.current].filter(Boolean) as THREE.Object3D[];
    if (scene) {
      nodes.forEach((node) => scene.remove(node));
    }
    if (nodes.length > 0) disposeGizmoNodes(nodes);
    gizmoRef.current = null;
    selectionOutlineRefs.current = [];
  }, []);

  const syncTransformGizmo = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || shotFramingRef.current || !showTransformGizmoRef.current) {
      clearTransformGizmo();
      return;
    }

    // Capture-origin gizmos: translate / rotate only (scale is not meaningful for a point origin).
    if (originPlacementActiveRef.current) {
      const originMode: GizmoMode = gizmoModeRef.current === 'rotate' ? 'rotate' : 'translate';
      const origin = projectRef.current.scene.panoOrigin;
      const needsNewGizmo = !gizmoRef.current
        || gizmoRef.current.userData.gizmoMode !== originMode
        || gizmoRef.current.userData.originGizmo !== true;
      if (needsNewGizmo) {
        if (gizmoRef.current) {
          scene.remove(gizmoRef.current);
          disposeGizmoNodes([gizmoRef.current]);
        }
        selectionOutlineRefs.current.forEach((outline) => {
          scene.remove(outline);
        });
        disposeGizmoNodes(selectionOutlineRefs.current);
        selectionOutlineRefs.current = [];
        gizmoRef.current = createPanoOriginGizmoGroup(originMode);
        gizmoRef.current.userData.originGizmo = true;
        scene.add(gizmoRef.current);
      }
      if (gizmoRef.current) {
        gizmoRef.current.position.fromArray(origin);
        gizmoRef.current.scale.setScalar(0.95);
        gizmoRef.current.rotation.set(0, 0, 0);
        gizmoRef.current.visible = true;
      }
      return;
    }

    const selectedIds = selectedObjectIdsRef.current;
    if (selectedIds.length === 0) {
      clearTransformGizmo();
      return;
    }

    const objectMeshes = selectedIds
      .map((id) => findSceneObjectMesh(scene, id))
      .filter((mesh): mesh is THREE.Object3D => Boolean(mesh));
    if (objectMeshes.length !== selectedIds.length) {
      clearTransformGizmo();
      return;
    }

    const needsNewGizmo = !gizmoRef.current
      || gizmoRef.current.userData.gizmoMode !== gizmoModeRef.current
      || gizmoRef.current.userData.originGizmo === true;
    if (needsNewGizmo) {
      if (gizmoRef.current) {
        scene.remove(gizmoRef.current);
        disposeGizmoNodes([gizmoRef.current]);
      }
      gizmoRef.current = createGizmoGroup(gizmoModeRef.current);
      gizmoRef.current.userData.originGizmo = false;
      scene.add(gizmoRef.current);
    }

    const outlinesMatch = selectionOutlineRefs.current.length === selectedIds.length
      && selectionOutlineRefs.current.every((outline, index) => outline.userData.selectionId === selectedIds[index]);
    if (!outlinesMatch) {
      selectionOutlineRefs.current.forEach((outline) => {
        scene.remove(outline);
        disposeGizmoNodes([outline]);
      });
      selectionOutlineRefs.current = objectMeshes.map((mesh, index) => {
        const outline = createSelectionOutline(mesh);
        outline.userData.selectionId = selectedIds[index];
        const material = outline.material as THREE.LineBasicMaterial;
        material.color.set(index === selectedIds.length - 1 ? 0x14b8a6 : 0x60a5fa);
        material.opacity = index === selectedIds.length - 1 ? 1 : 0.65;
        scene.add(outline);
        return outline;
      });
    }

    if (selectedIds.length === 1) {
      const object = projectRef.current.scene.objects.find((item) => item.id === selectedIds[0]);
      if (object) updateTransformGizmo(gizmoRef.current, selectionOutlineRefs.current[0], objectMeshes[0], object);
    } else {
      updateGroupTransformGizmo(gizmoRef.current, selectionOutlineRefs.current, objectMeshes);
    }
  }, [clearTransformGizmo]);

  const emitFramingCamera = useCallback(() => {
    const framing = shotFramingRef.current;
    if (!framing) return;
    const camera = cameraFromFlyState(
      flyRef.current,
      framingFovRef.current,
      framing.camera.aspectRatio,
      framing.camera.near,
      framing.camera.far,
    );
    framing.onCameraChange(camera);
    flyDirtyRef.current = false;
  }, []);

  const clearPreviewMesh = useCallback(() => {
    const scene = sceneRef.current;
    const preview = previewMeshRef.current;
    if (!scene || !preview) return;
    scene.remove(preview);
    disposePreviewMesh(preview);
    previewMeshRef.current = null;
  }, []);

  const updatePreviewMesh = useCallback((point?: Vec3) => {
    previewPointRef.current = point;
    const scene = sceneRef.current;
    if (!scene) return;

    const existingPreview = previewMeshRef.current;
    if (existingPreview) {
      scene.remove(existingPreview);
      disposePreviewMesh(existingPreview);
      previewMeshRef.current = null;
    }

    const activePlacementType = placementTypeRef.current;
    if (!activePlacementType || !point) return;

    const count = projectRef.current.scene.objects.filter((object) => object.type === activePlacementType).length + 1;
    const previewObject = createPlacedSceneObject({
      type: activePlacementType,
      index: count,
      point,
      snapToGrid: snapToGridRef.current,
    });
    const preview = createPreviewMesh(previewObject, theme);
    scene.add(preview);
    previewMeshRef.current = preview;
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_INTERACTIVE_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'absolute inset-0 block h-full w-full touch-none';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(framingFovRef.current, 1, 0.1, renderDistanceRef.current);
    cameraRef.current = camera;

    const syncViewportSize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = Math.max(1, containerRef.current.clientWidth);
      const height = Math.max(1, containerRef.current.clientHeight);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height, false);
    };

    syncViewportSize();
    const resizeObserver = new ResizeObserver(() => syncViewportSize());
    resizeObserver.observe(container);
    window.addEventListener('resize', syncViewportSize);

    const processFlyMovement = (deltaSeconds: number) => {
      const keys = flyKeysRef.current;
      const axes = flyAxesRef.current;
      let axisForward = 0;
      let axisStrafe = 0;
      let axisVertical = 0;
      if (keys.has('KeyW')) axisForward += 1;
      if (keys.has('KeyS')) axisForward -= 1;
      if (keys.has('KeyA')) axisStrafe -= 1;
      if (keys.has('KeyD')) axisStrafe += 1;
      if (keys.has('Space')) axisVertical += 1;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) axisVertical -= 1;
      // Touch pad fills axes when keyboard is not driving that channel.
      if (axisForward === 0) axisForward = axes.forward;
      if (axisStrafe === 0) axisStrafe = axes.strafe;
      if (axisVertical === 0) axisVertical = axes.vertical;
      if (axisForward === 0 && axisStrafe === 0 && axisVertical === 0) return;

      const fly = flyRef.current;
      const { forward, right } = horizontalFlyDirections(fly.yawDegrees);
      const moveX = forward[0] * axisForward + right[0] * axisStrafe;
      const moveY = axisVertical;
      const moveZ = forward[2] * axisForward + right[2] * axisStrafe;
      const length = Math.hypot(moveX, moveY, moveZ);
      if (length === 0) return;
      const sprinting = isForwardSprinting(forwardSprintRef.current);
      const speed = FLY_SPEED * (sprinting ? FLY_SPRINT_MULTIPLIER : 1);
      const step = (speed * deltaSeconds) / length;
      fly.position = clampFlyCameraPosition(
        [
          fly.position[0] + moveX * step,
          fly.position[1] + moveY * step,
          fly.position[2] + moveZ * step,
        ],
        flyBoundsRef.current,
      );
      flyDirtyRef.current = true;
    };

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const activeCamera = cameraRef.current;
      const activeRenderer = rendererRef.current;
      const activeScene = sceneRef.current;
      if (!activeCamera || !activeRenderer || !activeScene) return;

      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = now;

      const framing = shotFramingRef.current;
      const container = containerRef.current;
      const cssWidth = Math.max(1, container?.clientWidth ?? 1);
      const cssHeight = Math.max(1, container?.clientHeight ?? 1);

      if (framing || freeCameraActiveRef.current) {
        if (framing?.flyActive || freeCameraActiveRef.current) processFlyMovement(deltaSeconds);
        if (framing && flyDirtyRef.current) emitFramingCamera();
        applyFlyCameraToPerspectiveCamera(
          activeCamera,
          flyRef.current,
          framingFovRef.current,
          framing?.frameAspectRatio ?? cssWidth / cssHeight,
          0.1,
          framing?.camera.far ?? renderDistanceRef.current,
        );

        const viewport = computeFullCssRendererRect(cssWidth, cssHeight);
        setRendererRect(activeRenderer, 'viewport', viewport);
        setRendererRect(activeRenderer, 'scissor', viewport);
        activeRenderer.setScissorTest(false);
        activeRenderer.render(activeScene, activeCamera);
      } else {
        const viewport = computeFullCssRendererRect(cssWidth, cssHeight);
        setRendererRect(activeRenderer, 'viewport', viewport);
        setRendererRect(activeRenderer, 'scissor', viewport);
        activeRenderer.setScissorTest(false);
        updateCamera(activeCamera, orbitRef.current);
        activeRenderer.render(activeScene, activeCamera);
      }
    };
    animate();

    const canvas = renderer.domElement;

    const beginOrbitDrag = (event: PointerEvent, forceOrbit = false) => {
      dragRef.current = {
        kind: 'orbit',
        x: event.clientX,
        y: event.clientY,
        moved: false,
        forceOrbit,
      };
      canvas.setPointerCapture(event.pointerId);
    };

    const startEditBatch = () => {
      if (editBatchActiveRef.current) return;
      editBatchActiveRef.current = true;
      callbacksRef.current.onEditBatchStart?.();
    };

    const endEditBatch = () => {
      if (!editBatchActiveRef.current) return;
      editBatchActiveRef.current = false;
      callbacksRef.current.onEditBatchEnd?.();
    };

    const beginOriginGizmoDrag = (
      gizmoHit: GizmoHit,
      pointer: ReturnType<typeof getPointerState>,
      event: PointerEvent,
    ) => {
      const { onMovePanoOrigin, onRotatePanoOrigin, onRequestPanoOriginEdit } = callbacksRef.current;
      // Check consent before starting any drag or batch.
      const allowed = onRequestPanoOriginEdit?.() ?? true;
      if (!allowed) return false;

      const gizmo = gizmoRef.current;
      const camera = cameraRef.current;
      if (!gizmo || !camera || !pointer) return false;
      const origin = projectRef.current.scene.panoOrigin;
      const rotation = projectRef.current.scene.panoRotation;

      if (gizmoHit.kind === 'translate' && onMovePanoOrigin) {
        const axisOrigin = getGizmoWorldPosition(gizmo);
        const axisDirection = axisWorldVector(gizmoHit.axis, gizmo);
        const axisStartPoint = intersectAxisDragPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
          camera,
        );
        if (!axisStartPoint) return false;
        startEditBatch();
        dragRef.current = {
          kind: 'origin_gizmo_translate',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          gizmoAxis: gizmoHit.axis,
          gizmoStartPosition: [...origin] as Vec3,
          gizmoAxisStartPoint: axisStartPoint,
        };
        canvas.setPointerCapture(event.pointerId);
        return true;
      }

      if (gizmoHit.kind === 'rotate' && onRotatePanoOrigin) {
        const axisOrigin = getGizmoWorldPosition(gizmo);
        const axisDirection = axisWorldVector(gizmoHit.axis, gizmo);
        const startAngle = angleInAxisPlane(pointer.raycaster, axisOrigin, axisDirection);
        if (startAngle === undefined) return false;
        startEditBatch();
        dragRef.current = {
          kind: 'origin_gizmo_rotate',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          gizmoAxis: gizmoHit.axis,
          gizmoStartRotation: [...rotation] as Vec3,
          gizmoRotateStartAngle: startAngle,
        };
        canvas.setPointerCapture(event.pointerId);
        return true;
      }

      return false;
    };

    const beginGizmoDrag = (
      gizmoHit: GizmoHit,
      object: SceneObject,
      pointer: ReturnType<typeof getPointerState>,
      event: PointerEvent,
    ) => {
      const {
        onMoveObjectInSpace,
        onRotateObject,
        onScaleObject,
      } = callbacksRef.current;
      const gizmo = gizmoRef.current;
      const camera = cameraRef.current;
      if (!gizmo || !camera || !pointer) return false;

      if (gizmoHit.kind === 'translate' && onMoveObjectInSpace) {
        const axisOrigin = getGizmoWorldPosition(gizmo);
        const axisDirection = axisWorldVector(gizmoHit.axis, gizmo);
        const axisStartPoint = intersectAxisDragPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
          camera,
        );
        if (!axisStartPoint) return false;
        startEditBatch();
        dragRef.current = {
          kind: 'gizmo_translate',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          objectId: object.id,
          gizmoAxis: gizmoHit.axis,
          gizmoStartPosition: [...object.transform.position] as Vec3,
          gizmoAxisStartPoint: axisStartPoint,
        };
        canvas.setPointerCapture(event.pointerId);
        return true;
      }

      if (gizmoHit.kind === 'rotate' && onRotateObject) {
        const axisOrigin = getGizmoWorldPosition(gizmo);
        const axisDirection = axisWorldVector(gizmoHit.axis, gizmo);
        const startAngle = angleInAxisPlane(pointer.raycaster, axisOrigin, axisDirection);
        if (startAngle === undefined) return false;
        startEditBatch();
        dragRef.current = {
          kind: 'gizmo_rotate',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          objectId: object.id,
          gizmoAxis: gizmoHit.axis,
          gizmoStartRotation: [...object.transform.rotation] as Vec3,
          gizmoRotateStartAngle: startAngle,
        };
        canvas.setPointerCapture(event.pointerId);
        return true;
      }

      if (gizmoHit.kind === 'scale' && onScaleObject) {
        if (gizmoHit.axis === 'uniform') {
          startEditBatch();
          dragRef.current = {
            kind: 'gizmo_scale',
            x: event.clientX,
            y: event.clientY,
            moved: false,
            objectId: object.id,
            gizmoScaleAxis: 'uniform',
            gizmoStartDimensions: [...object.dimensions] as Vec3,
            gizmoUniformStartDistance: event.clientY,
          };
          canvas.setPointerCapture(event.pointerId);
          return true;
        }
        startEditBatch();
        dragRef.current = {
          kind: 'gizmo_scale',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          objectId: object.id,
          gizmoAxis: gizmoHit.axis,
          gizmoScaleAxis: gizmoHit.axis,
          gizmoStartDimensions: [...object.dimensions] as Vec3,
          gizmoScreenStartX: event.clientX,
          gizmoScreenStartY: event.clientY,
        };
        canvas.setPointerCapture(event.pointerId);
        return true;
      }

      return false;
    };

    const onPointerDown = (event: PointerEvent) => {
      const framing = shotFramingRef.current;
      if (framing?.flyActive && event.button === 0) {
        dragRef.current = {
          kind: 'shot_framing',
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      if (framing) return;

      if (freeCameraActiveRef.current && event.button === 0) {
        event.preventDefault();
        dragRef.current = {
          kind: 'free_camera',
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        beginOrbitDrag(event, true);
        return;
      }

      if (event.button !== 0) return;

      const pointer = getPointerState(
        event,
        canvas,
        cameraRef.current,
        orbitRef.current,
        sceneRef.current,
        snapToGridRef.current,
      );
      if (!pointer) return;
      const floorPoint = pointer.floorPoint;
      const hit = getSceneHit(pointer.raycaster, sceneRef.current);
      const activePlacementType = placementTypeRef.current;
      const originPlacement = originPlacementActiveRef.current;
      const { onMoveObject, onMovePanoOrigin, onSelectObject } = callbacksRef.current;
      const activeProject = projectRef.current;
      const activeSnapToGrid = snapToGridRef.current;

      if (activePlacementType) {
        dragRef.current = {
          kind: 'place',
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        if (floorPoint) {
          lastFloorPointRef.current = floorPoint;
          updatePreviewMesh(floorPoint);
        }
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      // Origin mode: translate / rotate gizmos at the capture origin (no floor-click reposition).
      if (originPlacement && showTransformGizmoRef.current && gizmoRef.current && cameraRef.current) {
        const originMode: GizmoMode = gizmoModeRef.current === 'rotate' ? 'rotate' : 'translate';
        const originGizmoHit = findGizmoHit(pointer.raycaster, gizmoRef.current, originMode);
        if (originGizmoHit) {
          // Always consume the hit — even if consent is denied, do not fall through to orbit.
          beginOriginGizmoDrag(originGizmoHit, pointer, event);
          return;
        }
        beginOrbitDrag(event);
        return;
      }

      const hitObject = hit?.objectId
        ? activeProject.scene.objects.find((object) => object.id === hit.objectId)
        : undefined;
      const inSelectMode = !activePlacementType && !originPlacement;
      const gizmoHit = inSelectMode && showTransformGizmoRef.current
        ? findGizmoHit(pointer.raycaster, gizmoRef.current, gizmoModeRef.current)
        : undefined;
      if (
        inSelectMode
        && gizmoHit
        && selectedObjectIdsRef.current.length > 0
        && gizmoRef.current
        && cameraRef.current
      ) {
        const activeId = selectedObjectIdsRef.current.at(-1);
        const object = activeProject.scene.objects.find((item) => item.id === activeId);
        if (object && !object.locked && beginGizmoDrag(gizmoHit, object, pointer, event)) {
          return;
        }
      }
      beginOrbitDrag(event);
      dragRef.current.pendingSelectId = hitObject?.id;
      dragRef.current.pendingSelectionMode = event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const placementPreviewActive = Boolean(placementTypeRef.current);
      if (drag.kind === 'idle' && !placementPreviewActive) return;

      const needsFloorPoint = placementPreviewActive;
      const needsRaycaster = needsFloorPoint
        || drag.kind === 'gizmo_translate'
        || drag.kind === 'gizmo_rotate'
        || drag.kind === 'origin_gizmo_translate'
        || drag.kind === 'origin_gizmo_rotate';
      const pointer = needsRaycaster
        ? getPointerState(
            event,
            canvas,
            cameraRef.current,
            orbitRef.current,
            sceneRef.current,
            snapToGridRef.current,
            needsFloorPoint,
          )
        : undefined;
      if (placementTypeRef.current && pointer?.floorPoint) {
        lastFloorPointRef.current = pointer.floorPoint;
        updatePreviewMesh(pointer.floorPoint);
      }
      if (drag.kind === 'idle') return;

      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;

      const {
        onMoveObjectInSpace,
        onRotateObject,
        onScaleObject,
        onMovePanoOrigin,
        onRotatePanoOrigin,
      } = callbacksRef.current;

      if (
        drag.kind === 'gizmo_translate'
        && drag.objectId
        && drag.gizmoAxis
        && drag.gizmoStartPosition
        && drag.gizmoAxisStartPoint
        && gizmoRef.current
        && cameraRef.current
        && pointer
        && onMoveObjectInSpace
      ) {
        const axisOrigin = getGizmoWorldPosition(gizmoRef.current);
        const axisDirection = axisWorldVector(drag.gizmoAxis, gizmoRef.current);
        const intersection = intersectAxisDragPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
          cameraRef.current,
        );
        if (intersection) {
          const delta = intersection.clone().sub(drag.gizmoAxisStartPoint);
          const projected = axisDirection.clone().multiplyScalar(delta.dot(axisDirection));
          const next = new THREE.Vector3().fromArray(drag.gizmoStartPosition).add(projected);
          onMoveObjectInSpace(drag.objectId, vec3FromVector3(next));
          syncTransformGizmo();
        }
        return;
      }

      if (
        drag.kind === 'gizmo_rotate'
        && drag.objectId
        && drag.gizmoAxis
        && drag.gizmoStartRotation
        && drag.gizmoRotateStartAngle !== undefined
        && gizmoRef.current
        && pointer
        && onRotateObject
      ) {
        const axisOrigin = getGizmoWorldPosition(gizmoRef.current);
        const axisDirection = axisWorldVector(drag.gizmoAxis, gizmoRef.current);
        const currentAngle = angleInAxisPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
        );
        if (currentAngle !== undefined) {
          const delta = currentAngle - drag.gizmoRotateStartAngle;
          onRotateObject(
            drag.objectId,
            applyAxisRotationDelta(drag.gizmoStartRotation, drag.gizmoAxis, delta),
          );
          syncTransformGizmo();
        }
        return;
      }

      if (
        drag.kind === 'gizmo_scale'
        && drag.objectId
        && drag.gizmoScaleAxis
        && drag.gizmoStartDimensions
        && onScaleObject
      ) {
        if (drag.gizmoScaleAxis === 'uniform' && drag.gizmoUniformStartDistance !== undefined) {
          const delta = (drag.gizmoUniformStartDistance - event.clientY) * 0.01;
          onScaleObject(drag.objectId, applyAxisScaleDelta(drag.gizmoStartDimensions, 'uniform', delta));
          syncTransformGizmo();
          return;
        }
        if (
          drag.gizmoAxis
          && drag.gizmoScaleAxis
          && drag.gizmoScaleAxis !== 'uniform'
          && drag.gizmoScreenStartX !== undefined
          && drag.gizmoScreenStartY !== undefined
          && gizmoRef.current
          && cameraRef.current
        ) {
          const delta = computeScreenAxisDragDelta(
            drag.gizmoAxis,
            gizmoRef.current,
            cameraRef.current,
            canvas,
            drag.gizmoScreenStartX,
            drag.gizmoScreenStartY,
            event.clientX,
            event.clientY,
          );
          onScaleObject(
            drag.objectId,
            applyAxisScaleDelta(drag.gizmoStartDimensions, drag.gizmoScaleAxis, delta),
          );
          syncTransformGizmo();
        }
        return;
      }

      if (
        drag.kind === 'origin_gizmo_translate'
        && drag.gizmoAxis
        && drag.gizmoStartPosition
        && drag.gizmoAxisStartPoint
        && gizmoRef.current
        && pointer
        && onMovePanoOrigin
        && cameraRef.current
      ) {
        const axisOrigin = getGizmoWorldPosition(gizmoRef.current);
        const axisDirection = axisWorldVector(drag.gizmoAxis, gizmoRef.current);
        const intersection = intersectAxisDragPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
          cameraRef.current,
        );
        if (intersection) {
          const delta = intersection.clone().sub(drag.gizmoAxisStartPoint);
          const projected = axisDirection.clone().multiplyScalar(delta.dot(axisDirection));
          const next = new THREE.Vector3().fromArray(drag.gizmoStartPosition).add(projected);
          if (snapToGridRef.current) {
            next.x = Math.round(next.x / BUILD_GRID_SIZE) * BUILD_GRID_SIZE;
            next.z = Math.round(next.z / BUILD_GRID_SIZE) * BUILD_GRID_SIZE;
          }
          onMovePanoOrigin([
            Number(next.x.toFixed(3)),
            Number(next.y.toFixed(3)),
            Number(next.z.toFixed(3)),
          ]);
          syncTransformGizmo();
        }
        return;
      }

      if (
        drag.kind === 'origin_gizmo_rotate'
        && drag.gizmoAxis
        && drag.gizmoStartRotation
        && drag.gizmoRotateStartAngle !== undefined
        && gizmoRef.current
        && pointer
        && onRotatePanoOrigin
      ) {
        const axisOrigin = getGizmoWorldPosition(gizmoRef.current);
        const axisDirection = axisWorldVector(drag.gizmoAxis, gizmoRef.current);
        const currentAngle = angleInAxisPlane(
          pointer.raycaster,
          axisOrigin,
          axisDirection,
        );
        if (currentAngle !== undefined) {
          const delta = currentAngle - drag.gizmoRotateStartAngle;
          onRotatePanoOrigin(
            applyAxisRotationDelta(drag.gizmoStartRotation, drag.gizmoAxis, delta),
          );
          syncTransformGizmo();
        }
        return;
      }

      if (drag.kind === 'shot_framing' || drag.kind === 'free_camera') {
        const fly = flyRef.current;
        fly.yawDegrees -= dx * LOOK_SENSITIVITY;
        fly.pitchDegrees = Math.max(-89, Math.min(89, fly.pitchDegrees - dy * LOOK_SENSITIVITY));
        flyDirtyRef.current = true;
        if (drag.kind === 'shot_framing') emitFramingCamera();
        return;
      }

      if (drag.kind === 'orbit') {
        orbitRef.current.yaw -= dx * 0.25;
        orbitRef.current.pitch = Math.max(-10, Math.min(78, orbitRef.current.pitch - dy * 0.18));
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.kind === 'shot_framing') {
        dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }

      if (drag.kind === 'free_camera') {
        dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }

      if (drag.kind === 'orbit' && drag.forceOrbit) {
        dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }

      if (event.button !== 0) return;

      const pointer = getPointerState(
        event,
        canvas,
        cameraRef.current,
        orbitRef.current,
        sceneRef.current,
        snapToGridRef.current,
      );
      const { onPlaceObject, onSelectObject } = callbacksRef.current;
      if (drag.kind === 'place') {
        const activePlacementType = placementTypeRef.current;
        const floorPoint = pointer?.floorPoint ?? lastFloorPointRef.current;
        if (activePlacementType && floorPoint) {
          onPlaceObject?.(activePlacementType, floorPoint);
        }
        if (!placementTypeRef.current) {
          lastFloorPointRef.current = undefined;
          clearPreviewMesh();
        } else if (lastFloorPointRef.current) {
          updatePreviewMesh(lastFloorPointRef.current);
        }
      } else if (drag.kind === 'orbit' && !drag.moved) {
        onSelectObject?.(drag.pendingSelectId, drag.pendingSelectionMode);
      }
      const wasEditDrag = drag.kind === 'gizmo_translate'
        || drag.kind === 'gizmo_rotate'
        || drag.kind === 'gizmo_scale'
        || drag.kind === 'origin_gizmo_translate'
        || drag.kind === 'origin_gizmo_rotate';
      dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
      if (wasEditDrag) endEditBatch();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    const onPointerLeave = () => {
      if (dragRef.current.kind === 'idle') clearPreviewMesh();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const framing = shotFramingRef.current;
      if (framing) {
        framingFovRef.current = Math.max(18, Math.min(120, framingFovRef.current + event.deltaY * 0.04));
        if (cameraRef.current) {
          cameraRef.current.fov = framingFovRef.current;
          cameraRef.current.updateProjectionMatrix();
        }
        emitFramingCamera();
        return;
      }
      if (freeCameraActiveRef.current) return;
      orbitRef.current.distance = Math.max(3, Math.min(sceneBoundingRadius(projectRef.current) * 4, orbitRef.current.distance + event.deltaY * 0.01));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shotFramingRef.current?.flyActive && !freeCameraActiveRef.current) return;
      if (event.code === 'Escape') {
        const escapeInsideDialog = Boolean((event.target as HTMLElement | null)?.closest?.('[role="dialog"]'));
        if (freeCameraActiveRef.current && !escapeInsideDialog) {
          event.preventDefault();
          event.stopImmediatePropagation();
          callbacksRef.current.onFreeCameraActiveChange?.(false);
        }
        return;
      }
      if (event.target && (event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // Ctrl is not a camera command — never intercept Ctrl+W or Control keys.
      if (event.code === 'ControlLeft' || event.code === 'ControlRight') return;
      if (event.ctrlKey || event.metaKey) return;
      if (!isBuildFreeCameraKey(event.code)) return;
      if (event.code === 'KeyW') {
        forwardSprintRef.current = reduceForwardSprint(forwardSprintRef.current, {
          type: 'keydown',
          timestamp: performance.now(),
          repeat: event.repeat,
        });
      }
      flyKeysRef.current.add(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyW') {
        forwardSprintRef.current = reduceForwardSprint(forwardSprintRef.current, {
          type: 'keyup',
          timestamp: performance.now(),
        });
      }
      flyKeysRef.current.delete(event.code);
    };
    const clearFlyInput = () => {
      flyKeysRef.current.clear();
      flyAxesRef.current = { forward: 0, strafe: 0, vertical: 0 };
      forwardSprintRef.current = reduceForwardSprint(forwardSprintRef.current, { type: 'reset' });
    };
    const onVisibilityChange = () => { if (document.hidden) clearFlyInput(); };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const onPointerCancel = () => {
      dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
      endEditBatch();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearFlyInput);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      endEditBatch();
      cancelAnimationFrame(frameRef.current);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearFlyInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flyKeysRef.current.clear();
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncViewportSize);
      clearTransformGizmo();
      if (sceneRef.current) disposeScene(sceneRef.current);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [clearTransformGizmo, emitFramingCamera, syncTransformGizmo, theme]);

  useEffect(() => {
    const modeChanged = freeCameraModeRef.current !== freeCameraActive;
    freeCameraModeRef.current = freeCameraActive;
    if (!modeChanged || shotFraming) return;
    const camera = cameraRef.current;
    if (!camera) return;

    flyKeysRef.current.clear();
    flyAxesRef.current = { forward: 0, strafe: 0, vertical: 0 };
    forwardSprintRef.current = reduceForwardSprint(forwardSprintRef.current, { type: 'reset' });
    flyDirtyRef.current = false;

    if (freeCameraActive) {
      updateCamera(camera, orbitRef.current);
      flyRef.current = flyCameraFromCamera(cameraFromOrbit(
        {
          yaw: orbitRef.current.yaw,
          pitch: orbitRef.current.pitch,
          distance: orbitRef.current.distance,
          target: [orbitRef.current.target.x, orbitRef.current.target.y, orbitRef.current.target.z],
        },
        camera.fov,
        camera.aspect,
        camera.near,
        camera.far,
      ));
      return;
    }

    const cameraData = cameraFromFlyState(
      flyRef.current,
      camera.fov,
      camera.aspect,
      camera.near,
      camera.far,
      orbitRef.current.distance,
    );
    const nextOrbit = cameraOrbitFromCamera(cameraData);
    orbitRef.current = {
      yaw: nextOrbit.yaw,
      pitch: Math.max(-10, Math.min(78, nextOrbit.pitch)),
      distance: Math.max(3, Math.min(sceneBoundingRadius(projectRef.current) * 4, nextOrbit.distance)),
      target: new THREE.Vector3().fromArray(nextOrbit.target),
    };
  }, [freeCameraActive, shotFraming]);

  useEffect(() => {
    if (shotFraming) return;
    const camera = cameraRef.current;
    if (!camera) return;
    const far = clampBuildRenderDistance(renderDistance);
    camera.far = far;
    if (sceneRef.current?.fog instanceof THREE.Fog) {
      const fogRange = computeBuildFogRange(far);
      sceneRef.current.fog.near = fogRange.near;
      sceneRef.current.fog.far = fogRange.far;
    }
    camera.updateProjectionMatrix();
  }, [renderDistance, shotFraming]);

  useEffect(() => {
    return subscribeHumanMannequinReady(() => {
      setMannequinRevision(getHumanMannequinRevision());
    });
  }, []);

  useEffect(() => {
    if (!shotFraming?.flyActive && !freeCameraActive) {
      flyKeysRef.current.clear();
      flyAxesRef.current = { forward: 0, strafe: 0, vertical: 0 };
      forwardSprintRef.current = reduceForwardSprint(forwardSprintRef.current, { type: 'reset' });
    }
  }, [freeCameraActive, shotFraming?.flyActive]);

  const setFlyAxes = useCallback((axes: { forward: number; strafe: number; vertical?: number }) => {
    flyAxesRef.current = {
      forward: clampUnit(axes.forward),
      strafe: clampUnit(axes.strafe),
      vertical: clampUnit(axes.vertical ?? 0),
    };
  }, []);

  const projectedProjectors = appearance === 'projected'
    ? resolveProjectedProjectorAssets(project)
    : undefined;
  const projectedAssetKey = projectedProjectors?.primaryUrl ?? '';
  const projectedSecondaryAssetKey = projectedProjectors?.secondaryUrl ?? '';
  const projectedPanoId = projectedProjectors?.primary.id
    ?? project.settings.projectedStyle?.panoId;
  const projectedSecondaryPanoId = projectedProjectors?.secondary?.id;
  const projectedBlendMode = projectedProjectors?.settings.blendMode
    ?? project.settings.projectedStyle?.blendMode
    ?? 'primary_only';

  // Load / release primary projected-style texture when appearance or projector changes.
  // Ownership: release currently *owned* URL immediately on change; never release a
  // captured previousUrl from the completion callback (A→B→C leak / double-release).
  useEffect(() => {
    let cancelled = false;
    const url = projectedAssetKey || undefined;
    const ownership = primaryOwnershipRef.current;
    const { clearedOwned } = prepareProjectedTextureRequest(ownership, url);
    if (clearedOwned) {
      setProjectedTexture(null);
      setProjectedTextureReadyUrl(undefined);
    }
    if (!url) {
      return () => {
        cancelled = true;
      };
    }
    // Already holding this texture — keep it (effect may re-run after unmount cleanup only).
    if (ownership.ownedUrl === url) {
      return () => {
        cancelled = true;
      };
    }
    void acquireProjectedStyleTexture(url).then((texture) => {
      const result = resolveProjectedTextureRequest(ownership, url, texture, cancelled);
      if (result === 'accept') {
        setProjectedTexture(texture);
        setProjectedTextureReadyUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectedAssetKey]);

  // Load / release optional secondary projector for multi-origin blend.
  useEffect(() => {
    let cancelled = false;
    const url = projectedSecondaryAssetKey || undefined;
    const ownership = secondaryOwnershipRef.current;
    const { clearedOwned } = prepareProjectedTextureRequest(ownership, url);
    if (clearedOwned) {
      setProjectedSecondaryTexture(null);
      setProjectedSecondaryReadyUrl(undefined);
      setSecondaryLoadError(false);
    }
    if (!url) {
      setSecondaryLoadError(false);
      return () => {
        cancelled = true;
      };
    }
    if (ownership.ownedUrl === url) {
      return () => {
        cancelled = true;
      };
    }
    setSecondaryLoadError(false);
    void acquireProjectedStyleTexture(url).then((texture) => {
      const result = resolveProjectedTextureRequest(ownership, url, texture, cancelled);
      if (result === 'accept') {
        setProjectedSecondaryTexture(texture);
        setProjectedSecondaryReadyUrl(url);
        setSecondaryLoadError(false);
        return;
      }
      // Still the requested URL but load failed → surface error (do not leave prior dual active).
      if (!cancelled && ownership.requestedUrl === url && !texture) {
        setSecondaryLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectedSecondaryAssetKey]);

  useEffect(() => () => {
    disposeProjectedTextureOwnership(primaryOwnershipRef.current);
    disposeProjectedTextureOwnership(secondaryOwnershipRef.current);
    primaryWarpRef.current?.release();
    secondaryWarpRef.current?.release();
    if (alignmentOverlayRef.current) {
      disposeAlignmentOverlay(alignmentOverlayRef.current);
      alignmentOverlayRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!shotFraming || dragRef.current.kind === 'shot_framing') return;
    // Re-seed fly pose only when the shot or stored camera pose changes.
    // Do not depend on the whole shotFraming object — video shutter phase and
    // other chrome churn recreate that object and must not yank the live camera.
    flyRef.current = flyCameraFromCamera(shotFraming.camera);
    framingFovRef.current = shotFraming.camera.fovDegrees;
    if (cameraRef.current) {
      applyFlyCameraToPerspectiveCamera(
        cameraRef.current,
        flyRef.current,
        framingFovRef.current,
        shotFraming.frameAspectRatio,
      );
    }
  }, [
    selectedShotId,
    shotFraming?.camera.position[0],
    shotFraming?.camera.position[1],
    shotFraming?.camera.position[2],
    shotFraming?.camera.target[0],
    shotFraming?.camera.target[1],
    shotFraming?.camera.target[2],
    shotFraming?.camera.fovDegrees,
    shotFraming?.frameAspectRatio,
    // Presence toggle: enter/leave shot framing mode.
    Boolean(shotFraming),
  ]);

  const projectedSettings = projectedProjectors?.settings
    ?? normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const projectedPano = projectedProjectors?.primary;
  const projectedSecondary = projectedProjectors?.secondary;
  const projectedState = computeProjectedAppearanceState({
    appearance,
    primaryTextureReady: Boolean(projectedTexture),
    primaryReadyUrl: projectedTextureReadyUrl ?? '',
    primaryAssetKey: projectedAssetKey,
    primaryPanoExists: Boolean(projectedPano),
    blendMode: projectedBlendMode,
    secondaryPanoIdExists: Boolean(projectedSecondaryPanoId),
    secondaryTextureReady: Boolean(projectedSecondaryTexture),
    secondaryReadyUrl: projectedSecondaryReadyUrl ?? '',
    secondaryAssetKey: projectedSecondaryAssetKey,
  });
  const { projectedActive, dualActive } = projectedState;

  useEffect(() => {
    previewMeshRef.current = null;
    if (sceneRef.current) disposeScene(sceneRef.current);
    clearTransformGizmo();

    // Acquire new warp maps first, then release old ones (swap pattern)
    // to avoid destroying a texture that is still needed for the same key.
    const oldPrimaryWarp = primaryWarpRef.current;
    const oldSecondaryWarp = secondaryWarpRef.current;

    // Use the project-aware resolver that returns both the warp texture and
    // the saved alignment strength in one call, replacing the deprecated
    // settings-only resolver and the separate manual strength lookups.
    // Wrap acquisition in try/catch so a thrown resolver does not leak newly
    // acquired resources — both warps are released if anything fails before
    // the successful commit point.
    let nextPrimary: ResolvedWarpWithStrength | undefined;
    let nextSecondary: ResolvedWarpWithStrength | undefined;
    try {
      nextPrimary = projectedActive && projectedTexture && projectedPano
        ? resolveProjectionWarpWithStrengthForProject(project, projectedPano.id, 'runtime')
        : undefined;
      nextSecondary = dualActive && projectedSecondary
        ? resolveProjectionWarpWithStrengthForProject(project, projectedSecondary.id, 'runtime')
        : undefined;
    } catch (error) {
      // Release anything that was successfully acquired before the throw.
      nextPrimary?.warp.release();
      nextSecondary?.warp.release();
      oldPrimaryWarp?.release();
      oldSecondaryWarp?.release();
      throw error;
    }

    primaryWarpRef.current = nextPrimary?.warp;
    secondaryWarpRef.current = nextSecondary?.warp;

    oldPrimaryWarp?.release();
    oldSecondaryWarp?.release();

    const primaryStrength = nextPrimary?.strength;
    const secondaryStrength = nextSecondary?.strength;

    // Wrap the commit phase so a buildScene failure releases the newly acquired
    // warps before the error propagates out of the effect.
    try {
    sceneRef.current = buildScene(project, {
      selectedShotId,
      hideShotFrustums: Boolean(shotFraming) || !showSceneGuides,
      showSceneGuides: shotFraming ? false : showSceneGuides,
      showPanoOrigin: shotFraming ? false : (showSceneGuides || originPlacementActive),
      showHelpers: shotFraming ? false : showSceneGuides,
      theme,
      fogDistance: shotFraming ? undefined : renderDistance,
      appearance: projectedActive ? 'projected' : 'clay',
      projected: projectedActive && projectedTexture && projectedPano
        ? {
          texture: projectedTexture,
          origin: projectedPano.origin,
          rotation: projectedPano.rotation,
          settings: projectedSettings,
          disposableMaterials: true,
          secondaryTexture: dualActive ? projectedSecondaryTexture ?? undefined : undefined,
          secondaryOrigin: dualActive ? projectedSecondary?.origin : undefined,
          secondaryRotation: dualActive ? projectedSecondary?.rotation : undefined,
          warpMap: primaryWarpRef.current?.texture,
          warpMapSize: primaryWarpRef.current
            ? [primaryWarpRef.current.width, primaryWarpRef.current.height]
            : undefined,
          warpStrength: primaryStrength,
          warpMapB: secondaryWarpRef.current?.texture,
          warpMapSizeB: secondaryWarpRef.current
            ? [secondaryWarpRef.current.width, secondaryWarpRef.current.height]
            : undefined,
          warpStrengthB: secondaryStrength,
        }
        : undefined,
    });
    } catch (error) {
      // buildScene failed — release the newly acquired warps; old refs were
      // already released so the effect is in a clean state.
      nextPrimary?.warp.release();
      nextSecondary?.warp.release();
      throw error;
    }
    if (previewPointRef.current && placementTypeRef.current) {
      updatePreviewMesh(previewPointRef.current);
    }
    syncTransformGizmo();
  }, [
    clearTransformGizmo,
    originPlacementActive,
    project,
    projectedActive,
    projectedBlendMode,
    projectedPano?.id,
    projectedPanoId,
    projectedSecondary?.id,
    projectedSecondaryPanoId,
    projectedSecondaryTexture,
    projectedSettings,
    projectedTexture,
    selectedShotId,
    shotFraming,
    showSceneGuides,
    syncTransformGizmo,
    theme,
    updatePreviewMesh,
    mannequinRevision,
    renderDistance,
  ]);

  useEffect(() => {
    syncTransformGizmo();
  }, [gizmoMode, selectedObjectIds, showTransformGizmo, syncTransformGizmo]);

  // Alignment debug overlay: marker pins + connecting lines
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = alignmentOverlayRef.current;
    if (existing) {
      scene.remove(existing);
      disposeAlignmentOverlay(existing);
      alignmentOverlayRef.current = null;
    }

    if (!showAlignmentOverlay) return;
    if (!projectedActive || !projectedPano) return;
    if (!projectedSettings.alignments || projectedSettings.alignments.length === 0) return;

    const alignment = findProjectionAlignmentForPano(projectedSettings, projectedPano.id);
    if (!alignment) return;

    const overlay = createAlignmentMarkerOverlay(
      alignment,
      projectedPano.origin,
      projectedPano.rotation,
    );
    scene.add(overlay);
    alignmentOverlayRef.current = overlay;
  }, [
    showAlignmentOverlay,
    projectedActive,
    projectedPano?.id,
    projectedPano?.origin,
    projectedPano?.rotation,
    projectedSettings,
  ]);

  useEffect(() => {
    if (!frameRequest || shotFraming || !cameraRef.current) return;
    const objects = project.scene.objects.filter((object) => frameObjectIds.includes(object.id) && object.visible);
    const scene = sceneRef.current;
    if (!scene || objects.length === 0) return;
    const box = selectionBounds(objects);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    orbitRef.current.target.copy(center);
    const framingDistance = Math.max(size.length() * 0.5, 2) / Math.tan(THREE.MathUtils.degToRad(framingFovRef.current * 0.5));
    orbitRef.current.distance = THREE.MathUtils.clamp(framingDistance * 1.15, 3, sceneBoundingRadius(projectRef.current) * 4);
  }, [frameObjectIds, frameRequest, project.scene.objects, shotFraming]);

  useEffect(() => {
    if (previewPointRef.current) updatePreviewMesh(previewPointRef.current);
    else clearPreviewMesh();
  }, [placementType, snapToGrid, clearPreviewMesh, updatePreviewMesh]);

  const cursorClass = shotFraming
    ? 'cursor-crosshair'
    : freeCameraActive
      ? 'cursor-grab active:cursor-grabbing'
    : placementType
      ? 'cursor-crosshair'
      : originPlacementActive || !placementType
        ? 'cursor-grab'
        : 'cursor-default';

  const showSecondaryWarning = secondaryLoadError
    && projectedActive
    && Boolean(projectedSecondaryAssetKey)
    && !dualActive;

  return (
    <div
      className={`relative h-full ${minHeightClassName} overflow-hidden bg-surface-base ${cursorClass}`}
      data-testid="scene-viewport"
      ref={containerRef}
    >
      {shotFraming && (
        <ShotViewfinderOverlay
          containerRef={containerRef}
          aspectRatio={shotFraming.frameAspectRatio}
          fovDegrees={shotFraming.camera.fovDegrees}
          resolutionLabel={shotFraming.frameResolutionLabel}
          variant="full"
        />
      )}
      {(shotFraming?.flyActive || freeCameraActive) && (
        <TouchFlyPad
          onAxesChange={setFlyAxes}
          verticalPositionClassName={freeCameraActive ? 'bottom-[12rem]' : undefined}
        />
      )}
      {showSecondaryWarning && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full border border-amber-500/40 bg-amber-50/90 px-4 py-2 text-xs font-medium text-amber-800 shadow-card backdrop-blur-sm dark:bg-amber-950/80 dark:text-amber-200"
        >
          Secondary panorama unavailable. Showing the primary projection only.
        </div>
      )}
    </div>
  );
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/** On-screen move pad for touch devices (keyboard WASD has no mobile equivalent). */
function TouchFlyPad({
  onAxesChange,
  verticalPositionClassName = 'bottom-[7.5rem]',
}: {
  onAxesChange: (axes: { forward: number; strafe: number; vertical?: number }) => void;
  verticalPositionClassName?: string;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);

  useEffect(() => {
    return () => onAxesChange({ forward: 0, strafe: 0, vertical: 0 });
  }, [onAxesChange]);

  const updateFromPoint = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = (clientX - cx) / radius;
    const dy = (clientY - cy) / radius;
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    onAxesChange({
      strafe: dx * scale,
      forward: -dy * scale,
    });
  };

  return (
    <div
      className={`pointer-events-none absolute left-3 z-30 flex flex-col items-center gap-2 md:hidden ${verticalPositionClassName}`}
      data-touch-fly-pad
    >
      <div className="pointer-events-auto flex gap-2">
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-xs font-semibold text-white/90 backdrop-blur-sm active:bg-black/70"
          aria-label="Move camera up"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onAxesChange({ forward: 0, strafe: 0, vertical: 1 });
          }}
          onPointerUp={() => onAxesChange({ forward: 0, strafe: 0, vertical: 0 })}
          onPointerCancel={() => onAxesChange({ forward: 0, strafe: 0, vertical: 0 })}
        >
          Up
        </button>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-xs font-semibold text-white/90 backdrop-blur-sm active:bg-black/70"
          aria-label="Move camera down"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onAxesChange({ forward: 0, strafe: 0, vertical: -1 });
          }}
          onPointerUp={() => onAxesChange({ forward: 0, strafe: 0, vertical: 0 })}
          onPointerCancel={() => onAxesChange({ forward: 0, strafe: 0, vertical: 0 })}
        >
          Dn
        </button>
      </div>
      <div
        ref={padRef}
        className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-white/25 bg-black/40 shadow-card backdrop-blur-sm"
        role="application"
        aria-label="Drag to move camera. Drag up/down for forward/back, left/right to strafe."
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPoint(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (activePointerId.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          updateFromPoint(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (activePointerId.current !== event.pointerId) return;
          activePointerId.current = null;
          onAxesChange({ forward: 0, strafe: 0, vertical: 0 });
        }}
        onPointerCancel={() => {
          activePointerId.current = null;
          onAxesChange({ forward: 0, strafe: 0, vertical: 0 });
        }}
      >
        <div className="pointer-events-none absolute inset-3 rounded-full border border-white/10" />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium uppercase tracking-wide text-white/55">
          Move
        </span>
      </div>
    </div>
  );
}

function updateCamera(
  camera: THREE.PerspectiveCamera,
  orbit: { yaw: number; pitch: number; distance: number; target: THREE.Vector3 },
) {
  const yaw = THREE.MathUtils.degToRad(orbit.yaw);
  const pitch = THREE.MathUtils.degToRad(orbit.pitch);
  const x = Math.sin(yaw) * Math.cos(pitch) * orbit.distance;
  const y = Math.sin(pitch) * orbit.distance;
  const z = Math.cos(yaw) * Math.cos(pitch) * orbit.distance;
  camera.position.set(orbit.target.x + x, orbit.target.y + y, orbit.target.z + z);
  camera.lookAt(orbit.target);
}

function setRendererRect(
  renderer: THREE.WebGLRenderer,
  kind: 'viewport' | 'scissor',
  rect: CssRendererRect,
) {
  if (kind === 'viewport') {
    renderer.setViewport(rect.left, rect.bottom, rect.width, rect.height);
  } else {
    renderer.setScissor(rect.left, rect.bottom, rect.width, rect.height);
  }
}

function getPointerState(
  event: PointerEvent,
  element: HTMLElement,
  camera: THREE.PerspectiveCamera | null,
  orbit: { yaw: number; pitch: number; distance: number; target: THREE.Vector3 },
  scene: THREE.Scene | null,
  snapToGrid: boolean,
  resolveFloorPoint = true,
) {
  if (!camera) return undefined;
  updateCamera(camera, orbit);
  camera.updateMatrixWorld(true);

  const bounds = element.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / width) * 2 - 1,
    -((event.clientY - bounds.top) / height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const floorPoint = resolveFloorPoint
    ? resolveStampPoint(raycaster, {
        snapToGrid,
        scene,
      })
    : undefined;
  return {
    raycaster,
    floorPoint,
  };
}

function getSceneHit(raycaster: THREE.Raycaster, scene: THREE.Scene | null) {
  if (!scene) return undefined;
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    if (isTransformGizmoNode(hit.object) || hit.object.name === 'SelectionOutline') continue;
    if (findPanoOrigin(hit.object)) return { isPanoOrigin: true, objectId: undefined };
    const objectId = findSceneObjectId(hit.object);
    if (objectId) return { isPanoOrigin: false, objectId };
  }
  return undefined;
}

function findSceneObjectId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.sceneObjectId === 'string') return current.userData.sceneObjectId;
    current = current.parent;
  }
  return undefined;
}

function isTransformGizmoNode(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.isTransformGizmo) return true;
    current = current.parent;
  }
  return false;
}

function findPanoOrigin(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.panoOrigin === true) return true;
    current = current.parent;
  }
  return false;
}
