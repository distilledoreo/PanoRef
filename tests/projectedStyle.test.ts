import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
  defaultProjectedStyleSettings,
  normalizeProjectedStyleSettings,
  normalizeProjectSettings,
} from '../src/domain/defaults';
import {
  canUseProjectedAppearance,
  isEligibleProjectedStylePano,
  listEligibleProjectedStylePanos,
  resolveProjectedStylePano,
} from '../src/engine/projectedStyle';
import { parseProject, serializeProject } from '../src/engine/projectIO';

describe('projected style settings', () => {
  it('normalizes missing and out-of-range fields', () => {
    expect(normalizeProjectedStyleSettings(undefined)).toEqual(defaultProjectedStyleSettings);
    expect(normalizeProjectedStyleSettings({ opacity: 2, exposure: 0.1, lightingContribution: -1 })).toEqual({
      opacity: 1,
      exposure: 0.25,
      lightingContribution: 0,
      fallbackMode: 'clay',
    });
    expect(normalizeProjectedStyleSettings({ fallbackMode: 'neutral', panoId: 'p1' }).panoId).toBe('p1');
  });

  it('loads legacy projects without projectedStyle safely', () => {
    const project = createDefaultProject();
    delete (project.settings as { projectedStyle?: unknown }).projectedStyle;
    const parsed = parseProject(serializeProject(project));
    expect(parsed.settings.projectedStyle).toEqual(defaultProjectedStyleSettings);
    expect(normalizeProjectSettings(parsed.settings).projectedStyle?.opacity).toBe(1);
  });

  it('prefers canonical styled panos over graybox by default', () => {
    const project = createDefaultProject();
    const grayAsset = createPanoAsset({
      name: 'gray.png',
      uri: 'data:image/png;base64,AAAA',
      width: 4096,
      height: 2048,
    });
    const styledAsset = createPanoAsset({
      name: 'styled.png',
      uri: 'data:image/png;base64,BBBB',
      width: 4096,
      height: 2048,
    });
    project.assets.assets[grayAsset.id] = grayAsset;
    project.assets.assets[styledAsset.id] = styledAsset;
    const gray = createPanoReference({
      name: 'Graybox',
      assetId: grayAsset.id,
      type: 'graybox_render',
      origin: project.scene.panoOrigin,
      width: 4096,
      height: 2048,
      isCanonical: false,
    });
    const styled = createPanoReference({
      name: 'Armory Styled',
      assetId: styledAsset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: 4096,
      height: 2048,
      isCanonical: true,
    });
    project.panoRefs = [gray, styled];

    expect(isEligibleProjectedStylePano(gray)).toBe(false);
    expect(isEligibleProjectedStylePano(styled)).toBe(true);
    expect(listEligibleProjectedStylePanos(project).map((pano) => pano.id)).toEqual([styled.id]);
    expect(resolveProjectedStylePano(project)?.id).toBe(styled.id);
    expect(canUseProjectedAppearance(project)).toBe(true);
  });

  it('honors explicit pano selection including graybox when chosen', () => {
    const project = createDefaultProject();
    const grayAsset = createPanoAsset({
      name: 'gray.png',
      uri: 'data:image/png;base64,AAAA',
      width: 4096,
      height: 2048,
    });
    project.assets.assets[grayAsset.id] = grayAsset;
    const gray = createPanoReference({
      name: 'Graybox',
      assetId: grayAsset.id,
      type: 'graybox_render',
      origin: project.scene.panoOrigin,
      width: 4096,
      height: 2048,
      isCanonical: true,
    });
    project.panoRefs = [gray];
    project.settings.projectedStyle = normalizeProjectedStyleSettings({ panoId: gray.id });
    expect(resolveProjectedStylePano(project)?.id).toBe(gray.id);
    expect(canUseProjectedAppearance(project)).toBe(true);
  });

  it('reports unavailable when no panos exist', () => {
    const project = createDefaultProject();
    project.panoRefs = [];
    expect(canUseProjectedAppearance(project)).toBe(false);
    expect(resolveProjectedStylePano(project)).toBeUndefined();
  });
});
