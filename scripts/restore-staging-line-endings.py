from pathlib import Path
import subprocess

paths = [
    'src/domain/defaults.ts',
    'src/domain/types.ts',
    'src/engine/projectIO.ts',
    'src/state/useContinuityStore.ts',
]

for path in paths:
    base = subprocess.check_output(['git', 'show', f'origin/main:{path}'])
    target = Path(path)
    current = target.read_bytes()
    normalized = current.replace(b'\r\n', b'\n')
    if b'\r\n' in base:
        target.write_bytes(normalized.replace(b'\n', b'\r\n'))
    else:
        target.write_bytes(normalized)

print('Restored base line-ending style for modified legacy files.')
