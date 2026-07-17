# Implementation Plan: Projection Assist

## Background

PanoRef already projects a styled equirectangular panorama onto graybox and imported 3D geometry using world-space projection. The Projection Assist feature adds a guided paired-marker workflow so users can locally correct mismatches between the styled panorama's appearance and the graybox geometry.

All processing is client-side. No new runtime dependencies are introduced.

---

## Scope and non-goals

**In scope:**
- `alignments?: ProjectionAlignment[]` added to the existing single-projector `ProjectedStyleSettings`
- Spherical RBF solver producing a 512×256 warp field
- Packed RGBA8 `DataTexture` cache with reference counting
- Fragment shader sampling through the warp map
- PanoViewer pick mode and marker overlay
- `ProjectionAlignmentEditor` full-screen modal
- Reference workspace Local fit section
- Precision panel status, strength slider, and removal

**Strictly out of scope:**
- Secondary projector (`secondaryPanoId`)
- Any blend mode system (`blendMode`, `ProjectorBlendMode`, `'lerp' | 'additive'`, or any other)
- Changes to any field of `ProjectedStyleSettings` other than adding `alignments`
- AI feature matching, optical flow, texture baking, or server processing

> [!WARNING]
> `ProjectedStyleSettings` currently has exactly: `panoId`, `opacity`, `exposure`, `lightingContribution`, `fallbackMode`. Only `alignments?: ProjectionAlignment[]` is added. Do not add or redefine any other fields.

---

## Amendment summary

### A — Panorama rotation coordinate frames
Marker UVs are stored in image space. Before using a target graybox UV as the warp-map lookup coordinate, it is transformed:
1. Graybox UV → graybox-local unit direction
2. Rotate by target graybox pano yaw → world direction
3. Rotate by inverse source styled-pano yaw → source-local direction
4. Source-local direction → source-aligned target UV (the warp-map key)

The corresponding source marker UV is the desired styled-pano UV.

Both `targetYaw` and `sourceYaw` are inputs to the solver and are included in the deterministic cache key. Any change in either referenced panorama yaw causes the cache key to change and therefore acquires the corresponding regenerated warp texture (the cache entry itself remains immutable).

### B — Control-marker accuracy
Tolerance is calculated exactly as:
```ts
const oneDegree = Math.PI / 180;
const twoHorizontalTexels = (2 * 2 * Math.PI) / width;
const twoVerticalTexels = (2 * Math.PI) / height;
const toleranceRadians = Math.min(oneDegree, twoHorizontalTexels, twoVerticalTexels);
```

If any enabled marker exceeds `toleranceRadians` error after the initial solve, up to 4 residual correction passes are executed. Each pass adds kernel-weighted residual axis-angle corrections to the existing rotation field (not raw UV deltas). The solver returns `maxMarkerErrorRadians`.

### C — Strength applied exactly once
The warp field is always solved at full strength. `strength` is excluded from the cache key. The shader applies it once:
```glsl
panoUv.x = fract(panoUv.x + displacement.x * projectedWarpStrength);
panoUv.y = clamp(panoUv.y + displacement.y * projectedWarpStrength, 0.0, 1.0);
```
Changing strength updates the uniform only — no texture rebuild.

### D — Idempotent release
`acquireProjectionWarpTexture` returns an idempotent release callback. Materials attach a one-time `dispose` event listener that calls this callback. Repeated `dispose()` calls cannot double-decrement the reference count.

### E — Draft geometry preview stays local
Geometry preview passes a locally cloned or memoized project containing the draft alignment to `SceneViewport`. `SceneViewport` already accepts `project` as a prop, so no architecture changes are required. Zustand and persisted project settings are not touched until the user confirms with **Use improved projection**.

### F — Verify every projected render path
All of the following paths must receive the same normalized `ProjectedStyleSettings` (including `alignments`) and apply the warp identically:
- Live `SceneViewport` projected appearance
- `renderViewportProjected` (still)
- `renderShotCameraMoveMp4` (video, projected)
- Reference-frame stills in `packageExport.ts`

### G — Multi-origin data model (single-projector scope)
Because the codebase currently has only one projector, the multi-origin requirement is handled as:
- `alignments?: ProjectionAlignment[]` — one entry per `sourcePanoId`
- `findProjectionAlignmentForPano(settings, sourcePanoId)` helper
- `setProjectionAlignmentForPano(settings, alignment | undefined, sourcePanoId)` helper
- Normalization deduplicates by `sourcePanoId` (last valid entry wins)
- Alignments for absent panos are preserved (reported as stale, not silently dropped)

No secondary projector slot, no blend mode, and no additional shader uniform slots are introduced.

### H — Preview wording
> Implement geometry preview by passing a locally cloned or memoized project containing the draft alignment to `SceneViewport`. Do not modify Zustand or persisted project settings.

### I — Unambiguous tolerance formula
See amendment B above.

### J — Completion verification commands
`npm run lint`, `npm test`, and `npm run build` must all pass before the feature is reported complete.

---

## Proposed changes

### Domain layer

#### [MODIFY] [types.ts](file:///c:/Users/disti/App%20Development/PanoRef/src/domain/types.ts)
- Add `Vec2 = [number, number]`
- Add `ProjectionControlPair` interface
- Add `ProjectionAlignment` interface
- Extend `ProjectedStyleSettings` with **only** `alignments?: ProjectionAlignment[]`
- Do not touch `panoId`, `opacity`, `exposure`, `lightingContribution`, `fallbackMode`

#### [MODIFY] [defaults.ts](file:///c:/Users/disti/App%20Development/PanoRef/src/domain/defaults.ts)
- Extend `normalizeProjectedStyleSettings()` to normalize `alignments`
- Export `findProjectionAlignmentForPano(settings, sourcePanoId)`
- Export `setProjectionAlignmentForPano(settings, alignment | undefined, sourcePanoId)`
- Normalization rules: discard invalid pairs, clamp UVs 0–1, deduplicate by `sourcePanoId` (keep last), preserve stale-pano entries, default strength 1, clamp strength 0–1

---

### New engine files

#### [NEW] `src/engine/projectionAlignmentMath.ts`
Pure math helpers (no side effects, fully testable without WebGL):
- `equirectUvToUnitDirection(uv: Vec2): Vec3`
- `unitDirectionToEquirectUv(direction: Vec3): Vec2`
- `shortestWrappedDeltaU(fromU, toU): number` — result in `[-0.5, 0.5)`
- `wrapUvU(u): number`
- `clampUvV(v): number`
- `angularDistanceRadians(a, b: Vec3): number`
- `axisAngleVectorBetween(from, to: Vec3): Vec3` — handles parallel and anti-parallel
- `rotateDirectionByAxisAngleVector(direction, rotation: Vec3): Vec3`
- `wendlandC2(t: number): number`

#### [NEW] `src/engine/projectionAlignmentSolver.ts`
- `solveProjectionAlignment(alignment, options)` → `ProjectionWarpField`
- Returns identity field when: alignment missing/invalid, zero enabled pairs, or strength zero
- Influence radius: `nearestDistance × 1.75`, clamped 20°–70°; default 50° for singletons
- Four soft-identity anchors at `v=0.5`, `u∈{0, 0.25, 0.5, 0.75}`, radius 45°, weight 0.08
- Coordinate transform per amendment A (target pano yaw → world → source pano yaw inverse)
- Up to 4 residual passes for sub-tolerance accuracy
- Returns `maxMarkerErrorRadians` and `conflictCount`
- Output is always finite; NaN/Inf replaced with zero

#### [NEW] `src/engine/projectionWarpTexture.ts`
- Packs `Float32Array` displacement into RGBA8 `DataTexture` (16-bit per channel per amendment spec)
- Cache keyed on: alignment version, source pano ID, target graybox pano ID, source yaw, target yaw, solver name, sorted enabled pair IDs/orders/UVs, map dimensions
- Strength **excluded** from cache key
- Reference counting; release callback is idempotent
- `acquireProjectionWarpTexture(alignment, options): { texture, width, height, release }`
- `disposeAllProjectionWarpTextures()` for tests

---

### Shader integration

#### [MODIFY] [projectedStyleMaterials.ts](file:///c:/Users/disti/App%20Development/PanoRef/src/engine/projectedStyleMaterials.ts)
- `createProjectedStyleMaterial` acquires a warp texture for the primary pano alignment
- Uniforms added: `projectedWarpMap`, `projectedWarpMapSize`, `projectedWarpStrength`, `projectedWarpEnabled`
- Fragment shader: decode warp map → apply displacement × strength → sample `projectedPanoMap`
- `customProgramCacheKey()` updated to include warp-enabled flag and pano ID
- Material `dispose` listener releases the warp texture once, idempotently

#### [MODIFY] [projectedStyle.ts](file:///c:/Users/disti/App%20Development/PanoRef/src/engine/projectedStyle.ts)
- Export `isProjectionAlignmentCurrent(project, alignment): boolean`
- Export `projectionAlignmentStatusForPano(project, sourcePanoId): { state, pairCount, conflictCount, message }`
- Stale when: source pano missing, target graybox missing, sourcePanoId ≠ current resolved pano, assets missing, zero enabled pairs

---

### UI layer

#### [MODIFY] [PanoViewer.tsx](file:///c:/Users/disti/App%20Development/PanoRef/src/components/viewers/PanoViewer.tsx)
- Add `PanoViewerMarker` interface and `interactionMode`, `onPickUv`, `markers` props
- Default `interactionMode='navigate'` — all existing call sites unchanged
- Click vs. drag: record `pointerdown` position; if total movement < 5 CSS px, treat `pointerup` as click
- `onPickUv` called with equirect UV derived from camera ray + pano rotation
- Marker overlay: HTML buttons positioned via `projectMarkerUvToScreen` helper
- Three marker states: `normal`, `pending`, `warning`
- Accessible `aria-label` values: `Graybox match 3`, `Styled match 3`

#### [NEW] `src/components/reference/ProjectionAlignmentEditor.tsx`
- Full-screen fixed overlay (modal semantics, focus trapped, Escape with confirmation)
- Props: `open`, `sourcePano`, `sourceImageUrl`, `targetPano`, `targetImageUrl`, `initialAlignment`, `onCancel`, `onApply`, `onPreviewGeometry`
- Local state only while editing; `onApply` is the only commit path
- Desktop: two equal side-by-side `PanoViewer` panels sharing `sharedView`
- Mobile: single viewer with `Graybox` / `Styled` segmented buttons
- Pair creation: click graybox → pending marker; click styled → complete pair
- Instruction text changes per step
- Pair chips with per-pair enable/disable and remove
- Actions: Cancel, Undo last match, Clear all matches, Preview on geometry (≥3 pairs), Use improved projection (≥1 pair)
- `Clear all matches` requires confirmation when pairs exist

#### [MODIFY] [ReferenceWorkspace.tsx](file:///c:/Users/disti/App%20Development/PanoRef/src/components/workspaces/ReferenceWorkspace.tsx)
- Add **Local fit** section in the Alignment card (below yaw controls) when styled pano + graybox + both assets exist
- Shows status message + **Fix local mismatches** button
- On editor apply: `updateProjectSettings({ projectedStyle: setProjectionAlignmentForPano(...) })`
- Geometry preview: clones project with draft alignment, passes to `SceneViewport`; no Zustand write until confirmed

#### [MODIFY] [ProjectedStylePanel.tsx](file:///c:/Users/disti/App%20Development/PanoRef/src/components/common/ProjectedStylePanel.tsx)
- Add **Projection Assist** read-only status section: status message + active match count
- Amber warning when stale or conflicting
- Add **Local fit strength** slider (hidden when no alignment)
- Add **Remove local fit** button (clears only `alignment` for the active source pano; does not remove the pano)

---

### Store

#### [MODIFY] [useContinuityStore.ts](file:///c:/Users/disti/App%20Development/PanoRef/src/state/useContinuityStore.ts)
- Add `setProjectionAlignment(alignment: ProjectionAlignment | undefined, sourcePanoId: string): void`
- Uses `setProjectionAlignmentForPano` then calls `updateProjectSettings`

---

## Implementation order

1. Add `Vec2`, `ProjectionControlPair`, `ProjectionAlignment` to `types.ts`
2. Extend `normalizeProjectedStyleSettings`, add helpers to `defaults.ts`
3. Implement `projectionAlignmentMath.ts` + math tests
4. Implement `projectionAlignmentSolver.ts` + solver tests
5. Implement `projectionWarpTexture.ts` + texture tests
6. Integrate warp into `projectedStyleMaterials.ts`
7. Add status helpers to `projectedStyle.ts`
8. Verify all projected render paths in `renderers.ts` and `packageExport.ts`
9. Extend `PanoViewer.tsx` (pick mode, marker overlay)
10. Create `ProjectionAlignmentEditor.tsx`
11. Integrate into `ReferenceWorkspace.tsx`
12. Add Precision panel status/strength/removal to `ProjectedStylePanel.tsx`
13. Add stale/conflict handling and invalidation
14. Add project serialization tests and UI fidelity tests
15. Update `README.md` and Help workspace docs
16. Run `npm run lint`, `npm test`, `npm run build` — fix all failures

---

## Tests

### `tests/projectionAlignmentMath.test.ts`
1. UV → direction → UV round-trip
2. Horizontal seam wrapping (u ≈ 0 and u ≈ 1)
3. Pole stability (v = 0, v = 1)
4. Parallel axis-angle returns zero vector
5. Anti-parallel axis-angle is deterministic and finite
6. Rotation reaches the expected target direction
7. Wendland kernel boundaries (t ≤ 0 = 1, t ≥ 1 = 0)

### `tests/projectionAlignmentSolver.test.ts`
1. Missing alignment → identity field
2. Zero enabled pairs → identity field
3. All disabled pairs → identity field
4. One marker moves target close to source (within tolerance)
5. Multiple markers influence separate nearby regions independently
6. Distant unmarked regions stay near identity
7. Seam-crossing marker moves by short path
8. All output values are finite
9. Max displacement clamped to 35°
10. Conflict detection (two nearby targets, divergent sources)
11. Disabled pairs are ignored
12. Equal source and target yaw produces same result as zero-yaw case
13. Different source and target yaws correctly align marker after rotation
14. Changing source yaw changes cache key (new field acquired)
15. Changing target yaw changes cache key (new field acquired)
16. Marker correctly aligns after global yaw correction

### `tests/projectionWarpTexture.test.ts`
1. Zero displacement encodes and decodes near zero
2. Min/max U displacement round-trips
3. Min/max V displacement round-trips
4. Deterministic cache key (same inputs → same key)
5. Reference count: acquire → release → cache eviction
6. Repeated acquire reuses the same texture object
7. Idempotent release (second release does not decrement again)
8. Repeated acquire/release does not leak
9. `disposeAllProjectionWarpTextures` clears to zero

### `tests/projectedStyle.test.ts` (extended)
1. Old projects without `alignments` load normally
2. Valid alignment survives save/reload
3. Invalid pairs are discarded on normalization
4. Strength is clamped to 0–1
5. `alignments` is optional
6. Removing local fit preserves other `ProjectedStyleSettings` fields
7. `findProjectionAlignmentForPano` returns correct entry
8. `setProjectionAlignmentForPano` removes only the specified pano's alignment
9. New graybox render makes existing alignment stale
10. Changing projected source pano makes alignment stale

### `tests/uiFidelity.test.ts` (extended)
1. **Fix local mismatches** appears only when styled + graybox + assets exist
2. Existing yaw and fade controls remain unchanged
3. Projection Assist editor has Graybox and Styled panels
4. Pair numbering is automatic
5. **Use improved projection** is disabled before one completed pair
6. **Preview on geometry** is disabled before three enabled pairs
7. Mobile side-switching logic works
8. Existing `PanoViewer` usages compile without new required props
9. Existing UI fidelity tests still pass
10. Entering and leaving preview does not modify serialized project JSON
11. Project save/reload preserves valid marker pairs
12. Reopening editor restores pairs
13. Missing assets fall back to unwarped projection
14. Malformed alignment cannot generate NaN or Infinity in the warp field
15. `PanoViewer` click-to-UV correct at varied yaw, pitch, FOV, viewport sizes
16. Marker overlay placement accounts for pano rotation
17. Texture reference counts return to zero after project switching
18. Same world-space point produces identical warped UV in live and export render paths

---

## Completion checklist

- [ ] `npm run lint` passes with zero errors
- [ ] `npm test` passes with all new and existing tests green
- [ ] `npm run build` produces a clean production bundle
- [ ] Project save and reload round-trips marker data
- [ ] Reopening editor restores pairs
- [ ] Projected still export uses warp
- [ ] Projected camera-move frames use warp
- [ ] Projected camera-move video uses warp
- [ ] Entering/leaving preview leaves serialized JSON unchanged
- [ ] Texture cache size returns to baseline after project switch
- [ ] `README.md` updated
- [ ] Help workspace docs updated
