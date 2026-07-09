import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { buildScene, disposeScene } from '../src/engine/sceneObjects';

describe('rendered shot output', () => {
  it('does not synthesize final AI frames inside the app renderer', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/renderSkinnedShotFrame|composeShotLockedSkinnedFrame|canonical_reference_skinning/i);
    expect(source).toContain('renderViewportClay');
    expect(source).toContain('renderShotFrame');
    expect(source).toContain('applyFlyCameraToPerspectiveCamera');
    expect(source).toContain('panoMap');
    expect(source).toContain('yaw: { value: degreesToRadians(crop.yawDegrees - panoRotation[1]) }');
    expect(source).toContain('vec3 dir = normalize(vec3(-ndc.x * aspect * tanHalfFov');
    expect(source).toContain('atan(dir.x, dir.z)');
    expect(source).toContain('#include <colorspace_fragment>');
    expect(source).not.toContain('renderContinuityControlView');
    expect(source).toContain('renderPanoPerspectiveCrop');
    expect(source).toContain('renderPanoCubemapFaces');
    expect(source).not.toContain('stitchCubemapFacesGridAsync');
    expect(source).not.toContain('stitchImageStripAsync');
  });

  it('keeps sun markers out of AI-facing export renders', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/renderGrayboxEquirectangularPano[\s\S]*hiddenObjectTypes: \['sun_marker'\]/);
    expect(source).toMatch(/renderViewportClay[\s\S]*hiddenObjectTypes: \['sun_marker'\]/);
  });

  it('defaults graybox 360 renders to 4K equirectangular resolution', () => {
    const source = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    const storeSource = readFileSync(new URL('../src/state/useContinuityStore.ts', import.meta.url), 'utf8');

    expect(source).toContain('DEFAULT_GRAYBOX_PANO_WIDTH');
    expect(source).toContain('DEFAULT_GRAYBOX_PANO_HEIGHT');
    expect(storeSource).toMatch(/renderGrayboxEquirectangularPano\(state\.project/);
    expect(storeSource).toContain('useThemeStore.getState().theme');
    expect(storeSource).not.toContain('renderGrayboxEquirectangularPano(state.project, 2048, 1024)');
    expect(storeSource).not.toMatch(/renderGrayboxPano:[\s\S]*downloadDataUrl/);
  });

  it('applies linked pano rotation to local reference exports', () => {
    const source = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');
    expect(source).toContain('renderPanoPerspectiveCrop(linkedPanoAsset.uri, shot.panoCrop, linkedPano.rotation)');
    expect(source).toContain('renderPanoCubemapFaces(cubemapSourcePano.asset.uri');
    expect(source).toContain('panoRotation: cubemapSourcePano.pano.rotation');
    expect(source).toContain('inputs/cubemap/');
    expect(source).toContain('stitchCubemapFacesCrossAsync');
    expect(source).not.toContain('stitchCubemapVisibleFacesAsync');
    expect(source).not.toContain('cubemap_visible');
  });

  it('letterboxes full pano exports when the project setting is enabled', () => {
    const source = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');
    expect(source).toContain('preparePanoExportDataUrl');
    expect(source).toContain('panoLetterboxExports169');
  });

  it('keeps compare overlay as a preview-only yaw and opacity check', () => {
    const viewerSource = readFileSync(new URL('../src/components/viewers/PanoViewer.tsx', import.meta.url), 'utf8');
    const referenceSource = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');

    expect(viewerSource).not.toMatch(/panoFovDegrees|compareFovDegrees/);
    expect(viewerSource).toContain('rendererRef.current.render(compareSceneRef.current, cameraRef.current)');
    expect(viewerSource).toContain('rendererRef.current.clearDepth()');
    expect(viewerSource).toContain('rendererRef.current.render(activeSceneRef.current, cameraRef.current)');
    expect(viewerSource).toContain('panoYawToThreeJsYawDegrees(view.yawDegrees - rotation[1])');
    expect(referenceSource).not.toContain('label="Pano FOV"');
    expect(referenceSource).not.toContain('label="Graybox FOV"');
    expect(referenceSource).not.toContain('Object Stamps');
  });

  it('does not include continuity control projection in export renders', () => {
    const rendererSource = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    const packageSource = readFileSync(new URL('../src/engine/packageExport.ts', import.meta.url), 'utf8');

    expect(rendererSource).not.toContain('createProjectedPanoMaterial');
    expect(rendererSource).not.toContain('createStampedProjectionMaterials');
    expect(packageSource).not.toContain('continuity_control_view.png');
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
