import React, { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Euler, PanoViewState, Vec2 } from '../../domain/types';
import { panoYawToThreeJsYawDegrees } from '../../engine/sync';
import { useThemeStore } from '../../state/useThemeStore';
import { degreesToRadians } from '../../engine/sync';

export interface PanoViewerMarker {
  id: string;
  label: string;
  uv: Vec2;
  state: 'normal' | 'pending' | 'warning';
  /** 'target' for graybox-side markers, 'source' for styled-pano-side markers. */
  side: 'target' | 'source';
}

const THEME_COLORS = {
  light: { empty: 0xe4e7e5, background: 0xf4f6f4 },
  dark: { empty: 0x243040, background: 0x0f1419 },
} as const;

const CLICK_THRESHOLD_PX = 5;

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
  markers,
}: {
  imageUrl?: string;
  view: PanoViewState;
  onViewChange: (updates: Partial<PanoViewState>) => void;
  label?: string;
  panoRotation?: Euler;
  compareImageUrl?: string;
  compareRotation?: Euler;
  compareOpacity?: number;
  interactionMode?: 'navigate' | 'pick';
  onPickUv?: (uv: Vec2) => void;
  markers?: PanoViewerMarker[];
}) {
  const theme = useThemeStore((state) => state.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const activeSceneRef = useRef<THREE.Scene | null>(null);
  const compareSceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const activeSphereRef = useRef<THREE.Mesh | null>(null);
  const compareSphereRef = useRef<THREE.Mesh | null>(null);
  const frameRef = useRef<number>(0);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; x: number; y: number }>({ active: false, startX: 0, startY: 0, x: 0, y: 0 });

  const pickRaycaster = useRef(new THREE.Raycaster());
  const pickCamera = useRef(new THREE.PerspectiveCamera());

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

    const camera = new THREE.PerspectiveCamera(view.fovDegrees, container.clientWidth / container.clientHeight, 0.1, 1000);
    cameraRef.current = camera;
    pickCamera.current.copy(camera);

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

  const viewRef = useRef(view);
  const activeRotationRef = useRef(panoRotation);
  const compareRotationRef = useRef(compareRotation);
  const compareImageUrlRef = useRef(compareImageUrl);
  const opacityRef = useRef(compareOpacity);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
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

  const computeUvFromPointer = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera) return null;
    const rect = container.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    if (Math.abs(x) > 1 || Math.abs(y) > 1) return null;

    pickCamera.current.copy(camera);
    pickCamera.current.aspect = rect.width / rect.height;
    pickCamera.current.updateProjectionMatrix();

    pickRaycaster.current.setFromCamera(new THREE.Vector2(x, y), pickCamera.current);
    const dir = pickRaycaster.current.ray.direction.clone().normalize();
    const rotation = activeRotationRef.current;
    const yawRad = degreesToRadians(rotation[1] ?? 0);
    const s = Math.sin(yawRad);
    const c = Math.cos(yawRad);
    const correctedDir = new THREE.Vector3(
      dir.x * c + dir.z * s,
      dir.y,
      dir.z * c - dir.x * s,
    );
    const longitude = Math.atan2(correctedDir.x, correctedDir.z);
    const latitude = Math.asin(Math.max(-1, Math.min(1, correctedDir.y)));
    return [
      longitude / (2 * Math.PI) + 0.5,
      latitude / Math.PI + 0.5,
    ];
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { active: true, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
      container.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
      if (interactionMode === 'navigate') {
        const factor = viewRef.current.fovDegrees / Math.max(1, container.clientHeight);
        onViewChange({
          yawDegrees: viewRef.current.yawDegrees - dx * factor,
          pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees - dy * factor)),
        });
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const wasDragging = dragRef.current.active;
      const totalDx = event.clientX - dragRef.current.startX;
      const totalDy = event.clientY - dragRef.current.startY;
      const totalMovement = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      dragRef.current.active = false;
      container.releasePointerCapture(event.pointerId);
      if (wasDragging && totalMovement < CLICK_THRESHOLD_PX && interactionMode === 'pick' && onPickUv) {
        const uv = computeUvFromPointer(event.clientX, event.clientY);
        if (uv) onPickUv(uv);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onViewChange({ fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees + event.deltaY * 0.04)) });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) {
          return;
        }
      }
      if (interactionMode !== 'navigate') return;
      const step = event.shiftKey ? 8 : 3;
      const fovStep = event.shiftKey ? 4 : 2;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          onViewChange({ yawDegrees: viewRef.current.yawDegrees - step });
          break;
        case 'ArrowRight':
          event.preventDefault();
          onViewChange({ yawDegrees: viewRef.current.yawDegrees + step });
          break;
        case 'ArrowUp':
          event.preventDefault();
          onViewChange({
            pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees + step)),
          });
          break;
        case 'ArrowDown':
          event.preventDefault();
          onViewChange({
            pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees - step)),
          });
          break;
        case '+':
        case '=':
          event.preventDefault();
          onViewChange({
            fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees - fovStep)),
          });
          break;
        case '-':
        case '_':
          event.preventDefault();
          onViewChange({
            fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees + fovStep)),
          });
          break;
        default:
          break;
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [onViewChange, interactionMode, onPickUv, computeUvFromPointer]);

  const pickModeActive = interactionMode === 'pick';

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-surface-base outline-none"
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="360 panorama viewer. Drag or use arrow keys to look around. Plus and minus change field of view."
    >
      {!imageUrl && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center bg-surface-base text-secondary">
          <p className="text-sm font-medium">No panorama selected</p>
          <p className="mt-1 text-xs">Render a graybox pano or import a styled pano. Drag or use arrow keys to look around.</p>
        </div>
      )}

      {markers?.map((marker) => {
        const markerView = viewRef.current;
        const rotation = activeRotationRef.current;
        const yawRad = degreesToRadians(rotation[1] ?? 0);
        const longitude = (marker.uv[0] - 0.5) * 2 * Math.PI;
        const latitude = (marker.uv[1] - 0.5) * Math.PI;
        const dir = new THREE.Vector3(
          Math.sin(longitude) * Math.cos(latitude),
          Math.sin(latitude),
          Math.cos(longitude) * Math.cos(latitude),
        );
        const s = Math.sin(-yawRad);
        const c = Math.cos(-yawRad);
        const worldDir = new THREE.Vector3(
          dir.x * c + dir.z * s,
          dir.y,
          dir.z * c - dir.x * s,
        );

        const cameraYaw = degreesToRadians(panoYawToThreeJsYawDegrees(markerView.yawDegrees));
        const cameraPitch = degreesToRadians(markerView.pitchDegrees);
        const cosPitch = Math.cos(cameraPitch);
        const forward = new THREE.Vector3(
          Math.sin(cameraYaw) * cosPitch,
          Math.sin(cameraPitch),
          Math.cos(cameraYaw) * cosPitch,
        );
        const right = new THREE.Vector3(
          Math.cos(cameraYaw),
          0,
          -Math.sin(cameraYaw),
        );
        const up = new THREE.Vector3(0, 1, 0);
        const fovRad = degreesToRadians(markerView.fovDegrees);
        const container = containerRef.current;
        if (!container) return null;
        const aspect = container.clientWidth / Math.max(1, container.clientHeight);

        const toDir = worldDir.clone().sub(forward.multiplyScalar(2 * forward.dot(worldDir)));
        const screenX = toDir.dot(right) / (Math.tan(fovRad / 2) * aspect);
        const screenY = toDir.dot(up) / Math.tan(fovRad / 2);
        const screenPixelX = (screenX * 0.5 + 0.5) * container.clientWidth;
        const screenPixelY = (-screenY * 0.5 + 0.5) * container.clientHeight;

        const isOffscreen = screenPixelX < -50 || screenPixelX > container.clientWidth + 50
          || screenPixelY < -50 || screenPixelY > container.clientHeight + 50;

        if (isOffscreen) return null;

        const stateColors: Record<string, string> = {
          normal: 'border-accent bg-accent text-white',
          pending: 'border-amber-400 bg-amber-400 text-black',
          warning: 'border-red-400 bg-red-400 text-white',
        };

        return (
          <button
            key={marker.id}
            type="button"
            className={`pointer-events-auto absolute z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow-md transition-opacity ${stateColors[marker.state] ?? stateColors.normal}`}
            style={{ left: screenPixelX, top: screenPixelY }}
            aria-label={marker.label}
          >
            {marker.label.replace(/[^0-9]/g, '')}
          </button>
        );
      })}

      {pickModeActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-full border-2 border-dashed border-white/60 bg-black/20 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm">
            Click on the panorama to place a marker
          </div>
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
