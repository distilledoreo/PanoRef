import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Euler, PanoViewState, Vec2 } from '../../domain/types';
import { panoYawToThreeJsYawDegrees } from '../../engine/sync';
import {
  isPanoViewerClick,
  panoUvToScreenPoint,
  screenPointToPanoUv,
  shouldPickPanoViewerPointerUp,
} from '../../engine/panoViewerPicking';
import { useThemeStore } from '../../state/useThemeStore';
import { pointInsidePolygon, unwrapRegionU } from '../../engine/projectionRegionPolygon';

const THEME_COLORS = {
  light: { empty: 0xe4e7e5, background: 0xf4f6f4 },
  dark: { empty: 0x243040, background: 0x0f1419 },
} as const;

const DEFAULT_VIEW: PanoViewState = {
  yawDegrees: 0,
  pitchDegrees: 0,
  fovDegrees: 65,
};

export interface PanoViewerMarker {
  id: string;
  uv: [number, number];
  label: string;
  state?: 'complete' | 'pending' | 'disabled' | 'conflicting';
}

export interface PanoViewerRegionVertex { id: string; uv: Vec2; label?: string }
export interface PanoViewerRegion {
  id: string;
  vertices: PanoViewerRegionVertex[];
  state?: 'complete' | 'active' | 'invalid' | 'disabled';
  label?: string;
}
export type PanoViewerInteractionMode = 'navigate' | 'pick' | 'draw-region' | 'edit-region' | 'transform-region' | 'move-outline' | 'edit-handles';

export type PanoGestureOwner = 'none' | 'view' | 'region-handle' | 'region-mask' | 'region-transform';

export type { PanoViewState };

interface PointerGesture {
  active: boolean;
  owner: PanoGestureOwner;
  pointerId?: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  multiplePointers: boolean;
  regionDragId?: string;
  regionVertexId?: string;
  pointerStartU?: number;
  pointerStartV?: number;
  lastUnwrappedU?: number;
  lastV?: number;
  handleStartVertices?: Array<{ id: string; u: number; v: number }>;
  lastUv?: Vec2;
}

export function unwrapPanoUToReference(value: number, reference: number): number {
  let unwrapped = value;
  while (unwrapped - reference > 0.5) unwrapped -= 1;
  while (unwrapped - reference < -0.5) unwrapped += 1;
  return unwrapped;
}

export function choosePanoGestureOwner(
  mode: PanoViewerInteractionMode,
  interaction: 'handle' | 'body' | 'mask' | undefined,
  insideActiveRegion: boolean,
  spaceHeld: boolean,
): PanoGestureOwner {
  if (interaction === 'handle' && (mode === 'edit-handles' || mode === 'edit-region')) return 'region-handle';
  if (interaction === 'handle') return 'none';
  if (mode === 'draw-region') return 'region-mask';
  if (insideActiveRegion && (mode === 'move-outline' || mode === 'transform-region' || mode === 'edit-region')) return 'region-transform';
  if (mode === 'navigate' || mode === 'pick' || spaceHeld) return 'view';
  return 'none';
}

export function eventHasRegionInteraction(event: Event): boolean {
  return event.composedPath().some((node) => typeof HTMLElement !== 'undefined' && node instanceof HTMLElement && node.dataset.regionInteraction !== undefined);
}

export function PanoViewer({
  imageUrl,
  view,
  onViewChange,
  label,
  panoRotation = [0, 0, 0],
  compareImageUrl,
  compareRotation = [0, 0, 0],
  compareOpacity = 1,
  interactionMode = 'navigate',
  onPickUv,
  markers = [],
  regions = [], activeRegionId, selectedVertexIds = [],
  onRegionDraftChange, onRegionComplete, onVertexMove, onVertexInsert, onVertexRemove, onVertexSelectionChange,
  regionDrawShape = 'polygon',
  onRegionTranslate,
  onRegionGestureStart,
  onRegionGestureEnd,
}: {
  imageUrl?: string;
  view?: PanoViewState;
  onViewChange?: (updates: Partial<PanoViewState>) => void;
  label?: string;
  panoRotation?: Euler;
  compareImageUrl?: string;
  compareRotation?: Euler;
  compareOpacity?: number;
  interactionMode?: PanoViewerInteractionMode;
  onPickUv?: (uv: [number, number]) => void;
  markers?: PanoViewerMarker[];
  regions?: PanoViewerRegion[];
  activeRegionId?: string;
  selectedVertexIds?: string[];
  onRegionDraftChange?: (vertices: PanoViewerRegionVertex[]) => void;
  onRegionComplete?: (vertices: PanoViewerRegionVertex[]) => void;
  onVertexMove?: (regionId: string, vertexId: string, uv: Vec2) => void;
  onVertexInsert?: (regionId: string, edgeStartVertexId: string, edgeT: number) => void;
  onVertexRemove?: (regionId: string, vertexId: string) => void;
  onVertexSelectionChange?: (vertexIds: string[]) => void;
  regionDrawShape?: 'polygon' | 'rectangle';
  onRegionTranslate?: (regionId: string, deltaUv: Vec2) => void;
  onRegionGestureStart?: () => void;
  onRegionGestureEnd?: () => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const [uncontrolledView, setUncontrolledView] = useState(DEFAULT_VIEW);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const effectiveView = view ?? uncontrolledView;
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const activeSceneRef = useRef<THREE.Scene | null>(null);
  const compareSceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const activeSphereRef = useRef<THREE.Mesh | null>(null);
  const compareSphereRef = useRef<THREE.Mesh | null>(null);
  const frameRef = useRef<number>(0);
  const dragRef = useRef<PointerGesture>({
    active: false,
    owner: 'none',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    multiplePointers: false,
  });
  const gestureOwnerRef = useRef<PanoGestureOwner>('none');
  const activePointerIdsRef = useRef(new Set<number>());
  const viewRef = useRef(effectiveView);
  const activeRotationRef = useRef(panoRotation);
  const compareRotationRef = useRef(compareRotation);
  const compareImageUrlRef = useRef(compareImageUrl);
  const opacityRef = useRef(compareOpacity);
  const controlledRef = useRef(view !== undefined);
  const onViewChangeRef = useRef(onViewChange);
  const onPickUvRef = useRef(onPickUv);
  const onVertexMoveRef = useRef(onVertexMove);
  const onVertexSelectionChangeRef = useRef(onVertexSelectionChange);
  const selectedVertexIdsRef = useRef(selectedVertexIds);
  const interactionModeRef = useRef(interactionMode);
  const [draftVertices, setDraftVertices] = useState<PanoViewerRegionVertex[]>([]);
  const draftVerticesRef = useRef<PanoViewerRegionVertex[]>([]);
  const lastDraftClickRef = useRef(0);
  const regionDrawShapeRef = useRef(regionDrawShape);
  const regionsRef = useRef(regions);
  const activeRegionIdRef = useRef(activeRegionId);
  const onRegionTranslateRef = useRef(onRegionTranslate);
  const onRegionGestureStartRef = useRef<() => void>();
  const onRegionGestureEndRef = useRef<() => void>();
  const emitViewChangeRef = useRef<(update: Partial<PanoViewState>) => void>();
  const completeDraftRef = useRef<(vertices?: PanoViewerRegionVertex[]) => void>();
  const replaceDraftVerticesRef = useRef<(vertices: PanoViewerRegionVertex[]) => void>();
  const onVertexRemoveRef = useRef(onVertexRemove);
  const spaceHeldRef = useRef(false);

  viewRef.current = effectiveView;
  controlledRef.current = view !== undefined;
  onViewChangeRef.current = onViewChange;
  onPickUvRef.current = onPickUv;
  onVertexMoveRef.current = onVertexMove;
  onVertexSelectionChangeRef.current = onVertexSelectionChange;
  selectedVertexIdsRef.current = selectedVertexIds;
  interactionModeRef.current = interactionMode;
  regionDrawShapeRef.current = regionDrawShape;
  regionsRef.current = regions;
  activeRegionIdRef.current = activeRegionId;
  onRegionTranslateRef.current = onRegionTranslate;
  onRegionGestureStartRef.current = onRegionGestureStart;
  onRegionGestureEndRef.current = onRegionGestureEnd;
  onVertexRemoveRef.current = onVertexRemove;

  const replaceDraftVertices = useCallback((vertices: PanoViewerRegionVertex[]) => {
    draftVerticesRef.current = vertices;
    setDraftVertices(vertices);
    onRegionDraftChange?.(vertices);
  }, [onRegionDraftChange]);
  const completeDraft = useCallback((vertices = draftVerticesRef.current) => {
    if (vertices.length < 3) return;
    onRegionComplete?.(vertices);
    draftVerticesRef.current = [];
    setDraftVertices([]);
    lastDraftClickRef.current = 0;
  }, [onRegionComplete]);

  useEffect(() => {
    if (interactionMode !== 'draw-region') replaceDraftVertices([]);
  }, [interactionMode, replaceDraftVertices]);

  const emitViewChange = useCallback((update: Partial<PanoViewState>) => {
    const next = { ...viewRef.current, ...update };
    viewRef.current = next;
    if (!controlledRef.current) setUncontrolledView(next);
    onViewChangeRef.current?.(update);
  }, []);
  emitViewChangeRef.current = emitViewChange;
  completeDraftRef.current = completeDraft;
  replaceDraftVerticesRef.current = replaceDraftVertices;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(THEME_COLORS[theme].background, 1);
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const activeScene = new THREE.Scene();
    const compareScene = new THREE.Scene();
    activeSceneRef.current = activeScene;
    compareSceneRef.current = compareScene;

    const camera = new THREE.PerspectiveCamera(viewRef.current.fovDegrees, container.clientWidth / container.clientHeight, 0.1, 1000);
    cameraRef.current = camera;

    const compareSphere = createSphere(new THREE.MeshBasicMaterial({ color: THEME_COLORS[theme].empty }));
    const activeSphere = createSphere(new THREE.MeshBasicMaterial({ color: THEME_COLORS[theme].empty }));
    compareScene.add(compareSphere);
    activeScene.add(activeSphere);
    compareSphereRef.current = compareSphere;
    activeSphereRef.current = activeSphere;

    const onResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (!cameraRef.current || !rendererRef.current || !activeSceneRef.current || !compareSceneRef.current) return;

      rendererRef.current.clear(true, true, true);
      const hasCompare = Boolean(compareImageUrlRef.current);

      if (hasCompare) {
        configureCamera(cameraRef.current, viewRef.current, compareRotationRef.current);
        rendererRef.current.render(compareSceneRef.current, cameraRef.current);
        rendererRef.current.clearDepth();
      }

      configureCamera(cameraRef.current, viewRef.current, activeRotationRef.current);
      rendererRef.current.render(activeSceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', onResize);
      disposeMesh(compareSphere);
      disposeMesh(activeSphere);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [theme]);

  useEffect(() => {
    activeRotationRef.current = panoRotation;
  }, [panoRotation]);
  useEffect(() => {
    compareRotationRef.current = compareRotation;
  }, [compareRotation]);
  useEffect(() => {
    compareImageUrlRef.current = compareImageUrl;
  }, [compareImageUrl]);
  useEffect(() => {
    opacityRef.current = clamp01(compareOpacity);
    updateLayerOpacity(activeSphereRef.current?.material, compareImageUrl ? opacityRef.current : 1, Boolean(compareImageUrl));
  }, [compareImageUrl, compareOpacity]);

  useEffect(() => {
    let cancelled = false;
    setPanoSphereMaterial({
      sphere: activeSphereRef.current,
      imageUrl,
      theme,
      opacity: compareImageUrl ? opacityRef.current : 1,
      transparent: Boolean(compareImageUrl),
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, compareImageUrl, theme]);

  useEffect(() => {
    let cancelled = false;
    setPanoSphereMaterial({
      sphere: compareSphereRef.current,
      imageUrl: compareImageUrl,
      theme,
      opacity: 1,
      transparent: false,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [compareImageUrl, theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      setViewportSize({
        width: Math.max(0, container.clientWidth),
        height: Math.max(0, container.clientHeight),
      });
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(container);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resetGesture = (pointerId: number) => {
      const gesture = dragRef.current;
      if (!gesture.active || gesture.pointerId !== pointerId) return;
      if (gesture.owner === 'region-handle' || gesture.owner === 'region-transform') onRegionGestureEndRef.current?.();
      gestureOwnerRef.current = 'none';
      dragRef.current = { active: false, owner: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0, multiplePointers: false };
      activePointerIdsRef.current.delete(pointerId);
      try {
        if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    };
    const pointerUv = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return {
        rect,
        uv: screenPointToPanoUv({ x: event.clientX - rect.left, y: event.clientY - rect.top }, { width: rect.width, height: rect.height }, viewRef.current, activeRotationRef.current),
      };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.pointerType === 'mouse' && event.isPrimary === false) return;
      activePointerIdsRef.current.add(event.pointerId);
      if (activePointerIdsRef.current.size > 1) {
        dragRef.current.multiplePointers = true;
        return;
      }
      const mode = interactionModeRef.current;
      const handleNode = event.composedPath().find(
        (node): node is HTMLElement => typeof HTMLElement !== 'undefined' && node instanceof HTMLElement && node.dataset.regionInteraction === 'handle',
      );
      const interaction = handleNode?.dataset.regionInteraction as 'handle' | undefined;
      const { uv } = pointerUv(event);
      let owner = choosePanoGestureOwner(mode, interaction, false, spaceHeldRef.current);
      let regionId: string | undefined;
      let regionVertexId: string | undefined;
      let pointerStartU: number | undefined;
      let pointerStartV: number | undefined;
      let lastUnwrappedU: number | undefined;
      let lastV: number | undefined;
      let handleStartVertices: Array<{ id: string; u: number; v: number }> | undefined;

      if (owner === 'region-handle' && handleNode && uv) {
        regionId = handleNode.dataset.regionId;
        regionVertexId = handleNode.dataset.regionVertexId;
        const region = regionsRef.current.find((item) => item.id === regionId);
        const vertex = region?.vertices.find((item) => item.id === regionVertexId);
        if (!region || !vertex || !regionVertexId) owner = 'none';
        else {
          const selected = event.shiftKey
            ? new Set([...selectedVertexIdsRef.current, regionVertexId])
            : new Set([regionVertexId]);
          onVertexSelectionChangeRef.current?.([...selected]);
          pointerStartU = uv[0];
          pointerStartV = uv[1];
          lastUnwrappedU = uv[0];
          lastV = uv[1];
          handleStartVertices = region.vertices
            .filter((item) => selected.has(item.id))
            .map((item) => ({ id: item.id, u: unwrapPanoUToReference(item.uv[0], uv[0]), v: item.uv[1] }));
        }
      } else if (uv && (mode === 'move-outline' || mode === 'transform-region' || mode === 'edit-region')) {
        const region = regionsRef.current.find((item) => item.id === activeRegionIdRef.current);
        if (region) {
          const loop = unwrapRegionU(region.vertices.map((vertex) => vertex.uv));
          const pointU = unwrapPanoUToReference(uv[0], loop[0]?.[0] ?? uv[0]);
          if (pointInsidePolygon([pointU, uv[1]], loop)) {
            owner = 'region-transform';
            regionId = region.id;
            pointerStartU = uv[0];
            pointerStartV = uv[1];
            lastUnwrappedU = uv[0];
            lastV = uv[1];
          }
        }
      }
      if (owner === 'none' && (mode === 'navigate' || mode === 'pick' || spaceHeldRef.current)) owner = 'view';
      if (owner === 'none') return;
      event.preventDefault();
      gestureOwnerRef.current = owner;
      dragRef.current = {
        active: true,
        owner,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        multiplePointers: false,
        regionDragId: regionId,
        regionVertexId,
        pointerStartU,
        pointerStartV,
        lastUnwrappedU,
        lastV,
        handleStartVertices,
      };
      if (owner === 'region-handle' || owner === 'region-transform') onRegionGestureStartRef.current?.();
      try {
        container.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is not available in a few embedded browser surfaces.
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;
      if (dragRef.current.owner === 'view') {
        if (eventHasRegionInteraction(event)) return;
        const dx = event.clientX - dragRef.current.lastX;
        const dy = event.clientY - dragRef.current.lastY;
        dragRef.current.lastX = event.clientX;
        dragRef.current.lastY = event.clientY;
        const factor = viewRef.current.fovDegrees / Math.max(1, container.clientHeight);
        emitViewChangeRef.current?.({
          yawDegrees: viewRef.current.yawDegrees - dx * factor,
          pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees - dy * factor)),
        });
        return;
      }
      if (dragRef.current.owner === 'region-mask') return;
      const { uv } = pointerUv(event);
      const region = dragRef.current.regionDragId
        ? regionsRef.current.find((item) => item.id === dragRef.current.regionDragId)
        : undefined;
      if (!uv || !region) return;
      const referenceU = dragRef.current.lastUnwrappedU ?? uv[0];
      const currentU = unwrapPanoUToReference(uv[0], referenceU);
      if (dragRef.current.owner === 'region-handle' && dragRef.current.pointerStartU !== undefined && dragRef.current.pointerStartV !== undefined) {
        const deltaU = currentU - dragRef.current.pointerStartU;
        const deltaV = uv[1] - dragRef.current.pointerStartV;
        dragRef.current.lastUnwrappedU = currentU;
        dragRef.current.lastV = uv[1];
        for (const start of dragRef.current.handleStartVertices ?? []) {
          onVertexMoveRef.current?.(region.id, start.id, [((start.u + deltaU) % 1 + 1) % 1, Math.max(0, Math.min(1, start.v + deltaV))]);
        }
      } else if (dragRef.current.owner === 'region-transform' && dragRef.current.lastV !== undefined) {
        onRegionTranslateRef.current?.(region.id, [currentU - referenceU, uv[1] - dragRef.current.lastV]);
        dragRef.current.lastUnwrappedU = currentU;
        dragRef.current.lastV = uv[1];
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const gesture = dragRef.current;
      activePointerIdsRef.current.delete(event.pointerId);
      if (!gesture.active || gesture.pointerId !== event.pointerId) return;
      const rect = container.getBoundingClientRect();
      const isClick = isPanoViewerClick(
        { x: gesture.startX, y: gesture.startY },
        { x: event.clientX, y: event.clientY },
        gesture.multiplePointers || activePointerIdsRef.current.size > 0,
      );
      if (gesture.owner === 'region-mask' && interactionModeRef.current === 'draw-region' && regionDrawShapeRef.current === 'rectangle' && !isClick) {
        const startUv = screenPointToPanoUv({ x: gesture.startX - rect.left, y: gesture.startY - rect.top }, { width: rect.width, height: rect.height }, viewRef.current, activeRotationRef.current);
        const endUv = screenPointToPanoUv({ x: event.clientX - rect.left, y: event.clientY - rect.top }, { width: rect.width, height: rect.height }, viewRef.current, activeRotationRef.current);
        if (startUv && endUv) {
          let endU = endUv[0]; while (endU - startUv[0] > 0.5) endU -= 1; while (endU - startUv[0] < -0.5) endU += 1;
          const wrap = (u: number) => ((u % 1) + 1) % 1;
          completeDraftRef.current?.([
            { id: 'draft-1', uv: [startUv[0], startUv[1]] }, { id: 'draft-2', uv: [wrap(endU), startUv[1]] },
            { id: 'draft-3', uv: [wrap(endU), endUv[1]] }, { id: 'draft-4', uv: [startUv[0], endUv[1]] },
          ]);
        }
      } else
      if ((gesture.owner === 'view' || gesture.owner === 'region-mask') && shouldPickPanoViewerPointerUp(interactionModeRef.current, isClick)) {
        const uv = screenPointToPanoUv(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          { width: rect.width, height: rect.height },
          viewRef.current,
          activeRotationRef.current,
        );
        if (uv) {
          if (interactionModeRef.current === 'draw-region') {
            const current = draftVerticesRef.current;
            const firstPoint = current[0] ? panoUvToScreenPoint(current[0].uv, { width: rect.width, height: rect.height }, viewRef.current, activeRotationRef.current) : undefined;
            const closesFirst = current.length >= 3 && firstPoint?.visible && Math.hypot(firstPoint.x - (event.clientX - rect.left), firstPoint.y - (event.clientY - rect.top)) <= 12;
            const now = performance.now(); const doubleClick = current.length >= 3 && now - lastDraftClickRef.current < 350;
            if (closesFirst || doubleClick) completeDraftRef.current?.(current);
            else { const next = [...current, { id: `draft-${current.length + 1}`, uv }]; replaceDraftVerticesRef.current?.(next); lastDraftClickRef.current = now; }
          } else onPickUvRef.current?.(uv);
        }
      }
      resetGesture(event.pointerId);
    };
    const onPointerCancel = (event: PointerEvent) => {
      activePointerIdsRef.current.delete(event.pointerId);
      dragRef.current.multiplePointers = true;
      resetGesture(event.pointerId);
    };
    const onLostPointerCapture = (event: PointerEvent) => resetGesture(event.pointerId);
    const onPointerLeave = (event: PointerEvent) => {
      if (dragRef.current.active && !container.hasPointerCapture(event.pointerId)) resetGesture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      if (eventHasRegionInteraction(event) || (gestureOwnerRef.current !== 'none' && gestureOwnerRef.current !== 'view')) return;
      if (interactionModeRef.current !== 'navigate' && !spaceHeldRef.current) return;
      event.preventDefault();
      emitViewChangeRef.current?.({ fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees + event.deltaY * 0.04)) });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) {
          return;
        }
      }
      if (event.code === 'Space') {
        spaceHeldRef.current = true;
        event.preventDefault();
        return;
      }
      const navigationKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_']);
      if (navigationKeys.has(event.key) && interactionModeRef.current !== 'navigate' && interactionModeRef.current !== 'pick' && !spaceHeldRef.current) return;
      const step = event.shiftKey ? 8 : 3;
      const fovStep = event.shiftKey ? 4 : 2;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          emitViewChangeRef.current?.({ yawDegrees: viewRef.current.yawDegrees - step });
          break;
        case 'ArrowRight':
          event.preventDefault();
          emitViewChangeRef.current?.({ yawDegrees: viewRef.current.yawDegrees + step });
          break;
        case 'ArrowUp':
          event.preventDefault();
          emitViewChangeRef.current?.({
            pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees + step)),
          });
          break;
        case 'ArrowDown':
          event.preventDefault();
          emitViewChangeRef.current?.({
            pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees - step)),
          });
          break;
        case '+':
        case '=':
          event.preventDefault();
          emitViewChangeRef.current?.({
            fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees - fovStep)),
          });
          break;
        case '-':
        case '_':
          event.preventDefault();
          emitViewChangeRef.current?.({
            fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees + fovStep)),
          });
          break;
        case 'Enter':
          if (interactionModeRef.current === 'draw-region' && draftVerticesRef.current.length >= 3) {
            event.preventDefault(); completeDraftRef.current?.();
          }
          break;
        case 'Backspace':
          if (interactionModeRef.current === 'draw-region') {
            event.preventDefault(); replaceDraftVerticesRef.current?.(draftVerticesRef.current.slice(0, -1));
          }
          break;
        case 'Escape':
          if (interactionModeRef.current === 'draw-region') { event.preventDefault(); replaceDraftVerticesRef.current?.([]); }
          break;
        case 'Delete':
          if (activeRegionIdRef.current && selectedVertexIdsRef.current.length) selectedVertexIdsRef.current.forEach((id) => onVertexRemoveRef.current?.(activeRegionIdRef.current!, id));
          break;
        default:
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceHeldRef.current = false;
    };

    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('pointermove', onPointerMove, { capture: true });
    container.addEventListener('pointerup', onPointerUp, { capture: true });
    container.addEventListener('pointercancel', onPointerCancel, { capture: true });
    container.addEventListener('lostpointercapture', onLostPointerCapture);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('keyup', onKeyUp);
    return () => {
      const pointerId = dragRef.current.pointerId;
      if (pointerId !== undefined) resetGesture(pointerId);
      spaceHeldRef.current = false;
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
      container.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      container.removeEventListener('lostpointercapture', onLostPointerCapture);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const draftRegion: PanoViewerRegion | undefined = draftVertices.length
    ? { id: '__draft__', vertices: draftVertices, state: 'active' }
    : undefined;
  const displayedRegions: PanoViewerRegion[] = draftRegion ? [...regions, draftRegion] : regions;
  const regionElements = displayedRegions.map((region) => {
    const points = region.vertices.map((vertex) => ({ vertex, point: panoUvToScreenPoint(vertex.uv, viewportSize, effectiveView, panoRotation) }));
    const visible = points.filter(({ point }) => point.visible);
    if (!visible.length) return null;
    const invalid = region.state === 'invalid'; const disabled = region.state === 'disabled'; const active = region.id === activeRegionId || region.state === 'active';
    const stroke = invalid ? '#ef4444' : disabled ? '#94a3b8' : active ? '#22d3ee' : '#34d399';
    const polygonPoints = visible.map(({ point }) => `${point.x},${point.y}`).join(' ');
    return <React.Fragment key={region.id}>
      {visible.length === region.vertices.length && <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-label={region.label ?? 'Region outline'}><polygon points={polygonPoints} fill={`${stroke}26`} stroke={stroke} strokeWidth="2" /></svg>}
      {points.map(({ vertex, point }) => point.visible && <button key={vertex.id} type="button" data-region-vertex={vertex.id}
        data-region-interaction="handle" data-region-id={region.id} data-region-vertex-id={vertex.id}
        className={`absolute z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 select-none rounded-full border-2 bg-surface-base text-[9px] cursor-pointer ${selectedVertexIds.includes(vertex.id) ? 'ring-2 ring-cyan-300' : ''}`}
        style={{ left: point.x, top: point.y, borderColor: stroke, touchAction: 'none' }} aria-label={vertex.label ?? `Handle ${vertex.id}`}
        onPointerDown={(event) => { event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); const next = event.shiftKey ? [...new Set([...selectedVertexIds, vertex.id])] : [vertex.id]; onVertexSelectionChange?.(next); }}
        onDoubleClick={() => activeRegionId && onVertexInsert?.(activeRegionId, vertex.id, 0.5)}>{vertex.label}</button>)}
    </React.Fragment>;
  });

  const markerElements = markers.map((marker) => {
    const point = panoUvToScreenPoint(marker.uv, viewportSize, effectiveView, panoRotation);
    if (!point.visible) return null;
    const state = marker.state ?? 'complete';
    const tone = state === 'pending'
      ? 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100'
      : state === 'disabled'
        ? 'border-slate-300 bg-slate-100 text-slate-500 opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400'
        : state === 'conflicting'
          ? 'border-red-300 bg-red-100 text-red-800 ring-2 ring-red-300 dark:border-red-500 dark:bg-red-950 dark:text-red-100'
          : 'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-100';
    return (
      <span
        key={marker.id}
        data-pano-marker={marker.id}
        className={`pointer-events-none absolute z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm ${tone}`}
        style={{ left: point.x, top: point.y }}
        aria-label={`${marker.label}${state === 'conflicting' ? ', conflicting' : state === 'pending' ? ', pending' : ''}`}
      >
        {marker.label}
      </span>
    );
  });

  return (
    <div
      className={`relative h-full min-h-0 touch-none select-none overflow-hidden bg-surface-base outline-none ${
        interactionMode === 'navigate' || interactionMode === 'pick' ? 'cursor-grab' :
          interactionMode === 'move-outline' || interactionMode === 'transform-region' ? 'cursor-move' :
            interactionMode === 'edit-handles' || interactionMode === 'edit-region' ? 'cursor-default' :
              'cursor-crosshair'
      }`}
      ref={containerRef}
      tabIndex={0}
      role="application"
      data-pano-interaction-mode={interactionMode}
      aria-label={label
        ? `${label}. 360 panorama viewer. Drag or use arrow keys to look around. Plus and minus change field of view.`
        : '360 panorama viewer. Drag or use arrow keys to look around. Plus and minus change field of view.'}
    >
      {regionElements}{markerElements}
      {!imageUrl && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center bg-surface-base text-secondary">
          <p className="text-sm font-medium">No panorama selected</p>
          <p className="mt-1 text-xs">Render a graybox pano or import a styled pano. Drag or use arrow keys to look around.</p>
        </div>
      )}
    </div>
  );
}

function createSphere(material: THREE.Material) {
  const geometry = new THREE.SphereGeometry(500, 80, 48);
  geometry.scale(-1, 1, 1);
  return new THREE.Mesh(geometry, material);
}

function configureCamera(camera: THREE.PerspectiveCamera, view: PanoViewState, rotation: Euler) {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = THREE.MathUtils.degToRad(panoYawToThreeJsYawDegrees(view.yawDegrees - rotation[1]));
  camera.rotation.x = THREE.MathUtils.degToRad(view.pitchDegrees);
  camera.rotation.z = 0;
  camera.fov = clampFovDegrees(view.fovDegrees);
  camera.updateProjectionMatrix();
}

function setPanoSphereMaterial(params: {
  sphere: THREE.Mesh | null;
  imageUrl?: string;
  theme: keyof typeof THEME_COLORS;
  opacity: number;
  transparent: boolean;
  isCancelled: () => boolean;
}) {
  if (!params.sphere) return;
  if (!params.imageUrl) {
    const material = new THREE.MeshBasicMaterial({ color: THEME_COLORS[params.theme].empty });
    setSphereMaterial(params.sphere, material, params.isCancelled);
    return;
  }
  new THREE.TextureLoader().load(params.imageUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      opacity: clamp01(params.opacity),
      transparent: params.transparent,
      depthWrite: !params.transparent,
    });
    setSphereMaterial(params.sphere, material, params.isCancelled);
  });
}

function setSphereMaterial(sphere: THREE.Mesh, material: THREE.Material, isCancelled: () => boolean) {
  if (isCancelled()) {
    disposeMaterial(material);
    return;
  }
  const oldMaterial = sphere.material;
  sphere.material = material;
  disposeMaterial(oldMaterial);
}

function updateLayerOpacity(
  material: THREE.Material | THREE.Material[] | undefined,
  opacity: number,
  transparent: boolean,
) {
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  for (const item of materials) {
    item.opacity = clamp01(opacity);
    item.transparent = transparent;
    item.depthWrite = !transparent;
    item.needsUpdate = true;
  }
}

function clampFovDegrees(value: number) {
  if (!Number.isFinite(value)) return 65;
  return Math.max(18, Math.min(120, value));
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function normalizeYaw(value: number) {
  return ((value % 360) + 360) % 360;
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  disposeMaterial(mesh.material);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => disposeMaterial(item));
    return;
  }
  const texture = (material as THREE.MeshBasicMaterial).map;
  texture?.dispose();
  material.dispose();
}
