import { SceneObjectType } from '../domain/types';

export const BUILD_PRIMITIVE_SHORTCUTS = [
  { key: '1', type: 'floor' },
  { key: '2', type: 'wall' },
  { key: '3', type: 'box' },
  { key: '4', type: 'arch' },
  { key: '5', type: 'doorway' },
  { key: '6', type: 'column' },
  { key: '7', type: 'stairs' },
  { key: '8', type: 'tree_blob' },
  { key: '9', type: 'terrain_mass' },
  { key: '0', type: 'human_dummy' },
] as const satisfies ReadonlyArray<{ key: string; type: SceneObjectType }>;

export const HOTKEYED_BUILD_PRIMITIVES = BUILD_PRIMITIVE_SHORTCUTS.map((shortcut) => shortcut.type);

export const CLICK_ONLY_BUILD_PRIMITIVES = [
  'background_card',
  'sun_marker',
] as const satisfies ReadonlyArray<SceneObjectType>;

export type BuildShortcutCommand =
  | { kind: 'primitive'; type: SceneObjectType }
  | { kind: 'mode'; mode: 'select' | 'pano_origin' }
  | { kind: 'toggle-snap' }
  | { kind: 'duplicate' }
  | { kind: 'rotate-left' }
  | { kind: 'rotate-right' }
  | { kind: 'scale-down' }
  | { kind: 'scale-up' }
  | { kind: 'toggle-lock' }
  | { kind: 'toggle-visibility' }
  | { kind: 'toggle-precision' }
  | { kind: 'gizmo-translate' }
  | { kind: 'gizmo-rotate' }
  | { kind: 'gizmo-scale' }
  | { kind: 'delete' }
  | { kind: 'undo' }
  | { kind: 'redo' };

export interface BuildShortcutInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}

const primitiveShortcutByKey = new Map<string, SceneObjectType>(
  BUILD_PRIMITIVE_SHORTCUTS.map((shortcut) => [shortcut.key, shortcut.type]),
);

const keyByPrimitiveShortcut = new Map<SceneObjectType, string>(
  BUILD_PRIMITIVE_SHORTCUTS.map((shortcut) => [shortcut.type, shortcut.key]),
);

export function getPrimitiveShortcutLabel(type: SceneObjectType): string | undefined {
  return keyByPrimitiveShortcut.get(type);
}

export function resolveBuildShortcut(input: BuildShortcutInput): BuildShortcutCommand | undefined {
  if (isEditableShortcutTarget(input.target)) {
    return undefined;
  }

  // History chords (Ctrl/Cmd) must be handled before the generic modifier block.
  const history = resolveBuildHistoryShortcut(input);
  if (history) return history;

  if (input.ctrlKey || input.metaKey || input.altKey) {
    return undefined;
  }

  const key = input.key.toLowerCase();
  if (!input.shiftKey) {
    const primitive = primitiveShortcutByKey.get(key);
    if (primitive) return { kind: 'primitive', type: primitive };
  }

  if (key === 'escape' || (!input.shiftKey && key === 'v')) return { kind: 'mode', mode: 'select' };
  if (!input.shiftKey && key === 'o') return { kind: 'mode', mode: 'pano_origin' };
  if (!input.shiftKey && key === 'g') return { kind: 'toggle-snap' };
  if (!input.shiftKey && key === 'd') return { kind: 'duplicate' };
  if (key === 'r') return input.shiftKey ? { kind: 'rotate-left' } : { kind: 'rotate-right' };
  if (!input.shiftKey && key === '[') return { kind: 'scale-down' };
  if (!input.shiftKey && key === ']') return { kind: 'scale-up' };
  if (!input.shiftKey && key === 'l') return { kind: 'toggle-lock' };
  if (!input.shiftKey && key === 'h') return { kind: 'toggle-visibility' };
  if (!input.shiftKey && key === 'i') return { kind: 'toggle-precision' };
  if (!input.shiftKey && key === 't') return { kind: 'gizmo-translate' };
  if (!input.shiftKey && key === 'e') return { kind: 'gizmo-rotate' };
  if (!input.shiftKey && key === 's') return { kind: 'gizmo-scale' };
  if (!input.shiftKey && (key === 'delete' || key === 'backspace')) return { kind: 'delete' };

  return undefined;
}

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. */
export function resolveBuildHistoryShortcut(input: BuildShortcutInput): BuildShortcutCommand | undefined {
  if (isEditableShortcutTarget(input.target)) return undefined;
  if (input.altKey) return undefined;
  if (!input.ctrlKey && !input.metaKey) return undefined;

  const key = input.key.toLowerCase();
  if (key === 'z' && input.shiftKey) return { kind: 'redo' };
  if (key === 'z') return { kind: 'undo' };
  if (key === 'y' && !input.shiftKey) return { kind: 'redo' };
  return undefined;
}

export function isEditableShortcutTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false;
  const element = target as EventTarget & {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => Element | null;
  };
  if (element.isContentEditable) return true;

  const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;

  return typeof element.closest === 'function'
    ? Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    : false;
}
