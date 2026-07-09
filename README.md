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

After the intro splash, pick a mode: **Build continuity packages** (full pipeline) or **Just view a 360 pano** (import, look around, **Download current view**). Switch anytime from the brand menu. Preference is stored in `localStorage` as `panoref-app-mode`.

In Continuity Stage mode, the top stage rail tracks progress across Build → Reference → Shots → Export. It guides without locking you in — every workspace remains available at any time. Continuity Stage is a **handoff tool**: it produces control frames, camera truth, and packages for external AI and pipeline tools — not the archive for final generated stills.

Open an existing project with the folder button in the top-right header, or use the compact brand menu for Open Project, Save Project, Package Export, and the current objective. Project import accepts saved Continuity Stage `.json` files and reports a clear error if the selected file is not a supported project.

Persisted workflow checkpoints are saved in project JSON under `workflow`:

- `grayboxApprovedForReferenceAt`
- `shotFramingAcceptedAtByShotId`
- `finalPackageExportedAtByShotId`
- `aiBriefSentAtByShotId` (legacy; no longer required by the production path)

1. **Build:** shape the graybox set in the full-bleed sandbox. The bottom object tray shows the primary primitives (with hotkey badges), the compact **More** tool opens select/origin/snap, extra primitives, and a shortcut cheatsheet, and **Render 360 Reference** captures a 4096×2048 graybox 360 when blocking and pano origin look right. After a graybox exists, **Download Graybox 360** becomes the primary action (native 2:1 equirectangular PNG); use **Re-render after scene changes** only when the set or origin changed. Selected objects support solid colors or a 1m×1m face-aligned checkerboard surface in Precision. In Select mode, the selected object shows an in-canvas transform gizmo with teal/red/blue move arrows plus rotate and scale controls in the floating object card; drag arrows for axis moves or drag the object body for floor-plane moves. Camera frustums and passive 3D landmark markers stay hidden by default — use the small eye toggle in the top-right to show scene guides when needed. Pano origin placement (`O`) still reveals the origin marker while guides are hidden.
2. **Reference:** import a styled canonical pano or approve the graybox when iterating without a final AI pano yet. When alignment is needed, yaw and graybox-fade sliders appear on the viewer chrome; full alignment controls stay in the precision drawer.
3. **Shots:** select an active shot from the bottom filmstrip. Thumbnails use real project media when it exists. Unlanded shots enter **Fly Camera** so you can reposition immediately; **Land this shot** saves the camera and marks framing ready. Fly Camera keeps a broad invisible safety volume around the set: visible scene objects define the travel area, then the camera can move 10m beyond the farthest object on each horizontal side. FOV and resolution stay in the floating shot card and precision drawer. Dock **PNG** downloads a clay still of the current view. After landing, fork to the next shot, add a camera move (start from the landed still, fly the end, export MP4), or go to Export.
4. **Export:** multi-select shots and download continuity ZIP handoff packages with **Export Selected Shots**. Packages carry clay control frames, pano/cubemap references, camera metadata, and prompts for external tools. You do **not** need to import AI results back into Continuity Stage. Package include/exclude toggles stay in **Export Settings**.

## Build Shortcuts

Primitive stamps use game-inventory style number slots: `1` Floor, `2` Wall, `3` Box, `4` Arch, `5` Doorway, `6` Column, `7` Stairs, `8` Tree, `9` Terrain, and `0` Person. Backdrop, Sun, Arch, Terrain, and Person are also reachable from the tray's **More** tool when they are not part of the primary visible strip.

Build action shortcuts are `V` or `Esc` for Select, `O` for Origin, `G` for Snap, `D` for Duplicate, `R` / `Shift+R` for rotate right/left, `[` / `]` for scale down/up, `L` for lock, `H` for hide/show, `I` for the precision drawer, and `Delete` / `Backspace` for delete. Shortcuts are ignored while typing in editable fields.

## Project Format

Saved projects are JSON files using schema version `0.1`.

Use the top-right **Open project** / **Save project** header buttons, or the brand menu (Open / Save / Package Export). Rename the project from the brand menu name field.

Top-level fields include:

- `scene`: primitive graybox objects and the pano origin.
- `panoRefs`: graybox, canonical, or external equirectangular references.
- Graybox 360 panos use standard equirectangular image orientation: up/sky at the top, down/floor at the bottom.
- Pano reference `rotation[1]` stores the calibrated yaw offset in degrees. A value of `0` means image center (`u=0.5`) faces world `+Z`; positive values rotate that image center toward world `+X`.
- `landmarks`: named continuity anchors used in prompts and packages.
- `shots`: camera truth, status, linked pano, selected landmarks, prompt overrides, and export settings.
- `assets`: local data URLs for imported or rendered images.
- `workflow`: persisted production-path checkpoints for reference approval, landed framing, and package export.

Legacy project files may still contain ignored `projectionStamp` fields on scene objects or `includeContinuityControlView` in shot export settings. Those values are dropped on load.

## Shot Package Format

An exported shot ZIP uses this shape:

```text
shot_001/
  inputs/
    viewport_clay.png
    viewport_clay_motion.mp4
    cubemap/
      px.png
      nx.png
      py.png
      ny.png
      pz.png
      nz.png
      cubemap_stitched.png
    camera_move/
      clay_start.png
      clay_mid.png
      clay_end.png
    pano_crop.png
    global_reference.png
    global_graybox.png
  outputs/
    ai_result_frame.png
  metadata/
    shot.json
    camera.json
    camera_keyframes.json
    camera_move_reference_frames.json
    landmarks.json
    location.json
  prompts/
    image_gen_prompt.txt
    video_gen_prompt.txt
    negative_prompt.txt
  manifest.json
```

`inputs/viewport_clay.png` is the primary camera-locked AI control image. It renders the shot camera view from the graybox scene. Helper-only build objects such as the sun marker are omitted from this render and from `inputs/global_graybox.png`.

`inputs/viewport_clay_motion.mp4` is included only after a shot camera move has been exported. It records the graybox scene from the shot's start/end camera keyframes as a 16:9 MP4, using browser MP4 recording support when available. `metadata/camera_keyframes.json` stores the captured keyframes when keyframes exist.

`inputs/cubemap/` is included whenever a full styled/linked pano is exported (`includeFullPano`). Face PNGs (`px`…`nz`) and `cubemap_stitched.png` provide an undistorted environment reference alongside the equirectangular `global_reference.png`.

`inputs/camera_move/` is included when camera keyframes exist and camera-move clay frames are enabled. `clay_start.png`, `clay_mid.png`, and `clay_end.png` are graybox control frames sampled from the shot move. `metadata/camera_move_reference_frames.json` records the sampled frame times and cameras.

`inputs/global_reference.png` is included only when a canonical/global reference pano exists. It provides visual identity, lighting, material, and palette authority.

`inputs/global_graybox.png` is included only when a graybox pano exists. It provides full-location spatial context.

`inputs/pano_crop.png` is included only when the selected shot has a linked pano and crop settings. It is supporting local context from the linked pano origin and may not match the shot perspective when the shot camera is away from that pano origin.

`outputs/ai_result_frame.png` is included only when an older project already has an AI result asset attached (optional; not part of the normal handoff path).

`manifest.json` lists only the files that will actually be written into the ZIP.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run goal:smoke
```

Runtime verification should also launch the app, render a graybox 360 pano with **Render 360 Reference**, import a canonical pano, approve reference alignment, land a shot, confirm the filmstrip/Export thumbnails use real available media, export selected shot packages without importing any AI result, and exercise at least one warning state such as exporting before a shot exists.
For project import specifically, verify the top-right folder button opens a saved Continuity Stage JSON file, shows a project-opened status, updates the project name in the brand menu, and shows an error status for invalid JSON or unsupported schema files.
For camera-move MP4 export, verify a shot can capture Start and End keyframes from landed views, export a playable MP4 when the browser reports MP4 support, preview the saved clip in Shots, and include `inputs/viewport_clay_motion.mp4`, `inputs/camera_move/clay_start.png`, `inputs/cubemap/pz.png`, `inputs/cubemap/cubemap_stitched.png`, `metadata/camera_keyframes.json`, and `metadata/camera_move_reference_frames.json` in the final ZIP manifest (no `cubemap_visible` paths).
For the Build sandbox specifically, verify pressing `3` to stamp multiple Boxes, using `Esc` or `V` to return to Select, pressing `0` to stamp Person, confirming Backdrop and Sun are click-only, dragging the selected object in Select mode, dragging the visible transform gizmo arrows for axis moves, using the rotate/scale controls in the selected-object card, toggling grid snap with `G`, moving the amber pano origin with `O`, confirming camera frustums stay hidden until the scene-guides eye toggle is enabled, using selected-piece shortcuts, confirming shortcuts do not fire while editing a name field, and checking that orbit center and click targets stay visually aligned with the cursor on high-DPI displays.
For Fly Camera specifically, verify sustained movement can travel beyond walls and floors without leaving a reasonable set-adjacent volume; the expected horizontal limit is 10m past the farthest visible non-helper object.

## Limitations

- MVP is local-first; there is no backend, account system, or AI API integration.
- Geometry editing is primitive-level only. There is no vertex editing, UV editing, shader graph, rigging, or timeline.
- Shot packages rely on `viewport_clay.png` for camera-locked layout control rather than projected pano textures on proxy geometry.
- Projection quality depends on pano alignment. If the canonical pano is yaw-shifted relative to the graybox pano, use the opacity compare view and set the reference yaw offset before exporting shot packages.
- Final/generated AI images and videos live outside Continuity Stage; the in-app MP4 export is a graybox camera-motion control clip, not final AI video generation.
- Project assets are stored as data URLs inside the JSON project file, so large projects can become heavy.
