import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import { getShotWarnings } from '../src/engine/warnings';
import { shotPresets, useContinuityStore } from '../src/state/useContinuityStore';

describe('shot presets', () => {
  it('aims every default preset into the positive-Z starter set', () => {
    for (const preset of Object.values(shotPresets)) {
      expect(preset.target[2]).toBeGreaterThan(preset.position[2]);
      expect(preset.target[2]).toBeGreaterThan(3);
    }
  });

  it('creates preset shots with camera targets facing the starter temple', () => {
    useContinuityStore.setState({
      project: createDefaultProject(),
      workspace: 'shots',
      selectedShotId: undefined,
    });

    const shot = useContinuityStore.getState().createPresetShot('medium_frontal');

    expect(shot).toBeDefined();
    expect(shot?.camera.position[2]).toBeLessThan(0);
    expect(shot?.camera.target[2]).toBeGreaterThan(3);
  });

  it('creates preset shots with prompt-critical landmarks selected', () => {
    const project = createDefaultProject();
    useContinuityStore.setState({
      project,
      workspace: 'shots',
      selectedShotId: undefined,
    });

    const shot = useContinuityStore.getState().createPresetShot('wide_establishing');
    const criticalLandmarkIds = project.landmarks
      .filter((landmark) => landmark.promptCritical)
      .map((landmark) => landmark.id);

    expect(shot?.landmarkIds).toEqual(criticalLandmarkIds);
    expect(getShotWarnings(project, shot!).some((warning) => warning.id.endsWith('missing-landmarks'))).toBe(false);
  });
});
