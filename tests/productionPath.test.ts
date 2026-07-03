import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workflow guidance UI', () => {
  it('uses modal guidance instead of a persistent production path rail', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('WorkflowGuidance');
    expect(app).toContain('ObjectiveHelpButton');
    expect(app).not.toContain('ProductionPath');
    expect(app).not.toContain('DirectorQuest');
  });

  it('renders tool sidebars with shot selector instead of guided clutter', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../src/components/workspaces/WorkspaceShell.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('WorkspaceSidebar');
    expect(shots).toContain('ShotSelector');
    expect(shots).toContain('Accept Framing');
    expect(shots).toContain('Camera Move MP4');
    expect(shots).toContain('Export MP4');
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('Camera move cubemap references');
    expect(shell).not.toContain('ShotDrawer');
    expect(shell).not.toContain('WorkspaceWithDrawer');
  });
});
