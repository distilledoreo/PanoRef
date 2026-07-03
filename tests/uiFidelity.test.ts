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
    expect(viewport).toContain('showSceneGuides: shotFraming ? false : showSceneGuides');
    expect(viewport).toContain('if (framing) return;');
  });

  it('adds filmstrip scroll affordances', () => {
    const filmstrip = readFileSync(new URL('../src/components/common/ShotFilmstrip.tsx', import.meta.url), 'utf8');
    expect(filmstrip).toContain('ChevronLeft');
    expect(filmstrip).toContain('Scroll shots left');
  });

  it('keeps accent-tone primary actions for main workflow CTAs', () => {
    const primaryCta = readFileSync(new URL('../src/components/common/PrimaryCTA.tsx', import.meta.url), 'utf8');
    const reference = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    expect(primaryCta).toContain("tone?: 'accent' | 'success'");
    expect(primaryCta).toContain('bg-[var(--accent)]');
    expect(reference).not.toContain('tone="success"');
    expect(shots).not.toContain('tone="success"');
    expect(exportWorkspace).not.toContain('tone="success"');
  });

  it('renders reference workspace with landmark markers, strip, and accent approve CTA', () => {
    const reference = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');
    expect(reference).toContain('PanoLandmarkMarkers');
    expect(reference).toContain('LandmarkStrip');
    expect(reference).toContain('panoOrigin={panoOrigin}');
    expect(reference).toContain('Approve as Reference');
    expect(reference).toContain('rounded-[18px]');
  });

  it('renders build transform gizmo affordances and hides scene guides by default', () => {
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    const gizmo = readFileSync(new URL('../src/engine/transformGizmo.ts', import.meta.url), 'utf8');
    expect(build).toContain('showSceneGuides');
    expect(build).toContain('useState(false)');
    expect(build).toContain('showTransformGizmo');
    expect(build).toContain('RotateCw');
    expect(build).toContain('ZoomIn');
    expect(viewport).toContain('createTransformGizmoGroup');
    expect(viewport).toContain('showSceneGuides');
    expect(gizmo).toContain('0x14b8a6');
  });

  it('fits review grid as a compact 3x2 layout above the action bar', () => {
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    expect(review).toContain('fitsCompactGrid');
    expect(review).toContain('lg:grid-cols-3');
    expect(review).toContain('lg:grid-rows-2');
    expect(review).toContain('lg:overflow-hidden');
    expect(review).toContain('compactGrid');
    expect(review).not.toContain('gridTemplateColumns');
  });

  it('keeps export shot rows and package summary compact with a docked CTA footer', () => {
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('fitsCompactShotList');
    expect(exportWorkspace).toContain('h-9 w-16 shrink-0');
    expect(exportWorkspace).toContain('items-start justify-start');
    expect(exportWorkspace).toContain('shrink-0 border-t border-subtle');
    expect(exportWorkspace).toContain('layout="inline"');
  });

  it('renders polished theme-aware shot thumbnail fallbacks for missing media', () => {
    const shotThumbnail = readFileSync(new URL('../src/components/common/ShotThumbnail.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(shotThumbnail).toContain('data-shot-thumbnail-fallback');
    expect(shotThumbnail).toContain('ShotThumbnailFallback');
    expect(shotThumbnail).toContain('No preview');
    expect(shotThumbnail).not.toContain('ImageIcon');
    expect(styles).toContain('--thumbnail-fallback-sky');
    expect(styles).toContain('--thumbnail-fallback-block-a');
  });

  it('keeps review compact-grid thumbnails stretched through StatusGlow', () => {
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    const statusBadge = readFileSync(new URL('../src/components/common/StatusBadge.tsx', import.meta.url), 'utf8');
    const shotThumbnail = readFileSync(new URL('../src/components/common/ShotThumbnail.tsx', import.meta.url), 'utf8');
    expect(statusBadge).toContain('className?: string');
    expect(review).toContain('min-h-0 flex-1');
    expect(review).toContain('className={compactGrid ? \'h-full min-h-0 w-full\' : \'w-full\'}');
    expect(review).toContain('compactGrid ? \'h-full min-h-0\' : \'aspect-video\'');
    expect(shotThumbnail).toContain('data-shot-thumbnail-fallback');
  });

  it('uses compact shot thumbnail fallbacks without cramped labels in export rows', () => {
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    const shotThumbnail = readFileSync(new URL('../src/components/common/ShotThumbnail.tsx', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('compact className="h-9 w-16 shrink-0"');
    expect(shotThumbnail).toContain('compact?: boolean');
    expect(shotThumbnail).toContain('data-shot-thumbnail-compact');
    expect(shotThumbnail).toContain('{!compact && (');
    expect(shotThumbnail).toContain('thumbnail-fallback-block-a');
  });

  it('uses theme-aware pano viewer colors and build tray glow tokens', () => {
    const panoViewer = readFileSync(new URL('../src/components/viewers/PanoViewer.tsx', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(panoViewer).toContain('useThemeStore');
    expect(panoViewer).toContain('THEME_COLORS');
    expect(build).toContain('shadow-[var(--tray-glow)]');
    expect(build).toContain("appearance={theme === 'dark' ? 'glow-outline' : 'solid'}");
    expect(styles).toContain('--tray-glow');
    expect(styles).toContain('--cta-glow');
  });
});