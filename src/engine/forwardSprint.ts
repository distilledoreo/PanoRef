/**
 * Double-tap-and-hold W sprint for free / fly camera.
 * Pure state machine — pass explicit timestamps (no real timers).
 */

export const FORWARD_SPRINT_DOUBLE_TAP_MS = 300;

export interface ForwardSprintState {
  /** Timestamp of the most recent W keyup that can start a double-tap window. */
  lastReleasedAt?: number;
  /** True only while the second W press of a double-tap is held. */
  sprinting: boolean;
  /** True while any non-repeat KeyW is currently considered held by this machine. */
  held: boolean;
}

export type ForwardSprintEvent =
  | { type: 'keydown'; timestamp: number; repeat: boolean }
  | { type: 'keyup'; timestamp: number }
  | { type: 'reset' };

export function createForwardSprintState(): ForwardSprintState {
  return {
    lastReleasedAt: undefined,
    sprinting: false,
    held: false,
  };
}

/**
 * Reduce sprint state. Only KeyW transitions should be fed here
 * (caller filters by event.code === 'KeyW').
 */
export function reduceForwardSprint(
  state: ForwardSprintState,
  event: ForwardSprintEvent,
  doubleTapMs = FORWARD_SPRINT_DOUBLE_TAP_MS,
): ForwardSprintState {
  switch (event.type) {
    case 'reset':
      return createForwardSprintState();
    case 'keyup':
      return {
        lastReleasedAt: event.timestamp,
        sprinting: false,
        held: false,
      };
    case 'keydown': {
      // Auto-repeat must never arm sprint or re-enter hold.
      if (event.repeat) {
        return state;
      }
      const withinWindow = state.lastReleasedAt !== undefined
        && (event.timestamp - state.lastReleasedAt) <= doubleTapMs
        && (event.timestamp - state.lastReleasedAt) >= 0;
      return {
        lastReleasedAt: undefined,
        sprinting: withinWindow,
        held: true,
      };
    }
    default:
      return state;
  }
}

export function isForwardSprinting(state: ForwardSprintState): boolean {
  return state.sprinting && state.held;
}
