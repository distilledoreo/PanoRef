/**
 * Browser harness: render the receiving Projected Style material with a real
 * occlusion cubemap and read back pixels. Verifies that single-projector output
 * is NOT blended 50/50 with fallback, that occlusion makes rear surfaces fall
 * back, and that blend modes change the result.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { generateProjectorOcclusionMap } from '../../src/engine/projectorOcclusion';
import { createDefaultProject, createSceneObject } from '../../src/domain/defaults';
import type { LocationProject, Vec3, Euler, ProjectedStyleSettings } from '../../src/domain/types';

export interface ProjectedReceiveResult {
  ok: boolean;
  errors: string[];
  /** Front receiver (in front of occluder) RGB, mapped to 0..255. */
  frontPixel: [number, number, number];
  /** Rear receiver (behind occluder) RGB, mapped to 0..255. */
  rearPixel: [number, number, number];
  /** Primary-only mode front pixel. */
  primaryModeFront: [number, number, number];
}

const ORIGIN: Vec3 = [0, 1.6, 0];

function buildOccluderProject(): LocationProject {
  const project = createDefaultProject();
  project.scene.panoOrigin = ORIGIN;
  const frontBox = createSceneObject('box', 1, [4, 1.6, 0]);
  frontBox.dimensions = [1, 1, 1];
  const floor = createSceneObject('floor', 1, [0, 0, 0]);
  // Only geometry that casts occlusion: the front box + floor.
  project.scene.objects = [floor, frontBox];
  return project;
}

function makePano(): THREE.DataTexture {
  // Solid red pano for unambiguous color checks.
  const data = new Uint8Array(4).fill(0);
  data[0] = 255;
  data[3] = 255;
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function readCenter(renderer: THREE.WebGLRenderer): [number, number, number] {
  const gl = renderer.getContext();
  const buf = new Uint8Array(4);
  gl.readPixels(
    Math.floor(renderer.domElement.width / 2),
    Math.floor(renderer.domElement.height / 2),
    1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf,
  );
  return [buf[0], buf[1], buf[2]];
}

function renderReceiver(
  renderer: THREE.WebGLRenderer,
  origin: Vec3,
  pano: THREE.Texture,
  occlusion: ReturnType<typeof generateProjectorOcclusionMap>,
  receiverX: number,
  settings: ProjectedStyleSettings,
): [number, number, number] {
  const material = createProjectedStyleMaterial({
    texture: pano,
    origin,
    rotation: [0, 0, 0] as Euler,
    settings,
    fallbackColor: 0x0000ff, // solid blue fallback
    disposable: true,
    occlusionTexture: occlusion.texture,
    occlusionNearMeters: occlusion.nearMeters,
    occlusionFarMeters: occlusion.farMeters,
    occlusionFaceSize: occlusion.faceSize,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
  plane.position.set(receiverX, 1.6, 0);
  plane.rotation.y = -Math.PI / 2; // face -X toward the origin
  const scene = new THREE.Scene();
  scene.add(plane);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(receiverX, 1.6, 0);
  camera.updateProjectionMatrix();

  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const px = readCenter(renderer);
  material.dispose();
  plane.geometry.dispose();
  return px;
}

export function runProjectedReceiveGate(): ProjectedReceiveResult {
  const result: ProjectedReceiveResult = {
    ok: false,
    errors: [],
    frontPixel: [0, 0, 0],
    rearPixel: [0, 0, 0],
    primaryModeFront: [0, 0, 0],
  };
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  } catch (error) {
    result.errors.push(`WebGLRenderer init failed: ${String(error)}`);
    return result;
  }
  renderer.setSize(64, 64, false);

  const project = buildOccluderProject();
  let occlusion: ReturnType<typeof generateProjectorOcclusionMap> | undefined;
  const pano = makePano();
  try {
    occlusion = generateProjectorOcclusionMap(renderer, project, ORIGIN, { faceSize: 64, nearMeters: 0.05 });

    const base: ProjectedStyleSettings = {
      panoId: 'x', opacity: 1, exposure: 1, lightingContribution: 0, fallbackMode: 'neutral',
      occlusionEnabled: true, occlusionBiasMeters: 0.04, occlusionSoftness: 1,
      occlusionDebugMode: 'off', blendMode: 'primary_dominant',
    };

    // Front receiver plane at x=3.0 (clearly in front of the box's ~3.5m near face).
    result.frontPixel = renderReceiver(renderer, ORIGIN, pano, occlusion, 3.0, base);
    // Rear receiver plane at x=7 (behind the box => occluded => fallback blue).
    result.rearPixel = renderReceiver(renderer, ORIGIN, pano, occlusion, 7, base);
    // Primary-only mode front receiver.
    result.primaryModeFront = renderReceiver(renderer, ORIGIN, pano, occlusion, 3.0, { ...base, blendMode: 'primary_only' });

    result.ok = true;
  } catch (error) {
    const e = error as Error;
    result.errors.push(`${e.message}\n${e.stack ?? ''}`);
  } finally {
    occlusion?.dispose();
    pano.dispose();
    renderer.dispose();
  }
  return result;
}

declare global {
  interface Window {
    __PROJECTED_RECEIVE__?: ProjectedReceiveResult;
    runProjectedReceiveGate?: typeof runProjectedReceiveGate;
  }
}

window.runProjectedReceiveGate = runProjectedReceiveGate;
try {
  window.__PROJECTED_RECEIVE__ = runProjectedReceiveGate();
} catch (error) {
  window.__PROJECTED_RECEIVE__ = {
    ok: false,
    errors: [String(error)],
    frontPixel: [0, 0, 0],
    rearPixel: [0, 0, 0],
    primaryModeFront: [0, 0, 0],
  };
}
