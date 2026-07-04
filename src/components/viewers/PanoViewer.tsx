import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Euler, PanoViewState } from '../../domain/types';
import { panoYawToThreeJsYawDegrees } from '../../engine/sync';
import { useThemeStore } from '../../state/useThemeStore';

const THEME_COLORS = {
  light: { empty: 0xe4e7e5, background: 0xf4f6f4 },
  dark: { empty: 0x243040, background: 0x0f1419 },
} as const;

export function PanoViewer({
  imageUrl,
  view,
  onViewChange,
  label,
  panoRotation = [0, 0, 0],
  compareImageUrl,
  compareRotation = [0, 0, 0],
  compareOpacity = 1,
}: {
  imageUrl?: string;
  view: PanoViewState;
  onViewChange: (updates: Partial<PanoViewState>) => void;
  label?: string;
  panoRotation?: Euler;
  compareImageUrl?: string;
  compareRotation?: Euler;
  compareOpacity?: number;
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
  const dragRef = useRef({ active: false, x: 0, y: 0 });

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { active: true, x: event.clientX, y: event.clientY };
      container.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
      const factor = viewRef.current.fovDegrees / Math.max(1, container.clientHeight);
      onViewChange({
        yawDegrees: viewRef.current.yawDegrees - dx * factor,
        pitchDegrees: Math.max(-89, Math.min(89, viewRef.current.pitchDegrees - dy * factor)),
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      dragRef.current.active = false;
      container.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onViewChange({ fovDegrees: Math.max(18, Math.min(120, viewRef.current.fovDegrees + event.deltaY * 0.04)) });
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', onWheel);
    };
  }, [onViewChange]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-surface-base" ref={containerRef}>
      {!imageUrl && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center bg-surface-base text-secondary">
          <p className="text-sm font-medium">No panorama selected</p>
          <p className="mt-1 text-xs">Render a graybox pano or import a styled pano.</p>
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
