import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShotViewfinderOverlay } from '../src/components/viewers/ShotViewfinderOverlay';
import { focalLengthToVerticalFov, verticalFovToFocalLength } from '../src/engine/focalLength';

function renderOverlay(options: {
  fovDegrees: number;
  cameraAspectRatio?: number;
  focalLengthHudPulse?: number;
}) {
  const containerRef = { current: { clientWidth: 1280, clientHeight: 720 } as HTMLDivElement };
  return renderToStaticMarkup(
    <ShotViewfinderOverlay
      containerRef={containerRef}
      aspectRatio={16 / 9}
      cameraAspectRatio={options.cameraAspectRatio ?? 16 / 9}
      fovDegrees={options.fovDegrees}
      focalLengthHudPulse={options.focalLengthHudPulse ?? 0}
      resolutionLabel="1920×1080"
    />,
  );
}

describe('ShotViewfinderOverlay focal length HUD', () => {
  it('does not render the focal-length HUD before it is pulsed', () => {
    const html = renderOverlay({ fovDegrees: 54.4, focalLengthHudPulse: 0 });
    expect(html).not.toContain('data-focal-length-hud');
  });

  it('derives the displayed focal length from the current FOV and aspect ratio', () => {
    const fovDegrees = 54.4;
    const aspectRatio = 16 / 9;
    const expected = `${Math.round(verticalFovToFocalLength(fovDegrees, aspectRatio))} mm`;
    const html = renderOverlay({ fovDegrees, focalLengthHudPulse: 1 });
    expect(html).toContain(expected);
    expect(html).toContain('Full-frame equivalent');
  });

  it('recalculates the measurement when aspect ratio changes', () => {
    const fovDegrees = focalLengthToVerticalFov(50, 3 / 2);
    const wideAspect = renderOverlay({ fovDegrees, cameraAspectRatio: 16 / 9, focalLengthHudPulse: 1 });
    const tallAspect = renderOverlay({ fovDegrees, cameraAspectRatio: 3 / 2, focalLengthHudPulse: 1 });
    const wideLabel = `${Math.round(verticalFovToFocalLength(fovDegrees, 16 / 9))} mm`;
    const tallLabel = `${Math.round(verticalFovToFocalLength(fovDegrees, 3 / 2))} mm`;
    expect(wideAspect).toContain(wideLabel);
    expect(tallAspect).toContain(tallLabel);
    expect(wideLabel).not.toBe(tallLabel);
  });

  it('positions the HUD in the top-right corner away from bottom controls', () => {
    const html = renderOverlay({ fovDegrees: 54.4, focalLengthHudPulse: 1 });
    expect(html).toContain('absolute right-3 top-3');
    expect(html).toContain('absolute bottom-3 left-1/2');
  });
});
