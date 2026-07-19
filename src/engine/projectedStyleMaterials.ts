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
  panoramaWidth?: number;
  panoramaHeight?: number;
  settings: ProjectedStyleSettings;
  /** Clay / neutral fallback albedo (linear-ish hex or Color). */
  fallbackColor: THREE.ColorRepresentation;
  /** When true, materials mark themselves disposable (export path). */
  disposable?: boolean;

  occlusionTexture?: THREE.CubeTexture;
  occlusionNearMeters?: number;
  occlusionFarMeters?: number;
  occlusionFaceSize?: number;

  secondaryTexture?: THREE.Texture;
  secondaryOrigin?: Vec3;
  secondaryRotation?: Euler;
  secondaryPanoramaWidth?: number;
  secondaryPanoramaHeight?: number;

  secondaryOcclusionTexture?: THREE.CubeTexture;
  secondaryOcclusionNearMeters?: number;
  secondaryOcclusionFarMeters?: number;
  secondaryOcclusionFaceSize?: number;
}

/**
 * World-space equirect projection material with optional geometry occlusion.
 * A panorama behaves like a real 360° projector: the first surface along a ray
 * receives the panorama, hidden surfaces fall back or may be filled by another
 * projector.
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
  const useOcclusion = params.settings.occlusionEnabled !== false
    && Boolean(params.occlusionTexture);
  const useSecondary = hasSecondary;
  const useSecondaryOcclusion = useSecondary && useOcclusion && Boolean(params.secondaryOcclusionTexture);
  const occlusionBias = params.settings.occlusionBiasMeters ?? 0.04;
  const occlusionSoftness = params.settings.occlusionSoftness ?? 1;
  const debugCoverage = params.settings.occlusionDebugMode === 'coverage';
  const blendMode = params.settings.blendMode ?? 'primary_only';
  const blendModeId = blendMode === 'secondary_only'
    ? 1
    : blendMode === 'primary_dominant'
      ? 2
      : blendMode === 'secondary_dominant'
        ? 3
        : 0;
  const texelConstant = (width: number, height: number) => width * height / (2 * Math.PI * Math.PI);

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

    shader.uniforms.projectedUseOcclusion = { value: useOcclusion ? 1 : 0 };
    shader.uniforms.projectedOcclusionCube = { value: params.occlusionTexture ?? null };
    shader.uniforms.projectedOcclusionNear = { value: params.occlusionNearMeters ?? 0.05 };
    shader.uniforms.projectedOcclusionFar = { value: params.occlusionFarMeters ?? 100 };
    shader.uniforms.projectedOcclusionFaceSize = { value: params.occlusionFaceSize ?? 512 };
    shader.uniforms.projectedOcclusionBias = { value: occlusionBias };
    shader.uniforms.projectedOcclusionSoftness = { value: occlusionSoftness };

    shader.uniforms.projectedUseSecondary = { value: useSecondary ? 1 : 0 };
    shader.uniforms.projectedSecondaryPanoMap = { value: params.secondaryTexture ?? null };
    shader.uniforms.projectedSecondaryOrigin = { value: secondaryOrigin };
    shader.uniforms.projectedSecondaryYaw = { value: secondaryYaw };
    shader.uniforms.projectedUseSecondaryOcclusion = { value: useSecondaryOcclusion ? 1 : 0 };
    shader.uniforms.projectedSecondaryOcclusionCube = { value: params.secondaryOcclusionTexture ?? null };
    shader.uniforms.projectedSecondaryOcclusionNear = { value: params.secondaryOcclusionNearMeters ?? 0.05 };
    shader.uniforms.projectedSecondaryOcclusionFar = { value: params.secondaryOcclusionFarMeters ?? 100 };
    shader.uniforms.projectedSecondaryOcclusionFaceSize = { value: params.secondaryOcclusionFaceSize ?? 512 };

    shader.uniforms.projectedDebugCoverage = { value: debugCoverage ? 1 : 0 };
    shader.uniforms.projectedBlendMode = { value: blendModeId };
    shader.uniforms.projectedPrimaryTexelConstant = {
      value: texelConstant(params.panoramaWidth ?? 8_192, params.panoramaHeight ?? 4_096),
    };
    shader.uniforms.projectedSecondaryTexelConstant = {
      value: texelConstant(params.secondaryPanoramaWidth ?? 8_192, params.secondaryPanoramaHeight ?? 4_096),
    };

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
uniform int projectedUseOcclusion;
uniform samplerCube projectedOcclusionCube;
uniform float projectedOcclusionNear;
uniform float projectedOcclusionFar;
uniform float projectedOcclusionFaceSize;
uniform float projectedOcclusionBias;
uniform float projectedOcclusionSoftness;
uniform int projectedUseSecondary;
uniform sampler2D projectedSecondaryPanoMap;
uniform vec3 projectedSecondaryOrigin;
uniform float projectedSecondaryYaw;
uniform int projectedUseSecondaryOcclusion;
uniform samplerCube projectedSecondaryOcclusionCube;
uniform float projectedSecondaryOcclusionNear;
uniform float projectedSecondaryOcclusionFar;
uniform float projectedSecondaryOcclusionFaceSize;
uniform int projectedDebugCoverage;
uniform float projectedPrimaryTexelConstant;
uniform float projectedSecondaryTexelConstant;
varying vec3 vProjectedWorldPos;
const float PROJECTED_PI = 3.141592653589793;

${PROJECTED_STYLE_GLSL.applyInversePanoYaw}

${PROJECTED_STYLE_GLSL.equirectUvFromDirection}

${PROJECTED_STYLE_GLSL.occlusionDepthHelpers}

${PROJECTED_STYLE_GLSL.occlusionVisibility}

float projectedQualityAt(vec3 worldPos, vec3 origin, float texelConstant) {
  vec3 offset = worldPos - origin;
  float distanceSquared = max(dot(offset, offset), 1e-6);
  vec3 direction = normalize(offset);
  vec3 geometricNormal = normalize(cross(dFdy(worldPos), dFdx(worldPos)));
  // The renderer may receive either winding for imported double-sided set
  // surfaces; visible fragments use the same absolute face-angle quality as
  // intentionally double-sided coverage geometry.
  float facing = abs(dot(geometricNormal, -direction));
  float angleQuality = smoothstep(0.15, 0.55, facing);
  float texelDensity = texelConstant * facing / distanceSquared;
  float resolutionQuality = smoothstep(128.0, 1024.0, texelDensity);
  return angleQuality * resolutionQuality;
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 fallbackAlbedo = projectedUseNeutralFallback == 1
    ? projectedFallbackColor
    : diffuseColor.rgb;

  // --- Per-projector visibility from radial-depth occlusion cubemaps ---
  float primaryVisibility = 1.0;
  float secondaryVisibility = 1.0;
  if (projectedUseOcclusion == 1) {
    primaryVisibility = sampleProjectorVisibility(
      vProjectedWorldPos,
      projectedPanoOrigin,
      projectedOcclusionCube,
      projectedOcclusionNear,
      projectedOcclusionFar,
      projectedOcclusionFaceSize,
      projectedOcclusionBias,
      projectedOcclusionSoftness
    );
  }
  if (projectedUseSecondaryOcclusion == 1) {
    secondaryVisibility = sampleProjectorVisibility(
      vProjectedWorldPos,
      projectedSecondaryOrigin,
      projectedSecondaryOcclusionCube,
      projectedSecondaryOcclusionNear,
      projectedSecondaryOcclusionFar,
      projectedSecondaryOcclusionFaceSize,
      projectedOcclusionBias,
      projectedOcclusionSoftness
    );
  }

  vec3 primarySample = fallbackAlbedo;
  vec3 secondarySample = fallbackAlbedo;
  float secondaryValid = 0.0;

  // Primary pano sample.
  {
    vec3 offset = vProjectedWorldPos - projectedPanoOrigin;
    if (dot(offset, offset) >= 1e-8) {
      vec3 direction = applyInversePanoYaw(normalize(offset), projectedPanoYaw);
      vec2 panoUv = equirectUvFromDirection(direction);
      panoUv.x = fract(panoUv.x);
      panoUv.y = clamp(panoUv.y, 0.0, 1.0);
      vec4 panoSample = texture2D(projectedPanoMap, panoUv);
      primarySample = panoSample.rgb * projectedExposure;
    }
  }

  // Secondary pano sample (only when a secondary projector exists).
  if (projectedUseSecondary == 1) {
    vec3 offset = vProjectedWorldPos - projectedSecondaryOrigin;
    if (dot(offset, offset) >= 1e-8) {
      vec3 direction = applyInversePanoYaw(normalize(offset), projectedSecondaryYaw);
      vec2 panoUv = equirectUvFromDirection(direction);
      panoUv.x = fract(panoUv.x);
      panoUv.y = clamp(panoUv.y, 0.0, 1.0);
      vec4 panoSample = texture2D(projectedSecondaryPanoMap, panoUv);
      secondarySample = panoSample.rgb * projectedExposure;
    }
    secondaryValid = 1.0;
  }

  // --- Continuous visibility scores (no hard 0.5 thresholding) ---
  // Gate everything by the actual availability of a secondary projector AND the
  // selected blend mode, so single-projector output is never mixed with the
  // fallback and blend modes are honored.
  float hasSecondary = (projectedUseSecondary == 1 && secondaryValid > 0.5) ? 1.0 : 0.0;

  float primaryEnabled = projectedBlendMode == 1 ? 0.0 : 1.0;
  float secondaryEnabled = projectedBlendMode == 0 ? 0.0 : hasSecondary;

  float primaryQuality = projectedQualityAt(
    vProjectedWorldPos,
    projectedPanoOrigin,
    projectedPrimaryTexelConstant
  );
  float secondaryQuality = hasSecondary > 0.5
    ? projectedQualityAt(vProjectedWorldPos, projectedSecondaryOrigin, projectedSecondaryTexelConstant)
    : 0.0;

  float primaryDominance = projectedBlendMode == 2 ? 1.15 : 1.0;
  float secondaryDominance = projectedBlendMode == 3 ? 1.15 : 1.0;
  float primaryScore = primaryEnabled * primaryVisibility * primaryQuality * primaryDominance;
  float secondaryScore = secondaryEnabled * secondaryVisibility * secondaryQuality * secondaryDominance;
  // Winner-takes-most weighting follows the optimizer's max-quality objective
  // while retaining a narrow transition when qualities are nearly equal.
  float primaryWeight = pow(primaryScore, 4.0);
  float secondaryWeight = pow(secondaryScore, 4.0);
  float scoreTotal = primaryWeight + secondaryWeight;

  float coverage = max(
    primaryScore,
    secondaryScore
  );

  // --- Coverage diagnostic (four-state: red/cyan/magenta/white) ---
  if (projectedDebugCoverage == 1) {
    float p = primaryScore;
    float s = secondaryScore;
    float visibleButPoor = max(
      primaryEnabled * primaryVisibility,
      secondaryEnabled * secondaryVisibility
    ) * (1.0 - step(0.001, max(p, s)));
    vec3 cov =
        vec3(1.0, 0.0, 0.0) * (1.0 - p) * (1.0 - s) // red: neither
      + vec3(0.0, 1.0, 1.0) * p * (1.0 - s)         // cyan: primary only
      + vec3(1.0, 0.0, 1.0) * (1.0 - p) * s          // magenta: secondary only
      + vec3(1.0) * p * s;                           // white: both
    diffuseColor.rgb = mix(cov, vec3(1.0, 0.55, 0.0), visibleButPoor); // orange: poor quality
  } else {
    vec3 projectedColor = (primarySample * primaryWeight + secondarySample * secondaryWeight)
      / max(scoreTotal, 0.0001);
    // When fully occluded (no score), keep the fallback albedo.
    vec3 resultColor = coverage > 0.0001
      ? mix(fallbackAlbedo, projectedColor, clamp(projectedOpacity, 0.0, 1.0) * clamp(coverage, 0.0, 1.0))
      : fallbackAlbedo;
    diffuseColor.rgb = resultColor;
  }
}
`,
      )
      // Lighting contract is ONLY post-aomap mixing of reflectedLight.
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
    `projected-style-v5:${params.settings.fallbackMode}:`
    + `${params.disposable ? 'd' : 's'}:`
    + `${useOcclusion ? 'o' : 'n'}:`
    + `${useSecondary ? 's' : 'p'}:`
    + `${useSecondaryOcclusion ? 'so' : 'sn'}:`
    + `${debugCoverage ? 'c' : 'x'}:`
    + `${blendMode}`
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
