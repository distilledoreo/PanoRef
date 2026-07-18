/**
 * Browser harness: compile projected-style materials under real WebGL.
 * Tests single and dual projector modes with pixel readback verification.
 * Bundled to IIFE by the compile test and executed in Chromium.
 */
import * as THREE from 'three';
import { createProjectedStyleMaterial } from '../../src/engine/projectedStyleMaterials';
import { defaultProjectedStyleSettings } from '../../src/domain/defaults';
import type { ProjectedStyleSettings } from '../../src/domain/types';
import { worldPositionToProjectedPanoUv } from '../../src/engine/projectedStyleMath';

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

function makeWeightDataTexture(weight: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([Math.round(weight * 255)]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

type WarpDelta = [number, number];

function encodeWarpDelta(data: Uint8Array, index: number, [du, dv]: WarpDelta): void {
  const encodedU = Math.round(((du + 0.5) / 1) * 65535);
  const encodedV = Math.round(((dv + 1.0) / 2) * 65535);
  data[index * 4] = encodedU >> 8;
  data[index * 4 + 1] = encodedU & 0xff;
  data[index * 4 + 2] = encodedV >> 8;
  data[index * 4 + 3] = encodedV & 0xff;
}

function makeWarpDataTextureFromValues(width: number, height: number, values: WarpDelta[]): THREE.DataTexture {
  if (values.length !== width * height) throw new Error('Warp value count must match texture dimensions.');
  const data = new Uint8Array(values.length * 4);
  values.forEach((value, index) => encodeWarpDelta(data, index, value));
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function readbackWorldPoint(
  renderer: THREE.WebGLRenderer,
  boxPosition: [number, number, number],
  cameraPosition: [number, number, number],
): [number, number, number] | undefined {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(...boxPosition);
  mesh.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(...cameraPosition);
  camera.lookAt(...boxPosition);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const pixelX = Math.floor(renderer.domElement.width / 2);
  const pixelY = Math.floor(renderer.domElement.height / 2);
  const ndc = new THREE.Vector2(
    ((pixelX + 0.5) / renderer.domElement.width) * 2 - 1,
    ((pixelY + 0.5) / renderer.domElement.height) * 2 - 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(mesh)[0];
  mesh.geometry.dispose();
  return hit?.point ? [hit.point.x, hit.point.y, hit.point.z] : undefined;
}

function bilinearWarpDelta(
  values: WarpDelta[],
  width: number,
  height: number,
  uv: { u: number; v: number },
): WarpDelta {
  const texelX = uv.u * width;
  const texelY = uv.v * height;
  const fracX = texelX - Math.floor(texelX);
  const fracY = texelY - Math.floor(texelY);
  const x0 = Math.floor(texelX);
  const y0 = Math.floor(texelY);
  const x1 = (x0 + 1) % width;
  const y1 = Math.min(y0 + 1, height - 1);
  const at = (x: number, y: number): WarpDelta => values[y * width + x];
  const top = [
    at(x0, y0)[0] + (at(x1, y0)[0] - at(x0, y0)[0]) * fracX,
    at(x0, y0)[1] + (at(x1, y0)[1] - at(x0, y0)[1]) * fracX,
  ];
  const bottom = [
    at(x0, y1)[0] + (at(x1, y1)[0] - at(x0, y1)[0]) * fracX,
    at(x0, y1)[1] + (at(x1, y1)[1] - at(x0, y1)[1]) * fracX,
  ];
  return [
    top[0] + (bottom[0] - top[0]) * fracY,
    top[1] + (bottom[1] - top[1]) * fracY,
  ];
}

/*
 * Keep this fixture intentionally nonuniform. The production shader samples
 * four neighboring texels, so a constant map cannot prove interpolation.
 */
function nonuniformWarpValues(width: number, height: number): WarpDelta[] {
  const values: WarpDelta[] = Array.from({ length: width * height }, () => [0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = [
        x === 2 && y === 2 ? -0.3 :
          x === 3 && y === 2 ? 0.4 :
            x === 2 && y === 3 ? 0.2 :
              x === 3 && y === 3 ? -0.45 : 0,
        y === 2 ? -0.4 : y === 3 ? 0.6 : 0,
      ];
    }
  }
  return values;
}

function makeVerticalGradientTexture(height: number): THREE.DataTexture {
  const data = new Uint8Array(1 * height * 4);
  for (let y = 0; y < height; y++) {
    const v = Math.round((y / (height - 1)) * 255);
    data[y * 4] = 255 - v;
    data[y * 4 + 1] = 0;
    data[y * 4 + 2] = v;
    data[y * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, height);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function tryWarpTests(
  renderer: THREE.WebGLRenderer,
): Array<{ name: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }> {
  const THRESHOLD = 5;

  // Wide horizontal gradient pano (256 wide, blue→red) for U-shift tests.
  const hGradSize = 256;
  const hGradData = new Uint8Array(hGradSize * 1 * 4);
  for (let x = 0; x < hGradSize; x++) {
    const v = Math.round((x / (hGradSize - 1)) * 255);
    hGradData[x * 4] = v;
    hGradData[x * 4 + 1] = 0;
    hGradData[x * 4 + 2] = 255 - v;
    hGradData[x * 4 + 3] = 255;
  }
  const hGradTex = new THREE.DataTexture(hGradData, hGradSize, 1);
  hGradTex.colorSpace = THREE.SRGBColorSpace;
  hGradTex.wrapS = THREE.RepeatWrapping;
  hGradTex.wrapT = THREE.ClampToEdgeWrapping;
  hGradTex.minFilter = THREE.LinearFilter;
  hGradTex.magFilter = THREE.LinearFilter;
  hGradTex.needsUpdate = true;

  // Tall vertical gradient pano (256 tall, top=blue, bottom=red) for V-shift tests.
  const vGradTex = makeVerticalGradientTexture(256);

  const origin: [number, number, number] = [0, 1.6, 0];
  const settings: ProjectedStyleSettings = {
    ...defaultProjectedStyleSettings,
    lightingContribution: 0,
    blendMode: 'primary_only',
  };
  const boxPos: [number, number, number] = [0.5, 1.6, 0.5];
  const camPos: [number, number, number] = [-2, 2.6, 5];

  function renderWith(mat: THREE.MeshStandardMaterial): { r: number; g: number; b: number; ok: boolean; error?: string } {
    return renderAndReadPixel(renderer, mat, boxPos, camPos);
  }

  const results: Array<{ name: string; ok: boolean; detail?: string; pixelR?: number; pixelG?: number; pixelB?: number }> = [];

  function push(name: string, res: { r: number; g: number; b: number; ok: boolean; error?: string }) {
    results.push({ name, ok: res.ok, detail: res.error, pixelR: res.r, pixelG: res.g, pixelB: res.b });
  }
  function closeTo(a: number, b: number): boolean { return Math.abs(a - b) <= THRESHOLD; }
  function closeChan(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): boolean {
    return closeTo(a.r, b.r) && closeTo(a.g, b.g) && closeTo(a.b, b.b);
  }
  function diffFrom(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): boolean {
    return !closeTo(a.r, b.r) || !closeTo(a.g, b.g) || !closeTo(a.b, b.b);
  }
  function between(v: number, lo: number, hi: number): boolean {
    return v >= Math.min(lo, hi) - THRESHOLD && v <= Math.max(lo, hi) + THRESHOLD;
  }

  // ── Reference (no warp) on horizontal gradient ──
  const refMat = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
  });
  const refRes = renderWith(refMat);
  refMat.dispose();
  if (!refRes.ok) { hGradTex.dispose(); vGradTex.dispose(); return [{ name: 'warp_reference', ok: false, detail: refRes.error }]; }
  const ref = { r: refRes.r, g: refRes.g, b: refRes.b };

  // ── Identity (du=0, dv=0) strength 1 => same as ref ──
  const idWarp = makeWarpDataTexture(1, 1, 0, 0);
  let m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: idWarp, warpMapSize: [1, 1], warpStrength: 1,
  });
  let r = renderWith(m); m.dispose();
  if (r.ok && closeChan(r, ref)) push('identity_warp_strength_1', r);
  else push('identity_warp_strength_1', { ...r, ok: false, error: r.error ?? `pixel mismatch: ref=(${ref.r},${ref.g},${ref.b}) got=(${r.r},${r.g},${r.b})` });

  // ── Identity warp strength 0 => same as ref ──
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: idWarp, warpMapSize: [1, 1], warpStrength: 0,
  });
  r = renderWith(m); m.dispose();
  if (r.ok && closeChan(r, ref)) push('identity_warp_strength_0', r);
  else push('identity_warp_strength_0', { ...r, ok: false, error: r.error ?? `pixel mismatch: ref=(${ref.r},${ref.g},${ref.b}) got=(${r.r},${r.g},${r.b})` });

  // ── Positive U (du=0.25) with strength 1 => shift right toward red ──
  const puWarp = makeWarpDataTexture(1, 1, 0.25, 0);
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: puWarp, warpMapSize: [1, 1], warpStrength: 1,
  });
  r = renderWith(m); m.dispose();
  if (r.ok && r.r > ref.r + THRESHOLD && r.b < ref.b - THRESHOLD) push('positive_u_shift', r);
  else if (r.ok) push('positive_u_shift', { ...r, ok: false, error: `positive U shift should increase R / decrease B: ref=(${ref.r},${ref.g},${ref.b}) got=(${r.r},${r.g},${r.b})` });
  else push('positive_u_shift', r);

  // ── Negative U (du=-0.25) with strength 1 => shift left toward blue ──
  const nuWarp = makeWarpDataTexture(1, 1, -0.25, 0);
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: nuWarp, warpMapSize: [1, 1], warpStrength: 1,
  });
  r = renderWith(m); m.dispose();
  if (r.ok && r.r < ref.r - THRESHOLD && r.b > ref.b + THRESHOLD) push('negative_u_shift', r);
  else if (r.ok) push('negative_u_shift', { ...r, ok: false, error: `negative U shift should decrease R / increase B: ref=(${ref.r},${ref.g},${ref.b}) got=(${r.r},${r.g},${r.b})` });
  else push('negative_u_shift', r);

  // ── Positive U shift with strength 0 => same as ref ──
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: puWarp, warpMapSize: [1, 1], warpStrength: 0,
  });
  r = renderWith(m); m.dispose();
  if (r.ok && closeChan(r, ref)) push('positive_u_shift_strength_0', r);
  else push('positive_u_shift_strength_0', { ...r, ok: false, error: r.error ?? `pixel mismatch: ref=(${ref.r},${ref.g},${ref.b}) got=(${r.r},${r.g},${r.b})` });

  // ── Positive U shift with strength 0.5 => between ref and full ──
  // Re-render full shift for comparison
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: puWarp, warpMapSize: [1, 1], warpStrength: 1,
  });
  const fullRes = renderWith(m); m.dispose();
  m = createProjectedStyleMaterial({
    texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    warpMap: puWarp, warpMapSize: [1, 1], warpStrength: 0.5,
  });
  r = renderWith(m); m.dispose();
  if (r.ok && fullRes.ok) {
    const rOk = between(r.r, ref.r, fullRes.r) && between(r.g, ref.g, fullRes.g) && between(r.b, ref.b, fullRes.b);
    const notExtreme = diffFrom(r, ref) && diffFrom(r, fullRes);
    push('positive_u_shift_strength_0.5', { ...r, ok: rOk && notExtreme,
      error: !rOk ? `not between ref(${ref.r},${ref.g},${ref.b}) and full(${fullRes.r},${fullRes.g},${fullRes.b}): got(${r.r},${r.g},${r.b})` : !notExtreme ? 'matches an extreme' : undefined });
  } else {
    push('positive_u_shift_strength_0.5', { ...r, ok: false, error: r.error ?? fullRes.error ?? 'full shift render failed' });
  }

  // ── V shift tests use the vertical gradient ──
  // Reference on vertical gradient
  const vRefMat = createProjectedStyleMaterial({
    texture: vGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
  });
  const vRefRes = renderWith(vRefMat);
  vRefMat.dispose();
  if (!vRefRes.ok) {
    results.push({ name: 'positive_v_shift', ok: false, detail: vRefRes.error, pixelR: 0, pixelG: 0, pixelB: 0 });
    results.push({ name: 'negative_v_shift', ok: false, detail: vRefRes.error, pixelR: 0, pixelG: 0, pixelB: 0 });
    results.push({ name: 'vertical_clamping', ok: false, detail: vRefRes.error, pixelR: 0, pixelG: 0, pixelB: 0 });
  } else {
    const vRef = { r: vRefRes.r, g: vRefRes.g, b: vRefRes.b };

    // Positive V shift (dv=0.25) => moves toward bottom (blue)
    // Vertical gradient: top(v=0)=red, bottom(v=1)=blue, so positive V increases B.
    const pvWarp = makeWarpDataTexture(1, 1, 0, 0.25);
    m = createProjectedStyleMaterial({
      texture: vGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
      warpMap: pvWarp, warpMapSize: [1, 1], warpStrength: 1,
    });
    r = renderWith(m); m.dispose();
    if (r.ok && r.b > vRef.b + THRESHOLD && r.r < vRef.r - THRESHOLD) push('positive_v_shift', r);
    else if (r.ok) push('positive_v_shift', { ...r, ok: false, error: `positive V shift should increase B / decrease R: ref=(${vRef.r},${vRef.g},${vRef.b}) got=(${r.r},${r.g},${r.b})` });
    else push('positive_v_shift', r);

    // Negative V shift (dv=-0.25) => moves toward top (red)
    const nvWarp = makeWarpDataTexture(1, 1, 0, -0.25);
    m = createProjectedStyleMaterial({
      texture: vGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
      warpMap: nvWarp, warpMapSize: [1, 1], warpStrength: 1,
    });
    r = renderWith(m); m.dispose();
    if (r.ok && r.r > vRef.r + THRESHOLD && r.b < vRef.b - THRESHOLD) push('negative_v_shift', r);
    else if (r.ok) push('negative_v_shift', { ...r, ok: false, error: `negative V shift should increase R / decrease B: ref=(${vRef.r},${vRef.g},${vRef.b}) got=(${r.r},${r.g},${r.b})` });
    else push('negative_v_shift', r);

    // Vertical clamping: dv=1.0 => clamped to bottom (blue, B≈255 R≈0)
    const cvWarp = makeWarpDataTexture(1, 1, 0, 1.0);
    m = createProjectedStyleMaterial({
      texture: vGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
      warpMap: cvWarp, warpMapSize: [1, 1], warpStrength: 1,
    });
    r = renderWith(m); m.dispose();
    if (r.ok && r.b > 245 && r.r < 10) push('vertical_clamping', r);
    else if (r.ok) push('vertical_clamping', { ...r, ok: false, error: `dv=1.0 should clamp to bottom (B≈255,R≈0): got=(${r.r},${r.g},${r.b})` });
    else push('vertical_clamping', r);

    pvWarp.dispose(); nvWarp.dispose(); cvWarp.dispose();
  }

  // ── Horizontal seam wrapping ──
  // Split pano: left half blue, right half red; Nearest filtering to keep boundary sharp.
  const splitW = 64;
  const splitData = new Uint8Array(splitW * 1 * 4);
  for (let x = 0; x < splitW; x++) {
    splitData[x * 4] = x < splitW / 2 ? 0 : 255;
    splitData[x * 4 + 1] = 0;
    splitData[x * 4 + 2] = x < splitW / 2 ? 255 : 0;
    splitData[x * 4 + 3] = 255;
  }
  const splitTex = new THREE.DataTexture(splitData, splitW, 1);
  splitTex.colorSpace = THREE.SRGBColorSpace;
  splitTex.wrapS = THREE.RepeatWrapping;
  splitTex.wrapT = THREE.ClampToEdgeWrapping;
  splitTex.minFilter = THREE.NearestFilter;
  splitTex.magFilter = THREE.NearestFilter;
  splitTex.needsUpdate = true;

  // Box at (+Z) samples near u=0.5 (blue/red boundary in split texture).
  const sp = { box: [0, 1.6, 1] as [number, number, number], cam: [-2, 2.6, 5] as [number, number, number] };
  const spRefMat = createProjectedStyleMaterial({
    texture: splitTex, origin, rotation: [0, 0, 0], settings: { ...settings, blendMode: 'primary_only' }, fallbackColor: 0x888888, disposable: true,
  });
  const spRef = renderAndReadPixel(renderer, spRefMat, sp.box, sp.cam);
  spRefMat.dispose();

  if (spRef.ok) {
    const sr = { r: spRef.r, g: spRef.g, b: spRef.b };
    // Shift du=0.5 wraps u=0.5→u=0.0 crossing the seam (blue/red boundary).
    const seamWarp = makeWarpDataTexture(1, 1, 0.5, 0);
    m = createProjectedStyleMaterial({
      texture: splitTex, origin, rotation: [0, 0, 0], settings: { ...settings, blendMode: 'primary_only' }, fallbackColor: 0x888888, disposable: true,
      warpMap: seamWarp, warpMapSize: [1, 1], warpStrength: 1,
    });
    r = renderAndReadPixel(renderer, m, sp.box, sp.cam);
    m.dispose(); seamWarp.dispose();
    // The reference at this fragment samples left-of-center (u~0.47 → blue).
    // du=0.5 shifts and wraps to u~0.97 → red (right half).
    if (r.ok && r.r > 200 && r.b < 55) push('horizontal_seam_wrap', r);
    else if (r.ok) push('horizontal_seam_wrap', { ...r, ok: false, error: `seam wrap (du=0.5) should land on red half (R≈255,B≈0): ref=(${sr.r},${sr.g},${sr.b}) got=(${r.r},${r.g},${r.b})` });
    else push('horizontal_seam_wrap', r);
  } else {
    results.push({ name: 'horizontal_seam_wrap', ok: false, detail: spRef.error, pixelR: 0, pixelG: 0, pixelB: 0 });
  }
  splitTex.dispose();

  // ── Primary warp independence ──
  // Primary: horizontal gradient. Secondary: solid green. Blend: primary_dominant.
  // Warping primary should change the output.
  const priGrad = hGradTex;
  const secSolid = makeSolidDataTexture(0, 255, 0);
  const so: [number, number, number] = [10, 1.6, 0];
  const dualS: ProjectedStyleSettings = { ...defaultProjectedStyleSettings, lightingContribution: 0, blendMode: 'primary_dominant' };

  const piIdWarp = makeWarpDataTexture(1, 1, 0, 0);
  const piShiftWarp = makeWarpDataTexture(1, 1, 0.25, 0);

  // No-warp reference
  const piRefMat = createProjectedStyleMaterial({
    texture: priGrad, origin, rotation: [0, 0, 0], settings: dualS, fallbackColor: 0x888888, disposable: true,
    secondaryTexture: secSolid, secondaryOrigin: so, secondaryRotation: [0, 0, 0],
    warpMap: piIdWarp, warpMapSize: [1, 1], warpStrength: 1,
    warpMapB: piIdWarp, warpMapSizeB: [1, 1], warpStrengthB: 1,
  });
  const piRef = renderWith(piRefMat);
  piRefMat.dispose();

  if (piRef.ok) {
    const piResMat = createProjectedStyleMaterial({
      texture: priGrad, origin, rotation: [0, 0, 0], settings: dualS, fallbackColor: 0x888888, disposable: true,
      secondaryTexture: secSolid, secondaryOrigin: so, secondaryRotation: [0, 0, 0],
      warpMap: piShiftWarp, warpMapSize: [1, 1], warpStrength: 1,
      warpMapB: piIdWarp, warpMapSizeB: [1, 1], warpStrengthB: 1,
    });
    r = renderWith(piResMat);
    piResMat.dispose();
    // Primary warp (du=0.25) shifts toward red on the horizontal gradient.
    if (r.ok && r.r > piRef.r + THRESHOLD && r.b < piRef.b - THRESHOLD) push('primary_warp_independent', r);
    else if (r.ok) push('primary_warp_independent', { ...r, ok: false, error: `primary warp should increase R / decrease B in dual: ref=(${piRef.r},${piRef.g},${piRef.b}) got=(${r.r},${r.g},${r.b})` });
    else push('primary_warp_independent', r);
  } else {
    results.push({ name: 'primary_warp_independent', ok: false, detail: piRef.error, pixelR: 0, pixelG: 0, pixelB: 0 });
  }
  secSolid.dispose(); piIdWarp.dispose(); piShiftWarp.dispose();

  // ── Secondary warp independence ──
  // Primary: solid gray. Secondary: horizontal gradient. Blend: secondary_only.
  // Warping secondary should change the output.
  const priSolid = makeSolidDataTexture(128, 128, 128);
  const secGrad = hGradTex;
  const soS: ProjectedStyleSettings = { ...defaultProjectedStyleSettings, lightingContribution: 0, blendMode: 'secondary_only' };

  const siIdWarp = makeWarpDataTexture(1, 1, 0, 0);
  const siShiftWarp = makeWarpDataTexture(1, 1, 0.25, 0);

  // No-warp reference
  const siRefMat = createProjectedStyleMaterial({
    texture: priSolid, origin, rotation: [0, 0, 0], settings: soS, fallbackColor: 0x888888, disposable: true,
    secondaryTexture: secGrad, secondaryOrigin: origin, secondaryRotation: [0, 0, 0],
    warpMap: siIdWarp, warpMapSize: [1, 1], warpStrength: 1,
    warpMapB: siIdWarp, warpMapSizeB: [1, 1], warpStrengthB: 1,
  });
  const siRef = renderWith(siRefMat);
  siRefMat.dispose();

  if (siRef.ok) {
    const siResMat = createProjectedStyleMaterial({
      texture: priSolid, origin, rotation: [0, 0, 0], settings: soS, fallbackColor: 0x888888, disposable: true,
      secondaryTexture: secGrad, secondaryOrigin: origin, secondaryRotation: [0, 0, 0],
      warpMap: siIdWarp, warpMapSize: [1, 1], warpStrength: 1,
      warpMapB: siShiftWarp, warpMapSizeB: [1, 1], warpStrengthB: 1,
    });
    r = renderWith(siResMat);
    siResMat.dispose();
    if (r.ok && r.r > siRef.r + THRESHOLD && r.b < siRef.b - THRESHOLD) push('secondary_warp_independent', r);
    else if (r.ok) push('secondary_warp_independent', { ...r, ok: false, error: `secondary warp should increase R / decrease B: ref=(${siRef.r},${siRef.g},${siRef.b}) got=(${r.r},${r.g},${r.b})` });
    else push('secondary_warp_independent', r);
  } else {
    results.push({ name: 'secondary_warp_independent', ok: false, detail: siRef.error, pixelR: 0, pixelG: 0, pixelB: 0 });
  }
  priSolid.dispose(); siIdWarp.dispose(); siShiftWarp.dispose();

  // ── Nonuniform multi-texel bilinear sampling ──
  // Four neighboring texels intentionally carry different displacements. The
  // center readback UV is used to calculate the expected bilinear value, then
  // compared with a 1×1 warp carrying that interpolated value. A constant map
  // would not distinguish bilinear interpolation from nearest sampling.
  {
    const bw = 4, bh = 4;
    const values = nonuniformWarpValues(bw, bh);
    const multiWarpTex = makeWarpDataTextureFromValues(bw, bh, values);
    const readbackPoint = readbackWorldPoint(renderer, boxPos, camPos);
    const sampleUv = readbackPoint
      ? worldPositionToProjectedPanoUv({
          worldPosition: readbackPoint,
          panoOrigin: origin,
          panoYawRadians: 0,
        })
      : undefined;
    const expectedDelta = sampleUv ? bilinearWarpDelta(values, bw, bh, sampleUv) : undefined;

    const multiMat = createProjectedStyleMaterial({
      texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
      warpMap: multiWarpTex, warpMapSize: [bw, bh], warpStrength: 1,
    });
    r = renderWith(multiMat);
    multiMat.dispose();

    const refWarp = expectedDelta
      ? makeWarpDataTexture(1, 1, expectedDelta[0], expectedDelta[1])
      : undefined;
    const refMat = createProjectedStyleMaterial({
      texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
      warpMap: refWarp ?? idWarp, warpMapSize: [1, 1], warpStrength: 1,
    });
    const refRes = renderWith(refMat);
    refMat.dispose();
    refWarp?.dispose();
    multiWarpTex.dispose();

    if (r.ok && refRes.ok && expectedDelta && sampleUv) {
      if (closeChan(r, refRes)) push('nonuniform_multi_texel_bilinear', r);
      else push('nonuniform_multi_texel_bilinear', { ...r, ok: false, error: `nonuniform multi-texel warp ≠ bilinear reference at uv=(${sampleUv.u.toFixed(4)},${sampleUv.v.toFixed(4)}), delta=(${expectedDelta[0].toFixed(4)},${expectedDelta[1].toFixed(4)}): ref=(${refRes.r},${refRes.g},${refRes.b}) got=(${r.r},${r.g},${r.b})` });
    } else {
      push('nonuniform_multi_texel_bilinear', { ...r, ok: false, error: r.error ?? refRes.error ?? 'unable to resolve center sample UV' });
    }
  }

  // ── Cleanup ──
  hGradTex.dispose(); vGradTex.dispose();
  // Region Fit samples original and fitted colors with an independent weight.
  const regionWeight = makeWeightDataTexture(1);
  m = createProjectedStyleMaterial({ texture: hGradTex, origin, rotation: [0, 0, 0], settings, fallbackColor: 0x888888, disposable: true,
    regionWarpMap: puWarp, regionWeightMap: regionWeight, regionWarpMapSize: [1, 1], regionStrength: 1,
    warpMap: nuWarp, warpMapSize: [1, 1], warpStrength: 1 });
  r = renderWith(m); m.dispose();
  if (r.ok && r.r > ref.r + THRESHOLD && r.b < ref.b - THRESHOLD) push('region_fit_precedence_and_weight', r);
  else push('region_fit_precedence_and_weight', { ...r, ok: false, error: r.error ?? 'Region Fit did not override legacy correction.' });
  regionWeight.dispose(); idWarp.dispose(); puWarp.dispose(); nuWarp.dispose();

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
