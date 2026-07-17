/**
 * Browser harness: compile projected-style materials under real WebGL.
 * Tests single and dual projector modes with pixel readback verification.
 * Bundled to IIFE by the compile test and executed in Chromium.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { defaultProjectedStyleSettings } from '../../src/domain/defaults';

export interface ProjectedCompileResult {
  ok: boolean;
  errors: string[];
  lightingCases: Array<{ lightingContribution: number; ok: boolean; detail?: string }>;
  dualCases: Array<{ mode: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }>;
}

function makeSolidDataTexture(r: number, g: number, b: number, a = 255): THREE.DataTexture {
  const data = new Uint8Array([r, g, b, a]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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

function renderAndReadPixel(
  renderer: THREE.WebGLRenderer,
  material: THREE.MeshStandardMaterial,
  boxPosition: [number, number, number],
  cameraPosition: [number, number, number],
): { r: number; g: number; b: number; ok: boolean; error?: string } {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(...boxPosition);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(...cameraPosition);
  camera.lookAt(...boxPosition);

  renderer.clear();
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const err = gl.getError();
  if (err !== gl.NO_ERROR) {
    return { r: 0, g: 0, b: 0, ok: false, error: `gl.getError()=${err}` };
  }

  const pixel = new Uint8Array(4);
  // Read center pixel
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  gl.readPixels(
    Math.floor(width / 2),
    Math.floor(height / 2),
    1, 1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  return {
    r: pixel[0],
    g: pixel[1],
    b: pixel[2],
    ok: true,
  };
}

function tryDualBlend(
  renderer: THREE.WebGLRenderer,
  mode: string,
): { ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number } {
  // Primary: solid red texture. Secondary: solid blue texture.
  const primaryTex = makeSolidDataTexture(255, 0, 0);
  const secondaryTex = makeSolidDataTexture(0, 0, 255);

  const blendModeId = mode === 'secondary_only' ? 1
    : mode === 'primary_dominant' ? 2
    : mode === 'secondary_dominant' ? 3
    : 0;

  const material = createProjectedStyleMaterial({
    texture: primaryTex,
    origin: [0, 1.6, 0],
    rotation: [0, 0, 0],
    settings: {
      ...defaultProjectedStyleSettings,
      lightingContribution: 0,
      blendMode: mode as 'primary_only' | 'secondary_only' | 'primary_dominant' | 'secondary_dominant',
    },
    fallbackColor: 0x888888,
    disposable: true,
    secondaryTexture: blendModeId !== 0 ? secondaryTex : undefined,
    secondaryOrigin: blendModeId !== 0 ? [5, 1.6, 0] : undefined,
    secondaryRotation: [0, 0, 0],
  });

  // Place box near primary origin so primary should dominate in dominant modes.
  const result = renderAndReadPixel(
    renderer,
    material,
    [0, 1.6, 2],
    [0, 1.6, 6],
  );

  primaryTex.dispose();
  secondaryTex.dispose();
  material.dispose();

  if (!result.ok) return result;

  return {
    ok: true,
    pixelR: result.r,
    pixelG: result.g,
    pixelB: result.b,
  };
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
      dualCases: [],
    };
  }

  renderer.setSize(64, 64, false);

  const lightingCases = [0, 0.5].map((lightingContribution) => {
    const result = tryCompile(renderer, lightingContribution);
    return { lightingContribution, ...result };
  });

  // Dual projector tests with pixel readback
  const dualModes = ['primary_only', 'secondary_only', 'primary_dominant', 'secondary_dominant'];
  const dualCases = dualModes.map((mode) => {
    const result = tryDualBlend(renderer, mode);
    return { mode, ...result };
  });

  renderer.dispose();
  console.error = originalError;

  const shaderFail = glErrors.some((line) =>
    /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line),
  );
  const allCasesOk = lightingCases.every((c) => c.ok) && dualCases.every((c) => c.ok);
  const errors = [
    ...glErrors.filter((line) => /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line)),
    ...lightingCases.filter((c) => !c.ok).map((c) => `lighting=${c.lightingContribution}: ${c.detail}`),
    ...dualCases.filter((c) => !c.ok).map((c) => `dual mode=${c.mode}: ${c.detail}`),
  ];

  return {
    ok: allCasesOk && !shaderFail,
    errors,
    lightingCases,
    dualCases,
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
    dualCases: [],
  };
}
