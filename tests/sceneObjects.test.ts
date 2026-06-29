import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { buildScene, createObject3D, createPreviewMesh, disposeScene } from '../src/engine/sceneObjects';

describe('scene object disposal', () => {
  it('keeps shared build materials alive across scene rebuilds', () => {
    const project = createDefaultProject();
    const firstScene = buildScene(project, { showHelpers: false });
    const firstWall = firstScene.children
      .map((child) => child as THREE.Mesh)
      .find((child) => child.name === 'Main Temple Wall') as THREE.Mesh | undefined;

    expect(firstWall).toBeTruthy();
    const sharedMaterial = firstWall?.material as THREE.Material;
    expect(sharedMaterial).toBeTruthy();

    disposeScene(firstScene);

    const secondScene = buildScene(project, { showHelpers: false });
    const preview = createPreviewMesh(project.scene.objects[1]);
    secondScene.add(preview);

    const secondWall = secondScene.children
      .map((child) => child as THREE.Mesh)
      .find((child) => child.name === 'Main Temple Wall') as THREE.Mesh | undefined;

    expect(secondWall?.material).toBe(sharedMaterial);
    expect(((secondWall?.material as THREE.Material | undefined)?.uuid)).toBe(sharedMaterial.uuid);

    disposeScene(secondScene);
  });

  it('creates independent preview nodes for placement', () => {
    const project = createDefaultProject();
    const wall = project.scene.objects[1];
    const wallMesh = createObject3D(wall);
    const preview = createPreviewMesh(wall);

    expect(wallMesh).not.toBe(preview);
    expect(preview.name).toBe('Placement Preview');
    expect(preview.userData.previewObject).toBe(true);
  });
});