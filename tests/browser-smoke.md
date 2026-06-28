# Browser Smoke Coverage

Use the Codex Browser plugin for runtime smoke verification.

1. Launch the app with `npm run dev`.
2. Open `http://localhost:3000`.
3. In **Build**, add at least one primitive and select it.
4. Render **Graybox 360**, then confirm **Download Graybox PNG** is enabled and downloads the standalone equirectangular PNG.
5. In **Reference**, verify the graybox pano appears in the pano viewer.
6. In **Shots**, click **Main Structure Wide Shot** and confirm the central structure shot appears with landmarks selected.
7. In **Review**, click **Export AI Brief ZIP** and confirm the package downloads with viewport clay, pano crop, global reference, prompts, and metadata for an external image generator.
8. Import an externally generated result frame, confirm the **AI Result Frame** pane updates, then in **Export**, export the selected shot package.
9. Exercise a warning path by creating a fresh project or shot with no selected critical landmarks and confirming the warning is visible.
