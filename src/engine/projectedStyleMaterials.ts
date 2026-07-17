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

/**
 * Viewport ownership for a single projector slot (primary or secondary).
 * Separates "currently requested URL" from "accepted/owned texture URL" so rapid
 * A→B→C switches always release the accepted texture immediately, never wait for
 * a stale completion callback that captured a previousUrl.
 */
export interface ProjectedTextureOwnership {
  requestedUrl?: string;
  ownedUrl?: string;
}

/**
 * Begin a load for `nextUrl`. Releases the currently owned texture immediately when
 * the desired URL changes (including to undefined). Does not release in-flight
 * acquires — those release themselves when they finish stale.
 */
export function prepareProjectedTextureRequest(
  ownership: ProjectedTextureOwnership,
  nextUrl: string | undefined,
  release: (url: string | undefined) => void = releaseProjectedStyleTexture,
): { clearedOwned: boolean } {
  let clearedOwned = false;
  const owned = ownership.ownedUrl;
  if (owned && owned !== nextUrl) {
    release(owned);
    ownership.ownedUrl = undefined;
    clearedOwned = true;
  }
  ownership.requestedUrl = nextUrl;
  return { clearedOwned };
}

/**
 * Complete an acquire. Accept only when still current; otherwise release this
 * acquisition. Never releases a captured previous URL (that is prepare's job).
 */
export function resolveProjectedTextureRequest(
  ownership: ProjectedTextureOwnership,
  url: string,
  texture: THREE.Texture | null,
  cancelled: boolean,
  release: (url: string | undefined) => void = releaseProjectedStyleTexture,
): 'accept' | 'discard' {
  if (cancelled || ownership.requestedUrl !== url || !texture) {
    if (texture) release(url);
    return 'discard';
  }
  ownership.ownedUrl = url;
  return 'accept';
}

/** Unmount / hard reset: release owned texture and clear both slots. */
export function disposeProjectedTextureOwnership(
  ownership: ProjectedTextureOwnership,
  release: (url: string | undefined) => void = releaseProjectedStyleTexture,
) {
  release(ownership.ownedUrl);
  ownership.ownedUrl = undefined;
  ownership.requestedUrl = undefined;
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

/** Test helper — current refCount for a URL (0 if absent). */
export function projectedStyleTextureRefCount(imageUrl: string): number {
  return textureCache.get(imageUrl)?.refCount ?? 0;
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
  /** Optional secondary projector for multi-origin blend. */
  secondaryTexture?: THREE.Texture;
  secondaryOrigin?: Vec3;
  secondaryRotation?: Euler;
}

/**
 * World-space equirect projection material.
 * Dual-projector blend uses distance-based weights (not true occlusion).
 */
export function createProjectedStyleMaterial(params: ProjectedMaterialParams): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });

  const origin = new THREE.Vector3(...params.origin);
  const panoYaw = degreesToRadians(params.rotation[1] ?? 0);
  const hasSecondary = Boolean(params.secondaryTexture && params.secondaryOrigin);
  const secondaryOrigin = new THREE.Vector3(...(params.secondaryOrigin ?? params.origin));
  const secondaryYaw = degreesToRadians(params.secondaryRotation?.[1] ?? 0);
  const fallback = new THREE.Color(params.fallbackColor);
  const opacity = params.settings.opacity;
  const exposure = params.settings.exposure;
  const lightingContribution = params.settings.lightingContribution;
  const useNeutralFallback = params.settings.fallbackMode === 'neutral';
  const blendMode = params.settings.blendMode ?? 'primary_only';
  const blendModeId = blendMode === 'secondary_only'
    ? 1
    : blendMode === 'primary_dominant'
      ? 2
      : blendMode === 'secondary_dominant'
        ? 3
        : 0;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.projectedPanoMap = { value: params.texture };
    shader.uniforms.projectedPanoOrigin = { value: origin };
    shader.uniforms.projectedPanoYaw = { value: panoYaw };
    shader.uniforms.projectedPanoMapB = { value: params.secondaryTexture ?? params.texture };
    shader.uniforms.projectedPanoOriginB = { value: secondaryOrigin };
    shader.uniforms.projectedPanoYawB = { value: secondaryYaw };
    shader.uniforms.projectedHasSecondary = { value: hasSecondary ? 1 : 0 };
    shader.uniforms.projectedBlendMode = { value: blendModeId };
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
uniform sampler2D projectedPanoMapB;
uniform vec3 projectedPanoOriginB;
uniform float projectedPanoYawB;
uniform int projectedHasSecondary;
uniform int projectedBlendMode;
uniform float projectedOpacity;
uniform float projectedExposure;
uniform float projectedLighting;
uniform vec3 projectedFallbackColor;
uniform int projectedUseNeutralFallback;
varying vec3 vProjectedWorldPos;
const float PROJECTED_PI = 3.141592653589793;
const float PROJECTED_FALLOFF = 6.0;

${PROJECTED_STYLE_GLSL.applyInversePanoYaw}

${PROJECTED_STYLE_GLSL.equirectUvFromDirection}

float projectedConfidence(vec3 worldPos, vec3 origin) {
  float dist = length(worldPos - origin);
  return PROJECTED_FALLOFF / (PROJECTED_FALLOFF + dist);
}

vec3 sampleProjectedPano(sampler2D map, vec3 origin, float yaw, vec3 worldPos) {
  vec3 offset = worldPos - origin;
  float distSq = dot(offset, offset);
  if (distSq < 1e-8) {
    return projectedUseNeutralFallback == 1 ? projectedFallbackColor : vec3(-1.0);
  }
  vec3 direction = applyInversePanoYaw(normalize(offset), yaw);
  vec2 panoUv = equirectUvFromDirection(direction);
  panoUv.x = fract(panoUv.x);
  panoUv.y = clamp(panoUv.y, 0.0, 1.0);
  return texture2D(map, panoUv).rgb * projectedExposure;
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 sampleA = sampleProjectedPano(projectedPanoMap, projectedPanoOrigin, projectedPanoYaw, vProjectedWorldPos);
  vec3 sampleColor = sampleA;
  if (sampleA.x < 0.0) {
    sampleColor = projectedUseNeutralFallback == 1 ? projectedFallbackColor : diffuseColor.rgb;
  } else if (projectedHasSecondary == 1 && projectedBlendMode != 0) {
    vec3 sampleB = sampleProjectedPano(projectedPanoMapB, projectedPanoOriginB, projectedPanoYawB, vProjectedWorldPos);
    if (sampleB.x >= 0.0) {
      float confA = projectedConfidence(vProjectedWorldPos, projectedPanoOrigin);
      float confB = projectedConfidence(vProjectedWorldPos, projectedPanoOriginB);
      float wA = 1.0;
      if (projectedBlendMode == 1) {
        wA = 0.0;
      } else if (projectedBlendMode == 2) {
        float total = confA + confB;
        wA = total <= 1e-8 ? 1.0 : (confA >= confB ? min(1.0, 0.55 + confA * 0.55) : confA / total);
      } else if (projectedBlendMode == 3) {
        float total = confA + confB;
        wA = total <= 1e-8 ? 0.0 : (confB >= confA ? max(0.0, 0.45 - confB * 0.45) : confA / total);
      }
      sampleColor = mix(sampleB, sampleA, clamp(wA, 0.0, 1.0));
    }
  }
  vec3 fallbackAlbedo = projectedUseNeutralFallback == 1
    ? projectedFallbackColor
    : diffuseColor.rgb;
  diffuseColor.rgb = mix(fallbackAlbedo, sampleColor, clamp(projectedOpacity, 0.0, 1.0));
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
  reflectedLight.directDiffuse *= projectedLighting;
  reflectedLight.directSpecular *= projectedLighting;
  reflectedLight.indirectDiffuse = mix(diffuseColor.rgb, reflectedLight.indirectDiffuse, projectedLighting);
  reflectedLight.indirectSpecular *= projectedLighting;
}
`,
      );
  };

  material.customProgramCacheKey = () => (
    `projected-style-v4:${params.settings.fallbackMode}:${hasSecondary ? 'dual' : 'single'}:${params.disposable ? 'd' : 's'}`
  );

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
