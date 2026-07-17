# Projected Rendering Architecture (Pre-Projection Assist)

## Entry Points That Create Projected Materials

| # | Path | Trigger | Material Creation | Disposal |
|---|---|---|---|---|
| 1 | **Live Viewport** | SceneViewport with `appearance='projected'` | `buildScene()` → `applyProjectedStyleToObject()` → `createProjectedStyleMaterial()` with `disposableMaterials: true` | `disposeScene()` on effect re-run or unmount |
| 2 | **Shot Still Export** | User clicks "Capture" in ShotsWorkspace | `renderShotProjectedFrame()` → `renderViewportProjected()` → `loadProjectedSceneOptions()` + `buildScene()` | `disposeScene()` + `releaseProjectedStyleTexture()` after render |
| 3 | **Camera-Move Frames (Shots)** | After projected MP4 export | `renderViewportProjected()` per keyframe | Same as #2 |
| 4 | **Camera-Move MP4 (Shots)** | `exportCameraMoveVideo()` with `appearance:'projected'` | `renderShotCameraMoveMp4()` → `loadProjectedSceneOptions()` + `buildScene()` | After MediaRecorder completes |
| 5 | **Package Export — Still** | `includeProjectedViewport` | `renderShotProjectedFrame()` → `renderViewportProjected()` | Same as #2 |
| 6 | **Package Export — Video** | `includeProjectedCameraMoveVideo` | `renderShotCameraMoveMp4({appearance:'projected'})` | Same as #4 |
| 7 | **Package Export — Frames** | `includeProjectedCameraMoveReferenceFrames` | `renderViewportProjected()` per frame | Same as #2 |
| 8 | **Test Harness** | `runProjectedStyleCompileGate()` | Direct `createProjectedStyleMaterial()` in test code | Explicit `.dispose()` after readback |

## Projector Resolution Chain

1. `resolveProjectedProjectorAssets(project)` in `multiOriginProjection.ts`:
   - Normalizes settings via `normalizeProjectedStyleSettings()`
   - Resolves primary pano: explicit `panoId` → canonical styled → first eligible → first any
   - Resolves secondary pano: explicit `secondaryPanoId` → auto-pick (for dual modes) → degrade if missing
   - Looks up asset URIs from `project.assets.assets`

2. Used by:
   - `SceneViewport` (live viewport)
   - `loadProjectedSceneOptions()` in `renderers.ts` (all export paths)

## ProjectedStyleSettings

Defined in `src/domain/types.ts`:
```typescript
export interface ProjectedStyleSettings {
  panoId?: string;
  secondaryPanoId?: string;
  blendMode?: ProjectorBlendMode;
  opacity: number;
  exposure: number;
  lightingContribution: number;
  fallbackMode: 'clay' | 'neutral';
}
```

### Blend Modes
- `primary_only` (0) — only primary projector
- `secondary_only` (1) — only secondary projector
- `primary_dominant` (2) — primary dominant, secondary fills far regions
- `secondary_dominant` (3) — secondary dominant, primary fills far regions

## Texture Acquisition and Release Ownership

### Cache (`projectedStyleMaterials.ts`)
- Module-level `Map<string, { texture, refCount, loading?, failed? }>`
- `acquireProjectedStyleTexture(url)` — load or increment refCount
- `releaseProjectedStyleTexture(url)` — decrement; dispose when zero

### Ownership Protocol
- `ProjectedTextureOwnership` — `{ requestedUrl?, ownedUrl? }`
- `prepareProjectedTextureRequest(ownership, nextUrl)` — releases owned if URL changes
- `resolveProjectedTextureRequest(ownership, url, texture, cancelled)` — accept or discard
- `disposeProjectedTextureOwnership(ownership)` — unmount cleanup

### SceneViewport
Two ref slots: `primaryOwnershipRef`, `secondaryOwnershipRef`. Effects keyed on asset URLs.

### Export Paths
`loadProjectedSceneOptions()` acquires textures; caller releases after render.

## Material Creation

`createProjectedStyleMaterial(params)` in `projectedStyleMaterials.ts`:
- Creates `MeshStandardMaterial` with `onBeforeCompile` hook
- Injects GLSL for: inverse yaw, equirect sampling, confidence-based blend
- Supports dual-projector blend via `projectedHasSecondary` uniform
- Marks `userData.projectedStyle = true`, `userData.disposableProjected` for lifecycle

## Shader Convention
- Unrotated pano center (u=0.5) faces world +Z
- +X is right when looking +Z
- `applyInversePanoYaw()` rotates direction by -yaw around Y
- World position → pano-local direction → equirect UV
- Inverse-distance confidence: `falloff / (falloff + distance)`

## Key Files
- `src/domain/types.ts` — `ProjectedStyleSettings`, `ProjectorBlendMode`
- `src/domain/defaults.ts` — `normalizeProjectedStyleSettings()`
- `src/engine/projectedStyle.ts` — `resolveProjectedStylePano()`, eligibility
- `src/engine/multiOriginProjection.ts` — projector resolution, blend weights
- `src/engine/projectedStyleMaterials.ts` — texture cache, material creation, ownership
- `src/engine/projectedStyleMath.ts` — pure math + GLSL strings
- `src/engine/sceneObjects.ts` — `buildScene()`, `ProjectedSceneOptions`, material application
- `src/engine/renderers.ts` — all export render paths
- `src/components/viewers/SceneViewport.tsx` — live viewport lifecycle
