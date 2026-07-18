import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Projection Assist debug overlay boundary', () => {
  it('keeps the 3D overlay development-only and resolves the selected graybox pose', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('showAlignmentDebugOverlay');
    expect(viewport).toContain('import.meta.env.DEV');
    expect(viewport).toContain('alignment.targetGrayboxPanoId');
    expect(viewport).toContain('targetPano.origin');
    expect(viewport).toContain('targetPano.rotation[1]');
    expect(viewport).not.toContain('showAlignmentOverlay');
  });
});
