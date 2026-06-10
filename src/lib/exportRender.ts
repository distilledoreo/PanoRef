import * as THREE from 'three';
import { PanoramaMode, StereoExportMode } from '../types';

interface ExportParams {
  imageUrl: string;
  panoramaMode: PanoramaMode;
  yawDegrees: number;
  pitchDegrees: number;
  fovDegrees: number;
  width: number;
  height: number;
  stereoMode: StereoExportMode;
  name?: string;
}

export async function exportCrop(params: ExportParams): Promise<void> {
  return new Promise((resolve, reject) => {
    // 1. Setup offscreen renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(params.width, params.height);
    renderer.setPixelRatio(1); // Exact pixel output

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(params.fovDegrees, params.width / params.height, 0.1, 1000);
    
    // Invert geometry
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);

    const loader = new THREE.TextureLoader();
    loader.load(params.imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      
      // Handle stereo modes mapping
      if (params.panoramaMode === 'stereo-side-by-side') {
        texture.repeat.set(0.5, 1);
        if (params.stereoMode === 'right-eye-only') {
           texture.offset.set(0.5, 0);
        } else {
           texture.offset.set(0, 0); // left eye
        }
      } else if (params.panoramaMode === 'stereo-over-under') {
        texture.repeat.set(1, 0.5);
        if (params.stereoMode === 'right-eye-only') {
          texture.offset.set(0, 0); // Bottom half generally right eye
        } else {
          texture.offset.set(0, 0.5); // Top half left eye
        }
      }

      const material = new THREE.MeshBasicMaterial({ map: texture });
      const sphere = new THREE.Mesh(geometry, material);
      scene.add(sphere);

      // Rotate camera
      const yawRad = THREE.MathUtils.degToRad(params.yawDegrees);
      const pitchRad = THREE.MathUtils.degToRad(params.pitchDegrees);
      
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yawRad;
      camera.rotation.x = pitchRad;
      camera.updateProjectionMatrix();

      // Render
      renderer.render(scene, camera);

      // Convert to blob and download
      renderer.domElement.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const namePart = params.name || `yaw${Math.round(params.yawDegrees)}_pitch${Math.round(params.pitchDegrees)}`;
        a.download = `panoref_${namePart}_${params.width}x${params.height}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Cleanup
        scene.remove(sphere);
        geometry.dispose();
        material.dispose();
        texture.dispose();
        renderer.dispose();
        
        resolve();
      }, 'image/png');
    }, undefined, reject);
  });
}
