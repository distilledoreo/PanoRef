# Browser Smoke Coverage

Use the Codex Browser plugin for runtime smoke verification.

1. Launch the app with `npm run dev`.
2. Open the local URL printed by Vite. It usually starts at `http://localhost:3000`, but use the next free port if Vite reports one.
3. On a fresh project in **Build**, confirm a **Current Objective** modal appears once. Dismiss it with **Got it**, then reopen it from the header **Objective** button.
4. In **Build**, render **Graybox 360** from the sidebar. When the step is complete, confirm an advance modal appears with **Continue to Reference** and **Not right now**. Choose **Not right now** and confirm you stay in Build without the modal immediately reappearing.
5. In **Reference**, confirm the initial objective modal includes the graybox styling prompt builder. Import a styled pano, confirm the alignment guide modal appears, use yaw and graybox fade in the sidebar, then click **Looks good enough**. If alignment is still poor, open retry tips and confirm generation advice appears. Verify the advance modal offers **Continue to Shots** only after alignment is confirmed.
6. Open **Shots**, switch shots from the sidebar **Shots** panel if more than one exists, and confirm the active shot updates framing controls.
7. Fly the camera, lock it in the viewport, and click **Accept Framing**. Verify an advance modal offers Review and reopening fly mode clears the accepted checkpoint.
8. In **Shots**, with the camera locked, set **Start** in **Camera Move MP4**, fly and lock a different view, set **End**, and export **MP4**. If the browser reports MP4 recording support, confirm the MP4 downloads and a video preview appears in the panel. If unsupported, confirm the panel clearly reports that MP4 export is unavailable instead of offering WebM.
9. In **Review**, export **AI Brief ZIP** and confirm the brief-sent checkpoint appears. Import an AI result frame and verify the comparison panes update, then confirm the advance modal offers Export.
10. In **Export**, confirm the manifest includes `inputs/viewport_clay_motion.mp4`, `inputs/camera_move/clay_start.png`, `inputs/camera_move/cubemap/pz.png`, `metadata/camera_keyframes.json`, `metadata/camera_move_reference_frames.json`, and `metadata/camera_move_cubemap_visibility.json` after a camera move has been exported and linked to a pano. Export the final ZIP from the sidebar and confirm the export checkpoint completes for the selected shot.
11. At each workspace, confirm the sidebar stays tool-focused (actions, status, collapsed more options) and guidance appears in modals instead of persistent cards.
12. Repeat at a phone-sized viewport and confirm modals fit the screen, sidebars scroll cleanly, and there is no horizontal overflow from the main canvas.
