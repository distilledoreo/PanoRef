# Continuity Stage

Continuity Stage is a local-first browser app for AI-video location continuity. It lets a creator build a simple graybox set, render a 360-degree equirectangular graybox panorama, connect that reference to shot cameras, and export AI-ready shot packages.

## Run Locally

Prerequisite: Node.js 22 or newer.

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:3000`. If that port is already occupied, Vite will print the next available local URL; use the URL shown in the terminal for browser verification.

## Workflow

The **Production Path** rail at the top tracks progress for the selected shot across Build → Reference → Shots → Review → Export. It guides without locking you in — every workspace remains available at any time.

Persisted workflow checkpoints are saved in project JSON under `workflow`:

- `grayboxApprovedForReferenceAt`
- `shotFramingAcceptedAtByShotId`
- `aiBriefSentAtByShotId`
- `finalPackageExportedAtByShotId`

1. **Build:** shape the graybox set in the canvas-first sandbox. The guided sidebar leads with **Render Graybox 360** once blocking and the pano origin look right. Advanced controls hold toybox layers, shortcuts, and the precision drawer.
2. **Reference:** import a styled canonical pano or **Approve Graybox as Working Reference** when you are iterating without a final AI pano yet. Calibrate yaw and opacity when a canonical pano overlays the graybox.
3. **Shots:** frame the active shot from the **Shot Drawer** (peek bar at the bottom). Fly the camera, lock it in the viewport, then explicitly **Accept Framing** before moving on. Pano crop and export-frame previews refresh from the locked camera.
4. **Review:** export the **AI Brief ZIP**, which marks the brief as sent, then import the external AI result frame. Use the drawer to switch shots without losing production-path context.
5. **Export:** download the final continuity ZIP for the selected shot. The manifest and warning checks live in **Check Your Work**; package include/exclude toggles stay under **Adjust / Advanced**.

Each workspace sidebar follows the same objective order:

- **Current Objective** — goal, why it matters, proceed signal
- **Do This Next** — primary action
- **Check Your Work** — readiness and warnings
- **Adjust / Advanced** — collapsed secondary controls

## Build Shortcuts

Primitive stamps use game-inventory style number slots: `1` Floor, `2` Wall, `3` Box, `4` Arch, `5` Doorway, `6` Column, `7` Stairs, `8` Tree, `9` Terrain, and `0` Person. Backdrop and Sun remain visible in the tray but are click-only helper primitives.

Build action shortcuts are `V` or `Esc` for Select, `O` for Origin, `G` for Snap, `D` for Duplicate, `R` / `Shift+R` for rotate right/left, `[` / `]` for scale down/up, `L` for lock, `H` for hide/show, `I` for the precision drawer, and `Delete` / `Backspace` for delete. Shortcuts are ignored while typing in editable fields.

## Project Format

Saved projects are JSON files using schema version `0.1`.

Top-level fields include:

- `scene`: primitive graybox objects and the pano origin.
- `panoRefs`: graybox, canonical, or external equirectangular references.
- Graybox 360 panos use standard equirectangular image orientation: up/sky at the top, down/floor at the bottom.
- Pano reference `rotation[1]` stores the calibrated yaw offset in degrees. A value of `0` means image center (`u=0.5`) faces world `+Z`; positive values rotate that image center toward world `+X`.
- `landmarks`: named continuity anchors used in prompts and review.
- `shots`: camera truth, status, linked pano, selected landmarks, prompt overrides, and export settings.
- `assets`: local data URLs for imported or rendered images.
- `workflow`: persisted production-path checkpoints for reference approval, accepted framing, AI brief handoff, and final export.

Legacy project files may still contain ignored `projectionStamp` fields on scene objects or `includeContinuityControlView` in shot export settings. Those values are dropped on load.

## Shot Package Format

An exported shot ZIP uses this shape:

```text
shot_001/
  inputs/
    viewport_clay.png
    pano_crop.png
    global_reference.png
    global_graybox.png
  outputs/
    ai_result_frame.png
  metadata/
    shot.json
    camera.json
    landmarks.json
    location.json
  prompts/
    image_gen_prompt.txt
    video_gen_prompt.txt
    negative_prompt.txt
  manifest.json
```

`inputs/viewport_clay.png` is the primary camera-locked AI control image. It renders the shot camera view from the graybox scene. Helper-only build objects such as the sun marker are omitted from this render and from `inputs/global_graybox.png`.

`inputs/global_reference.png` is included only when a canonical/global reference pano exists. It provides visual identity, lighting, material, and palette authority.

`inputs/global_graybox.png` is included only when a graybox pano exists. It provides full-location spatial context.

`inputs/pano_crop.png` is included only when the selected shot has a linked pano and crop settings. It is supporting local context from the linked pano origin and may not match the shot perspective when the shot camera is away from that pano origin.

`outputs/ai_result_frame.png` is included only after a result from an external AI image generator has been imported back into Review.

`manifest.json` lists only the files that will actually be written into the ZIP.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run goal:smoke
```

Runtime verification should also launch the app, import a canonical pano, render a graybox 360 pano, create the **Main Structure Wide Shot**, export an AI Brief ZIP, import an external AI result frame, export a shot package, and exercise at least one warning state such as exporting before a shot exists.
For the Build sandbox specifically, verify pressing `3` to stamp multiple Boxes, using `Esc` or `V` to return to Select, pressing `0` to stamp Person, confirming Backdrop and Sun are click-only, dragging the selected object in Select mode, toggling grid snap with `G`, moving the amber pano origin with `O`, using selected-piece shortcuts, confirming shortcuts do not fire while editing a name field, and checking that orbit center and click targets stay visually aligned with the cursor on high-DPI displays.

## Limitations

- MVP is local-first; there is no backend, account system, or AI API integration.
- Geometry editing is primitive-level only. There is no vertex editing, UV editing, shader graph, rigging, or timeline.
- Shot packages rely on `viewport_clay.png` for camera-locked layout control rather than projected pano textures on proxy geometry.
- Projection quality depends on pano alignment. If the canonical pano is yaw-shifted relative to the graybox pano, use the opacity compare view and set the reference yaw offset before exporting shot packages.
- Generated images/videos are imported manually in Review.
- Project assets are stored as data URLs inside the JSON project file, so large projects can become heavy.
