import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import {
  clampDuration,
  getCameraMoveDurationSeconds,
  getCameraMoveReferenceFrames,
  hasRenderableCameraMove,
  interpolateCameraKeyframes,
  setTwoPointCameraKeyframe,
  updateCameraMoveDuration,
} from '../src/engine/cameraKeyframes';

describe('camera keyframes', () => {
  it('captures sorted start and end camera keyframes for a shot move', () => {
    const shot = createDefaultProject().shots[0];
    const endCamera = {
      ...shot.camera,
      position: [2, 1.8, -3] as [number, number, number],
      target: [0, 1.5, 4] as [number, number, number],
      fovDegrees: 45,
    };

    const withEnd = setTwoPointCameraKeyframe({
      keyframes: [],
      slot: 'end',
      camera: endCamera,
      durationSeconds: 4,
    });
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: withEnd,
      slot: 'start',
      camera: shot.camera,
      durationSeconds: 4,
    });

    expect(keyframes.map((keyframe) => keyframe.label)).toEqual(['Start', 'End']);
    expect(keyframes.map((keyframe) => keyframe.timeSeconds)).toEqual([0, 4]);
    expect(hasRenderableCameraMove(keyframes)).toBe(true);
  });

  it('interpolates camera position, target, and fov at the requested time', () => {
    const shot = createDefaultProject().shots[0];
    const endCamera = {
      ...shot.camera,
      position: [4, 2, -2] as [number, number, number],
      target: [0, 2, 2] as [number, number, number],
      fovDegrees: 35,
    };
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
        durationSeconds: 2,
      }),
      slot: 'end',
      camera: endCamera,
      durationSeconds: 2,
    });

    const halfway = interpolateCameraKeyframes(keyframes, 1);
    expect(halfway.position[0]).toBeCloseTo(2);
    expect(halfway.position[1]).toBeCloseTo(1.825);
    expect(halfway.target[2]).toBeCloseTo(6);
    expect(halfway.fovDegrees).toBeCloseTo(44.7);
  });

  it('samples start, mid, and end reference frames from a camera move', () => {
    const shot = createDefaultProject().shots[0];
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
        durationSeconds: 4,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [4, 2, -2],
        target: [0, 2, 2],
      },
      durationSeconds: 4,
    });

    const frames = getCameraMoveReferenceFrames(keyframes);
    expect(frames.map((frame) => frame.id)).toEqual(['start', 'mid', 'end']);
    expect(frames.map((frame) => frame.timeSeconds)).toEqual([0, 2, 4]);
    expect(frames[1].camera.position[0]).toBeCloseTo(2);
  });

  it('does not sample reference frames until a renderable move exists', () => {
    const shot = createDefaultProject().shots[0];
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: [],
      slot: 'start',
      camera: shot.camera,
    });

    expect(getCameraMoveReferenceFrames(keyframes)).toEqual([]);
  });

  it('clamps and updates the end keyframe duration', () => {
    const shot = createDefaultProject().shots[0];
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [0, 2, -4],
      },
      durationSeconds: 2,
    });

    const updated = updateCameraMoveDuration(keyframes, 60);
    expect(getCameraMoveDurationSeconds(updated)).toBe(30);
    expect(updated[1].timeSeconds).toBe(30);
    expect(clampDuration(Number.NaN)).toBe(3);
  });
});
