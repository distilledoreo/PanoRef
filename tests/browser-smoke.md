# Browser Smoke Coverage

Use the Codex Browser plugin for runtime smoke verification.

1. Launch the app with `npm run dev`.
2. Open the local URL printed by Vite. It usually starts at `http://localhost:3000`, but use the next free port if Vite reports one.
3. Confirm the top **Production Path** rail shows Build → Reference → Shots → Review → Export for **Camera 001**, with Build marked current or needs action on a fresh project.
4. In **Build**, verify the sidebar order is **Current Objective**, **Do This Next**, **Check Your Work**, then collapsed **Adjust / Advanced**. Render **Graybox 360** from Do This Next.
5. In **Reference**, confirm **Approve Graybox as Working Reference** appears when no styled canonical pano exists. Approve it and verify Production Path advances Reference guidance.
6. Open **Shots**, expand the bottom **Shot Drawer**, switch between shots if more than one exists, and confirm the selected shot name updates in Production Path.
7. Fly the camera, lock it in the viewport, and click **Accept Framing**. Verify the Shots step can proceed to Review and reopening fly mode clears the accepted checkpoint.
8. In **Review**, export **AI Brief ZIP** and confirm the brief-sent checkpoint appears. Import an AI result frame and verify the comparison panes update.
9. In **Export**, export the final ZIP from **Do This Next** and confirm Production Path marks the export checkpoint complete for the selected shot.
10. At each workspace, confirm the primary action is visually dominant and advanced controls stay collapsed until opened.
11. Repeat at a phone-sized viewport and confirm Production Path scrolls horizontally, the shot drawer does not overlap the main canvas, and there is no horizontal overflow from the sidebar.