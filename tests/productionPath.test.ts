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
    expect(shots).toContain('ShotFilmstrip');
    expect(shots).toContain('PrecisionDrawer');
    expect(shots).toContain('Accept Framing');
    expect(shots).toContain('Camera Move MP4');
    expect(shots).toContain('Export MP4');
    expect(build).toContain('FullBleedLayout');
    expect(build).toContain('PrecisionDrawer');
    expect(build).toContain('primaryTrayItems');
    expect(build).toContain('overflowTrayItems');
    expect(build).toContain('Render 360 Reference');
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('Camera move cubemap references');
    expect(exportWorkspace).toContain('Export Settings');
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
    expect(sceneViewport).toContain("theme === 'dark'");
    expect(sceneObjects).toContain('SceneVisualTheme');
    expect(sceneObjects).toContain('darkFloorMaterial');
  });
});
