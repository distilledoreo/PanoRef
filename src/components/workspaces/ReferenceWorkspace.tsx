import React, { useMemo, useState } from 'react';
import { FileDown, Sparkles, Star } from 'lucide-react';
import { STYLED_PANO } from '../../domain/copy';
import { useContinuityStore } from '../../state/useContinuityStore';
import { preparePanoImport, downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { ReferenceAlignmentPanel } from '../common/ReferenceAlignmentPanel';
import { StyledPanoImportButton } from '../common/StyledPanoImportButton';
import { WorkspaceSidebar } from '../common/WorkspaceSidebar';
import { Field, IconButton, Panel, TextInput } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { PanoViewer } from '../viewers/PanoViewer';
import {
  hasReferenceCandidate,
  isReferenceAlignmentAccepted,
  isReferenceReady,
  needsReferenceAlignment,
  resolveWorkspacePrimaryAction,
} from '../../engine/workflow';
import { NextStepHighlight } from '../common/NextStepHighlight';
import { getProjectWarnings } from '../../engine/warnings';
import { WorkspaceLayout } from './WorkspaceShell';

export function ReferenceWorkspace() {
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
    approveGrayboxForReference,
    acceptReferenceAlignment,
    requestAlignmentIntro,
    requestAlignmentRetryModal,
  } = useContinuityStore();
  const activePano = project.panoRefs.find((pano) => pano.id === activePanoId) ?? project.panoRefs.find((pano) => pano.isCanonical);
  const activeAsset = activePano ? project.assets.assets[activePano.imageAssetId] : undefined;
  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);
  const canCalibrate = Boolean(activePano && activePano.type !== 'graybox_render' && grayboxPano);
  const alignmentPending = needsReferenceAlignment(project) && !isReferenceAlignmentAccepted(project);
  const alignmentAccepted = isReferenceAlignmentAccepted(project);
  const primaryAction = useMemo(
    () => resolveWorkspacePrimaryAction({ project, workspace: 'reference', shotCameraFlying: false }),
    [project],
  );

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
        <WorkspaceSidebar
          primary={(
            <div className="space-y-2">
              {canCalibrate && activePano && (
                <ReferenceAlignmentPanel
                  activePano={activePano}
                  compareOpacity={compareOpacity}
                  onYawChange={setActiveYaw}
                  onOpacityChange={setCompareOpacity}
                  onAcceptAlignment={() => acceptReferenceAlignment()}
                  onShowRetryTips={() => requestAlignmentRetryModal()}
                  alignmentAccepted={alignmentAccepted}
                  highlightNextStep={primaryAction?.id === 'confirm-alignment'}
                />
              )}
              {!grayboxPano && (
                <p className="text-sm text-zinc-600">
                  Render a graybox in Build first. Then open Objective for the image AI prompt.
                </p>
              )}
              {alignmentPending && (
                <button
                  type="button"
                  onClick={() => requestAlignmentIntro()}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:border-teal-300 hover:text-teal-700"
                >
                  Reopen alignment guide
                </button>
              )}
              <NextStepHighlight
                active={primaryAction?.id === 'import-styled-pano'}
                hint={primaryAction?.hint}
              >
                <StyledPanoImportButton
                  primary={primaryAction?.id !== 'import-styled-pano'}
                  highlighted={primaryAction?.id === 'import-styled-pano'}
                />
              </NextStepHighlight>
              <IconButton onClick={() => void loadAttachedReference()} className="w-full">
                <Sparkles className="h-4 w-4" />
                Use Attached Reference
              </IconButton>
              {grayboxPano && !hasReferenceCandidate(project) && (
                <IconButton onClick={() => approveGrayboxForReference()} className="w-full">
                  <Star className="h-4 w-4" />
                  Use graybox only (skip styling)
                </IconButton>
              )}
            </div>
          )}
          diagnostics={(
            <>
              <WarningList warnings={getProjectWarnings(project)} />
              {grayboxPano && !canCalibrate && (
                <p className="text-sm text-zinc-600">
                  Import a {STYLED_PANO.short} to compare it against the graybox.
                </p>
              )}
              {isReferenceReady(project) && (
                <p className="text-sm text-emerald-800">
                  Reference is ready. You can move on to Shots.
                </p>
              )}
            </>
          )}
          advanced={(
            <>
          <Panel title="Pano References">
            <div className="space-y-2">
              {project.panoRefs.length === 0 && (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
                  No pano references yet. Render the graybox scene or import a {STYLED_PANO.short}.
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
            </>
          )}
        />
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