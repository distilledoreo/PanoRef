/**
 * Browser harness: compile projected-style materials under real WebGL.
 * Tests single and dual projector modes with pixel readback verification.
 * Bundled to IIFE by the compile test and executed in Chromium.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { defaultProjectedStyleSettings } from '../../src/domain/defaults';
import type { ProjectedStyleSettings, Vec3, Euler } from '../../src/domain/types';

export interface ProjectedCompileCase {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ProjectedCompileResult {
  ok: boolean;
  errors: string[];
  cases: ProjectedCompileCase[];
}

function makeDataTexture(): THREE.DataTexture {
  const data = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);
  const texture = new THREE.DataTexture(data, 2, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function makeOcclusionCube(renderer: THREE.WebGLRenderer): THREE.CubeTexture {
  const size = 4;
  const target = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x808080 })));
  const cubeCamera = new THREE.CubeCamera(0.05, 100, target);
  cubeCamera.update(renderer, scene);
  return target.texture as unknown as THREE.CubeTexture;
}

interface VariantSpec {
  label: string;
  settings: ProjectedStyleSettings;
  occlusion?: boolean;
  secondary?: boolean;
  occlusionSecondary?: boolean;
  debug?: boolean;
}

function tryVariant(
  renderer: THREE.WebGLRenderer,
  spec: VariantSpec,
): ProjectedCompileCase {
  const texture = makeDataTexture();
  const occlusionTexture = spec.occlusion || spec.occlusionSecondary ? makeOcclusionCube(renderer) : undefined;
  const secondaryTexture = spec.secondary ? makeDataTexture() : undefined;
  const secondaryOcclusionTexture = spec.occlusionSecondary ? makeOcclusionCube(renderer) : undefined;

  const params = {
    texture,
    origin: [0, 1.6, 0] as Vec3,
    rotation: [0, 0, 0] as Euler,
    settings: spec.settings,
    fallbackColor: 0x888888,
    disposable: true,
    occlusionTexture,
    occlusionNearMeters: 0.05,
    occlusionFarMeters: 100,
    occlusionFaceSize: 512,
    secondaryTexture,
    secondaryOrigin: spec.secondary ? ([5, 1.6, 0] as Vec3) : undefined,
    secondaryRotation: [0, 0, 0] as Euler,
    secondaryOcclusionTexture,
    secondaryOcclusionNearMeters: 0.05,
    secondaryOcclusionFarMeters: 100,
    secondaryOcclusionFaceSize: 512,
  };

  const material = createProjectedStyleMaterial(params);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.6));
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1.6, 3);
  camera.lookAt(0, 1.6, 0);

  try {
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const err = gl.getError();
    if (err !== gl.NO_ERROR) return { label: spec.label, ok: false, detail: `gl.getError()=${err}` };
    return { label: spec.label, ok: true };
  } catch (error) {
    return { label: spec.label, ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    material.dispose();
    texture.dispose();
    mesh.geometry.dispose();
  }
}

export function runProjectedStyleCompileGate(): ProjectedCompileResult {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);

  const glErrors: string[] = [];
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    glErrors.push(args.map(String).join(' '));
    originalError(...args);
  };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
  } catch (error) {
    console.error = originalError;
    return {
      ok: false,
      errors: [`WebGLRenderer init failed: ${error instanceof Error ? error.message : String(error)}`],
      cases: [],
    };
  }

  renderer.setSize(64, 64, false);

  const variants: VariantSpec[] = [
    { label: 'single-no-occlusion-lit0', settings: { ...defaultProjectedStyleSettings, lightingContribution: 0 } },
    { label: 'single-no-occlusion-lit1', settings: { ...defaultProjectedStyleSettings, lightingContribution: 0.5 } },
    { label: 'single-occlusion', settings: { ...defaultProjectedStyleSettings }, occlusion: true },
    { label: 'dual-no-occlusion', settings: { ...defaultProjectedStyleSettings }, secondary: true },
    { label: 'dual-occlusion-both', settings: { ...defaultProjectedStyleSettings }, secondary: true, occlusion: true, occlusionSecondary: true },
    { label: 'dual-primary-occlusion-only', settings: { ...defaultProjectedStyleSettings }, secondary: true, occlusion: true },
    { label: 'dual-secondary-occlusion-only', settings: { ...defaultProjectedStyleSettings }, secondary: true, occlusionSecondary: true },
    { label: 'coverage-debug', settings: { ...defaultProjectedStyleSettings, occlusionDebugMode: 'coverage' }, occlusion: true, secondary: true, occlusionSecondary: true },
  ];

  const cases = variants.map((spec) => tryVariant(renderer, spec));

  renderer.dispose();
  console.error = originalError;

  const shaderFail = glErrors.some((line) =>
    /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line),
  );
  const allCasesOk = cases.every((c) => c.ok);
  const errors = [
    ...glErrors.filter((line) => /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line)),
    ...cases.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`),
  ];

  return { ok: allCasesOk && !shaderFail, errors, cases };
}


// Auto-run when loaded as a browser harness.
declare global {
  interface Window {
    __PROJECTED_COMPILE__?: ProjectedCompileResult;
    runProjectedStyleCompileGate?: typeof runProjectedStyleCompileGate;
  }
}

window.runProjectedStyleCompileGate = runProjectedStyleCompileGate;
try {
  window.__PROJECTED_COMPILE__ = runProjectedStyleCompileGate();
} catch (error) {
  window.__PROJECTED_COMPILE__ = {
    ok: false,
    errors: [error instanceof Error ? error.message : String(error)],
    cases: [],
  };
}
