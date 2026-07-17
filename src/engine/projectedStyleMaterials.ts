import * as THREE from 'three';
import { Euler, ProjectedStyleSettings, Vec3 } from '../domain/types';
import { PROJECTED_STYLE_GLSL } from './projectedStyleMath';
import { degreesToRadians } from './sync';

/**
 * Shared equirect texture cache keyed by image URL.
 * One decoded texture is reused across all projected materials.
 */
const textureCache = new Map<string, {
  texture: THREE.Texture;
  refCount: number;
  loading?: Promise<THREE.Texture>;
  failed?: boolean;
}>();

export async function acquireProjectedStyleTexture(imageUrl: string): Promise<THREE.Texture | null> {
  const existing = textureCache.get(imageUrl);
  if (existing?.texture && !existing.failed) {
    existing.refCount += 1;
    return existing.texture;
  }
  if (existing?.loading) {
    try {
      const texture = await existing.loading;
      existing.refCount += 1;
      return texture;
    } catch {
      return null;
    }
  }

  const entry: {
    texture: THREE.Texture;
    refCount: number;
    loading?: Promise<THREE.Texture>;
    failed?: boolean;
  } = {
    texture: null as unknown as THREE.Texture,
    refCount: 0,
  };

  const loading = new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        entry.texture = texture;
        entry.loading = undefined;
        resolve(texture);
      },
      undefined,
      (error) => {
        entry.failed = true;
        entry.loading = undefined;
        textureCache.delete(imageUrl);
        reject(error);
      },
    );
  });

  entry.loading = loading;
  textureCache.set(imageUrl, entry);

  try {
    const texture = await loading;
    entry.refCount = 1;
    return texture;
  } catch {
    return null;
  }
}

export function releaseProjectedStyleTexture(imageUrl: string | undefined) {
  if (!imageUrl) return;
  const entry = textureCache.get(imageUrl);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && !entry.loading) {
    entry.texture?.dispose();
    textureCache.delete(imageUrl);
  }
}

/** Test helper — clear all cached textures. */
export function disposeAllProjectedStyleTextures() {
  for (const [url, entry] of textureCache) {
    entry.texture?.dispose();
    textureCache.delete(url);
  }
}

export function projectedStyleTextureCacheSize(): number {
  return textureCache.size;
}

export interface ProjectedMaterialParams {
  texture: THREE.Texture;
  origin: Vec3;
  /** Pano rotation Euler (degrees); yaw is rotation[1]. */
  rotation: Euler;
  settings: ProjectedStyleSettings;
  /** Clay / neutral fallback albedo (linear-ish hex or Color). */
  fallbackColor: THREE.ColorRepresentation;
  /** When true, materials mark themselves disposable (export path). */
  disposable?: boolean;
}

/**
 * World-space equirect projection material.
 * Matches app pano convention: yaw 0 faces +Z; u = atan(x,z)/(2π)+0.5.
 * Applies inverse pano yaw so Reference calibration aligns with geometry.
 */
export function createProjectedStyleMaterial(params: ProjectedMaterialParams): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    // Unlit-leaning: baked pano lighting dominates; lightingContribution scales real lights.
    emissive: 0x000000,
    emissiveIntensity: 0,
  });

  const origin = new THREE.Vector3(...params.origin);
  const panoYaw = degreesToRadians(params.rotation[1] ?? 0);
  const fallback = new THREE.Color(params.fallbackColor);
  const opacity = params.settings.opacity;
  const exposure = params.settings.exposure;
  const lightingContribution = params.settings.lightingContribution;
  const useNeutralFallback = params.settings.fallbackMode === 'neutral';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.projectedPanoMap = { value: params.texture };
    shader.uniforms.projectedPanoOrigin = { value: origin };
    shader.uniforms.projectedPanoYaw = { value: panoYaw };
    shader.uniforms.projectedOpacity = { value: opacity };
    shader.uniforms.projectedExposure = { value: exposure };
    shader.uniforms.projectedLighting = { value: lightingContribution };
    shader.uniforms.projectedFallbackColor = { value: fallback };
    shader.uniforms.projectedUseNeutralFallback = { value: useNeutralFallback ? 1 : 0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vProjectedWorldPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vProjectedWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D projectedPanoMap;
uniform vec3 projectedPanoOrigin;
uniform float projectedPanoYaw;
uniform float projectedOpacity;
uniform float projectedExposure;
uniform float projectedLighting;
uniform vec3 projectedFallbackColor;
uniform int projectedUseNeutralFallback;
varying vec3 vProjectedWorldPos;
const float PROJECTED_PI = 3.141592653589793;

${PROJECTED_STYLE_GLSL.applyInversePanoYaw}

${PROJECTED_STYLE_GLSL.equirectUvFromDirection}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 offset = vProjectedWorldPos - projectedPanoOrigin;
  float distSq = dot(offset, offset);
  vec3 sampleColor;
  if (distSq < 1e-8) {
    sampleColor = projectedUseNeutralFallback == 1
      ? projectedFallbackColor
      : diffuseColor.rgb;
  } else {
    vec3 direction = applyInversePanoYaw(normalize(offset), projectedPanoYaw);
    vec2 panoUv = equirectUvFromDirection(direction);
    panoUv.x = fract(panoUv.x);
    panoUv.y = clamp(panoUv.y, 0.0, 1.0);
    vec4 panoSample = texture2D(projectedPanoMap, panoUv);
    sampleColor = panoSample.rgb * projectedExposure;
  }
  // Opacity blends projected appearance over clay/neutral fallback albedo.
  vec3 fallbackAlbedo = projectedUseNeutralFallback == 1
    ? projectedFallbackColor
    : diffuseColor.rgb;
  diffuseColor.rgb = mix(fallbackAlbedo, sampleColor, clamp(projectedOpacity, 0.0, 1.0));
}
`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
// Scale specular/metal response down; panorama already has baked lighting.
material.specularIntensity *= projectedLighting;
material.roughness = mix(1.0, material.roughness, projectedLighting);
`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `
// At lightingContribution 0, skip scene lights and show baked pano as-is.
if (projectedLighting <= 0.001) {
  // no direct/indirect lights — leave reflectedLight at zero then add albedo as emissive-like
} else {
#include <lights_fragment_begin>
}
`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
if (projectedLighting <= 0.001) {
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.directSpecular = vec3(0.0);
  reflectedLight.indirectDiffuse = diffuseColor.rgb;
  reflectedLight.indirectSpecular = vec3(0.0);
} else {
  // Mild light contribution: keep most of the pano, fold in a fraction of lit result later via outgoing.
  reflectedLight.directDiffuse *= projectedLighting;
  reflectedLight.directSpecular *= projectedLighting;
  reflectedLight.indirectDiffuse = mix(diffuseColor.rgb, reflectedLight.indirectDiffuse, projectedLighting);
  reflectedLight.indirectSpecular *= projectedLighting;
}
`,
      );
  };

  material.customProgramCacheKey = () => (
    `projected-style-v1:${params.settings.fallbackMode}:${params.disposable ? 'd' : 's'}`
  );

  // Mark for disposal on export-only clones.
  (material as THREE.MeshStandardMaterial & { userData: Record<string, unknown> }).userData.projectedStyle = true;
  (material as THREE.MeshStandardMaterial & { userData: Record<string, unknown> }).userData.disposableProjected = Boolean(params.disposable);

  return material;
}

export function isProjectedStyleMaterial(material: THREE.Material): boolean {
  return Boolean((material as THREE.Material & { userData?: { projectedStyle?: boolean } }).userData?.projectedStyle);
}

/** Dispose materials created for one-shot export (not shared clay materials). */
export function disposeProjectedStyleMaterial(material: THREE.Material) {
  if (!isProjectedStyleMaterial(material)) return;
  const disposable = (material as THREE.Material & { userData?: { disposableProjected?: boolean } }).userData?.disposableProjected;
  if (disposable) material.dispose();
}
