# Projection Assist

Projection Assist is the local-first workflow for correcting a styled panorama when its recognizable features do not line up with the matching graybox panorama. It records visual matches and applies the existing projection correction to the selected source panorama. It does not edit geometry or create a new image.

## Workflow

1. Render or import a graybox panorama with a valid image asset, then import a styled panorama with its own image asset.
2. Open **Reference → Precision → Projected Style**. The panel shows a separate local-fit card for each active projector.
3. Choose **Fix local mismatches** (or **Edit local fit**, **Repair local fit**, or **Review matches** when a fit already exists).
4. Select the matching graybox panorama. One valid graybox is selected automatically; multiple valid grayboxes require an explicit choice.
5. In the guided editor, click a corner, edge, or recognizable boundary in **Graybox**, then click the same feature in **Styled**. Add several matches around the visible area rather than relying on one point.
6. Review the match list. Matches can be disabled, removed, cleared, or undone. The editor permits one source panorama draft per session; switching sources after edits asks for confirmation and discards that source’s unsaved draft before loading the next source.
7. Choose **Preview on geometry** to inspect **Before** and **After** in the live scene viewport. Adjust **Local fit strength** from 0–100% if the correction should be softened.
8. Choose **Apply local fit** / **Use improved projection** to save the draft, or **Back to matches** / **Cancel** to leave the saved project unchanged.

The editor uses one shared viewing orientation for both panorama viewers. On narrow screens it automatically moves from Graybox to Styled after a target click and back to Graybox after a source click. Dragging navigates; a click selects a feature.

## Ownership and persistence

An alignment belongs to its source panorama ID and records its target graybox ID:

- `sourcePanoId` identifies the styled panorama being projected.
- `targetGrayboxPanoId` identifies the graybox used for the matches.
- `pairs` preserves match IDs, order, coordinates, and enabled state.
- `strength` stores the saved correction strength from 0 to 1.

Alignments are stored in `settings.projectedStyle.alignments`. They do not belong to the primary or secondary slot. Swapping slots, changing blend mode, removing a secondary slot, and adding it again leave the source panorama’s saved fit attached to that panorama.

Editor picks, undo, preview toggles, and preview strength changes are draft-local. Apply and Preview stay disabled while a target point is waiting for its styled counterpart or while every match is disabled. The project and Zustand state change only when Apply is confirmed. Removing a fit requires confirmation and removes only the selected source panorama’s entry.

## Statuses

- **No local fit**: the source has no enabled saved matches.
- **Ready**: the saved fit resolves and its enabled matches are usable.
- **Local fit needs attention**: the source asset, target graybox, target asset, or required metadata is missing or invalid. The saved entry remains available for repair but is not applied.
- **Some matches conflict**: enabled matches disagree strongly enough to warrant review. Conflict diagnostics identify the affected draft markers and are refreshed after the editor or alignment data changes; the saved data remains intact.

The target list contains only `graybox_render` panoramas with valid image assets. A styled panorama cannot silently become its own target.

## Where the correction is used

The same saved source-owned alignment is resolved by the live projected viewport and by projected shot rendering. It therefore carries through to:

- projected shot stills;
- projected camera-move reference frames;
- projected camera-move MP4 output; and
- projected files included in shot packages.

Changing strength updates the correction amount while reusing the cached correction field. It does not rebuild the field for every slider movement. A new match, changed target, or changed source requires a new Apply and can require a new field.

## Limits

Projection Assist is a world-space image correction. It does not reconstruct hidden surfaces, fix geometry, bake UVs, or provide true occlusion. Results are strongest near the source panorama’s captured origin and can stretch or duplicate around large translations and occlusions. The source and target must both remain valid equirectangular panorama references with image assets.

The optional 3D marker-and-line overlay is developer-only diagnostic tooling. The production editor uses the two panorama viewers and the live Before/After viewport instead.
