import { describe, expect, it } from 'vitest';
import {
  BUILD_PRIMITIVE_SHORTCUTS,
  getPrimitiveShortcutLabel,
  isBuildFreeCameraKey,
  isEditableShortcutTarget,
  resolveBuildHistoryShortcut,
  resolveBuildShortcut,
} from '../src/engine/buildShortcuts';

describe('Build keyboard shortcuts', () => {
  it('maps numbered tray slots to hotkeyed primitives with 0 promoted to Person', () => {
    expect(resolveBuildShortcut({ key: '1' })).toEqual({ kind: 'primitive', type: 'floor' });
    expect(resolveBuildShortcut({ key: '3' })).toEqual({ kind: 'primitive', type: 'box' });
    expect(resolveBuildShortcut({ key: '0' })).toEqual({ kind: 'primitive', type: 'human_dummy' });
    expect(BUILD_PRIMITIVE_SHORTCUTS.map((shortcut) => shortcut.type)).toEqual([
      'floor',
      'wall',
      'box',
      'arch',
      'doorway',
      'column',
      'stairs',
      'tree_blob',
      'terrain_mass',
      'human_dummy',
    ]);
  });

  it('leaves Backdrop and Sun as click-only helper primitives', () => {
    expect(getPrimitiveShortcutLabel('background_card')).toBeUndefined();
    expect(getPrimitiveShortcutLabel('sun_marker')).toBeUndefined();
  });

  it('resolves Build action keys', () => {
    expect(resolveBuildShortcut({ key: 'Escape' })).toEqual({ kind: 'mode', mode: 'select' });
    expect(resolveBuildShortcut({ key: 'v' })).toEqual({ kind: 'mode', mode: 'select' });
    expect(resolveBuildShortcut({ key: 'o' })).toEqual({ kind: 'mode', mode: 'pano_origin' });
    expect(resolveBuildShortcut({ key: 'g' })).toEqual({ kind: 'toggle-snap' });
    expect(resolveBuildShortcut({ key: 'd' })).toEqual({ kind: 'duplicate' });
    expect(resolveBuildShortcut({ key: 'r' })).toEqual({ kind: 'rotate-right' });
    expect(resolveBuildShortcut({ key: 'R', shiftKey: true })).toEqual({ kind: 'rotate-left' });
    expect(resolveBuildShortcut({ key: '[' })).toEqual({ kind: 'scale-down' });
    expect(resolveBuildShortcut({ key: ']' })).toEqual({ kind: 'scale-up' });
    expect(resolveBuildShortcut({ key: 'l' })).toEqual({ kind: 'toggle-lock' });
    expect(resolveBuildShortcut({ key: 'h' })).toEqual({ kind: 'toggle-visibility' });
    expect(resolveBuildShortcut({ key: 'i' })).toEqual({ kind: 'toggle-precision' });
    expect(resolveBuildShortcut({ key: 't' })).toEqual({ kind: 'gizmo-translate' });
    expect(resolveBuildShortcut({ key: 'e' })).toEqual({ kind: 'gizmo-rotate' });
    expect(resolveBuildShortcut({ key: 's' })).toEqual({ kind: 'gizmo-scale' });
    expect(resolveBuildShortcut({ key: 'Delete' })).toEqual({ kind: 'delete' });
    expect(resolveBuildShortcut({ key: 'Backspace' })).toEqual({ kind: 'delete' });
  });

  it('reserves only the opt-in free-camera controls while that mode is active', () => {
    expect(isBuildFreeCameraKey('KeyW')).toBe(true);
    expect(isBuildFreeCameraKey('KeyD')).toBe(true);
    expect(isBuildFreeCameraKey('Space')).toBe(true);
    expect(isBuildFreeCameraKey('ShiftLeft')).toBe(true);
    // Ctrl is no longer a free-camera sprint modifier (double-tap W instead).
    expect(isBuildFreeCameraKey('ControlLeft')).toBe(false);
    expect(isBuildFreeCameraKey('ControlRight')).toBe(false);
    expect(isBuildFreeCameraKey('ArrowUp')).toBe(false);
    expect(isBuildFreeCameraKey('KeyF')).toBe(false);
  });

  it('suppresses shortcuts from editable fields and unsupported browser modifier chords', () => {
    expect(resolveBuildShortcut({ key: '3', target: { tagName: 'INPUT' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'Backspace', target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'd', target: { tagName: 'SELECT' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'v', target: { isContentEditable: true } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'b', ctrlKey: true })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'b', metaKey: true })).toBeUndefined();
  });

  it('resolves conventional editor clipboard and selection chords on Ctrl or Cmd', () => {
    expect(resolveBuildShortcut({ key: 'c', ctrlKey: true })).toEqual({ kind: 'copy' });
    expect(resolveBuildShortcut({ key: 'x', metaKey: true })).toEqual({ kind: 'cut' });
    expect(resolveBuildShortcut({ key: 'v', ctrlKey: true })).toEqual({ kind: 'paste', inPlace: false });
    expect(resolveBuildShortcut({ key: 'v', metaKey: true, shiftKey: true })).toEqual({ kind: 'paste', inPlace: true });
    expect(resolveBuildShortcut({ key: 'd', ctrlKey: true })).toEqual({ kind: 'duplicate' });
    expect(resolveBuildShortcut({ key: 'a', metaKey: true })).toEqual({ kind: 'select-all' });
    expect(resolveBuildShortcut({ key: 'a', ctrlKey: true, shiftKey: true })).toEqual({ kind: 'clear-selection' });
  });

  it('resolves nudge, framing, visibility, rename, and help shortcuts', () => {
    expect(resolveBuildShortcut({ key: 'ArrowLeft' })).toEqual({ kind: 'nudge', axis: 'x', direction: -1, multiplier: 1 });
    expect(resolveBuildShortcut({ key: 'ArrowUp', shiftKey: true })).toEqual({ kind: 'nudge', axis: 'z', direction: -1, multiplier: 10 });
    expect(resolveBuildShortcut({ key: 'PageDown', altKey: true })).toEqual({ kind: 'nudge', axis: 'y', direction: -1, multiplier: 0.1 });
    expect(resolveBuildShortcut({ key: 'f' })).toEqual({ kind: 'frame-selection' });
    expect(resolveBuildShortcut({ key: 'Home' })).toEqual({ kind: 'frame-all' });
    expect(resolveBuildShortcut({ key: 'h', altKey: true })).toEqual({ kind: 'show-all' });
    expect(resolveBuildShortcut({ key: 'F2' })).toEqual({ kind: 'rename' });
    expect(resolveBuildShortcut({ key: '?'})).toEqual({ kind: 'toggle-help' });
  });

  it('resolves undo/redo history chords', () => {
    expect(resolveBuildShortcut({ key: 'z', ctrlKey: true })).toEqual({ kind: 'undo' });
    expect(resolveBuildShortcut({ key: 'z', metaKey: true })).toEqual({ kind: 'undo' });
    expect(resolveBuildShortcut({ key: 'z', ctrlKey: true, shiftKey: true })).toEqual({ kind: 'redo' });
    expect(resolveBuildShortcut({ key: 'y', ctrlKey: true })).toEqual({ kind: 'redo' });
    expect(resolveBuildHistoryShortcut({ key: 'z', ctrlKey: true })).toEqual({ kind: 'undo' });
    expect(resolveBuildHistoryShortcut({ key: 'z' })).toBeUndefined();
    expect(resolveBuildShortcut({
      key: 'z',
      ctrlKey: true,
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    })).toBeUndefined();
  });

  it('detects nested editable shortcut targets structurally', () => {
    const nestedTarget = {
      closest: (selector: string) => selector.includes('contenteditable') ? ({} as Element) : null,
    } as unknown as EventTarget;

    expect(isEditableShortcutTarget(nestedTarget)).toBe(true);
  });
});
