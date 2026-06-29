import React, { useRef, useState } from 'react';
import { Download, FileDown, ImagePlus, RotateCcw, Sparkles, Star } from 'lucide-react';
import { useContinuityStore } from '../../state/useContinuityStore';
import { preparePanoImport, downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { Field, IconButton, Panel, TextInput } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { PanoViewer } from '../viewers/PanoViewer';
import { getProjectWarnings } from '../../engine/warnings';
import { WorkspaceLayout } from './BuildWorkspace';

export function ReferenceWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [compareOpacity, setCompareOpacity] = useState(0.65);
  const {
    project,
    activePanoId,
    panoView,
    setActivePano,
    setPanoView,
    updatePanoReference,
    updateProjectSettings,
    importCanonicalPano,
    renderGrayboxPano,
    isRenderingGraybox,
  } = useContinuityStore();
  const activePano = project.panoRefs.find((pano) => pano.id === activePanoId) ?? project.panoRefs.find((pano) => pano.isCanonical);
  const activeAsset = activePano ? project.assets.assets[activePano.imageAssetId] : undefined;
  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);
  const canCalibrate = Boolean(activePano && activePano.type !== 'graybox_render' && grayboxPano);
  const setActiveYaw = (yawDegrees: number) => {
    if (!activePano) return;
    updatePanoReference(activePano.id, {
      rotation: [
        activePano.rotation[0],
        normalizeSignedYaw(yawDegrees),
        activePano.rotation[2],
      ],
    });
  };

  const importPanoImage = async (params: { name: string; dataUrl: string; width: number; height: number }) => {
    const prepared = await preparePanoImport(params.dataUrl, params.width, params.height);
    importCanonicalPano({
      name: params.name,
      dataUrl: prepared.dataUrl,
      width: prepared.width,
      height: prepared.height,
      importNote: prepared.analysis.wasLetterboxed
        ? `Imported from ${params.width}×${params.height} letterboxed 16:9; extracted ${prepared.width}×${prepared.height} equirectangular region.`
        : undefined,
    });
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    await importPanoImage({ name: file.name, dataUrl, width: dimensions.width, height: dimensions.height });
  };

  const loadAttachedReference = async () => {
    const response = await fetch('/attached-canonical-reference.png');
    if (!response.ok) throw new Error('Could not load the attached canonical reference.');
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    const dimensions = await getImageDimensions(dataUrl);
    await importPanoImage({
      name: 'attached-canonical-reference.png',
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
    });
  };

  const downloadActivePano = async () => {
    if (!activeAsset || !activePano) return;
    await downloadPanoImage(
      activeAsset.uri,
      activePano.width,
      activePano.height,
      activeAsset.name || `${activePano.name}.png`,
      {
        letterboxEnabled: project.settings.panoLetterboxExports169,
        targetWidth: project.settings.defaultShotWidth,
        targetHeight: project.settings.defaultShotHeight,
      },
      downloadDataUrl,
    );
  };

  return (
    <WorkspaceLayout
      sidebar={(
        <>
          <Panel title="Global Reference">
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
              <IconButton onClick={() => fileInputRef.current?.click()} className="w-full">
                <ImagePlus className="h-4 w-4" />
                Import Canonical Pano
              </IconButton>
              <IconButton onClick={() => void loadAttachedReference()} className="w-full border-teal-500 bg-teal-500 text-white hover:bg-teal-600">
                <Sparkles className="h-4 w-4" />
                Use Attached Reference
              </IconButton>
              <IconButton onClick={() => void renderGrayboxPano()} disabled={isRenderingGraybox} className="w-full">
                <Download className="h-4 w-4" />
                {isRenderingGraybox ? 'Rendering Graybox...' : 'Render Graybox 360'}
              </IconButton>
              <IconButton
                onClick={() => grayboxAsset && downloadDataUrl(grayboxAsset.uri, grayboxAsset.name || 'global_graybox.png')}
                disabled={!grayboxAsset || isRenderingGraybox}
                className="w-full"
              >
                <FileDown className="h-4 w-4" />
                Download Graybox PNG
              </IconButton>
            </div>
          </Panel>

          <Panel title="Pano References">
            <div className="space-y-2">
              {project.panoRefs.length === 0 && (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
                  No pano references yet. Render the graybox scene or import a canonical pano.
                </p>
              )}
              {project.panoRefs.map((pano) => (
                <button
                  key={pano.id}
                  onClick={() => setActivePano(pano.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    pano.id === activePano?.id
                      ? 'border-teal-500 bg-teal-50 shadow-sm'
                      : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-zinc-900">{pano.name}</span>
                    {pano.isCanonical && <Star className="h-4 w-4 fill-amber-300 text-amber-300" />}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{pano.type} · {pano.width}x{pano.height}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Checks">
            <WarningList warnings={getProjectWarnings(project)} />
          </Panel>

          {activePano && (
            <Panel title="Active Pano">
              <div className="space-y-2 text-sm text-zinc-600">
                <Field label="Name">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-800">{activePano.name}</div>
                </Field>
                <div>Origin: {activePano.origin.map((item) => item.toFixed(1)).join(', ')}</div>
                <div>Projection: {activePano.projection}</div>
                <div>Yaw offset: {normalizeSignedYaw(activePano.rotation[1]).toFixed(1)}°</div>
                {activeAsset && (
                  <IconButton onClick={() => void downloadActivePano()} className="w-full">
                    <FileDown className="h-4 w-4" />
                    Download Active Pano
                  </IconButton>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Pano Export">
            <label className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={project.settings.panoLetterboxExports169}
                onChange={(event) => updateProjectSettings({ panoLetterboxExports169: event.target.checked })}
                className="mt-0.5 accent-teal-500"
              />
              <span>
                Letterbox panorama exports to 16:9
                <span className="mt-1 block text-xs text-zinc-500">
                  Wraps 2:1 equirectangular panos into {project.settings.defaultShotWidth}×{project.settings.defaultShotHeight} PNGs for image generators. Imports of 16:9 images auto-detect the embedded 2:1 region.
                </span>
              </span>
            </label>
          </Panel>

          {activePano && canCalibrate && (
            <Panel title="Calibrate to Graybox">
              <div className="space-y-3">
                <Field
                  label="Pano yaw offset"
                  hint="Rotate the canonical pano until its landmarks line up with the graybox pano. Exports and pano crop use this offset."
                >
                  <TextInput
                    type="number"
                    step="1"
                    value={normalizeSignedYaw(activePano.rotation[1])}
                    onChange={(event) => setActiveYaw(Number(event.target.value))}
                  />
                </Field>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={normalizeSignedYaw(activePano.rotation[1])}
                  onChange={(event) => setActiveYaw(Number(event.target.value))}
                  className="w-full accent-teal-500"
                />
                <div className="grid grid-cols-3 gap-2">
                  {[-5, 5].map((delta) => (
                    <IconButton
                      key={delta}
                      onClick={() => setActiveYaw(activePano.rotation[1] + delta)}
                      className="px-2"
                    >
                      {delta > 0 ? '+' : ''}{delta}°
                    </IconButton>
                  ))}
                  <IconButton onClick={() => setActiveYaw(0)} className="px-2">
                    <RotateCcw className="h-4 w-4" />
                  </IconButton>
                </div>
                <Field
                  label="Pano opacity over graybox"
                  hint="Lower this while calibrating to reveal the latest graybox pano underneath the canonical pano."
                >
                  <TextInput
                    type="number"
                    step="5"
                    min="0"
                    max="100"
                    value={Math.round(compareOpacity * 100)}
                    onChange={(event) => setCompareOpacity(clamp01(Number(event.target.value) / 100))}
                  />
                </Field>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(compareOpacity * 100)}
                  onChange={(event) => setCompareOpacity(clamp01(Number(event.target.value) / 100))}
                  className="w-full accent-teal-500"
                />
                <p className="text-xs text-zinc-500">
                  Use opacity to compare the canonical pano against the graybox render and set the yaw offset before exporting shot packages.
                </p>
              </div>
            </Panel>
          )}
        </>
      )}
    >
      <PanoViewer
        imageUrl={activeAsset?.uri}
        view={panoView}
        onViewChange={setPanoView}
        label={activePano?.name ?? 'Reference Workspace'}
        panoRotation={activePano?.rotation}
        compareImageUrl={canCalibrate ? grayboxAsset?.uri : undefined}
        compareRotation={grayboxPano?.rotation}
        compareOpacity={compareOpacity}
      />
    </WorkspaceLayout>
  );
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 4096, height: 2048 });
    image.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function normalizeSignedYaw(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}
