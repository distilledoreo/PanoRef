import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';

export function PanoramaViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const reqFrame = useRef<number>(0);
  
  const { imageUrl, panoramaMode, yawDegrees, pitchDegrees, fovDegrees, setViewerState } = useAppStore();
  
  // Local interaction state
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    // Setup Three.js
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(fovDegrees, container.clientWidth / container.clientHeight, 0.1, 1000);
    // Looking along Z initially
    camera.position.set(0, 0, 0);
    cameraRef.current = camera;

    // Create Sphere (radius 500)
    // Invert geometry to see inside
    const geometry = new THREE.SphereGeometry( 500, 60, 40 );
    geometry.scale(-1, 1, 1);
    
    const material = new THREE.MeshBasicMaterial({ color: 0x222222 }); // fallback
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    sphereRef.current = sphere;

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !containerRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      reqFrame.current = requestAnimationFrame(animate);
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        // Update camera rotation based on store yaw/pitch (we assume they are up-to-date)
        // Store yaw/pitch: yaw=0 is straight ahead, pitch=0 is horizon.
        const yawRad = THREE.MathUtils.degToRad(useAppStore.getState().yawDegrees);
        const pitchRad = THREE.MathUtils.degToRad(useAppStore.getState().pitchDegrees);
        
        // We can just use rotation
        cameraRef.current.rotation.order = 'YXZ';
        cameraRef.current.rotation.y = yawRad;
        cameraRef.current.rotation.x = pitchRad;
        cameraRef.current.fov = useAppStore.getState().fovDegrees;
        cameraRef.current.updateProjectionMatrix();

        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(reqFrame.current);
      if (rendererRef.current && rendererRef.current.domElement.parentNode) {
        rendererRef.current.domElement.parentNode.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
    };
  }, []); // Only once, relies on getState for anim loop.

  // Load texture
  useEffect(() => {
    if (!imageUrl || !sphereRef.current) return;
    const loader = new THREE.TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      textureRef.current = texture;
      
      const material = new THREE.MeshBasicMaterial({ map: texture });
      
      // Handle stereo modes
      if (panoramaMode === 'stereo-side-by-side') {
        texture.repeat.set(0.5, 1);
        texture.offset.set(0, 0); // left eye default
      } else if (panoramaMode === 'stereo-over-under') {
        texture.repeat.set(1, 0.5);
        texture.offset.set(0, 0.5); // Top half (left eye) default
      }
      
      if (sphereRef.current) {
        sphereRef.current.material = material;
      }
    });
  }, [imageUrl, panoramaMode]);

  // Handle interaction
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      isDragging.current = true;
      previousMousePosition.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - previousMousePosition.current.x;
      const dy = e.clientY - previousMousePosition.current.y;
      previousMousePosition.current = { x: e.clientX, y: e.clientY };

      const { yawDegrees, pitchDegrees, fovDegrees, setViewerState } = useAppStore.getState();
      
      // Calculate rotation speed based on FOV (zoom)
      const factor = fovDegrees / el.clientHeight;
      let newYaw = yawDegrees + dx * factor * -1; // -1 because dragging right should look left
      let newPitch = pitchDegrees + dy * factor * -1;
      
      newPitch = Math.max(-90, Math.min(90, newPitch));
      // Normalize yaw to 0-360 or let it roll (letting it roll is easy)
      
      setViewerState(newYaw, newPitch, fovDegrees);
    };

    const handlePointerUp = (e: PointerEvent) => {
      isDragging.current = false;
      el.releasePointerCapture(e.pointerId);
    };

    const handleWheel = (e: WheelEvent) => {
      // e.preventDefault(); // Might need to prevent scrolling on page if any
      const { yawDegrees, pitchDegrees, fovDegrees, setViewerState } = useAppStore.getState();
      let newFov = fovDegrees + e.deltaY * 0.05;
      newFov = Math.max(10, Math.min(140, newFov));
      setViewerState(yawDegrees, pitchDegrees, newFov);
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden touch-none" ref={containerRef}>
      {!imageUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 text-zinc-400 z-10">
          <p>No Panorama Loaded</p>
          <p className="text-sm mt-2 opacity-50">Go to Load Image tab to begin</p>
        </div>
      )}
      
      {/* HUD overlay */}
      {imageUrl && (
        <div className="absolute bottom-4 right-4 pointer-events-none bg-black/50 text-white text-xs px-3 py-1.5 rounded-md backdrop-blur flex gap-4 font-mono z-10">
          <div>YAW: {((yawDegrees % 360 + 360) % 360).toFixed(1)}°</div>
          <div>PITCH: {pitchDegrees.toFixed(1)}°</div>
          <div>FOV: {fovDegrees.toFixed(1)}°</div>
        </div>
      )}
    </div>
  );
}
