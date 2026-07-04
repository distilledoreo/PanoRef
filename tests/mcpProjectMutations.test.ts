import { describe, expect, it } from 'vitest';
import {
  createAgentProject,
  placeObjects,
  planShots,
  setPanoOrigin,
  summarizeProject,
} from '../src/mcp/projectMutations';

describe('mcp project mutations', () => {
  it('creates an agent project with brief metadata', () => {
    const project = createAgentProject({
      name: 'Temple Chase',
      description: 'Courtyard pursuit',
      videoBrief: 'A hero runs through an ancient gate.',
    });

    expect(project.name).toBe('Temple Chase');
    expect(project.description).toContain('Courtyard pursuit');
    expect(project.description).toContain('ancient gate');
    expect(project.shots.length).toBeGreaterThan(0);
  });

  it('places objects and plans shots without touching UI state', () => {
    const baseProject = createAgentProject({ name: 'Blocking Test' });
    const baseObjectCount = baseProject.scene.objects.length;
    let project = baseProject;
    project = placeObjects(project, [
      { type: 'column', name: 'Left Column', position: [-2, 0, 3] },
      { type: 'column', name: 'Right Column', position: [2, 0, 3] },
    ]);
    project = setPanoOrigin(project, [0, 1.65, 0]);
    project = planShots(project, [
      {
        name: 'Establishing Wide',
        description: 'See the full courtyard.',
        camera: {
          position: [0, 1.65, -4],
          target: [0, 1.8, 4],
        },
      },
      {
        name: 'Gate Push',
        description: 'Move toward the arch.',
        camera: {
          position: [0, 1.65, 0],
          target: [0, 2, 5],
        },
      },
    ]);

    const summary = summarizeProject(project);
    expect(project.scene.objects.length).toBe(baseObjectCount + 2);
    expect(summary.objectCount).toBe(baseObjectCount + 2);
    expect(summary.shotCount).toBe(2);
    expect(summary.shots[0]?.name).toBe('Establishing Wide');
    expect(summary.shots[1]?.description).toBe('Move toward the arch.');
    expect(project.scene.panoOrigin).toEqual([0, 1.65, 0]);
  });
});