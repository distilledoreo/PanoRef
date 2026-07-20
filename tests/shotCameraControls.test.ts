import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shot camera controls wiring', () => {
  it('uses focal-length wheel stepping in the shot viewfinder', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('applyShotFovWheelDelta');
    expect(viewport).toContain('onShotFovWheelBatchStart');
    expect(viewport).toContain('onShotFovWheelBatchEnd');
    expect(viewport).toContain('onFocalLengthHudPulse');
    expect(viewport).toContain('event.preventDefault()');
  });

  it('applies reduced precision while shift is held on pointer or wheel input', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('PRECISION_INPUT_MULTIPLIER');
    expect(viewport).toContain('event.shiftKey ? LOOK_SENSITIVITY * PRECISION_INPUT_MULTIPLIER');
    expect(viewport).toContain('shiftKey: event.shiftKey');
    expect(viewport).not.toContain('shiftHeldRef');
  });

  it('derives HUD focal length from framing camera FOV and aspect ratio', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const overlay = readFileSync(new URL('../src/components/viewers/ShotViewfinderOverlay.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('verticalFovToFocalLength');
    expect(shots).toContain('focalLengthHudPulse');
    expect(shots).toContain('framingCamera ?? selectedShot.camera');
    expect(shots).toContain('pulseFocalLengthHud');
    expect(overlay).toContain('verticalFovToFocalLength(fovDegrees, cameraAspectRatio)');
    expect(overlay).not.toContain('focalLengthHudFov');
  });

  it('uses finer numeric camera controls in the settings drawer', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('step={0.01}');
    expect(shots).toContain('step={0.1}');
  });

  it('routes shot camera undo and redo through the store history stack', () => {
    const store = readFileSync(new URL('../src/state/useContinuityStore.ts', import.meta.url), 'utf8');
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    expect(store).toContain('undoShotCamera');
    expect(store).toContain('redoShotCamera');
    expect(store).toContain('shotCameraHistoryPast');
    expect(shots).toContain('undoShotCamera()');
    expect(shots).toContain('redoShotCamera()');
  });
});
