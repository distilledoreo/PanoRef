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

The top stage rail tracks progress across Build → Reference → Shots → Review → Export. It guides without locking you in — every workspace remains available at any time. Project actions and the current objective live in the compact brand menu so the canvas stays visually close to the reference mocks.

Persisted workflow checkpoints are saved in project JSON under `workflow`:

- `grayboxApprovedForReferenceAt`
- `shotFramingAcceptedAtByShotId`
- `aiBriefSentAtByShotId`
- `finalPackageExportedAtByShotId`

1. **Build:** shape the graybox set in the full-bleed sandbox. The bottom object tray shows the primary primitives, the compact **More** tool opens select/origin/snap and extra primitives, and **Render 360 Reference** captures the graybox pano when blocking and pano origin look right.
2. **Reference:** import a styled canonical pano or approve the graybox when iterating without a final AI pano yet. Import and alignment controls appear as contextual cards or in the precision drawer instead of a permanent sidebar.
3. **Shots:** select an active shot from the bottom filmstrip. The shot opens in a composed/locked state; use **Frame** or the shot menu to fly the camera, lock it in the viewport, then explicitly **Accept Framing** before moving on. For camera moves, lock a start view, set **Start**, fly and lock an end view, set **End**, then export an MP4 when the browser supports MP4 recording.
4. **Review:** export the **AI Brief**, which marks the brief as sent, then import the external AI result frame. Compare, notes, prompts, and result details live in the drawer.
5. **Export:** choose shots and download the final continuity ZIP packages with **Export Selected Shots**. Package include/exclude toggles stay in **Export Settings**.

## Build Shortcuts

Primitive stamps use game-inventory style number slots: `1` Floor, `2` Wall, `3` Box, `4` Arch, `5` Doorway, `6` Column, `7` Stairs, `8` Tree, `9` Terrain, and `0` Person. Backdrop, Sun, Arch, Terrain, and Person are also reachable from the tray's **More** tool when they are not part of the primary visible strip.

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
    viewport_clay_motion.mp4
    camera_move/
      clay_start.png
      clay_mid.png
      clay_end.png
      cubemap/
        px.png
        nx.png
        py.png
        ny.png
        pz.png
        nz.png
        cubemap_stitched.png
      cubemap_visible/
        start_stitched.png
        mid_stitched.png
        end_stitched.png
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
    camera_move_cubemap_visibility.json
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

`inputs/camera_move/` is included when camera keyframes exist and camera-move cubemap references are enabled. `clay_start.png`, `clay_mid.png`, and `clay_end.png` are graybox control frames sampled from the shot move. `cubemap/px.png`, `nx.png`, `py.png`, `ny.png`, `pz.png`, and `nz.png` are the full linked pano converted into an aligned cubemap, which avoids passing equirectangular distortion into video-to-video references. `cubemap/cubemap_stitched.png` is a single 3×2 grid image combining all six faces with labels for convenient reference. `cubemap_visible/` contains per-frame stitched strips for the graybox surfaces that the moving 16:9 shot camera can actually see. Each frame gets a single `{frameId}_stitched.png` that combines the relevant visible face crops horizontally with face labels; those crops are computed by sampling the shot-camera frustum, raycasting into the graybox scene, projecting each hit from the linked pano origin into cubemap UV space, and padding the resulting face bounds. `metadata/camera_move_reference_frames.json` records the sampled frame times and cameras. `metadata/camera_move_cubemap_visibility.json` records the sampled face bounds, crop rectangles, and crop paths.

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

Runtime verification should also launch the app, render a graybox 360 pano with **Render 360 Reference**, import a canonical pano, approve reference alignment, frame and accept a shot, export an **AI Brief**, import an external AI result frame, export selected shot packages, and exercise at least one warning state such as exporting before a shot exists.
For camera-move MP4 export, verify a shot can capture Start and End keyframes from locked camera views, export a playable MP4 when the browser reports MP4 support, preview the saved clip in Shots, and include `inputs/viewport_clay_motion.mp4`, `inputs/camera_move/clay_start.png`, `inputs/camera_move/cubemap/pz.png`, `inputs/camera_move/cubemap/cubemap_stitched.png`, `metadata/camera_keyframes.json`, `metadata/camera_move_reference_frames.json`, and `metadata/camera_move_cubemap_visibility.json` in the final ZIP manifest.
For the Build sandbox specifically, verify pressing `3` to stamp multiple Boxes, using `Esc` or `V` to return to Select, pressing `0` to stamp Person, confirming Backdrop and Sun are click-only, dragging the selected object in Select mode, toggling grid snap with `G`, moving the amber pano origin with `O`, using selected-piece shortcuts, confirming shortcuts do not fire while editing a name field, and checking that orbit center and click targets stay visually aligned with the cursor on high-DPI displays.

## Limitations

- MVP is local-first; there is no backend, account system, or AI API integration.
- Geometry editing is primitive-level only. There is no vertex editing, UV editing, shader graph, rigging, or timeline.
- Shot packages rely on `viewport_clay.png` for camera-locked layout control rather than projected pano textures on proxy geometry.
- Projection quality depends on pano alignment. If the canonical pano is yaw-shifted relative to the graybox pano, use the opacity compare view and set the reference yaw offset before exporting shot packages.
- Final/generated AI images and videos are imported manually in Review; the in-app MP4 export is a graybox camera-motion control clip, not final AI video generation.
- Project assets are stored as data URLs inside the JSON project file, so large projects can become heavy.
