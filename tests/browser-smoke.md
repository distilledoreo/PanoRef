# Browser Smoke Coverage

Use the Codex Browser plugin for runtime smoke verification.

1. Launch the app with `npm run dev`.
2. Open the local URL printed by Vite. It usually starts at `http://localhost:3000`, but use the next free port if Vite reports one.
3. In **Build**, press `3` to arm Box Stamp Mode, verify the mode badge reads **Stamping Box**, click the floor twice, and confirm the tool stays armed after each placement.
4. Press `Esc` or `V` to return to **Select**, select and drag a placed object, then press `0` to arm Person. Confirm Backdrop and Sun remain visible in the toybox but have no number shortcut badge.
5. Toggle snap with `G`, enter Origin mode with `O`, drag the amber pano-origin beacon or click the floor to move it, then return to Select.
6. With an object selected, use Build shortcuts to duplicate (`D`), rotate (`R` / `Shift+R`), scale (`[` / `]`), lock/unlock (`L`), hide/show (`H`), open the precision drawer (`I`), and delete (`Delete` or `Backspace`).
7. Edit the selected object name and confirm primitive/action shortcuts do not fire while the text field is focused.
8. Render **Graybox 360**, then confirm **Download Graybox PNG** is enabled and downloads the standalone equirectangular PNG.
9. In **Reference**, verify the graybox pano appears in the pano viewer and the calibration controls remain available for a canonical pano.
10. In **Shots**, click **Main Structure Wide Shot** and confirm the central structure shot appears with landmarks selected.
11. In **Review**, click **Export AI Brief ZIP** and confirm the package downloads with viewport clay, pano crop, global reference, prompts, and metadata for an external image generator.
12. Import an externally generated result frame, confirm the **AI Result Frame** pane updates, then in **Export**, export the selected shot package.
13. Exercise a warning path by creating a fresh project or shot with no selected critical landmarks and confirming the warning is visible.
14. Repeat a visual smoke check at a phone-sized viewport and confirm there is no fixed 360px sidebar causing horizontal overflow.
