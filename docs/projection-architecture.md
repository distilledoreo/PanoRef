# Projected Rendering Architecture and Projection Assist

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
| 9 | **Projection Assist Preview** | User opens **Result** or **Geometry** | `ProjectionRegionEditor` creates an immutable Region Fit project snapshot; `ProjectionRegionResultPreview` renders a debounced 256×128 2D result and `SceneViewport` renders the same snapshot with `appearance='projected'` | Snapshot is discarded on Back, Cancel, or editor close |

## Projector Resolution Chain

1. `resolveProjectedProjectorAssets(project)` in `multiOriginProjection.ts`:
   - Normalizes settings via `normalizeProjectedStyleSettings()`
   - Resolves primary pano: explicit `panoId` → canonical styled → first eligible → first any
   - Resolves secondary pano: explicit `secondaryPanoId` → auto-pick (for dual modes) → degrade if missing
   - Looks up asset URIs from `project.assets.assets`

2. Used by:
   - `SceneViewport` (live viewport)
   - `loadProjectedSceneOptions()` in `renderers.ts` (all export paths)

3. `resolveProjectionRegionWithStrengthForProject(project, sourcePanoId, quality)` resolves a valid same-origin paired Region Fit and its displacement/weight textures. If none is usable, `resolveProjectionWarpWithStrengthForProject()` may resolve the legacy point correction. The two methods are not combined.

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
  /** One saved local fit per source panorama. */
  alignments?: ProjectionAlignment[];
  /** One recommended paired-mask Region Fit per source panorama. */
  regionAlignments?: ProjectionRegionAlignment[];
}
```

`ProjectionAlignment` is source-owned. Its `sourcePanoId` identifies the styled panorama and its `targetGrayboxPanoId` identifies the graybox used for the ordered control pairs. These entries are independent of the primary and secondary slots, so slot swaps and blend-mode changes do not copy or retarget matches.

## Projection Assist Region Fit lifecycle

`ProjectionRegionEditor` owns a non-persistent `ProjectionRegionDraft`. Closing a graybox polygon creates exactly one `ProjectionRegion`, clones its target positions into styled positions, and preserves shared vertex IDs permanently. Editor transitions provide paired insertion/deletion, styled-only transforms, undo, ordering, softness, enabled state, and dirty-state checks. Pending regions are included in the immutable preview snapshot so the Result/Geometry surfaces stay live, but pending regions cannot be converted to a persisted alignment or enabled for Apply. Pointer gestures have an explicit view/mask/outline/handle owner, capture the pointer, use seam-safe unwrapped U coordinates, and coalesce the full drag into one undo entry. Navigate, Move outline, and Edit handles are exclusive tools; hold `B` temporarily shows Before.

`projectionRegionCoordinates.ts` converts target and source directions through their respective yaw into one tangent plane. `projectionRegionMesh.ts` triangulates the shared topology and adds an identity transition cage. `projectionRegionTexture.ts` rasterizes deterministic ordered mappings and caches them without overall strength. Diagnostics use the same pure coordinate/mesh checks without acquiring GPU textures.

The editor preview path uses `createProjectionRegionPreviewProject()` to clone the project and replace only the selected source Region Fit. The 2D result uses the same preview-quality displacement texture (`256×128`) as the projection resolver, ignores stale debounced snapshots, and reports invalid or missing-image status without mutating the project. Apply is the only parent settings mutation. Primary and secondary entries remain source-owned and resolve independently in the live viewport and shared export renderer.

## Legacy point-correction lifecycle

`ProjectionAlignmentEditor` keeps one active draft per editor session. The draft contains the target, ordered pairs, enabled state, and strength. Switching sources after editing confirms and discards the current draft before loading the next source, so no hidden source draft can be lost or omitted from Apply. `ProjectionAlignmentEditorState` provides pure transitions for target/source picking, undo, removal, enabling, clearing, target changes, and dirty-state checks.

The editor’s preview path uses `createProjectionAlignmentPreviewProject()` to shallow-clone the project and replace only the selected source alignment in the clone. It never calls a store mutation. Before renders the source-isolated saved project; After renders the draft clone. Apply is the only path that calls the parent settings change.

The production panel exposes a card for each active projector. Cards resolve structural status synchronously, then refresh conflict diagnostics in an effect using preview-resolution pure solver math; ordinary React rendering does not acquire and dispose a runtime warp texture. Cards expose source-specific strength and remove only the selected source entry. The 3D marker overlay is separate development-only tooling behind `showAlignmentDebugOverlay` and `import.meta.env.DEV`.

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
- `src/engine/projectionAlignmentStatus.ts` — structural ready/stale status with deferred diagnostics support
- `src/engine/projectionAlignmentDiagnostics.ts` — preview-resolution pure diagnostics and pair-specific conflict IDs
- `src/engine/projectionAlignmentDebug.ts` — development-only 3D marker overlay
- `src/engine/projectedStyleMaterials.ts` — texture cache, material creation, ownership
- `src/engine/projectedStyleMath.ts` — pure math + GLSL strings
- `src/engine/sceneObjects.ts` — `buildScene()`, `ProjectedSceneOptions`, material application
- `src/engine/renderers.ts` — all export render paths
- `src/components/viewers/SceneViewport.tsx` — live viewport lifecycle
- `src/components/common/ProjectedStylePanel.tsx` — production per-projector controls
- `src/components/reference/ProjectionAlignmentEditor.tsx` — guided match editor and draft lifecycle
- `src/components/reference/ProjectionAlignmentPreview.tsx` — non-persistent Before/After geometry preview
- `src/components/reference/projectionAlignmentEditorState.ts` — pure draft transitions
