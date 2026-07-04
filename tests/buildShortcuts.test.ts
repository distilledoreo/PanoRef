import { describe, expect, it } from 'vitest';
import {
  BUILD_PRIMITIVE_SHORTCUTS,
  getPrimitiveShortcutLabel,
  isEditableShortcutTarget,
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

  it('suppresses shortcuts from editable fields and browser modifier chords', () => {
    expect(resolveBuildShortcut({ key: '3', target: { tagName: 'INPUT' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'Backspace', target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'd', target: { tagName: 'SELECT' } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'v', target: { isContentEditable: true } as unknown as EventTarget })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'd', ctrlKey: true })).toBeUndefined();
    expect(resolveBuildShortcut({ key: 'd', metaKey: true })).toBeUndefined();
  });

  it('detects nested editable shortcut targets structurally', () => {
    const nestedTarget = {
      closest: (selector: string) => selector.includes('contenteditable') ? ({} as Element) : null,
    } as unknown as EventTarget;

    expect(isEditableShortcutTarget(nestedTarget)).toBe(true);
  });
});
