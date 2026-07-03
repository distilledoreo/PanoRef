import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workflow guidance UI', () => {
  it('uses modal guidance instead of a persistent production path rail', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('WorkflowGuidance');
    expect(app).toContain('ProjectMenuButton');
    expect(app).toContain('requestObjectiveModal');
    expect(app).not.toContain('ObjectiveHelpButton');
    expect(app).not.toContain('ProductionPath');
    expect(app).not.toContain('DirectorQuest');
  });

  it('uses progressive disclosure layouts with shot filmstrip and precision drawer', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../src/components/workspaces/WorkspaceShell.tsx', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    const shotThumbnail = readFileSync(new URL('../src/components/common/ShotThumbnail.tsx', import.meta.url), 'utf8');
    const shotInfoCard = readFileSync(new URL('../src/components/common/ShotInfoCard.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('ShotFilmstrip');
    expect(shots).toContain('ShotInfoCard');
    expect(shots).toContain('ShotThumbnail');
    expect(shotInfoCard).toContain('Open in 360');
    expect(shots).toContain('PrecisionDrawer');
    expect(shots).not.toContain('tone="success"');
    expect(shots).toContain('PrimaryCTA');
    expect(shots).toContain('Accept Framing');
    expect(shots).toContain('Camera Move MP4');
    expect(shots).toContain('Export MP4');
    expect(build).toContain('FullBleedLayout');
    expect(build).toContain('PrecisionDrawer');
    expect(build).toContain('primaryTrayItems');
    expect(build).toContain('overflowTrayItems');
    expect(build).toContain('Render 360 Reference');
    expect(exportWorkspace).toContain('Camera move cubemap references');
    expect(exportWorkspace).toContain('Export Settings');
    expect(exportWorkspace).toContain('aria-label={`Export Shot');
    expect(review).toContain('ShotThumbnail');
    expect(review).toContain('lg:grid-cols-3');
    expect(shotThumbnail).toContain('resolveShotThumbnail');
    expect(shell).toContain('FullBleedLayout');
    expect(shell).not.toContain('ShotDrawer');
    expect(shell).not.toContain('WorkspaceWithDrawer');
  });

  it('keeps revamp surfaces tokenized and theme-aware', () => {
    const fields = readFileSync(new URL('../src/components/common/Field.tsx', import.meta.url), 'utf8');
    const sceneViewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    const sceneObjects = readFileSync(new URL('../src/engine/sceneObjects.ts', import.meta.url), 'utf8');

    expect(fields).toContain('bg-surface-raised');
    expect(fields).not.toContain('bg-white');
    expect(sceneViewport).toContain('useThemeStore');
    expect(sceneViewport).toContain('theme');
    expect(sceneObjects).toContain('SceneVisualTheme');
    expect(sceneObjects).toContain('darkFloorMaterial');
  });
});
