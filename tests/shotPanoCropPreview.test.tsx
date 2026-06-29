import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanoCropSettings } from '../src/domain/types';
import { ShotPanoCropPreview } from '../src/components/viewers/ShotPanoCropPreview';

const crop: PanoCropSettings = {
  panoId: 'pano_1',
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 0,
  fovDegrees: 55,
  aspectRatio: 16 / 9,
  width: 1920,
  height: 1080,
};

describe('ShotPanoCropPreview', () => {
  it('pauses crop rendering while the shot camera is still flying', () => {
    const html = renderToStaticMarkup(
      <ShotPanoCropPreview
        imageUrl="data:image/png;base64,iVBORw0KGgo="
        crop={crop}
        label="Graybox 360"
        disabledReason="Lock the camera to render the pano crop preview."
      />,
    );

    expect(html).toContain('Lock the camera to render the pano crop preview.');
    expect(html).not.toContain('55°');
    expect(html).not.toContain('1920×1080');
  });

  it('shows locked crop metadata when preview rendering is enabled', () => {
    const html = renderToStaticMarkup(
      <ShotPanoCropPreview
        imageUrl="data:image/png;base64,iVBORw0KGgo="
        crop={crop}
        label="Graybox 360"
      />,
    );

    expect(html).toContain('Pano Crop Preview');
    expect(html).toContain('55°');
    expect(html).toContain('1920×1080');
  });
});
