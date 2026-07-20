import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createVideoAsset } from '../src/domain/defaults';
import { ShotMediaModal } from '../src/components/common/ShotMediaModal';

describe('ShotMediaModal', () => {
  it('renders image captures without selecting the live shot', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const viewportAsset = createPanoAsset({
      name: 'viewport.png',
      uri: 'data:image/png;base64,VIEWPORT',
      width: 1920,
      height: 1080,
    });
    project.assets.assets[viewportAsset.id] = viewportAsset;
    shot.assets.viewportRenderAssetId = viewportAsset.id;

    const html = renderToStaticMarkup(
      <ShotMediaModal
        open
        project={project}
        shots={project.shots}
        shotId={shot.id}
        onClose={() => undefined}
        onOpenShot={() => undefined}
        onUpdateShot={() => undefined}
      />,
    );

    expect(html).toContain('data-shot-media-modal');
    expect(html).toContain('VIEWPORT');
    expect(html).toContain('<img');
    expect(html).not.toContain('<video');
  });

  it('renders stored video captures with a video element', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const videoAsset = createVideoAsset({
      name: 'camera_move.mp4',
      uri: 'data:video/mp4;base64,VIDEO',
      mimeType: 'video/mp4',
      width: 1920,
      height: 1080,
    });
    project.assets.assets[videoAsset.id] = videoAsset;
    shot.assets.cameraMoveVideoAssetId = videoAsset.id;

    const html = renderToStaticMarkup(
      <ShotMediaModal
        open
        project={project}
        shots={project.shots}
        shotId={shot.id}
        onClose={() => undefined}
        onOpenShot={() => undefined}
        onUpdateShot={() => undefined}
      />,
    );

    expect(html).toContain('<video');
    expect(html).toContain('VIDEO');
  });
});
