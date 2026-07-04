import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import { ShotThumbnail } from '../src/components/common/ShotThumbnail';

describe('ShotThumbnail component', () => {
  it('can suppress linked pano fallback while a review shot control frame is pending', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const linkedAsset = createPanoAsset({
      name: 'linked_pano.png',
      uri: 'data:image/png;base64,FULLPANO',
      width: 2048,
      height: 1024,
    });
    const linkedPano = createPanoReference({
      name: 'Linked Pano',
      assetId: linkedAsset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: 2048,
      height: 1024,
      isCanonical: true,
    });
    project.assets.assets[linkedAsset.id] = linkedAsset;
    project.panoRefs.push(linkedPano);
    shot.linkedPanoId = linkedPano.id;

    const html = renderToStaticMarkup(
      <ShotThumbnail project={project} shot={shot} fallbackOnly showSourceLabel />,
    );

    expect(html).toContain('data-shot-thumbnail-fallback');
    expect(html).toContain('No shot frame yet');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('FULLPANO');
  });

  it('labels review override images as graybox shot frames', () => {
    const project = createDefaultProject();
    const html = renderToStaticMarkup(
      <ShotThumbnail
        project={project}
        shot={project.shots[0]}
        overrideSrc="data:image/png;base64,SHOTFRAME"
        overrideLabel="Graybox shot"
        showSourceLabel
      />,
    );

    expect(html).toContain('Graybox shot');
    expect(html).toContain('SHOTFRAME');
  });
});
