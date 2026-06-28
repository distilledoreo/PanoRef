# Continuity Stage

Continuity Stage is a local-first browser app for AI-video location continuity. It lets a creator build a simple graybox set, render a 360-degree equirectangular graybox panorama, connect that reference to shot cameras, and export AI-ready shot packages.

## Run Locally

Prerequisite: Node.js 22 or newer.

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:3000`.

## Workflow

1. **Build:** add primitive floors, walls, arches, columns, terrain masses, human dummies, and a sun marker. Set the pano origin where the global 360 reference should be captured. The sun marker is a build helper and is omitted from AI-facing exports.
2. **Build Export:** click **Render Graybox 360** to create a full equirectangular graybox panorama without viewport helpers. Use **Download Graybox PNG** to save that standalone 360 image, or keep it in the project as a `graybox_render` pano reference.
3. **Reference:** import a canonical AI-finalized panorama, or use the graybox panorama as the current reference.
   Use **Calibrate to Graybox** on a canonical pano to overlay it against the latest graybox pano. The opacity slider fades the canonical pano over the graybox; separate pano and graybox FOV sliders render each overlay layer with its own comparison FOV. Set the yaw offset when the AI-finalized 360 image is rotated relative to the graybox render. The calibrated yaw is used by the viewer, pano crop export, and continuity control projection.
   Use **Object Stamps** to select one visible architecture/environment object and stamp the current pano alignment onto that object only. When stamped objects exist for the linked pano, the continuity control view textures only those stamped objects and leaves unstamped architecture clay.
4. **Shots:** click **Main Structure Wide Shot** for the guided hero shot, or create shots from camera presets / pano view. New shots start with prompt-critical landmarks selected so exports preserve continuity anchors; remove a landmark only when it is intentionally out of scope for that shot. Each shot stores camera position, target, FOV, linked pano, selected landmarks, warnings, and export settings.
5. **Review:** export an **AI Brief ZIP** for an external image generator, then import the generated result frame for approval. The app creates control/reference inputs; it does not procedurally fake the final styled frame.
6. **Export:** download a ZIP package with a continuity control view, viewport clay render, pano crop, global pano, graybox pano when available, prompts, metadata, and any imported AI result frame.

## Project Format

Saved projects are JSON files using schema version `0.1`.

Top-level fields include:

- `scene`: primitive graybox objects and the pano origin.
- `panoRefs`: graybox, canonical, or external equirectangular references.
- Graybox 360 panos use standard equirectangular image orientation: up/sky at the top, down/floor at the bottom.
- Pano reference `rotation[1]` stores the calibrated yaw offset in degrees. A value of `0` means image center (`u=0.5`) faces world `+Z`; positive values rotate that image center toward world `+X`.
- The Reference workspace pano/graybox FOV sliders are preview-only overlay controls, not saved pano metadata. They are meant for visual diagnosis when comparing two pano layers with different apparent optics.
- Scene objects can store an optional `projectionStamp` that captures the current pano id, yaw/pitch, graybox comparison FOV, pano comparison FOV, opacity, and timestamp for object-level stamped projection.
- `landmarks`: named continuity anchors used in prompts and review.
- `shots`: camera truth, status, linked pano, selected landmarks, prompt overrides, and export settings.
- `assets`: local data URLs for imported or rendered images.

## Shot Package Format

An exported shot ZIP uses this shape:

```text
shot_001/
  inputs/
    viewport_clay.png
    continuity_control_view.png
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

`inputs/continuity_control_view.png` is the preferred camera-locked AI control image. It renders the shot camera view while projecting the linked 360 pano onto reliable architecture/environment geometry. Backfaces, occluded regions, grazing-angle surfaces, helpers, and unknown texture areas remain neutral gray; gray means "structure placeholder," not final material design. `inputs/viewport_clay.png` remains the exact clay composition fallback. Helper-only build objects such as the sun marker are omitted from these AI-facing renders and from `inputs/global_graybox.png`. `inputs/pano_crop.png` is a panorama-derived local reference from the linked pano origin, so it may not match the shot perspective when the shot camera is away from that pano origin. `inputs/global_reference.png` remains the visual richness, material, lighting, and environment identity authority. `outputs/ai_result_frame.png` is included only after a result from an external AI image generator has been imported back into Review.

## Verification

```bash
npm run lint
npm run test
npm run build
```

Runtime verification should also launch the app, import a canonical pano, render a graybox 360 pano, create the **Main Structure Wide Shot**, export an AI Brief ZIP, import an external AI result frame, export a shot package, and exercise at least one warning state such as exporting before a shot exists.

## Limitations

- MVP is local-first; there is no backend, account system, or AI API integration.
- Geometry editing is primitive-level only. There is no vertex editing, UV editing, shader graph, rigging, or timeline.
- The continuity control view projects one linked 360 pano onto proxy geometry only where that projection is reliable; it leaves unknown regions gray rather than guessing hidden texture.
- Object-level stamps override global projection for that linked pano: stamped objects receive their stored projection, while unstamped architecture/environment geometry remains clay.
- Projection quality depends on pano alignment. If the canonical pano is yaw-shifted relative to the graybox pano, use the opacity compare view and set the reference yaw offset before exporting shot packages.
- The Reference workspace FOV overlay sliders do not correct non-equirectangular distortion inside an AI-generated pano and do not affect shot exports; they only help diagnose whether the canonical pano and graybox pano line up under different apparent FOVs.
- Generated images/videos are imported manually in Review.
- Project assets are stored as data URLs inside the JSON project file, so large projects can become heavy.
