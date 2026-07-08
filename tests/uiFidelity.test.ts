import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ui revamp fidelity surfaces', () => {
  it('floats the stage rail over a full-bleed workspace instead of a separate header strip', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../src/components/workspaces/WorkspaceShell.tsx', import.meta.url), 'utf8');
    const reference = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    expect(app).toContain('<main className="absolute inset-0">');
    expect(app).toContain('pointer-events-none absolute inset-x-0 top-0 z-40');
    expect(app).toContain('bg-surface-overlay/75');
    expect(app).not.toContain('border-b border-subtle bg-surface-header');
    expect(app).not.toContain('flex h-screen w-full flex-col');
    expect(styles).toContain('--stage-header-safe');
    expect(shell).toContain('reserveHeader');
    expect(shell).toContain('pt-[var(--stage-header-safe)]');
    expect(reference).toContain('FullBleedLayout reserveHeader');
    expect(shots).toContain('FullBleedLayout reserveHeader');
    expect(review).toContain('FullBleedLayout reserveHeader');
    expect(exportWorkspace).toContain('FullBleedLayout reserveHeader');
    expect(build).toContain('<FullBleedLayout>');
    expect(build).not.toContain('reserveHeader');
  });

  it('declares Continuity Stage favicon assets in the app shell', () => {
    const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const faviconSvg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
    const faviconIco = readFileSync(new URL('../public/favicon.ico', import.meta.url));
    expect(shell).toContain('rel="icon"');
    expect(shell).toContain('/favicon.svg');
    expect(shell).toContain('/favicon.ico');
    expect(faviconSvg).toContain('#0d9488');
    expect(faviconIco.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });

  it('uses theme-aware shot viewfinder chrome', () => {
    const overlay = readFileSync(new URL('../src/components/viewers/ShotViewfinderOverlay.tsx', import.meta.url), 'utf8');
    expect(overlay).toContain('useThemeStore');
    expect(overlay).toContain('border-[var(--accent)]');
    expect(overlay).toContain("variant?: 'full' | 'compact'");
    expect(overlay).toContain('data-shot-viewfinder={variant}');
    expect(overlay).not.toContain('border-teal-500');
  });

  it('uses full-bleed shot viewfinder framing in the shots viewport', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('variant="full"');
    expect(viewport).not.toContain('computeCenteredFrameRendererRects');
  });

  it('keeps empty pano viewer materials theme-aware in dark mode', () => {
    const panoViewer = readFileSync(new URL('../src/components/viewers/PanoViewer.tsx', import.meta.url), 'utf8');
    expect(panoViewer).toContain('THEME_COLORS[params.theme].empty');
    expect(panoViewer).not.toContain('THEME_COLORS.light.empty');
  });

  it('exposes fly camera controls directly in the shots action dock', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    expect(shots).toContain("'Fly Camera'");
    expect(shots).toContain("'Lock View'");
    expect(shots).toContain('commitDraftCameraAndLock');
    expect(shots).not.toContain('label="Frame"');
  });

  it('pauses automatic shot frame preview renders while fly camera is active', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    expect(shots).not.toContain('flyCameraRevision');
    expect(shots).toMatch(/useEffect\(\(\) => \{[\s\S]*if \(shotCameraFlying\) return;[\s\S]*renderShotFrame\(project, previewShot\)/);
    expect(shots).toMatch(/handleFramingCameraChange[\s\S]*if \(shotCameraFlying\) return;/);
    expect(shots).not.toMatch(/handleFramingCameraChange[\s\S]*setFlyCameraRevision/);
    expect(shots).not.toMatch(/startFlyCamera[\s\S]*setFramePreviewUrl\(undefined\)/);
  });

  it('keeps filmstrip overlay dots decorative instead of misleading option buttons', () => {
    const filmstrip = readFileSync(new URL('../src/components/common/ShotFilmstrip.tsx', import.meta.url), 'utf8');
    expect(filmstrip).toContain('aria-hidden');
    expect(filmstrip).toContain('pointer-events-none');
    expect(filmstrip).not.toContain('Shot ${shot.shotNumber} options');
  });

  it('keeps native graybox download in build and surfaces it in the reference starting modal', () => {
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    const guidance = readFileSync(new URL('../src/components/common/WorkflowGuidance.tsx', import.meta.url), 'utf8');
    const referenceGuide = readFileSync(new URL('../src/components/common/GrayboxReferenceGuide.tsx', import.meta.url), 'utf8');
    const defaults = readFileSync(new URL('../src/domain/defaults.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../src/state/useContinuityStore.ts', import.meta.url), 'utf8');
    const renderers = readFileSync(new URL('../src/engine/renderers.ts', import.meta.url), 'utf8');
    expect(build).toContain('Download Graybox 360');
    expect(build).toContain('Re-render 360 Reference');
    expect(build).toContain('handleRenderGraybox');
    expect(build).toContain('data-object-surface-style');
    expect(build).toContain('1m × 1m checkerboard');
    expect(build).not.toContain('grayboxDownloadPrompt');
    expect(build).toContain('letterboxEnabled: false');
    expect(guidance).toContain('showReferencePromptBuilder');
    expect(guidance).toContain('seenObjectiveWorkspaces.includes(\'reference\')');
    expect(guidance).toMatch(/advanceOpen && Boolean\(advancePrompt\)[\s\S]*onClose=\{handleAdvanceDismiss\}/);
    expect(referenceGuide).toContain('Your graybox 360 is ready');
    expect(referenceGuide).toContain('Download the graybox image.');
    expect(defaults).toContain('DEFAULT_GRAYBOX_PANO_WIDTH = 4096');
    expect(defaults).toContain('DEFAULT_GRAYBOX_PANO_HEIGHT = 2048');
    expect(store).toContain("existing.type !== 'graybox_render'");
    expect(store).toContain('isRenderingGraybox: false');
    expect(renderers).toContain('disposeRenderer');
    expect(renderers).toContain('forceContextLoss');
  });

  it('anchors shots floating card above the bottom overlay safe area', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(styles).toContain('--shots-overlay-bottom-safe');
    expect(shots).toContain('data-shots-info-safe-area');
    expect(shots).toContain('bottom-[var(--shots-overlay-bottom-safe)]');
    expect(shots).toContain('items-start');
    expect(shots).not.toContain('items-center pl-3');
  });

  it('uses shots workspace overlay layout with floating info card and cinematic filmstrip', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const shotInfoCard = readFileSync(new URL('../src/components/common/ShotInfoCard.tsx', import.meta.url), 'utf8');
    const filmstrip = readFileSync(new URL('../src/components/common/ShotFilmstrip.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(shots).toContain('ShotInfoCard');
    expect(shots).toContain('appearance="overlay"');
    expect(shots).toContain('absolute inset-x-0 bottom-0');
    expect(shots).toContain('layout="inline"');
    expect(shots).not.toContain('grid-cols-[minmax(220px,280px)_minmax(0,1fr)]');
    expect(shots).not.toContain('ContextualPanel');
    expect(shotInfoCard).toContain('data-shot-info-card="floating"');
    expect(shotInfoCard).toContain('bg-surface-overlay');
    expect(filmstrip).toContain("appearance?: 'default' | 'overlay'");
    expect(filmstrip).toContain('data-shot-filmstrip={appearance}');
    expect(filmstrip).toContain('ring-2 ring-[var(--accent)]');
    expect(filmstrip).toContain('MoreHorizontal');
    expect(styles).toContain('--filmstrip-overlay');
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

  it('isolates build placement to explicit SceneViewport props instead of global build mode', () => {
    const viewport = readFileSync(new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url), 'utf8');
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    expect(viewport).not.toContain('getBuildInteractionState');
    expect(viewport).not.toContain('useContinuityStore');
    expect(viewport).not.toContain('buildMode');
    expect(viewport).not.toContain('activePrimitive');
    expect(viewport).toContain('placementTypeRef.current');
    expect(viewport).toContain('originPlacementActiveRef.current');
    expect(viewport).toContain('snapToGridRef.current');
    expect(shots).not.toContain('placementType');
    expect(shots).not.toContain('originPlacementActive');
    expect(shots).not.toContain('onPlaceObject');
    expect(shots).not.toContain('onMovePanoOrigin');
    expect(build).toContain('placementType={buildMode === \'place\' ? activePrimitive : undefined}');
    expect(build).toContain('originPlacementActive={buildMode === \'pano_origin\'}');
    expect(build).toContain('onPlaceObject={placeObject}');
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
    expect(viewport).toContain('createGizmoGroup');
    expect(viewport).toContain('gizmoMode');
    expect(viewport).toContain('onMoveObjectInSpace');
    expect(viewport).toContain('showSceneGuides');
    expect(gizmo).toContain('0x14b8a6');
  });

  it('fits review grid as a compact 3x2 layout above the action bar', () => {
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    expect(review).toContain('fitsCompactGrid');
    expect(review).toContain('lg:grid-cols-3');
    expect(review).toContain('content-start');
    expect(review).toContain('auto-rows-min');
    expect(review).toContain('overflow-hidden');
    expect(review).toContain('compactGrid');
    expect(review).toContain('data-review-grid-card={compactGrid ? \'compact\' : \'default\'}');
    expect(review).toContain('aspect-video max-h-[8.5rem]');
    expect(review).not.toContain('lg:grid-rows-2');
    expect(review).not.toContain('gridTemplateColumns');
  });

  it('keeps export shot rows and composed package summary with a docked CTA footer', () => {
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('fitsCompactShotList');
    expect(exportWorkspace).toContain('h-9 w-16 shrink-0');
    expect(exportWorkspace).toContain('data-export-package-panel="composed"');
    expect(exportWorkspace).toContain('data-export-package-visual');
    expect(exportWorkspace).toContain('w-44 max-w-[11rem]');
    expect(exportWorkspace).toContain('Package Contents');
    expect(exportWorkspace).toContain('data-export-package-header');
    expect(exportWorkspace).toContain('data-export-settings-trigger');
    expect(exportWorkspace).toContain('data-export-shot-row={checked ? \'selected\' : \'default\'}');
    expect(exportWorkspace).toContain('shadow-[inset_3px_0_0_var(--accent)]');
    expect(exportWorkspace).not.toContain('bg-accent-soft shadow-[0_0_0_1px_var(--accent-glow)]');
    expect(exportWorkspace).toContain('shrink-0 border-t border-subtle');
    expect(exportWorkspace).toContain('layout="inline"');
    expect(exportWorkspace).not.toContain('<header className="mb-2 shrink-0">');
  });

  it('prioritizes key export output paths in capped last-export preview', () => {
    const exportWorkspace = readFileSync(new URL('../src/components/workspaces/ExportWorkspace.tsx', import.meta.url), 'utf8');
    const exportManifest = readFileSync(new URL('../src/engine/exportManifest.ts', import.meta.url), 'utf8');
    expect(exportWorkspace).toContain('selectExportPathPreview');
    expect(exportWorkspace).toContain('lastExportPreviewPaths');
    expect(exportWorkspace).not.toMatch(/lastExport\.slice\(0,\s*\d+\)/);
    expect(exportManifest).toContain('PRIORITY_EXPORT_PATH_MARKERS');
    expect(exportManifest).toContain('/outputs/ai_result_frame.png');
  });

  it('reserves a dedicated CTA lane so the reference landmark strip does not span underneath', () => {
    const reference = readFileSync(new URL('../src/components/workspaces/ReferenceWorkspace.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(styles).toContain('--reference-cta-lane');
    expect(reference).toContain('data-reference-bottom-chrome');
    expect(reference).toContain('max-w-[calc(100%-var(--reference-cta-lane))]');
    expect(reference).toContain('Approve as Reference');
    expect(reference).not.toMatch(/LandmarkStrip[\s\S]*bottom-5 right-5[\s\S]*PrimaryCTA/);
  });

  it('reserves an intentional shots bottom safe area for the filmstrip and CTA hint', () => {
    const shots = readFileSync(new URL('../src/components/workspaces/ShotsWorkspace.tsx', import.meta.url), 'utf8');
    const primaryCta = readFileSync(new URL('../src/components/common/PrimaryCTA.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(styles).toContain('--shots-overlay-bottom-safe: 12rem');
    expect(styles).toContain('--shots-bottom-chrome-pad: 1.125rem');
    expect(styles).toContain('--shots-bottom-chrome-gap: 0.375rem');
    expect(styles).toContain('--shots-cta-hint-block: 1.125rem');
    expect(styles).toContain('--shots-cta-lane: 15.5rem');
    expect(shots).toContain('data-shots-bottom-chrome');
    expect(shots).toContain('data-shots-action-dock');
    expect(shots).toContain('bottom-[var(--shots-overlay-bottom-safe)]');
    expect(shots).toContain('pb-[var(--shots-bottom-chrome-pad)]');
    expect(shots).toContain('gap-[var(--shots-bottom-chrome-gap)]');
    expect(shots).toContain('Preview this shot from the reference.');
    expect(shots).toContain('compact');
    expect(primaryCta).toContain('data-primary-cta-hint');
    expect(primaryCta).toContain('items-end');
    expect(primaryCta).toContain('whitespace-nowrap');
    expect(primaryCta).toContain('--shots-cta-lane');
    expect(primaryCta).toContain('leading-[var(--shots-cta-hint-block,1.125rem)]');
  });

  it('bundles a CC0 human mannequin glb for person scale references', () => {
    const license = readFileSync(new URL('../public/models/human-mannequin.license.txt', import.meta.url), 'utf8');
    const model = readFileSync(new URL('../public/models/human-mannequin.glb', import.meta.url));
    expect(license).toContain('Quaternius');
    expect(license).toContain('CC0');
    expect(model.subarray(0, 4).toString()).toBe('glTF');
  });

  it('shows build drag guidance near the gizmo when an object is selected', () => {
    const build = readFileSync(new URL('../src/components/workspaces/BuildWorkspace.tsx', import.meta.url), 'utf8');
    expect(build).toContain('data-build-drag-guidance');
    expect(build).toContain('Drag arrows to move');
    expect(build).toContain('Drag rings to rotate');
    expect(build).toContain('Drag handles to scale');
    expect(build).toContain('buildMode === \'select\'');
    expect(build).toContain('showTransformGizmo');
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

  it('keeps review compact-grid thumbnails thumbnail-first instead of stretching', () => {
    const review = readFileSync(new URL('../src/components/workspaces/ReviewWorkspace.tsx', import.meta.url), 'utf8');
    const statusBadge = readFileSync(new URL('../src/components/common/StatusBadge.tsx', import.meta.url), 'utf8');
    const shotThumbnail = readFileSync(new URL('../src/components/common/ShotThumbnail.tsx', import.meta.url), 'utf8');
    expect(statusBadge).toContain('className?: string');
    expect(review).toContain('aspect-video max-h-[8.5rem]');
    expect(review).toContain('StatusGlow level={level} showIcon={false} className="w-full"');
    expect(review).toContain('renderViewportClay(project, shot.camera, previewSize.width, previewSize.height)');
    expect(review).toContain('getReviewShotControlSize');
    expect(review).toContain('overrideLabel="Graybox shot"');
    expect(review).toContain('fallbackOnly');
    expect(review).toContain('Graybox Shot Control');
    expect(review).not.toContain('compactGrid ? \'h-full min-h-0\'');
    expect(review).not.toContain('lg:grid-rows-2');
    expect(shotThumbnail).toContain('data-shot-thumbnail-fallback');
    expect(shotThumbnail).toContain('fallbackOnly?: boolean');
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
