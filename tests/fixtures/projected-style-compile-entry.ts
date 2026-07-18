/**
 * Browser harness: compile projected-style materials under real WebGL.
 * Tests single and dual projector modes with pixel readback verification.
 * Bundled to IIFE by the compile test and executed in Chromium.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { defaultProjectedStyleSettings } from '../../src/domain/defaults';
import type { ProjectedStyleSettings } from '../../src/domain/types';

export interface ProjectedCompileResult {
  ok: boolean;
  errors: string[];
  lightingCases: Array<{ lightingContribution: number; ok: boolean; detail?: string }>;
  dualCases: Array<{ mode: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }>;
  warpCases: Array<{ name: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }>;
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

  const hasSecondary = mode !== 'primary_only';
  const primaryOrigin: [number, number, number] = [0, 1.6, 0];
  const secondaryOrigin: [number, number, number] = [10, 1.6, 0];

  const material = createProjectedStyleMaterial({
    texture: primaryTex,
    origin: primaryOrigin,
    rotation: [0, 0, 0],
    settings: {
      ...defaultProjectedStyleSettings,
      lightingContribution: 0,
      blendMode: mode as 'primary_only' | 'secondary_only' | 'primary_dominant' | 'secondary_dominant',
    },
    fallbackColor: 0x888888,
    disposable: true,
    secondaryTexture: hasSecondary ? secondaryTex : undefined,
    secondaryOrigin: hasSecondary ? secondaryOrigin : undefined,
    secondaryRotation: [0, 0, 0],
  });

  // Place box near the dominant origin so channel readback is unambiguous:
  //   primary_only / primary_dominant → near primary → red dominates
  //   secondary_only / secondary_dominant → near secondary → blue dominates
  const nearPrimary = mode === 'primary_only' || mode === 'primary_dominant';
  const boxPos: [number, number, number] = nearPrimary
    ? [0.5, 1.6, 0.5]
    : [10, 1.6, 0.5];
  const camPos: [number, number, number] = nearPrimary
    ? [-2, 2.6, 5]
    : [7, 2.6, 5];

  const result = renderAndReadPixel(renderer, material, boxPos, camPos);

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

function makeWarpDataTexture(width: number, height: number, du: number, dv: number): THREE.DataTexture {
  const pixelCount = width * height;
  const data = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const encodedU = Math.round(((du + 0.5) / 1) * 65535);
    const encodedV = Math.round(((dv + 1.0) / 2) * 65535);
    data[i * 4] = encodedU >> 8;
    data[i * 4 + 1] = encodedU & 0xff;
    data[i * 4 + 2] = encodedV >> 8;
    data[i * 4 + 3] = encodedV & 0xff;
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function tryWarpTests(
  renderer: THREE.WebGLRenderer,
): Array<{ name: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }> {
  // Use a horizontal-gradient pano so that a u-shift changes the sampled pixel.
  const gradSize = 32;
  const gradData = new Uint8Array(gradSize * 4 * 4); // 4 wide × 1 tall RGBA
  for (let x = 0; x < 4; x++) {
    const v = Math.round((x / 3) * 255);
    gradData[x * 4] = v;
    gradData[x * 4 + 1] = 0;
    gradData[x * 4 + 2] = 255 - v;
    gradData[x * 4 + 3] = 255;
  }
  const panoTex = new THREE.DataTexture(gradData, 4, 1);
  panoTex.colorSpace = THREE.SRGBColorSpace;
  panoTex.wrapS = THREE.RepeatWrapping;
  panoTex.wrapT = THREE.ClampToEdgeWrapping;
  panoTex.needsUpdate = true;

  const origin: [number, number, number] = [0, 1.6, 0];
  const settings: ProjectedStyleSettings = {
    ...defaultProjectedStyleSettings,
    lightingContribution: 0,
    blendMode: 'primary_only',
  };
  const boxPos: [number, number, number] = [0.5, 1.6, 0.5];
  const camPos: [number, number, number] = [-2, 2.6, 5];

  // Reference: no warp
  const matNoWarp = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
  });
  const refRes = renderAndReadPixel(renderer, matNoWarp, boxPos, camPos);
  matNoWarp.dispose();

  if (!refRes.ok) {
    panoTex.dispose();
    return [{ name: 'warp reference', ok: false, detail: refRes.error }];
  }

  const results: Array<{ name: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }> = [];
  const refR = refRes.r;
  const refG = refRes.g;
  const refB = refRes.b;

  // Identity warp (du=0, dv=0) with strength 1 → same as no-warp
  const identityWarp = makeWarpDataTexture(1, 1, 0, 0);
  const matIdWarp = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
    warpMap: identityWarp,
    warpMapSize: [1, 1],
    warpStrength: 1,
  });
  const idRes = renderAndReadPixel(renderer, matIdWarp, boxPos, camPos);
  matIdWarp.dispose();
  identityWarp.dispose();

  if (idRes.ok && Math.abs(idRes.r - refR) <= 5 && Math.abs(idRes.g - refG) <= 5 && Math.abs(idRes.b - refB) <= 5) {
    results.push({ name: 'identity_warp_strength_1', ok: true, pixelR: idRes.r, pixelG: idRes.g, pixelB: idRes.b });
  } else {
    results.push({ name: 'identity_warp_strength_1', ok: false, detail: idRes.error ?? `pixel mismatch: ref=(${refR},${refG},${refB}) got=(${idRes.r},${idRes.g},${idRes.b})`, pixelR: idRes.r, pixelG: idRes.g, pixelB: idRes.b });
  }

  // Identity warp with strength 0 → same as no-warp
  const matIdWarp0 = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
    warpMap: identityWarp,
    warpMapSize: [1, 1],
    warpStrength: 0,
  });
  const id0Res = renderAndReadPixel(renderer, matIdWarp0, boxPos, camPos);
  matIdWarp0.dispose();

  if (id0Res.ok && Math.abs(id0Res.r - refR) <= 5 && Math.abs(id0Res.g - refG) <= 5 && Math.abs(id0Res.b - refB) <= 5) {
    results.push({ name: 'identity_warp_strength_0', ok: true, pixelR: id0Res.r, pixelG: id0Res.g, pixelB: id0Res.b });
  } else {
    results.push({ name: 'identity_warp_strength_0', ok: false, detail: id0Res.error ?? `pixel mismatch: ref=(${refR},${refG},${refB}) got=(${id0Res.r},${id0Res.g},${id0Res.b})`, pixelR: id0Res.r, pixelG: id0Res.g, pixelB: id0Res.b });
  }

  // Non-zero shift warp with strength 1 → should differ from no-warp
  const shiftWarp = makeWarpDataTexture(1, 1, 0.25, 0);
  const matShift = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
    warpMap: shiftWarp,
    warpMapSize: [1, 1],
    warpStrength: 1,
  });
  const shiftRes = renderAndReadPixel(renderer, matShift, boxPos, camPos);
  matShift.dispose();

  if (shiftRes.ok && (Math.abs(shiftRes.r - refR) > 5 || Math.abs(shiftRes.g - refG) > 5 || Math.abs(shiftRes.b - refB) > 5)) {
    results.push({ name: 'nonzero_shift_warp_strength_1', ok: true, pixelR: shiftRes.r, pixelG: shiftRes.g, pixelB: shiftRes.b });
  } else if (shiftRes.ok) {
    results.push({ name: 'nonzero_shift_warp_strength_1', ok: false, detail: `warp did not shift pixel: ref=(${refR},${refG},${refB}) got=(${shiftRes.r},${shiftRes.g},${shiftRes.b})`, pixelR: shiftRes.r, pixelG: shiftRes.g, pixelB: shiftRes.b });
  } else {
    results.push({ name: 'nonzero_shift_warp_strength_1', ok: false, detail: shiftRes.error, pixelR: shiftRes.r, pixelG: shiftRes.g, pixelB: shiftRes.b });
  }

  // Non-zero shift warp with strength 0 → same as no-warp
  const matShift0 = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
    warpMap: shiftWarp,
    warpMapSize: [1, 1],
    warpStrength: 0,
  });
  const shift0Res = renderAndReadPixel(renderer, matShift0, boxPos, camPos);
  matShift0.dispose();

  if (shift0Res.ok && Math.abs(shift0Res.r - refR) <= 5 && Math.abs(shift0Res.g - refG) <= 5 && Math.abs(shift0Res.b - refB) <= 5) {
    results.push({ name: 'nonzero_shift_warp_strength_0', ok: true, pixelR: shift0Res.r, pixelG: shift0Res.g, pixelB: shift0Res.b });
  } else {
    results.push({ name: 'nonzero_shift_warp_strength_0', ok: false, detail: shift0Res.error ?? `pixel mismatch: ref=(${refR},${refG},${refB}) got=(${shift0Res.r},${shift0Res.g},${shift0Res.b})`, pixelR: shift0Res.r, pixelG: shift0Res.g, pixelB: shift0Res.b });
  }

  // Non-zero shift warp with strength 0.5: verify the warp path stays active
  // at an intermediate strength value (pixel should match ref or full).
  const matShiftHalf = createProjectedStyleMaterial({
    texture: panoTex,
    origin,
    rotation: [0, 0, 0],
    settings,
    fallbackColor: 0x888888,
    disposable: true,
    warpMap: shiftWarp,
    warpMapSize: [1, 1],
    warpStrength: 0.5,
  });
  const shiftHalfRes = renderAndReadPixel(renderer, matShiftHalf, boxPos, camPos);
  matShiftHalf.dispose();

  if (shiftHalfRes.ok) {
    const matchesRef = Math.abs(shiftHalfRes.r - refR) <= 5 && Math.abs(shiftHalfRes.g - refG) <= 5 && Math.abs(shiftHalfRes.b - refB) <= 5;
    const matchesFull = Math.abs(shiftHalfRes.r - shiftRes.r) <= 5 && Math.abs(shiftHalfRes.g - shiftRes.g) <= 5 && Math.abs(shiftHalfRes.b - shiftRes.b) <= 5;
    results.push({ name: 'nonzero_shift_warp_strength_0.5', ok: matchesRef || matchesFull, pixelR: shiftHalfRes.r, pixelG: shiftHalfRes.g, pixelB: shiftHalfRes.b });
  } else {
    results.push({ name: 'nonzero_shift_warp_strength_0.5', ok: false, detail: shiftHalfRes.error, pixelR: shiftHalfRes.r, pixelG: shiftHalfRes.g, pixelB: shiftHalfRes.b });
  }

  panoTex.dispose();
  identityWarp.dispose();
  shiftWarp.dispose();
  return results;
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
      warpCases: [],
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

  // Warp pixel readback tests
  const warpCases = tryWarpTests(renderer);

  renderer.dispose();
  console.error = originalError;

  const shaderFail = glErrors.some((line) =>
    /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line),
  );
  const allCasesOk = lightingCases.every((c) => c.ok) && dualCases.every((c) => c.ok) && warpCases.every((c) => c.ok);
  const errors = [
    ...glErrors.filter((line) => /shader|fragment|vertex|compile|link|THREE\.WebGLProgram/i.test(line)),
    ...lightingCases.filter((c) => !c.ok).map((c) => `lighting=${c.lightingContribution}: ${c.detail}`),
    ...dualCases.filter((c) => !c.ok).map((c) => `dual mode=${c.mode}: ${c.detail}`),
    ...warpCases.filter((c) => !c.ok).map((c) => `warp ${c.name}: ${c.detail}`),
  ];

  return {
    ok: allCasesOk && !shaderFail,
    errors,
    lightingCases,
    dualCases,
    warpCases,
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
    warpCases: [],
  };
}
