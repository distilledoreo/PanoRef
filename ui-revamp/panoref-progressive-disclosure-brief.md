# PanoRef — Progressive Disclosure Implementation Brief
Companion to: `panoref-redesign-brief.md` and reference image "Image 1" (Build stage, isometric viewport with drag gizmo).

## The Rule
No control is removed. Every field is relocated from "always rendered" to "rendered on demand, tied to an explicit user action." Capability stays 1:1 with the current app; visual density at rest drops to match Image 1.

## Mechanism 1 — Selection-Driven Contextual Panel (replaces the docked sidebar)
`WorkspaceSidebar.tsx`'s always-visible Primary → Status → Advanced stack is retired as the default layout. Replace with a panel that only mounts when something is selected, and unmounts on deselect.

- Nothing selected → screen matches Image 1: viewport, bottom tray, one primary CTA. No panel at all.
- Object/shot/camera selected → a small floating card appears near the selection with only the 2-4 highest-value controls for that object type (e.g. for a placed primitive: name, and a link into the precision drawer — not full transform fields inline).
- Deselect → card disappears. No leftover chrome.

## Mechanism 2 — Precision Drawer (replaces inline numeric fields)
`Vec3Input.tsx` and `Field.tsx` stay exactly as they are internally — just change where they mount. They currently render inline in the sidebar; move them into a slide-out drawer that opens only via:
- The existing `I` keyboard shortcut, or
- An explicit "precision" icon on the contextual panel from Mechanism 1

This is where every exact numeric value lives: position/rotation/dimensions, camera Lens/FOV/Aspect Ratio/Resolution/Height — everything currently in Image 4's always-visible "Camera Settings" panel. Same fields, same editability, gated behind one explicit open action instead of permanent visibility.

## Mechanism 3 — Smart Defaults (shrinks what needs touching)
Every field that moves into the precision drawer ships with a default so it's rarely opened at all:
- Camera: 35mm lens, 54.4° FOV, 16:9, 1920x1080, 1.65m height
- New primitives: snapped to grid, default dimensions, default rotation 0°

Check `domain/defaults.ts` for existing defaults and extend it to cover every field being relocated — the drawer should open pre-filled with reasonable values, not blanks.

## Mechanism 4 — Implicit Status (replaces the checklist panel)
`WarningList.tsx` and the "Check Your Work" readiness list stop rendering as a persistent panel. Status becomes a visual property of the object/shot itself:
- Ready → clean outline / no badge
- Needs attention → colored glow or small badge on the thumbnail/object
- Tapping the badge expands the specific issue — detail is lazy, not default-rendered

Applies to `ReferenceAlignmentPanel.tsx` and the Shots readiness score in Image 4 the same way: the 78% readiness ring becomes a glow state on the shot thumbnail in the filmstrip, full breakdown available on tap.

## Explicit Preserve List (nothing here is cut, only relocated)
- All Camera Settings fields (Lens, FOV, Aspect Ratio, Resolution, Camera Height, Rotation) → precision drawer
- Landmarks list/management → quick-tag action on click; full list is a secondary expand from the contextual panel, not default-visible
- Export Settings (Format, Range, Frame Rate, Padding) → deferred entirely to the Export stage, not rendered during Shots
- Readiness/warning detail → available via tap, not permanently listed
- All keyboard shortcuts stay as-is

## Visual Target (match Image 1, not Image 4)
- Viewport ≈ 85% of screen at rest, full-bleed, no permanently docked side panels
- Off-white/warm gray palette, single teal accent, soft shadows, rounded cards
- One dominant CTA per stage, bottom tray of icon buttons for placeable objects
- Contextual tooltips appear only near active selection, never as static help text

## Acceptance Criteria (self-check before calling a stage done)
1. With nothing selected, the screen's visual density matches Image 1 — no panel is visible except the top stage rail, bottom tray, and single CTA.
2. No numeric input field is rendered anywhere without a prior explicit user action (select → open drawer).
3. Every field/setting present in the current sidebar or in the Image 4 reference is still reachable in 2 clicks or fewer from the relevant selection.
4. No panel is permanently docked except the stage rail and the object tray.
5. Deselecting anything returns the screen to the Image 1 baseline state.

## Implementation Notes — 2026-07-03
Current branch progress:
- Build now includes the visible transform gadget layer expected by the reference direction: selected objects expose translate/rotate/scale mode controls and an on-canvas gizmo instead of relying only on hidden precision fields.
- Review uses a compact 3x2 grid for six-shot review so the full card set and bottom action bar remain visible at 1280x720.
- Export uses compact selected-shot rows so six shots and the export CTA remain visible without losing the selection workflow.
- Missing-media shot thumbnails use a theme-aware clay fallback instead of a broken icon-style placeholder.
- Shots workspace now uses a full-bleed viewport with overlay layers: a compact floating `ShotInfoCard` (~220px) anchored top-left within a reserved bottom safe area so `Camera settings` and `Open in 360` stay above the filmstrip/action dock at 1280x720, a dark translucent cinematic filmstrip tray with teal active outline and thumbnail-first controls, and a split bottom dock (compact white action group left, dominant teal Render Shot Preview CTA right).
- Shots framing uses a compact viewfinder marker (camera puck) instead of a full FOV/resolution pill over the viewport; lens/FOV/resolution remain in `ShotInfoCard` and the precision drawer.
- Build renders graybox 360 panos at 4096×2048 by default and exposes **Download Graybox 360** beside **Render 360 Reference** once a graybox exists, downloading the native 2:1 PNG.
- Export package summary now uses a composed horizontal layout: large folder/ZIP visual left, compact package-contents card right, with manifest preview and Export Settings subordinate below.
- Reference bottom chrome reserves a dedicated right CTA lane (`--reference-cta-lane`) so the landmark strip stays lower-left and never spans under Approve as Reference.
- Shots bottom chrome uses a compact overlay filmstrip separated from the command dock, with `--shots-overlay-bottom-safe` reserving space for the Render Shot Preview hint at 1280×720.
- Export package card owns its title/subtitle header and places Export Settings near the lower-left of the card.
- Build shows a compact “Drag arrows to move” guidance chip near the canvas center when an object is selected and the transform gizmo is visible.
- Shots primary CTA now reserves a fixed helper-text lane so the Render Shot Preview hint remains readable at the validated 1280×720 target.
- Review shot cards use a tighter thumbnail-first 3×2 layout with the footer actions kept visible below the grid.
- Export selected-shot rows use a quieter active state and a more compact package visual so the checklist and CTA read closer to the reference screen.
- The app shell now declares Continuity Stage favicon assets; browser console verification should stay free of favicon 404 noise.
- Shots fly camera no longer spawns per-frame `renderShotFrame` preview exports while movement is active; the live viewport keeps rendering and the floating card/filmstrip keep the last stable preview until Lock View.
- Shots fly camera movement is clamped to a navigable stage volume: floor footprint for lateral travel (inset by margin), vertical range from stage objects, and a forward cap before central front walls/arches so sustained WASD travel cannot pass behind the graybox set into blank space.
- Build object stamping and pano-origin placement are opt-in via explicit `SceneViewport` props from `BuildWorkspace` only; the Shots viewport never reads global build mode, so placement preview meshes and stamp clicks cannot leak into shot framing.

Remaining fidelity gaps:
- Filmstrip three-dot markers are decorative only; a dedicated per-shot overflow menu can be added if reference parity requires it.
- Default template media and real shot previews do not need to match the reference imagery, but live preview timing may still differ from the static reference shots.
- Very narrow viewports below 1280px may still wrap the bottom action dock; desktop 1280x720 is the validated target.
- Review still has more lower whitespace than the static reference once six compact cards are visible.
- Export package illustration proportions are closer but not yet an exact match to the reference folder/ZIP composition.
