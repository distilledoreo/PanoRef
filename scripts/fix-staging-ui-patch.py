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
text = text.replace(old, new, 1)

old = '''replace_once(
    'src/components/workspaces/ExportWorkspace.tsx',
    "import { Shot } from '../../domain/types';",
    "import { PeopleExportMode, Shot } from '../../domain/types';",
)'''
new = '''replace_once(
    'src/components/workspaces/ExportWorkspace.tsx',
    "import React, { useEffect, useMemo, useRef, useState } from 'react';",
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\\nimport type { PeopleExportMode } from '../../domain/types';",
)'''
if old not in text:
    raise SystemExit('export workspace type import patch block not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
