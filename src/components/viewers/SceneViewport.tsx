import React, { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { objectDisplayName } from '../../domain/defaults';
import { CameraData, LocationProject, SceneObjectType, Vec3 } from '../../domain/types';
import { createPlacedSceneObject, resolveStampPoint, snapBuildPoint } from '../../engine/sandbox';
import { buildScene, createPreviewMesh, disposePreviewMesh, disposeScene } from '../../engine/sceneObjects';
import { applyFlyCameraToPerspectiveCamera } from '../../engine/renderers';
import {
  cameraFromFlyState,
  flyCameraFromCamera,
  horizontalFlyDirections,
  type FlyCameraState,
} from '../../engine/sync';
import { computeCenteredFrameRendererRects, computeFullCssRendererRect, type CssRendererRect } from '../../engine/viewport';
import { useContinuityStore } from '../../state/useContinuityStore';
import { useThemeStore } from '../../state/useThemeStore';
import { ShotViewfinderOverlay } from './ShotViewfinderOverlay';

type DragKind = 'idle' | 'orbit' | 'object' | 'pano_origin' | 'place' | 'shot_framing';

const FLY_SPEED = 6;
const FLY_SPRINT_MULTIPLIER = 2.4;
const LOOK_SENSITIVITY = 0.12;

interface DragState {
  kind: DragKind;
  x: number;
  y: number;
  moved: boolean;
  forceOrbit?: boolean;
  objectId?: string;
  objectOffset?: Vec3;
  pendingSelectId?: string;
}

export function SceneViewport({
  project,
  selectedObjectId,
  selectedShotId,
  placementType,
  placementLabel,
  originPlacementActive = false,
  snapToGrid = true,
  shotFraming,
  onSelectObject,
  onPlaceObject,
  onMoveObject,
  onMovePanoOrigin,
  minHeightClassName = 'min-h-[420px]',
}: {
  project: LocationProject;
  selectedObjectId?: string;
  selectedShotId?: string;
  placementType?: SceneObjectType;
  placementLabel?: string;
  originPlacementActive?: boolean;
  snapToGrid?: boolean;
  shotFraming?: {
    camera: CameraData;
    frameAspectRatio: number;
    frameResolutionLabel: string;
    flyActive: boolean;
    onCameraChange: (camera: CameraData) => void;
    onLockCamera?: () => void;
  };
  onSelectObject?: (id?: string) => void;
  onPlaceObject?: (type: SceneObjectType, point: Vec3) => void;
  onMoveObject?: (id: string, point: Vec3) => void;
  onMovePanoOrigin?: (origin: Vec3) => void;
  minHeightClassName?: string;
}) {
  const theme = useThemeStore((state) => state.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const orbitRef = useRef({ yaw: -34, pitch: 28, distance: 15.5, target: new THREE.Vector3(0, 1.15, 1.25) });
  const dragRef = useRef<DragState>({ kind: 'idle', x: 0, y: 0, moved: false });
  const lastFloorPointRef = useRef<Vec3 | undefined>();
  const selectedObjectIdRef = useRef(selectedObjectId);
  const projectRef = useRef(project);
  const snapToGridRef = useRef(snapToGrid);
  const callbacksRef = useRef({ onSelectObject, onPlaceObject, onMoveObject, onMovePanoOrigin });
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
  const lastFrameTimeRef = useRef(performance.now());
  const flyDirtyRef = useRef(false);

  selectedObjectIdRef.current = selectedObjectId;
  projectRef.current = project;
  snapToGridRef.current = snapToGrid;
  placementTypeRef.current = placementType;
  shotFramingRef.current = shotFraming;
  callbacksRef.current = { onSelectObject, onPlaceObject, onMoveObject, onMovePanoOrigin };

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

    const activePlacementType = placementTypeRef.current ?? getBuildInteractionState().placementType;
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
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'absolute inset-0 block h-full w-full touch-none';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(framingFovRef.current, 1, 0.1, 200);
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
      if (keys.size === 0) return;
      const fly = flyRef.current;
      const { forward, right } = horizontalFlyDirections(fly.yawDegrees);
      let moveX = 0;
      let moveY = 0;
      let moveZ = 0;
      if (keys.has('KeyW')) {
        moveX += forward[0];
        moveZ += forward[2];
      }
      if (keys.has('KeyS')) {
        moveX -= forward[0];
        moveZ -= forward[2];
      }
      if (keys.has('KeyA')) {
        moveX -= right[0];
        moveZ -= right[2];
      }
      if (keys.has('KeyD')) {
        moveX += right[0];
        moveZ += right[2];
      }
      if (keys.has('Space')) moveY += 1;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) moveY -= 1;
      const length = Math.hypot(moveX, moveY, moveZ);
      if (length === 0) return;
      const sprinting = keys.has('ControlLeft') || keys.has('ControlRight');
      const speed = FLY_SPEED * (sprinting ? FLY_SPRINT_MULTIPLIER : 1);
      const step = (speed * deltaSeconds) / length;
      fly.position = [
        fly.position[0] + moveX * step,
        fly.position[1] + moveY * step,
        fly.position[2] + moveZ * step,
      ];
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

      if (framing) {
        if (framing.flyActive) processFlyMovement(deltaSeconds);
        if (flyDirtyRef.current) emitFramingCamera();
        applyFlyCameraToPerspectiveCamera(
          activeCamera,
          flyRef.current,
          framingFovRef.current,
          framing.frameAspectRatio,
        );

        const { clear, frame } = computeCenteredFrameRendererRects(cssWidth, cssHeight, framing.frameAspectRatio);
        activeRenderer.setScissorTest(true);
        activeRenderer.setClearColor(theme === 'dark' ? 0x0f1419 : 0xf3f6f4, 1);
        setRendererRect(activeRenderer, 'viewport', clear);
        setRendererRect(activeRenderer, 'scissor', clear);
        activeRenderer.clear();
        setRendererRect(activeRenderer, 'viewport', frame);
        setRendererRect(activeRenderer, 'scissor', frame);
        activeRenderer.render(activeScene, activeCamera);
        activeRenderer.setScissorTest(false);
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

      if (event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey)) {
        event.preventDefault();
        beginOrbitDrag(event, true);
        return;
      }

      if (event.button !== 0) return;

      const pointer = getPointerState(event, canvas, cameraRef.current, orbitRef.current, sceneRef.current);
      if (!pointer) return;
      const floorPoint = pointer.floorPoint;
      const hit = getSceneHit(pointer.raycaster, sceneRef.current);
      const { placementType: activePlacementType, originPlacementActive: originPlacement } = getBuildInteractionState();
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

      if (originPlacement && floorPoint && onMovePanoOrigin) {
        onMovePanoOrigin(getOriginPoint(floorPoint, activeProject.scene.panoOrigin[1], activeSnapToGrid));
        dragRef.current = { kind: 'pano_origin', x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      if (hit?.isPanoOrigin && floorPoint && onMovePanoOrigin) {
        dragRef.current = { kind: 'pano_origin', x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      const hitObject = hit?.objectId
        ? activeProject.scene.objects.find((object) => object.id === hit.objectId)
        : undefined;
      const inSelectMode = !activePlacementType && !originPlacement;
      if (
        inSelectMode
        && hitObject
        && !hitObject.locked
        && floorPoint
        && onMoveObject
      ) {
        onSelectObject?.(hitObject.id);
        dragRef.current = {
          kind: 'object',
          x: event.clientX,
          y: event.clientY,
          moved: false,
          objectId: hitObject.id,
          objectOffset: [
            hitObject.transform.position[0] - floorPoint[0],
            hitObject.transform.position[1],
            hitObject.transform.position[2] - floorPoint[2],
          ],
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      beginOrbitDrag(event);
      dragRef.current.pendingSelectId = hitObject?.id;
    };

    const onPointerMove = (event: PointerEvent) => {
      const pointer = getPointerState(event, canvas, cameraRef.current, orbitRef.current, sceneRef.current);
      if (getBuildInteractionState().placementType && pointer?.floorPoint) {
        lastFloorPointRef.current = pointer.floorPoint;
        updatePreviewMesh(pointer.floorPoint);
      }
      const drag = dragRef.current;
      if (drag.kind === 'idle') return;

      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;

      const { onMoveObject, onMovePanoOrigin } = callbacksRef.current;
      const activeProject = projectRef.current;
      const activeSnapToGrid = snapToGridRef.current;

      if (drag.kind === 'object' && drag.objectId && drag.objectOffset && pointer?.floorPoint && onMoveObject) {
        onMoveObject(drag.objectId, [
          pointer.floorPoint[0] + drag.objectOffset[0],
          drag.objectOffset[1],
          pointer.floorPoint[2] + drag.objectOffset[2],
        ]);
        return;
      }

      if (drag.kind === 'pano_origin' && pointer?.floorPoint && onMovePanoOrigin) {
        onMovePanoOrigin(getOriginPoint(pointer.floorPoint, activeProject.scene.panoOrigin[1], activeSnapToGrid));
        return;
      }

      if (drag.kind === 'shot_framing') {
        const fly = flyRef.current;
        fly.yawDegrees -= dx * LOOK_SENSITIVITY;
        fly.pitchDegrees = Math.max(-89, Math.min(89, fly.pitchDegrees - dy * LOOK_SENSITIVITY));
        flyDirtyRef.current = true;
        emitFramingCamera();
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
        if (!drag.moved) {
          shotFramingRef.current?.onLockCamera?.();
        }
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

      const pointer = getPointerState(event, canvas, cameraRef.current, orbitRef.current, sceneRef.current);
      const { onPlaceObject, onSelectObject } = callbacksRef.current;
      if (drag.kind === 'place') {
        const { placementType: activePlacementType } = getBuildInteractionState();
        const floorPoint = pointer?.floorPoint ?? lastFloorPointRef.current;
        if (activePlacementType && floorPoint) {
          onPlaceObject?.(activePlacementType, floorPoint);
        }
        if (!getBuildInteractionState().placementType) {
          lastFloorPointRef.current = undefined;
          clearPreviewMesh();
        } else if (lastFloorPointRef.current) {
          updatePreviewMesh(lastFloorPointRef.current);
        }
      } else if (drag.kind === 'orbit' && !drag.moved) {
        onSelectObject?.(drag.pendingSelectId);
      }
      dragRef.current = { kind: 'idle', x: 0, y: 0, moved: false };
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
      orbitRef.current.distance = Math.max(3, Math.min(28, orbitRef.current.distance + event.deltaY * 0.01));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shotFramingRef.current?.flyActive) return;
      if (event.code === 'Escape') return;
      flyKeysRef.current.add(event.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      flyKeysRef.current.delete(event.code);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(frameRef.current);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      flyKeysRef.current.clear();
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncViewportSize);
      if (sceneRef.current) disposeScene(sceneRef.current);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [emitFramingCamera, theme]);

  useEffect(() => {
    if (!shotFraming?.flyActive) {
      flyKeysRef.current.clear();
    }
  }, [shotFraming?.flyActive]);

  useEffect(() => {
    if (!shotFraming || dragRef.current.kind === 'shot_framing') return;
    flyRef.current = flyCameraFromCamera(shotFraming.camera);
    framingFovRef.current = shotFraming.camera.fovDegrees;
    if (cameraRef.current && shotFraming) {
      applyFlyCameraToPerspectiveCamera(
        cameraRef.current,
        flyRef.current,
        framingFovRef.current,
        shotFraming.frameAspectRatio,
      );
    }
  }, [
    shotFraming?.camera.position,
    shotFraming?.camera.target,
    shotFraming?.camera.fovDegrees,
    selectedShotId,
    shotFraming,
  ]);

  useEffect(() => {
    previewMeshRef.current = null;
    if (sceneRef.current) disposeScene(sceneRef.current);
    sceneRef.current = buildScene(project, {
      selectedObjectId,
      selectedShotId,
      hideShotFrustums: Boolean(shotFraming),
      theme,
    });
    if (previewPointRef.current && placementTypeRef.current) {
      updatePreviewMesh(previewPointRef.current);
    }
  }, [project, selectedObjectId, selectedShotId, shotFraming, theme, updatePreviewMesh]);

  useEffect(() => {
    if (previewPointRef.current) updatePreviewMesh(previewPointRef.current);
    else clearPreviewMesh();
  }, [placementType, snapToGrid, clearPreviewMesh, updatePreviewMesh]);

  const cursorClass = shotFraming
    ? 'cursor-crosshair'
    : placementType
      ? 'cursor-crosshair'
      : originPlacementActive || !placementType
        ? 'cursor-grab'
        : 'cursor-default';

  return (
    <div
      className={`relative h-full ${minHeightClassName} overflow-hidden bg-surface-base ${cursorClass}`}
      data-testid="scene-viewport"
      ref={containerRef}
    >
      {shotFraming && (
        <>
          <ShotViewfinderOverlay
            containerRef={containerRef}
            aspectRatio={shotFraming.frameAspectRatio}
            fovDegrees={shotFraming.camera.fovDegrees}
            resolutionLabel={shotFraming.frameResolutionLabel}
          />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-5">
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/90 shadow-sm" />
              <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/90 shadow-sm" />
            </div>
          </div>
        </>
      )}
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
  const floorPoint = resolveStampPoint(raycaster, {
    snapToGrid: useContinuityStore.getState().gridSnap,
    scene,
  });
  return {
    raycaster,
    floorPoint,
  };
}

function getBuildInteractionState() {
  const { buildMode, activePrimitive } = useContinuityStore.getState();
  return {
    placementType: buildMode === 'place' ? activePrimitive : undefined,
    originPlacementActive: buildMode === 'pano_origin',
  };
}

function getSceneHit(raycaster: THREE.Raycaster, scene: THREE.Scene | null) {
  if (!scene) return undefined;
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    if (findPanoOrigin(hit.object)) return { isPanoOrigin: true, objectId: undefined };
    const objectId = findSceneObjectId(hit.object);
    if (objectId) return { isPanoOrigin: false, objectId };
  }
  return undefined;
}

function getOriginPoint(point: Vec3, originY: number, snapToGrid: boolean): Vec3 {
  const snapped = snapBuildPoint([point[0], originY, point[2]], snapToGrid);
  return [snapped[0], originY, snapped[2]];
}

function findSceneObjectId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.sceneObjectId === 'string') return current.userData.sceneObjectId;
    current = current.parent;
  }
  return undefined;
}

function findPanoOrigin(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.panoOrigin === true) return true;
    current = current.parent;
  }
  return false;
}
