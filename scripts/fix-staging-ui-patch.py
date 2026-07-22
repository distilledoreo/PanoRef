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

old = '''replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  const [cameraReseedGeneration, setCameraReseedGeneration] = useState(0);",
    "  const [cameraReseedGeneration, setCameraReseedGeneration] = useState(0);\\n  const [stagingMode, setStagingMode] = useState(false);\\n  const [stagingGizmoMode, setStagingGizmoMode] = useState<GizmoMode>('translate');\\n  const [stagedObjectId, setStagedObjectId] = useState<string>();\\n  const [showPeopleInViewport, setShowPeopleInViewport] = useState(true);",
)'''
new = '''replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];\\n",
    "  const [stagingMode, setStagingMode] = useState(false);\\n  const [stagingGizmoMode, setStagingGizmoMode] = useState<GizmoMode>('translate');\\n  const [stagedObjectId, setStagedObjectId] = useState<string>();\\n  const [showPeopleInViewport, setShowPeopleInViewport] = useState(true);\\n  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];\\n",
)'''
if old not in text:
    raise SystemExit('staging hook patch block not found')
text = text.replace(old, new, 1)

needle = """    } else if (
      clayMotionSource === 'copy'
"""
replacement = """    // Legacy fallback only when rerendering is impossible; a stored people render cannot create a clean plate.
    } else if (
      clayMotionSource === 'copy'
"""
if needle not in text:
    raise SystemExit('clay fallback block not found')
text = text.replace(needle, replacement, 1)

marker = "\nprint('Applied staging UI and clean plate implementation.')\n"
contract_patch = r'''
replace_once(
    'tests/uiFidelity.test.ts',
    """    expect(shots).not.toContain('selectedObjectId');
    expect(shots).not.toContain('onSelectObject');
    expect(viewport).toContain('if (!scene || shotFramingRef.current');
    expect(viewport).toContain('showSceneGuides: shotFraming ? false : showSceneGuides');
    expect(viewport).toContain('if (framing) return;');""",
    """    expect(shots).toContain('objectEditingActive={stagingMode}');
    expect(shots).toContain('onSelectObject={stagingMode ? selectStagedObject : undefined}');
    expect(viewport).toContain('if (!scene || shotFramingRef.current');
    expect(viewport).toContain('showSceneGuides: shotFraming ? false : showSceneGuides');
    expect(viewport).toContain('if (framing && !objectEditingActive) return;');""",
)
'''
if marker not in text:
    raise SystemExit('primary patch footer not found')
text = text.replace(marker, contract_patch + marker, 1)

path.write_text(text, encoding='utf-8')
