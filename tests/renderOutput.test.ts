import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { buildScene, disposeScene } from '../src/engine/sceneObjects';

describe('rendered shot output', () => {
  it('does not synthesize final AI frames inside the app renderer', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/renderSkinnedShotFrame|composeShotLockedSkinnedFrame|canonical_reference_skinning/i);
    expect(source).toContain('renderViewportClay');
    expect(source).toContain('renderContinuityControlView');
    expect(source).toContain('renderPanoPerspectiveCrop');
  });

  it('keeps sun markers out of AI-facing export renders', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/renderGrayboxEquirectangularPano[\s\S]*hiddenObjectTypes: \['sun_marker'\]/);
    expect(source).toMatch(/renderViewportClay[\s\S]*hiddenObjectTypes: \['sun_marker'\]/);
    expect(source).toMatch(/renderContinuityControlView[\s\S]*hiddenObjectTypes: \['sun_marker'\]/);
  });

  it('applies linked pano rotation to local reference exports', () => {
    const source = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');
    expect(source).toContain('renderPanoPerspectiveCrop(linkedPanoAsset.uri, shot.panoCrop, linkedPano.rotation)');
  });

  it('keeps FOV matching as an independent preview overlay instead of an export texture warp', () => {
    const rendererSource = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    const viewerSource = readFileSync(new URL('../src/components/viewers/PanoViewer.tsx', import.meta.url), 'utf8');
    const referenceSource = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');

    expect(rendererSource).not.toMatch(/panoFovScale|fovScale|safeFovScale/);
    expect(viewerSource).not.toMatch(/panoFovScale|fovScale|safeFovScale/);
    expect(viewerSource).toContain('panoFovDegrees?: number');
    expect(viewerSource).toContain('compareFovDegrees?: number');
    expect(viewerSource).toContain('rendererRef.current.render(compareSceneRef.current, cameraRef.current)');
    expect(viewerSource).toContain('rendererRef.current.clearDepth()');
    expect(viewerSource).toContain('rendererRef.current.render(activeSceneRef.current, cameraRef.current)');
    expect(viewerSource).toContain('view.yawDegrees - rotation[1]');
    expect(referenceSource).toContain('label="Pano FOV"');
    expect(referenceSource).toContain('label="Graybox FOV"');
    expect(referenceSource).not.toContain('label="Compare FOV"');
  });

  it('supports object-level stamped projection in AI-facing control renders', () => {
    const rendererSource = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    const referenceSource = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');

    expect(rendererSource).toContain('createStampedProjectionMaterials');
    expect(rendererSource).toContain('createStampedPanoMaterial');
    expect(rendererSource).toContain('hasStampedMaterials');
    expect(rendererSource).toContain('!object.projectionStamp || object.projectionStamp.panoId !== params.pano.id');
    expect(referenceSource).toContain('title="Object Stamps"');
    expect(referenceSource).toContain('Stamp Object');
    expect(referenceSource).toContain('projectionStamp: {');
  });

  it('can hide helper object types while preserving build-scene visibility controls', () => {
    const project = createDefaultProject();
    const visibleScene = buildScene(project, { showHelpers: false });
    const filteredScene = buildScene(project, { showHelpers: false, hiddenObjectTypes: ['sun_marker'] });

    expect(visibleScene.getObjectByName('Sun Marker 1')).toBeTruthy();
    expect(filteredScene.getObjectByName('Sun Marker 1')).toBeUndefined();

    disposeScene(visibleScene);
    disposeScene(filteredScene);
  });
});
