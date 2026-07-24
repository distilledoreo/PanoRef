import { describe, expect, it } from 'vitest';
import { createDefaultProject, createSceneObject } from '../src/domain/defaults';
import { setTwoPointCameraKeyframe } from '../src/engine/cameraKeyframes';
import {
  cameraKeyframesHaveObjectAnimation,
  interpolateObjectOverrides,
} from '../src/engine/objectKeyframes';

describe('object keyframes', () => {
  it('stores staged-object snapshots on start and end camera keyframes', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    project.scene.objects.push(prop);

    const startOverrides = {
      [prop.id]: {
        transform: {
          ...prop.transform,
          position: [1, 0.7, 0] as [number, number, number],
        },
      },
    };
    const endOverrides = {
      [prop.id]: {
        transform: {
          ...prop.transform,
          position: [5, 0.7, 0] as [number, number, number],
        },
      },
    };

    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
        durationSeconds: 2,
        objectOverrides: startOverrides,
      }),
      slot: 'end',
      camera: {
        ...shot.camera,
        position: [0, 2, -4],
      },
      durationSeconds: 2,
      objectOverrides: endOverrides,
    });

    expect(cameraKeyframesHaveObjectAnimation(keyframes)).toBe(true);
    expect(keyframes[0].objectOverrides?.[prop.id]?.transform?.position[0]).toBe(1);
    expect(keyframes[1].objectOverrides?.[prop.id]?.transform?.position[0]).toBe(5);
  });

  it('interpolates object transforms between keyframe snapshots', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const prop = createSceneObject('box', 1);
    project.scene.objects.push(prop);

    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
        durationSeconds: 2,
        objectOverrides: {
          [prop.id]: {
            transform: {
              ...prop.transform,
              position: [0, 1, 0],
              rotation: [0, 0, 0],
            },
            visible: true,
          },
        },
      }),
      slot: 'end',
      camera: shot.camera,
      durationSeconds: 2,
      objectOverrides: {
        [prop.id]: {
          transform: {
            ...prop.transform,
            position: [4, 1, 0],
            rotation: [0, 90, 0],
          },
          visible: false,
        },
      },
    });

    const mid = interpolateObjectOverrides(keyframes, 1, {}, project.scene.objects);
    expect(mid[prop.id]?.transform?.position[0]).toBeCloseTo(2);
    expect(mid[prop.id]?.transform?.rotation[1]).toBeCloseTo(45);
    // Visibility snaps at midpoint.
    expect(mid[prop.id]?.visible).toBe(false);

    const early = interpolateObjectOverrides(keyframes, 0.4, {}, project.scene.objects);
    expect(early[prop.id]?.visible).toBe(true);
  });

  it('falls back to live shot overrides when keyframes lack snapshots', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    const prop = createSceneObject('box', 1);
    project.scene.objects.push(prop);
    const keyframes = setTwoPointCameraKeyframe({
      keyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: shot.camera,
        durationSeconds: 2,
      }),
      slot: 'end',
      camera: shot.camera,
      durationSeconds: 2,
    });
    const fallback = {
      [prop.id]: {
        transform: {
          ...prop.transform,
          position: [3, 1, 0] as [number, number, number],
        },
      },
    };

    expect(cameraKeyframesHaveObjectAnimation(keyframes)).toBe(false);
    const mid = interpolateObjectOverrides(keyframes, 1, fallback, project.scene.objects);
    expect(mid[prop.id]?.transform?.position[0]).toBe(3);
  });
});
