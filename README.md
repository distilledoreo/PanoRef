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

1. **Build:** use the canvas-first sandbox to shape the graybox set. Pick a primitive from the top toybox tray or press its number key to enter **Stamp Mode**, then click the floor to place as many copies as needed. Press `Esc` or `V` to return to **Select** mode, click an existing piece to select it, and drag a selected piece across the floor plane. The quickbar handles rename, duplicate, rotate, scale, lock, visibility, delete, and the precision drawer. Grid snap can be toggled from the tray or with `G`. The amber origin beacon can be dragged directly or moved with **Origin** mode; it marks where the global 360 reference will be captured. The backdrop card and sun marker are click-only helper tools; the sun marker is omitted from AI-facing exports.
2. **Build Export:** click **Render** from the Build side rail or **Render Graybox 360** from Reference to create a full equirectangular graybox panorama without viewport helpers. Use **Download Graybox PNG** to save that standalone 360 image, or keep it in the project as a `graybox_render` pano reference.
3. **Reference:** use the preview-first panorama bench to import a canonical AI-finalized panorama, load the attached reference, or use the graybox panorama as the current reference.
   Use **Calibrate to Graybox** on a canonical pano to overlay it against the latest graybox pano. The opacity slider fades the canonical pano over the graybox. Set the yaw offset when the AI-finalized 360 image is rotated relative to the graybox render. The calibrated yaw is used by the viewer and pano crop export.
4. **Shots:** use the split preview workspace to frame shots from the scene, presets, or active pano view. Click **Main Structure Wide Shot** for the guided hero shot. New shots start with prompt-critical landmarks selected so exports preserve continuity anchors; remove a landmark only when it is intentionally out of scope for that shot. Each shot stores camera position, target, FOV, linked pano, selected landmarks, warnings, and export settings.
5. **Review:** use the comparison bench to export an **AI Brief ZIP** for an external image generator, then import the generated result frame for approval. The app creates control/reference inputs; it does not procedurally fake the final styled frame.
6. **Export:** use the packaging desk to download a ZIP package with viewport clay render, optional pano crop, optional global reference, optional graybox pano, prompts, metadata, and any imported AI result frame.

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
For the Build sandbox specifically, verify pressing `3` to stamp multiple Boxes, using `Esc` or `V` to return to Select, pressing `0` to stamp Person, confirming Backdrop and Sun are click-only, dragging the selected object in Select mode, toggling grid snap with `G`, moving the amber pano origin with `O`, using selected-piece shortcuts, and confirming shortcuts do not fire while editing a name field.

## Limitations

- MVP is local-first; there is no backend, account system, or AI API integration.
- Geometry editing is primitive-level only. There is no vertex editing, UV editing, shader graph, rigging, or timeline.
- Shot packages rely on `viewport_clay.png` for camera-locked layout control rather than projected pano textures on proxy geometry.
- Projection quality depends on pano alignment. If the canonical pano is yaw-shifted relative to the graybox pano, use the opacity compare view and set the reference yaw offset before exporting shot packages.
- Generated images/videos are imported manually in Review.
- Project assets are stored as data URLs inside the JSON project file, so large projects can become heavy.
