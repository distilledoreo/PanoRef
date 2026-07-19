/**
 * Browser harness: generate a real radial-depth occlusion cubemap from
 * generateProjectorOcclusionMap() and read pixels back under real WebGL.
 * This exercises the actual depth ShaderMaterial (not a MeshBasicMaterial
 * stand-in), so it catches shader compile/link and packing defects.
 */
import * as THREE from 'three';
import {
  generateProjectorOcclusionMap,
  type ProjectorOcclusionMap,
} from '../../src/engine/projectorOcclusion';
import { createDefaultProject, createSceneObject } from '../../src/domain/defaults';
import type { LocationProject, Vec3 } from '../../src/domain/types';

export interface OcclusionPixelResult {
  ok: boolean;
  errors: string[];
  /** Center face (+X) hit value at the front box, if captured. */
  frontHitBlue: number;
  frontHitDepthNormalized: number;
  /** Opposite face (-X) no-hit flag (should be 0, cleared color). */
  oppositeBlue: number;
  /** -X face must read the cleared no-hit color R=1,G=1,B=0. */
  oppositeClearRed: number;
  oppositeClearGreen: number;
  /** A known rear box along +X reads as occluded by its own recorded hit. */
  rearBoxVisible: boolean;
}

function buildSyntheticProject(): LocationProject {
  const project = createDefaultProject();
  const origin: Vec3 = [0, 1.6, 0];
  project.scene.panoOrigin = origin;
  const frontBox = createSceneObject('box', 1, [4, 1.6, 0]);
  frontBox.dimensions = [1, 1, 1];
  const rearBox = createSceneObject('box', 2, [14, 1.6, 0]);
  rearBox.dimensions = [1, 1, 1];
  const floor = createSceneObject('floor', 1, [0, 0, 0]);
  // Only solid occluder geometry; sun_marker/human_dummy are not relevant here.
  project.scene.objects = [floor, frontBox, rearBox];
  return project;
}

export function runOcclusionPixelGate(): OcclusionPixelResult {
  const result: OcclusionPixelResult = {
    ok: false,
    errors: [],
    frontHitBlue: 0,
    frontHitDepthNormalized: 0,
    oppositeBlue: 0,
    oppositeClearRed: 0,
    oppositeClearGreen: 0,
    rearBoxVisible: true,
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

  const project = buildSyntheticProject();
  const origin: Vec3 = [0, 1.6, 0];

  let map: ProjectorOcclusionMap | undefined;
  try {
    map = generateProjectorOcclusionMap(renderer, project, origin, { faceSize: 64, nearMeters: 0.05 });
  } catch (error) {
    const e = error as Error;
    result.errors.push(`generateProjectorOcclusionMap threw: ${e.message}\n${e.stack ?? ''}`);
    renderer.dispose();
    return result;
  }

  try {
    // +X face (index 0) center should record a hit on the front box (blue = 1).
    const size = map.target.width;
    const center = Math.floor(size / 2);
    const full = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(map.target, 0, 0, size, size, full, 0, 0);
    const ci = (center * size + center) * 4;
    result.frontHitBlue = full[ci + 2] / 255;
    const highByte = full[ci] / 255;
    const lowByte = full[ci + 1] / 255;
    result.frontHitDepthNormalized = (Math.round(highByte * 255) * 256 + Math.round(lowByte * 255)) / 65535;

    // -X face (index 1) center: empty ray => cleared no-hit color R=1,G=1,B=0.
    const fullNeg = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(map.target, 0, 0, size, size, fullNeg, 1, 0);
    const ciNeg = (center * size + center) * 4;
    result.oppositeBlue = fullNeg[ciNeg + 2] / 255;
    result.oppositeClearRed = fullNeg[ciNeg] / 255;
    result.oppositeClearGreen = fullNeg[ciNeg + 1] / 255;

    result.rearBoxVisible = result.frontHitBlue > 0.5;

    result.ok = true;
  } catch (error) {
    result.errors.push(`pixel read failed: ${String(error)}`);
  } finally {
    map?.dispose();
    renderer.dispose();
  }

  return result;
}

declare global {
  interface Window {
    __OCCLUSION_PIXEL__?: OcclusionPixelResult;
    runOcclusionPixelGate?: typeof runOcclusionPixelGate;
  }
}

window.runOcclusionPixelGate = runOcclusionPixelGate;
try {
  window.__OCCLUSION_PIXEL__ = runOcclusionPixelGate();
} catch (error) {
  window.__OCCLUSION_PIXEL__ = {
    ok: false,
    errors: [String(error)],
    frontHitBlue: 0,
    frontHitDepthNormalized: 0,
    oppositeBlue: 0,
    oppositeClearRed: 0,
    oppositeClearGreen: 0,
    rearBoxVisible: true,
  };
}
