import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShotViewfinderOverlay } from '../src/components/viewers/ShotViewfinderOverlay';
import { shotFlySpeedMultiplier } from '../src/engine/shotFlyMovement';
import { applyShotFovWheelDelta, SHOT_FOV_WHEEL_STEP_THRESHOLD } from '../src/engine/shotFovWheel';
import { focalLengthToVerticalFov, verticalFovToFocalLength } from '../src/engine/focalLength';

describe('shot fly movement precision', () => {
  it('slows keyboard fly translation to 20% while Alt is held', () => {
    expect(shotFlySpeedMultiplier({ altHeld: true, sprinting: false })).toBeCloseTo(0.2, 5);
    expect(shotFlySpeedMultiplier({ altHeld: false, sprinting: false })).toBe(1);
  });
});

describe('shot focal-length wheel behavior', () => {
  it('requires accumulated delta before applying a step', () => {
    const aspectRatio = 16 / 9;
    const startFov = focalLengthToVerticalFov(50, aspectRatio);
    const partial = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: SHOT_FOV_WHEEL_STEP_THRESHOLD / 2,
      altKey: false,
      accumulatedDeltaY: 0,
    });
    expect(partial.stepsApplied).toBe(0);

    const stepped = applyShotFovWheelDelta({
      currentFovDegrees: startFov,
      aspectRatio,
      deltaY: SHOT_FOV_WHEEL_STEP_THRESHOLD / 2,
      altKey: false,
      accumulatedDeltaY: partial.nextAccumulatedDeltaY,
    });
    expect(stepped.stepsApplied).toBe(1);
  });
});

describe('shot viewfinder HUD behavior', () => {
  it('updates the displayed focal length when FOV changes under an active HUD pulse', () => {
    const containerRef = { current: { clientWidth: 1280, clientHeight: 720 } as HTMLDivElement };
    const wideFov = 60;
    const narrowFov = 30;
    const wideLabel = `${Math.round(verticalFovToFocalLength(wideFov, 16 / 9))} mm`;
    const narrowLabel = `${Math.round(verticalFovToFocalLength(narrowFov, 16 / 9))} mm`;

    const wideHtml = renderToStaticMarkup(
      <ShotViewfinderOverlay
        containerRef={containerRef}
        aspectRatio={16 / 9}
        cameraAspectRatio={16 / 9}
        fovDegrees={wideFov}
        focalLengthHudPulse={1}
        resolutionLabel="1920×1080"
      />,
    );
    const narrowHtml = renderToStaticMarkup(
      <ShotViewfinderOverlay
        containerRef={containerRef}
        aspectRatio={16 / 9}
        cameraAspectRatio={16 / 9}
        fovDegrees={narrowFov}
        focalLengthHudPulse={2}
        resolutionLabel="1920×1080"
      />,
    );

    expect(wideHtml).toContain(wideLabel);
    expect(narrowHtml).toContain(narrowLabel);
    expect(wideLabel).not.toBe(narrowLabel);
  });
});
