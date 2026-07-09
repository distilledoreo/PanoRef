import React, { useRef, useState } from 'react';
import { Download, ImagePlus, Loader2 } from 'lucide-react';
import { getCanonicalPano, getPanoAsset } from '../../domain/selectors';
import { preparePanoImport } from '../../engine/panoImage';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { renderPanoPerspectiveCrop } from '../../engine/renderers';
import { useContinuityStore } from '../../state/useContinuityStore';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { PanoViewer } from '../viewers/PanoViewer';
import { FullBleedLayout } from './WorkspaceShell';

const DEFAULT_DOWNLOAD_WIDTH = 1920;
const DEFAULT_DOWNLOAD_HEIGHT = 1080;

export function PanoViewerWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const {
    project,
    panoView,
    setPanoView,
    importCanonicalPano,
    activePanoId,
  } = useContinuityStore();

  const activePano = activePanoId
    ? project.panoRefs.find((pano) => pano.id === activePanoId)
    : getCanonicalPano(project) ?? project.panoRefs[0];
  const activeAsset = activePano ? getPanoAsset(project, activePano) : undefined;

  const importPano = async (file?: File) => {
    if (!file) return;
    setIsImporting(true);
    setError(undefined);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await getImageDimensions(dataUrl);
      const prepared = await preparePanoImport(dataUrl, dimensions.width, dimensions.height);
      importCanonicalPano({
        name: file.name || 'pano.png',
        dataUrl: prepared.dataUrl,
        width: prepared.width,
        height: prepared.height,
        importNote: prepared.analysis.wasLetterboxed
          ? `Imported from ${dimensions.width}×${dimensions.height} letterboxed 16:9; extracted ${prepared.width}×${prepared.height} equirectangular region.`
          : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import pano.');
    } finally {
      setIsImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const downloadCurrentView = async () => {
    if (!activePano || !activeAsset) return;
    setIsDownloading(true);
    setError(undefined);
    try {
      const width = project.settings.defaultShotWidth || DEFAULT_DOWNLOAD_WIDTH;
      const height = project.settings.defaultShotHeight || DEFAULT_DOWNLOAD_HEIGHT;
      const frame = await renderPanoPerspectiveCrop(
        activeAsset.uri,
        {
          panoId: activePano.id,
          yawDegrees: panoView.yawDegrees,
          pitchDegrees: panoView.pitchDegrees,
          rollDegrees: 0,
          fovDegrees: panoView.fovDegrees,
          aspectRatio: width / height,
          width,
          height,
        },
        activePano.rotation,
      );
      const baseName = (activeAsset.name || activePano.name || 'pano_view')
        .replace(/\.[^.]+$/, '')
        .replace(/\s+/g, '_')
        .toLowerCase();
      downloadDataUrl(frame.dataUrl, `${baseName}_${width}x${height}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download current view.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <FullBleedLayout reserveHeader>
      <div className="relative h-full min-h-0 w-full" data-pano-viewer-workspace>
        <PanoViewer
          imageUrl={activeAsset?.uri}
          view={panoView}
          onViewChange={setPanoView}
          label={activePano?.name}
          panoRotation={activePano?.rotation}
        />

        {!activeAsset && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-md space-y-3 rounded-[var(--radius-card)] border border-subtle bg-surface-overlay p-6 text-center shadow-soft backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-primary">Import a 360 pano</h2>
              <p className="text-sm text-secondary">
                Drop in an equirectangular image, look around, then download the current view as a flat PNG.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isImporting}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--accent)] bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:bg-[var(--accent)] hover:text-white disabled:opacity-50"
              >
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {isImporting ? 'Importing…' : 'Import pano'}
              </button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 p-5">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-pano-viewer-import-input
              onChange={(event) => void importPano(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isImporting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface-overlay/90 px-3 py-2 text-xs font-semibold text-secondary shadow-card backdrop-blur-sm transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {activeAsset ? 'Replace pano' : 'Import pano'}
            </button>
            {activeAsset && (
              <label className="inline-flex items-center gap-2 rounded-xl border border-subtle bg-surface-overlay/90 px-3 py-2 text-xs text-secondary shadow-card backdrop-blur-sm">
                <span className="font-medium">FOV</span>
                <input
                  type="range"
                  min={30}
                  max={120}
                  step={1}
                  value={panoView.fovDegrees}
                  onChange={(event) => setPanoView({ fovDegrees: Number(event.target.value) })}
                  className="w-24 accent-[var(--accent)]"
                  aria-label="Field of view"
                />
                <span className="w-8 tabular-nums text-primary">{Math.round(panoView.fovDegrees)}°</span>
              </label>
            )}
          </div>

          {activeAsset && (
            <div className="pointer-events-auto">
              <PrimaryCTA
                icon={isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                label={isDownloading ? 'Rendering…' : 'Download current view'}
                hint="Saves a flat PNG of what you are looking at right now."
                onClick={() => void downloadCurrentView()}
                disabled={isDownloading}
                highlighted
              />
            </div>
          )}
        </div>

        {error && (
          <div
            className="absolute left-1/2 top-[calc(var(--stage-header-safe)+0.75rem)] z-30 max-w-md -translate-x-1/2 rounded-lg border border-red-400/70 bg-surface-overlay px-3 py-2 text-sm text-primary shadow-card"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>
    </FullBleedLayout>
  );
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Could not read image dimensions.'));
    image.src = dataUrl;
  });
}
