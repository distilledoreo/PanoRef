import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import {
  landmarkPanoBackgroundPosition,
  landmarkStripBackgroundPosition,
  landmarkStripThumbnailYaw,
  projectLandmarkToScreen,
} from '../src/engine/panoOverlay';

describe('pano overlay projection', () => {
  it('projects a landmark in front of the current view near screen center', () => {
    const project = createDefaultProject();
    const landmark = project.landmarks[0];
    const position = projectLandmarkToScreen({
      landmark,
      panoOrigin: project.scene.panoOrigin,
      view: { yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 },
      viewportWidth: 1200,
      viewportHeight: 700,
    });

    expect(position.visible).toBe(true);
    expect(position.x).toBeGreaterThan(0.35);
    expect(position.x).toBeLessThan(0.65);
    expect(position.y).toBeGreaterThan(0.2);
    expect(position.y).toBeLessThan(0.8);
  });

  it('hides landmarks far outside the current view frustum', () => {
    const project = createDefaultProject();
    const landmark = project.landmarks[0];
    const position = projectLandmarkToScreen({
      landmark,
      panoOrigin: project.scene.panoOrigin,
      view: { yawDegrees: 170, pitchDegrees: 0, fovDegrees: 65 },
      viewportWidth: 1200,
      viewportHeight: 700,
    });

    expect(position.visible).toBe(false);
  });

  it('maps landmark yaw to equirectangular background position', () => {
    expect(landmarkPanoBackgroundPosition(0)).toBe('50.00% center');
    expect(landmarkPanoBackgroundPosition(90)).toBe('75.00% center');
  });

  it('computes landmark strip thumbnail yaw relative to pano origin', () => {
    const project = createDefaultProject();
    const landmark = project.landmarks[0];
    const shiftedOrigin = [2, 0, 0] as const;

    const worldYaw = Math.atan2(landmark.position[0], landmark.position[2]) * (180 / Math.PI);
    const originAwareYaw = landmarkStripThumbnailYaw(landmark.position, [...shiftedOrigin]);
    const defaultOriginYaw = landmarkStripThumbnailYaw(landmark.position, project.scene.panoOrigin);

    expect(originAwareYaw).not.toBeCloseTo(worldYaw, 1);
    expect(landmarkStripBackgroundPosition(landmark.position, [...shiftedOrigin]))
      .toBe(landmarkPanoBackgroundPosition(originAwareYaw));
    expect(landmarkStripBackgroundPosition(landmark.position, project.scene.panoOrigin))
      .toBe(landmarkPanoBackgroundPosition(defaultOriginYaw));
    expect(landmarkStripBackgroundPosition(landmark.position, [...shiftedOrigin]))
      .not.toBe(landmarkStripBackgroundPosition(landmark.position, project.scene.panoOrigin));
  });
});