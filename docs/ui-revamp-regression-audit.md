# Continuity Stage — UI revamp regression audit

**Date:** 2026-07-08  
**Auditor scope:** Post–ui-revamp codebase on `misc-bugfixes` vs pre-revamp baseline  
**Branch audited:** `misc-bugfixes` @ `2eca76f`  
**Pre-revamp baseline:** `0ef6776` (parent of first revamp commit `7efa83b`)  
**`main` at audit time:** `abd1dfc` (ui-revamp already merged via PR #3 / #4)

> **Follow-up (2026-07-08):** P0–P2 recommendations from this audit were implemented on `misc-bugfixes`, including `setProject` session reset, brand-menu rename/outside-close, auto-dismiss import toast, on-chrome Reference alignment, warning popovers, build shortcut badges, shots download-vs-accept CTA wording, export settings scope label, face-aligned 1m checkerboard, and Build graybox CTA rework (Download primary + Re-render secondary).

---

## Executive summary

The ui-revamp (PR #3/#4) moved Continuity Stage from docked sidebars to full-bleed progressive disclosure. Core engine capabilities remain present:

- Project JSON open/save
- Graybox 360 render + download
- Styled pano import / alignment / graybox approve
- Shot fly camera, lock, accept framing
- Camera keyframes + MP4 export
- Review AI brief + AI result import
- Multi-shot package ZIP (including cubemap / camera-move assets)

The revamp mostly **relocated** UI (sidebars → full-bleed + drawers/modals), not deleted pipelines.

`misc-bugfixes` restores the largest post-revamp breakages:

1. Visible **Save / Open** project controls
2. **Graybox re-render** reliability (WebGL dispose + replace prior panos)
3. **Object surface styles** (solid color + 1m×1m checkerboard)

Residual risk is mostly **UX discoverability and incomplete session reset**, not missing engines.

**Automated checks at audit time:**

| Command | Result |
|---------|--------|
| `npm test` | 156/156 passed |
| `npm run lint` (`tsc --noEmit`) | Clean |

---

## Merge / branch status

| Item | Value |
|------|--------|
| Current branch | `misc-bugfixes` |
| HEAD (audit) | `2eca76f` — Fix project save/open, graybox re-render, and object surface styles |
| `main` | `abd1dfc` — merge of PR #4 (ui-revamp) |
| `ui-revamp` tip | `8c9ab06` — already contained in `main` |
| Pre-revamp baseline | `0ef6776` = parent of `7efa83b` |
| Branch vs `main` | **+1 commit** (the bugfix commit above) |

**Important:** `ui-revamp` is **already merged** to `main`. There is no pending revamp merge; the work remaining is shipping `misc-bugfixes` (and any follow-up P0/P1 fixes) onto `main`.

---

## Lost or diminished features

| Feature | Pre-revamp (`0ef6776`) | Now (`misc-bugfixes`) | Severity | Notes |
|---------|------------------------|------------------------|----------|-------|
| Labeled Open / Save / Package | Text buttons in header | Icon Open/Save + brand menu; Package navigates to Export | Low (partially restored) | Bugfix restored discoverable open/save icons (`data-project-export-button`). Package is no longer a one-click header CTA. |
| Project name edit | Inline `TextInput` → `updateProjectInfo({ name })` | Name read-only in brand menu | **Medium** | `updateProjectInfo` still exists; only description is edited (via graybox prompt builder). No rename UI. |
| Import error handling | Silent / uncaught `parseProject` failure | try/catch + status banner + file input reset | **Improved** | `App.importProject` |
| Docked `WorkspaceSidebar` + `WarningList` | Always-visible primary/status/advanced | Contextual panels + precision drawers; `WarningList` largely unused | Medium (by design) | Warnings reduced to badges/counts. Message text harder to read. |
| Build layers list always visible | “Toybox Layers” in sidebar | Layers only when object selected + layers toggle | Low | Intentional progressive disclosure. |
| Build shortcuts cheatsheet | Visible panel + key badges on tray | Shortcuts still work (`buildShortcuts.ts`); tray badges gone | **Medium** | Overflow tray hides Person/Arch/Terrain/Backdrop. Hotkeys still work. |
| Build gizmo | Floor drag + precision only | Translate/rotate/scale gizmo + T/E/S | **Improved** | Post-revamp gain. |
| Graybox download after render | Sidebar download | Explicit **Download Graybox 360** (native 2:1) + Reference/objective paths | OK | Auto-download intentionally removed. |
| Graybox re-render | Appended new graybox; weaker dispose | Replace prior grayboxes; free stale assets; 4K default; `forceContextLoss` | **Improved** | Fixed on `misc-bugfixes`. |
| Object surface styles | Clay only | Solid / 1m checkerboard in precision drawer | **Improved** | New in bugfix commit. |
| Reference alignment controls | Always in left sidebar | Behind “Alignment controls” → `PrecisionDrawer` | **Medium** | Yaw/opacity not on-canvas primary chrome. |
| Project warnings in Reference | `WarningList` diagnostics | Not shown on Reference | Low–Medium | Export/Review only partially surface issues. |
| Shots dual preview strip | Always-on pano crop + export frame | Compare toggle; live preview in card/filmstrip | Low | Capability retained; less permanent dual view. |
| Lock camera via viewport click | Click-to-lock messaging | Explicit **Lock View** dock button | OK | More explicit control. |
| Fly default on enter Shots | Store forces flying | Same: `setWorkspace('shots')` sets `shotCameraFlying: true` | OK / doc mismatch | README claims locked open; code forces fly. |
| Camera keyframes / MP4 | Sidebar panels | Precision drawer “Camera Move MP4” | Low | Logic intact; deeper discoverability. |
| Export multi-shot + toggles | Per-shot export settings | Multi-select + Export Settings drawer | OK / improved | Multi-select is a revamp gain. |
| Objective help button | Header `ObjectiveHelpButton` | Brand menu “Current Objective” only | Low | Component still exists; not mounted in `App`. |
| Landmark creation UI | Store `addLandmark` only (no UI) | Still store-only | N/A | Pre-existing gap; default project seeds landmarks. |
| Theme toggle | Light only | Light/dark | **Improved** | |

---

## Bugs / regressions found

### Critical

None confirmed after `misc-bugfixes`. The main critical-class issues (graybox re-render stuck; project I/O hard to find) are addressed on this branch.

### High

1. **`setProject` incomplete session reset** — `src/state/useContinuityStore.ts`  
   Resets project, selections, `buildMode`, and workflow modal session flags — **does not** set:
   - `panoView` from first shot / defaults
   - `shotCameraFlying: false`
   - `isRenderingGraybox` / `isExportingPackage`
   - `activePrimitive` / `gridSnap`  

   **Symptom:** Open a project while flying or mid-render → stale camera view or stuck busy state.

### Medium

2. **Project brand menu never closes on outside click** — `src/App.tsx`  
   `projectMenuOpen` only toggles on brand click / menu item.

3. **Project import status toast never auto-dismisses** — `src/App.tsx`  
   Success/error banner stays until next open attempt.

4. **Project rename unavailable** — shell only displays `project.name`.

5. **`WarningList` effectively dead in UI** — component still exists; workspaces no longer render warning **text**, only counts/glow.

6. **Build tray overflow hides hotkeyed primitives** — Person (`0`), Arch (`4`), Terrain (`9`), Backdrop behind “More”.

7. **Shots primary CTA dual role** — frame download / render can be confused with Accept Framing / Export ZIP.

8. **Export settings bind to `selectedShot` only** — multi-select export uses other shots’ IDs but toggles only change the active row’s settings.

9. **Modal focus management incomplete** — `Modal.tsx` focuses panel + Esc/backdrop; no full Tab trap.

10. **Reference alignment controls not in primary chrome** — `ReferenceWorkspace.tsx`  
    Compare works when calibrating, but yaw/opacity live in the precision drawer. Risk: users approve without adjusting yaw.

### Low

11. Filmstrip three-dot markers decorative only (documented fidelity choice).  
12. Splash blocks interaction once (intentional; auto-dismisses if autoplay fails).  
13. `addLandmark` has no UI (pre-existing).  
14. Build precision “Download Graybox PNG” may use letterbox setting; primary CTA download forces native 2:1 — intentional dual mode, easy to confuse.  
15. Large projects store assets as data URLs — known product limitation (heavy JSON).

---

## Intentional changes that look healthy

| Change | Evidence | Assessment |
|--------|----------|------------|
| Full-bleed workspaces + floating stage rail | `App.tsx`, `WorkspaceShell.tsx`, `tests/uiFidelity.test.ts` | Matches progressive disclosure brief. |
| Transform gizmo + surface styles | `BuildWorkspace`, `transformGizmo.ts`, `sceneObjects.ts` | Net capability gain. |
| Shots fly isolation / no per-frame preview spam | `ShotsWorkspace` pauses `renderShotFrame` while flying | Correct isolation. |
| Stamp/origin only when Build passes props | Shots does not pass placement/origin props | Prevents stamp leak into framing. |
| Review clay control frames vs pano fallback | `ReviewWorkspace` shot-camera clay frames | Correct product intent. |
| Graybox 4K + theme-aware materials | `DEFAULT_GRAYBOX_PANO_*`, theme into render path | Intentional quality upgrade. |
| `sun_marker` hidden in AI-facing renders | `hiddenObjectTypes: ['sun_marker']` | Preserved + tested. |
| WebGL `disposeRenderer` + `forceContextLoss` | `renderers.ts` | Fixes re-render context exhaustion. |
| Package export cubemaps + MP4 assets | `packageExport.ts` | Intact. |
| Workflow modals (objective, alignment, advance) | `WorkflowGuidance.tsx` | Guidance without permanent rail. |
| Multi-shot export selection | `ExportWorkspace` `selectedShotIds` | Improvement over single-shot sidebar. |

---

## Test posture

### Run at audit time

- `npm test` — **156 passed** (23 files)
- `npm run lint` — **clean**

### Strong source-guard coverage

- `tests/productionPath.test.ts` — Open/Save discoverability, import status, package surfaces
- `tests/uiFidelity.test.ts` — floating header, fly/lock dock, graybox re-render/dispose, surface styles
- `tests/renderOutput.test.ts` — sun_marker exclusion, 4K graybox, no skinned/control projection
- `tests/projectWorkflow.test.ts` — serialize/parse, schema reject, legacy migrations
- Engine unit tests: keyframes, cubemap, fly bounds, shortcuts, pano image, mannequin, workflow

### Gaps

- No automated test for **`setProject` full reset completeness**
- No E2E for real file-picker import of invalid JSON
- No interaction test that alignment drawer is required for yaw
- Browser smoke remains manual (`tests/browser-smoke.md`)

### Recommended smoke before release

1. Open invalid JSON → error banner  
2. Open valid project → name/session update correctly  
3. Re-render graybox twice → download native 360  
4. Reference: import/align yaw → looks good enough  
5. Shots: fly → lock → accept framing  
6. Review: AI brief → import result  
7. Export: multi-select packages  

---

## Recommended fixes (prioritized)

### P0 — before release

1. **Harden `setProject`**  
   On import, also set:
   - `panoView` from first shot / defaults  
   - `shotCameraFlying: false`  
   - clear `isRenderingGraybox` / `isExportingPackage`  
   - optional: reset `gridSnap` / `activePrimitive`  
   Add a unit test around store open.

2. **Manual smoke** of the path listed above.

### P1 — high UX risk

3. Surface alignment controls without hunting (compact yaw + opacity on Reference chrome, or auto-open drawer after styled import).  
4. Close project menu on outside click / Esc.  
5. Restore project rename (inline edit in brand menu or settings).  
6. Warning detail on demand (tap badge → expand `WarningList` text).

### P2 — polish

7. Shortcut labels on primary tray (or `?` cheatsheet).  
8. Auto-dismiss import status after ~4s.  
9. Clarify Shots primary CTA: “Download frame” vs “Accept framing”.  
10. Export settings: apply toggles to all selected shots, or label “settings for selected shot only”.  
11. Fix README fly-vs-locked wording to match code (or change code to open locked).

---

## Residual risks / untested areas

| Area | Risk |
|------|------|
| Real WebGL multi-render stress | Dispose path looks correct; re-verify live |
| Safari/Firefox MP4 (`MediaRecorder`) | Browser-dependent; UI guards unsupported mime |
| Large multi-shot packages + cubemap stitch | Logic present; memory/time untested in audit |
| Mannequin GLB load failure | Capsule fallback exists; not exercised here |
| Dark theme materials in all export paths | Graybox gets theme; verify clay exports visually |
| Concurrent modal stacking | Effects try to order; edge cases possible |
| MCP server / tunnel paths | Outside app UI scope; not audited |

---

## Bottom line

| Question | Answer |
|----------|--------|
| Is ui-revamp still unmerged? | **No — already on `main`.** |
| Did the revamp delete core pipelines? | **No.** |
| Are there real regressions? | **Yes — mainly discoverability + incomplete project import reset.** |
| Is `misc-bugfixes` safe to merge after P0? | **Yes, reasonably.** It is the right follow-up branch. |
| Tests at audit time? | **Green (156 + tsc).** |

**Do not treat the revamp as feature-stripped.** Engines and package paths survived. **`misc-bugfixes` is a necessary follow-up** for I/O and graybox reliability. Remaining blockers are **session-reset completeness** and a handful of **discoverability regressions** (alignment controls, rename, warning text, build shortcuts). Fix P0, re-run the suite, then merge is reasonable.
