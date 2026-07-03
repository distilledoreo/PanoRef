# Browser Smoke Coverage

Use the Codex Browser plugin for runtime smoke verification.

1. Launch the app with `npm run dev`.
2. Open the local URL printed by Vite. It usually starts at `http://localhost:3000`, but use the next free port if Vite reports one.
3. On a fresh project in **Build**, confirm no objective modal blocks the reference-style canvas by default. Open the brand menu, choose **Current Objective**, confirm the modal appears, and dismiss it with **Got it**.
4. In **Build**, confirm the primary tray shows the reference primitives and the **More** tool exposes Select, Origin, Snap, and extra primitives. Render **Render 360 Reference**. When the step is complete, confirm an advance modal appears with **Continue to Reference** and **Not right now**.
5. In **Reference**, import a styled pano or use the attached reference. Confirm the alignment guide modal appears, dismiss it with **Start checking**, then approve the reference or open **Reference Settings** to use yaw and graybox fade. Verify the advance modal offers **Continue to Shots** only after alignment is confirmed.
6. Open **Shots**, switch shots from the bottom filmstrip if more than one exists, and confirm the active shot updates the floating shot card and framing controls.
7. Use **Frame** or the shot menu to fly the camera, lock it in the viewport, and click **Accept Framing**. Verify an advance modal offers Review and reopening fly mode clears the accepted checkpoint.
8. In **Shots**, with the camera locked, set **Start** in **Camera Move MP4**, fly and lock a different view, set **End**, and export **MP4**. If the browser reports MP4 recording support, confirm the MP4 downloads and a video preview appears in the panel. If unsupported, confirm the panel clearly reports that MP4 export is unavailable instead of offering WebM.
9. In **Review**, export **AI Brief** and confirm the brief-sent checkpoint appears. Import an AI result frame and verify the review card or detail drawer updates, then confirm the advance modal offers Export.
10. In **Export**, confirm the manifest includes `inputs/viewport_clay_motion.mp4`, `inputs/camera_move/clay_start.png`, `inputs/camera_move/cubemap/pz.png`, `metadata/camera_keyframes.json`, `metadata/camera_move_reference_frames.json`, and `metadata/camera_move_cubemap_visibility.json` after a camera move has been exported and linked to a pano. Export with **Export Selected Shots** and confirm the export checkpoint completes for the selected shot.
11. At each workspace, confirm default visual density stays close to the references: stage rail, full-bleed surface, contextual cards only when relevant, primary CTA, and drawer-based advanced controls.
12. Repeat at a phone-sized viewport and confirm modals fit the screen, drawers scroll cleanly, and there is no horizontal overflow from the main canvas.
