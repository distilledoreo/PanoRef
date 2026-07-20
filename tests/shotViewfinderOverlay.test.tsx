import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShotViewfinderOverlay } from '../src/components/viewers/ShotViewfinderOverlay';

function renderOverlay(focalLengthHudFov: number | null) {
  const containerRef = { current: { clientWidth: 1280, clientHeight: 720 } as HTMLDivElement };
  return renderToStaticMarkup(
    <ShotViewfinderOverlay
      containerRef={containerRef}
      aspectRatio={16 / 9}
      cameraAspectRatio={16 / 9}
      fovDegrees={54}
      focalLengthHudFov={focalLengthHudFov}
      resolutionLabel="1920×1080"
    />,
  );
}

describe('ShotViewfinderOverlay focal length HUD', () => {
  it('does not render the focal-length HUD when scrolling has not started', () => {
    const html = renderOverlay(null);
    expect(html).not.toContain('data-focal-length-hud');
    expect(html).not.toContain('Full-frame equivalent');
  });

  it('shows rounded full-frame equivalent focal length while scrolling', () => {
    const html = renderOverlay(54.4);
    expect(html).toContain('data-focal-length-hud');
    expect(html).toContain('Full-frame equivalent');
    expect(html).toMatch(/>\d+ mm</);
  });

  it('positions the HUD in the top-right corner away from bottom controls', () => {
    const html = renderOverlay(54.4);
    expect(html).toContain('absolute right-3 top-3');
    expect(html).toContain('absolute bottom-3 left-1/2');
  });
});
