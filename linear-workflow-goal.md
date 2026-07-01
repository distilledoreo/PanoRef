# Production Path, Shot Drawer, and Guided Sidebars

## Summary
- Build **Production Path** as the app’s linear guide: global progress rail, active objective card, selected-shot awareness, and persisted intent checkpoints.
- Add a bottom **Shot Drawer** from Shots onward so multi-shot work is visible and intuitive.
- Fully restructure workspace sidebars around step objectives so users can tell what to press, when to press it, and why it matters.
- Keep the app unlocked and non-patronizing: guidance leads, but does not trap.

## Key Changes
- Replace `Director Quest` with **Production Path**.
  - Steps: Build, Reference, Shots, Review, Export.
  - States: complete, current, ready, needs action, optional.
  - Guide actions navigate/focus only; real actions stay in the workspace.
- Add persisted workflow metadata to project JSON:
  - `grayboxApprovedForReferenceAt`
  - `shotFramingAcceptedAtByShotId`
  - `aiBriefSentAtByShotId`
  - `finalPackageExportedAtByShotId`
- Add contextual objective cards per workspace.
  - Each card says: current goal, why it matters, primary action, proceed signal.
  - Shots requires explicit **Accept Framing** after camera lock.
  - Reference can acknowledge graybox as the working reference if no styled canonical pano exists.
- Add bottom Shot Drawer on Shots, Review, and Export.
  - Peek by default.
  - Expanded cards show shot name, status, selected state, and workflow progress.
  - Selecting a shot updates the selected-shot Production Path.

## Sidebar Restructure
- Rebuild each sidebar around objective order instead of tool categories:
  - Top: **Do This Next** primary action panel.
  - Middle: **Check Your Work** readiness/warnings/proceed signal.
  - Bottom: **Adjust / Advanced** controls, collapsed when not immediately needed.
- Build sidebar:
  - Primary: place/edit set pieces, move origin, render graybox.
  - Checks: graybox exists, origin position, visible helpers note.
  - Advanced: shortcuts, precision drawer, object-level controls.
- Reference sidebar:
  - Primary: import/use reference or approve graybox as working reference.
  - Checks: canonical/graybox state, calibration readiness.
  - Advanced: pano list, yaw/opacity calibration, export formatting.
- Shots sidebar:
  - Primary: frame active shot, lock camera, accept framing.
  - Checks: linked pano, pano crop, landmark coverage, aspect match.
  - Advanced: camera inspector, export dimensions, landmark toggles.
- Review sidebar:
  - Primary: export AI Brief ZIP, mark brief sent, import AI result.
  - Checks: required inputs, imported result, approval state.
  - Advanced: prompt text and shot status controls.
- Export sidebar:
  - Primary: export final ZIP for the selected shot.
  - Checks: manifest readiness and missing artifacts.
  - Advanced: package include/exclude settings.

## Documentation
- Update `README.md` Workflow docs for Production Path, checkpoints, Shot Drawer, and guided sidebars.
- Update `tests/browser-smoke.md` to verify guide transitions, drawer behavior, and sidebar primary-action clarity.

## Test Plan
- Add workflow resolver tests:
  - fresh project starts at Build,
  - graybox render advances Reference guidance,
  - graybox-as-reference checkpoint works,
  - locked shot still requires Accept Framing,
  - accepted framing advances to Review,
  - AI brief sent and AI result import advance Export,
  - final package export completes selected shot.
- Add component/static render tests for Production Path, Shot Drawer, and representative guided sidebar panels.
- Run `npm run lint`, `npm run test`, and `npm run build`.

## Live Verification
- Launch with `npm run dev`.
- Verify the full user flow in-browser:
  - render graybox,
  - approve/use reference,
  - expand Shot Drawer and switch shots,
  - lock and accept framing,
  - export AI Brief ZIP,
  - import AI result,
  - export final ZIP.
- Verify sidebar behavior at each step: the primary action is obvious, checks explain blockers, and advanced controls do not dominate.
- Check mobile-width layout for no overlap or horizontal overflow.

## Assumptions
- Production Path guides the selected shot, not all shots at once.
- Sidebars are fully restructured, not merely decorated.
- Advanced controls remain available but are visually secondary.
- No strict gating, modal tutorial, backend, or AI API integration is added.
