import { describe, expect, it } from 'vitest';
import {
  createForwardSprintState,
  FORWARD_SPRINT_DOUBLE_TAP_MS,
  isForwardSprinting,
  reduceForwardSprint,
} from '../src/engine/forwardSprint';

describe('forwardSprint double-tap W', () => {
  it('starts at a non-sprinting rest state', () => {
    const state = createForwardSprintState();
    expect(state.sprinting).toBe(false);
    expect(state.held).toBe(false);
    expect(isForwardSprinting(state)).toBe(false);
  });

  it('first hold is normal speed (not sprint)', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    expect(state.held).toBe(true);
    expect(state.sprinting).toBe(false);
    expect(isForwardSprinting(state)).toBe(false);
  });

  it('double-tap within window arms sprint while held', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1100 });
    state = reduceForwardSprint(state, {
      type: 'keydown',
      timestamp: 1100 + FORWARD_SPRINT_DOUBLE_TAP_MS - 1,
      repeat: false,
    });
    expect(state.sprinting).toBe(true);
    expect(state.held).toBe(true);
    expect(isForwardSprinting(state)).toBe(true);
  });

  it('second press after the window is normal speed', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1100 });
    state = reduceForwardSprint(state, {
      type: 'keydown',
      timestamp: 1100 + FORWARD_SPRINT_DOUBLE_TAP_MS + 1,
      repeat: false,
    });
    expect(state.sprinting).toBe(false);
    expect(isForwardSprinting(state)).toBe(false);
  });

  it('auto-repeat keydown never arms sprint', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1100 });
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1200, repeat: true });
    expect(state.sprinting).toBe(false);
    expect(state.held).toBe(false);
  });

  it('releasing W clears sprint immediately', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1100 });
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1200, repeat: false });
    expect(isForwardSprinting(state)).toBe(true);
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1300 });
    expect(state.sprinting).toBe(false);
    expect(state.held).toBe(false);
    expect(isForwardSprinting(state)).toBe(false);
  });

  it('reset clears all sprint memory', () => {
    let state = createForwardSprintState();
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1000, repeat: false });
    state = reduceForwardSprint(state, { type: 'keyup', timestamp: 1100 });
    state = reduceForwardSprint(state, { type: 'keydown', timestamp: 1200, repeat: false });
    state = reduceForwardSprint(state, { type: 'reset' });
    expect(state).toEqual(createForwardSprintState());
  });
});
