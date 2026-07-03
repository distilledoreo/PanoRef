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

Remaining fidelity gaps:
- The Export package summary is functionally compact but still reads as a large sparse panel; the reference uses a tighter composed package card with stronger visual hierarchy.
- The Shots workspace still needs a closer pass on the floating shot-info card and filmstrip rhythm shown in the reference.
- The default template media does not need to match the reference, but UI chrome, density, and action placement should continue moving toward the supplied light/dark images.
