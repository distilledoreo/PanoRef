import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ui revamp fidelity surfaces', () => {
  it('uses theme-aware shot viewfinder chrome', () => {
    const overlay = readFileSync(new URL('../src/components/viewers/ShotViewfinderOverlay.tsx', import.meta.url), 'utf8');
    expect(overlay).toContain('useThemeStore');
    expect(overlay).toContain('border-[var(--accent)]');
    expect(overlay).not.toContain('border-teal-500');
  });

  it('keeps shots workspace sidebar and docked primary CTA', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('ShotInfoCard');
    expect(shots).toContain('grid-cols-[minmax(220px,280px)_minmax(0,1fr)]');
    expect(shots).toContain('layout="inline"');
    expect(shots).not.toContain('ContextualPanel');
  });

  it('renders shots viewport in camera-framing mode without build selection chrome', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(shots).toContain('shotFraming={shotFraming}');
    expect(shots).not.toContain('selectedObjectId');
    expect(shots).not.toContain('onSelectObject');
    expect(viewport).toContain('selectedObjectId: shotFraming ? undefined : selectedObjectId');
    expect(viewport).toContain('showHelpers: !shotFraming');
    expect(viewport).toContain('if (framing) return;');
  });

  it('adds filmstrip scroll affordances', () => {
    const filmstrip = readFileSync(new URL('../src/components/common/ShotFilmstrip.tsx', import.meta.url), 'utf8');
    expect(filmstrip).toContain('ChevronLeft');
    expect(filmstrip).toContain('Scroll shots left');
  });

  it('supports success-tone primary actions for shots and export', () => {
    const primaryCta = readFileSync(new URL('../src/components/common/PrimaryCTA.tsx', import.meta.url), 'utf8');
    expect(primaryCta).toContain("tone?: 'accent' | 'success'");
    expect(primaryCta).toContain('bg-[var(--success)]');
  });
});