from pathlib import Path

path = Path('scripts/apply-staging-ui-clean-plates.py')
text = path.read_text(encoding='utf-8')
old = '''replace_once(
    'src/engine/renderers.ts',
    "  includeDataUrl?: boolean;\\n}",
    "  includeDataUrl?: boolean;\\n  /** Hide all objects classified as people for clean-plate output. */\\n  peopleVariant?: PeopleRenderVariant;\\n}",
)'''
new = '''replace_once(
    'src/engine/renderers.ts',
    "   * Default false — downloads and ZIP packaging should use `blob` only.\\n   */\\n  includeDataUrl?: boolean;\\n}",
    "   * Default false — downloads and ZIP packaging should use `blob` only.\\n   */\\n  includeDataUrl?: boolean;\\n  /** Hide all objects classified as people for clean-plate output. */\\n  peopleVariant?: PeopleRenderVariant;\\n}",
)'''
if old not in text:
    raise SystemExit('renderer option patch block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
