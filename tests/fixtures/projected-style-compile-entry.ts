/**
 * Browser harness: compile projected-style materials under real WebGL.
 * Bundled to IIFE by the compile test and executed in Chromium.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { defaultProjectedStyleSettings } from '../../src/domain/defaults';

export interface ProjectedCompileResult {
  ok: boolean;
  errors: string[];
  lightingCases: Array<{ lightingContribution: number; ok: boolean; detail?: string }>;
}

function makeDataTexture(): THREE.DataTexture {
  // 2×1 equirect strip: left red-ish, right green-ish (SRGB bytes).
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

function tryCompile(
  renderer: THREE.WebGLRenderer,
  lightingContribution: number,
): { ok: boolean; detail?: string } {
  const texture = makeDataTexture();
  const material = createProjectedStyleMaterial({
    texture,
    origin: [0, 1.6, 0],
    rotation: [0, 0, 0],
    settings: {
      ...defaultProjectedStyleSettings,
      lightingContribution,
    },
    fallbackColor: 0x888888,
    disposable: true,
  });
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
    // Force a draw so the program is used.
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      return { ok: false, detail: `gl.getError()=${err}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
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
      lightingCases: [],
    };
  }

  renderer.setSize(64, 64, false);

  const lightingCases = [0, 0.5].map((lightingContribution) => {
    const result = tryCompile(renderer, lightingContribution);
    return { lightingContribution, ...result };
  });

  renderer.dispose();
  console.error = originalError;

  const shaderFail = glErrors.some((line) =>
    /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line),
  );
  const allCasesOk = lightingCases.every((c) => c.ok);
  const errors = [
    ...glErrors.filter((line) => /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line)),
    ...lightingCases.filter((c) => !c.ok).map((c) => `lighting=${c.lightingContribution}: ${c.detail}`),
  ];

  return {
    ok: allCasesOk && !shaderFail,
    errors,
    lightingCases,
  };
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
    lightingCases: [],
  };
}
