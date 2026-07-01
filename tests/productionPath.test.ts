import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production path UI', () => {
  it('replaces Director Quest with Production Path in the app shell', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('ProductionPath');
    expect(app).not.toContain('DirectorQuest');
  });

  it('renders guided sidebars and shot drawer shells', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../src/components/workspaces/WorkspaceShell.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('GuidedSidebar');
    expect(shots).toContain('WorkspaceWithDrawer');
    expect(shots).toContain('Accept Framing');
    expect(shell).toContain('ShotDrawer');
  });
});