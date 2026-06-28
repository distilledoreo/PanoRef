import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { LocationProject } from '../../domain/types';
import { buildScene, disposeScene } from '../../engine/sceneObjects';

export function SceneViewport({
  project,
  selectedObjectId,
  onSelectObject,
}: {
  project: LocationProject;
  selectedObjectId?: string;
  onSelectObject?: (id?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const orbitRef = useRef({ yaw: -35, pitch: 22, distance: 11, target: new THREE.Vector3(0, 1.2, 0) });
  const dragRef = useRef({ active: false, x: 0, y: 0, moved: false });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(52, container.clientWidth / container.clientHeight, 0.1, 200);
    cameraRef.current = camera;

    const onResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const activeCamera = cameraRef.current;
      const activeRenderer = rendererRef.current;
      const activeScene = sceneRef.current;
      if (!activeCamera || !activeRenderer || !activeScene) return;
      updateCamera(activeCamera, orbitRef.current);
      activeRenderer.render(activeScene, activeCamera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', onResize);
      if (sceneRef.current) disposeScene(sceneRef.current);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) disposeScene(sceneRef.current);
    sceneRef.current = buildScene(project, { selectedObjectId });
  }, [project, selectedObjectId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { active: true, x: event.clientX, y: event.clientY, moved: false };
      container.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragRef.current.moved = true;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
      orbitRef.current.yaw -= dx * 0.25;
      orbitRef.current.pitch = Math.max(-10, Math.min(78, orbitRef.current.pitch - dy * 0.18));
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragRef.current.moved) selectObjectAt(event, container);
      dragRef.current.active = false;
      container.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      orbitRef.current.distance = Math.max(3, Math.min(28, orbitRef.current.distance + event.deltaY * 0.01));
    };
    const selectObjectAt = (event: PointerEvent, element: HTMLDivElement) => {
      if (!sceneRef.current || !cameraRef.current) return;
      const bounds = element.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, cameraRef.current);
      const hits = raycaster.intersectObjects(sceneRef.current.children, true);
      const hit = hits.find((item) => findSceneObjectId(item.object));
      onSelectObject?.(hit ? findSceneObjectId(hit.object) : undefined);
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
  }, [onSelectObject]);

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden bg-slate-950" ref={containerRef}>
      <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-slate-950/80 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        Drag to orbit · scroll to zoom · click a primitive to inspect
      </div>
    </div>
  );
}

function updateCamera(camera: THREE.PerspectiveCamera, orbit: { yaw: number; pitch: number; distance: number; target: THREE.Vector3 }) {
  const yaw = THREE.MathUtils.degToRad(orbit.yaw);
  const pitch = THREE.MathUtils.degToRad(orbit.pitch);
  const x = Math.sin(yaw) * Math.cos(pitch) * orbit.distance;
  const y = Math.sin(pitch) * orbit.distance;
  const z = Math.cos(yaw) * Math.cos(pitch) * orbit.distance;
  camera.position.set(orbit.target.x + x, orbit.target.y + y, orbit.target.z + z);
  camera.lookAt(orbit.target);
}

function findSceneObjectId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.sceneObjectId === 'string') return current.userData.sceneObjectId;
    current = current.parent;
  }
  return undefined;
}

