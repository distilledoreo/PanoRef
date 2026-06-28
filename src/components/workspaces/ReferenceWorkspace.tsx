import React, { useRef, useState } from 'react';
import { Download, Eraser, FileDown, ImagePlus, Paintbrush, RotateCcw, Sparkles, Star } from 'lucide-react';
import { useContinuityStore } from '../../state/useContinuityStore';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { Field, IconButton, Panel, Select, TextInput } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { PanoViewer } from '../viewers/PanoViewer';
import { getProjectWarnings } from '../../engine/warnings';
import { WorkspaceLayout } from './BuildWorkspace';
import { createId } from '../../utils/ids';

export function ReferenceWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [compareOpacity, setCompareOpacity] = useState(0.65);
  const [panoLayerFov, setPanoLayerFov] = useState(65);
  const [grayboxLayerFov, setGrayboxLayerFov] = useState(65);
  const {
    project,
    activePanoId,
    selectedObjectId,
    panoView,
    setActivePano,
    setPanoView,
    selectObject,
    updateObject,
    updatePanoReference,
    importCanonicalPano,
    renderGrayboxPano,
    isRenderingGraybox,
  } = useContinuityStore();
  const activePano = project.panoRefs.find((pano) => pano.id === activePanoId) ?? project.panoRefs.find((pano) => pano.isCanonical);
  const activeAsset = activePano ? project.assets.assets[activePano.imageAssetId] : undefined;
  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);
  const canCalibrate = Boolean(activePano && activePano.type !== 'graybox_render' && grayboxPano);
  const stampableObjects = project.scene.objects.filter((object) => (
    object.visible && (object.category === 'architecture' || object.category === 'environment')
  ));
  const activeStampObject = stampableObjects.find((object) => object.id === selectedObjectId) ?? stampableObjects[0];
  const stampCount = project.scene.objects.filter((object) => (
    object.projectionStamp?.panoId === activePano?.id
  )).length;
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
  const setPanoFov = (fovDegrees: number) => setPanoLayerFov(clampFovDegrees(fovDegrees));
  const setGrayboxFov = (fovDegrees: number) => setGrayboxLayerFov(clampFovDegrees(fovDegrees));
  const stampActiveObject = () => {
    if (!activePano || !activeStampObject || !canCalibrate) return;
    updateObject(activeStampObject.id, {
      projectionStamp: {
        id: createId('stamp'),
        panoId: activePano.id,
        panoYawDegrees: activePano.rotation[1],
        yawDegrees: panoView.yawDegrees,
        pitchDegrees: panoView.pitchDegrees,
        viewFovDegrees: grayboxLayerFov,
        panoFovDegrees: panoLayerFov,
        opacity: compareOpacity,
        aspectRatio: 16 / 9,
        createdAt: new Date().toISOString(),
      },
    });
  };
  const clearActiveStamp = () => {
    if (!activeStampObject) return;
    updateObject(activeStampObject.id, { projectionStamp: undefined });
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    importCanonicalPano({ name: file.name, dataUrl, width: dimensions.width, height: dimensions.height });
  };

  const loadAttachedReference = async () => {
    const response = await fetch('/attached-canonical-reference.png');
    if (!response.ok) throw new Error('Could not load the attached canonical reference.');
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    const dimensions = await getImageDimensions(dataUrl);
    importCanonicalPano({
      name: 'attached-canonical-reference.png',
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
    });
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
              <IconButton onClick={() => void loadAttachedReference()} className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400">
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
                <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-500">
                  No pano references yet. Render the graybox scene or import a canonical pano.
                </p>
              )}
              {project.panoRefs.map((pano) => (
                <button
                  key={pano.id}
                  onClick={() => setActivePano(pano.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    pano.id === activePano?.id
                      ? 'border-cyan-400 bg-cyan-950/60'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-slate-100">{pano.name}</span>
                    {pano.isCanonical && <Star className="h-4 w-4 fill-amber-300 text-amber-300" />}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{pano.type} · {pano.width}x{pano.height}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Checks">
            <WarningList warnings={getProjectWarnings(project)} />
          </Panel>

          {activePano && (
            <Panel title="Active Pano">
              <div className="space-y-2 text-sm text-slate-400">
                <Field label="Name">
                  <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200">{activePano.name}</div>
                </Field>
                <div>Origin: {activePano.origin.map((item) => item.toFixed(1)).join(', ')}</div>
                <div>Projection: {activePano.projection}</div>
                <div>Yaw offset: {normalizeSignedYaw(activePano.rotation[1]).toFixed(1)}°</div>
                {activeAsset && (
                  <IconButton
                    onClick={() => downloadDataUrl(activeAsset.uri, activeAsset.name || `${activePano.name}.png`)}
                    className="w-full"
                  >
                    <FileDown className="h-4 w-4" />
                    Download Active Pano
                  </IconButton>
                )}
              </div>
            </Panel>
          )}

          {activePano && canCalibrate && (
            <Panel title="Calibrate to Graybox">
              <div className="space-y-3">
                <Field
                  label="Pano yaw offset"
                  hint="Rotate the canonical pano until its landmarks line up with the graybox pano. Exports and projection use this offset."
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
                  className="w-full accent-cyan-400"
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
                  className="w-full accent-cyan-400"
                />
                <Field
                  label="Pano FOV"
                  hint="Adjust only the canonical pano overlay FOV for visual calibration."
                >
                  <TextInput
                    type="number"
                    step="1"
                    min="18"
                    max="120"
                    value={Math.round(panoLayerFov)}
                    onChange={(event) => setPanoFov(Number(event.target.value))}
                  />
                </Field>
                <input
                  type="range"
                  min="18"
                  max="120"
                  step="1"
                  value={Math.round(panoLayerFov)}
                  onChange={(event) => setPanoFov(Number(event.target.value))}
                  className="w-full accent-cyan-400"
                />
                <Field
                  label="Graybox FOV"
                  hint="Adjust only the graybox pano layer FOV while comparing through the opacity overlay."
                >
                  <TextInput
                    type="number"
                    step="1"
                    min="18"
                    max="120"
                    value={Math.round(grayboxLayerFov)}
                    onChange={(event) => setGrayboxFov(Number(event.target.value))}
                  />
                </Field>
                <input
                  type="range"
                  min="18"
                  max="120"
                  step="1"
                  value={Math.round(grayboxLayerFov)}
                  onChange={(event) => setGrayboxFov(Number(event.target.value))}
                  className="w-full accent-cyan-400"
                />
                <p className="text-xs text-slate-500">
                  Use opacity with separate pano and graybox FOVs to diagnose optical mismatch. These FOV sliders are preview-only and do not change exports.
                </p>
              </div>
            </Panel>
          )}

          {activePano && canCalibrate && (
            <Panel title="Object Stamps">
              <div className="space-y-3">
                <Field
                  label="Object"
                  hint="Choose a graybox object, align the overlay, then stamp only that object."
                >
                  <Select
                    value={activeStampObject?.id ?? ''}
                    onChange={(event) => selectObject(event.target.value || undefined)}
                  >
                    {stampableObjects.map((object) => (
                      <option key={object.id} value={object.id}>{object.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <IconButton onClick={stampActiveObject} disabled={!activeStampObject} className="px-2">
                    <Paintbrush className="h-4 w-4" />
                    Stamp Object
                  </IconButton>
                  <IconButton onClick={clearActiveStamp} disabled={!activeStampObject?.projectionStamp} className="px-2">
                    <Eraser className="h-4 w-4" />
                    Clear Stamp
                  </IconButton>
                </div>
                {activeStampObject?.projectionStamp ? (
                  <div className="rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2 font-mono text-xs text-cyan-100">
                    {activeStampObject.name}: yaw {activeStampObject.projectionStamp.yawDegrees.toFixed(1)} / pano {activeStampObject.projectionStamp.panoFovDegrees.toFixed(0)}° / gray {activeStampObject.projectionStamp.viewFovDegrees.toFixed(0)}°
                  </div>
                ) : (
                  <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-500">
                    No stamp on this object yet.
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Stamped exports texture only matching stamped objects from this pano; unstamped architecture remains clay so the brief does not pretend hidden alignment exists. Current pano stamps: {stampCount}.
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
        panoFovDegrees={canCalibrate ? panoLayerFov : undefined}
        compareImageUrl={canCalibrate ? grayboxAsset?.uri : undefined}
        compareRotation={grayboxPano?.rotation}
        compareFovDegrees={canCalibrate ? grayboxLayerFov : undefined}
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

function clampFovDegrees(value: number) {
  if (!Number.isFinite(value)) return 65;
  return Math.max(18, Math.min(120, value));
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}
