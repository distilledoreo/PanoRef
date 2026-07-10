import React, { useMemo, useState } from 'react';
import { Check, FileDown, Hand, Sparkles, Star, Trash2 } from 'lucide-react';
import { STYLED_PANO } from '../../domain/copy';
import { useContinuityStore } from '../../state/useContinuityStore';
import { preparePanoImport, downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { ReferenceAlignmentPanel } from '../common/ReferenceAlignmentPanel';
import { StyledPanoImportButton } from '../common/StyledPanoImportButton';
import { ContextualPanel } from '../common/ContextualPanel';
import { Field, IconButton, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { LandmarkStrip, PanoLandmarkMarkers } from '../viewers/PanoLandmarkOverlay';
import { PanoViewer } from '../viewers/PanoViewer';
import { directionToYawPitch, subtract } from '../../engine/sync';
import {
  hasReferenceCandidate,
  hasStyledCanonicalPano,
  isReferenceAlignmentAccepted,
  isReferenceReady,
  needsReferenceAlignment,
  resolveWorkspacePrimaryAction,
} from '../../engine/workflow';
import { FullBleedLayout } from './WorkspaceShell';

export function ReferenceWorkspace() {
  const [compareOpacity, setCompareOpacity] = useState(0.65);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [focusedLandmarkId, setFocusedLandmarkId] = useState<string | undefined>();
  const {
    project,
    activePanoId,
    panoView,
    setActivePano,
    setPanoView,
    updatePanoReference,
    updateProjectSettings,
    importCanonicalPano,
    removePanoReference,
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

  const panoOrigin = activePano?.origin ?? project.scene.panoOrigin;

  const focusLandmark = (landmarkId: string, yawDegrees?: number, pitchDegrees?: number) => {
    setFocusedLandmarkId(landmarkId);
    const landmark = project.landmarks.find((item) => item.id === landmarkId);
    if (!landmark) return;
    if (yawDegrees !== undefined && pitchDegrees !== undefined) {
      setPanoView({ yawDegrees, pitchDegrees });
      return;
    }
    const { yawDegrees: targetYaw, pitchDegrees: targetPitch } = directionToYawPitch(
      subtract(landmark.position, panoOrigin),
    );
    setPanoView({ yawDegrees: targetYaw, pitchDegrees: targetPitch });
  };

  const approveReference = () => {
    if (canCalibrate && needsReferenceAlignment(project) && !alignmentAccepted) {
      acceptReferenceAlignment();
      return;
    }
    if (grayboxPano && !hasReferenceCandidate(project)) {
      approveGrayboxForReference();
    }
  };

  return (
    <FullBleedLayout reserveHeader>
      <div className="flex h-full min-h-0 flex-col p-4 md:p-5">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-subtle bg-surface-raised shadow-card">
          <div className="relative min-h-0 flex-1">
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

            {!activeAsset && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-surface-base/55 backdrop-blur-[2px]">
                <ContextualPanel className="max-w-md text-center">
                  <p className="text-base font-semibold text-primary">
                    {grayboxPano
                      ? 'Import a styled pano or approve the graybox to begin.'
                      : 'Render a graybox in Build first.'}
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    Use your own reference image or the attached sample to continue.
                  </p>
                  <div className="pointer-events-auto mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <StyledPanoImportButton
                      primary
                      highlighted={primaryAction?.id === 'import-styled-pano'}
                      className="min-w-44"
                    />
                    <IconButton onClick={() => void loadAttachedReference()} className="min-w-44">
                      <Sparkles className="h-4 w-4" />
                      Use Attached Reference
                    </IconButton>
                  </div>
                  {grayboxPano && !hasReferenceCandidate(project) && (
                    <button
                      type="button"
                      onClick={() => approveGrayboxForReference()}
                      className="pointer-events-auto mt-3 inline-flex items-center gap-2 text-sm text-secondary transition hover:text-accent"
                    >
                      <Star className="h-4 w-4" />
                      Use graybox only (skip styling)
                    </button>
                  )}
                </ContextualPanel>
              </div>
            )}

            {activeAsset && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
                <div className="rounded-full border border-subtle/70 bg-surface-overlay/55 px-3 py-1.5 text-center text-xs font-medium text-secondary shadow-soft backdrop-blur-sm">
                  <Hand className="mr-1 inline h-3.5 w-3.5 text-accent" />
                  Drag to look around
                </div>
              </div>
            )}

            {activeAsset && project.landmarks.length > 0 && (
              <PanoLandmarkMarkers
                landmarks={project.landmarks}
                panoOrigin={panoOrigin}
                view={panoView}
                focusedLandmarkId={focusedLandmarkId}
                onFocusLandmark={focusLandmark}
              />
            )}

            {activeAsset && grayboxPano && !hasStyledCanonicalPano(project) && (
              <div className="pointer-events-none absolute left-5 top-5 z-20">
                <ContextualPanel className="flex flex-wrap items-center gap-2">
                  <StyledPanoImportButton
                    label="Import styled pano"
                    primary
                    highlighted={primaryAction?.id === 'import-styled-pano'}
                    className="min-w-40"
                  />
                  <IconButton onClick={() => void loadAttachedReference()}>
                    <Sparkles className="h-4 w-4" />
                    Use Attached Reference
                  </IconButton>
                </ContextualPanel>
              </div>
            )}

            <div
              data-reference-bottom-chrome
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-3 pb-3 sm:flex-row sm:items-end sm:gap-3 sm:px-4 sm:pb-4"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                {grayboxAsset && grayboxPano && (
                  <div className="pointer-events-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => void downloadPanoImage(
                        grayboxAsset.uri,
                        grayboxPano.width,
                        grayboxPano.height,
                        grayboxAsset.name || 'global_graybox.png',
                        {
                          letterboxEnabled: project.settings.panoLetterboxExports169,
                          targetWidth: project.settings.defaultShotWidth,
                          targetHeight: project.settings.defaultShotHeight,
                        },
                        downloadDataUrl,
                      )}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-subtle bg-surface-raised px-4 py-2.5 text-sm font-medium text-secondary shadow-card transition hover:border-[var(--accent)] hover:text-accent"
                    >
                      <FileDown className="h-4 w-4" />
                      <span className="hidden xs:inline sm:inline">Download Graybox 360</span>
                      <span className="sm:hidden">Graybox</span>
                    </button>
                  </div>
                )}
                {activeAsset && project.landmarks.length > 0 && (
                  <div className="pointer-events-auto min-w-0 max-w-full flex-1 sm:max-w-[calc(100%-var(--reference-cta-lane))]">
                    <LandmarkStrip
                      landmarks={project.landmarks.filter((landmark) => landmark.visible)}
                      panoImageUrl={activeAsset.uri}
                      panoOrigin={panoOrigin}
                      focusedLandmarkId={focusedLandmarkId}
                      onFocusLandmark={(landmarkId) => focusLandmark(landmarkId)}
                    />
                  </div>
                )}
              </div>
              <div className="pointer-events-none w-full shrink-0 sm:ml-auto sm:w-auto">
                <PrimaryCTA
                  icon={<Check className="h-5 w-5" />}
                  label="Approve as Reference"
                  hint="Looks good? Lock this pano for your shots."
                  onClick={approveReference}
                  highlighted={primaryAction?.id === 'confirm-alignment' || isReferenceReady(project)}
                />
              </div>
            </div>

            {canCalibrate && activePano && (
              <div
                data-reference-alignment-chrome
                className="pointer-events-none absolute right-5 top-5 z-20 w-[min(18rem,calc(100%-2.5rem))]"
              >
                <ContextualPanel className="pointer-events-auto space-y-3 shadow-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-secondary">Alignment</div>
                      <p className="mt-0.5 text-xs text-secondary">Fade and yaw to match the graybox.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrecisionOpen(true)}
                      className="shrink-0 text-[11px] font-medium text-accent hover:underline"
                    >
                      More
                    </button>
                  </div>
                  <label className="block text-[11px] font-medium text-secondary">
                    Graybox fade
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(compareOpacity * 100)}
                      onChange={(event) => setCompareOpacity(Number(event.target.value) / 100)}
                      className="mt-1 w-full accent-[var(--accent)]"
                      aria-label="Graybox compare opacity"
                    />
                  </label>
                  <label className="block text-[11px] font-medium text-secondary">
                    Yaw ({Math.round(activePano.rotation[1])}°)
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={activePano.rotation[1]}
                      onChange={(event) => setActiveYaw(Number(event.target.value))}
                      className="mt-1 w-full accent-[var(--accent)]"
                      aria-label="Styled pano yaw"
                      data-reference-yaw-slider
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[-5, 5].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => setActiveYaw(activePano.rotation[1] + delta)}
                        className="rounded-lg border border-subtle px-2 py-1 text-[11px] font-medium text-secondary hover:border-accent hover:text-accent"
                      >
                        {delta > 0 ? '+' : ''}{delta}°
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setActiveYaw(0)}
                      className="rounded-lg border border-subtle px-2 py-1 text-[11px] font-medium text-secondary hover:border-accent hover:text-accent"
                    >
                      Reset
                    </button>
                  </div>
                </ContextualPanel>
              </div>
            )}

          </div>
        </div>
      </div>

      <PrecisionDrawer open={precisionOpen} title="Reference Settings" onClose={() => setPrecisionOpen(false)}>
        <div className="space-y-4">
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
          <div className="space-y-2" data-pano-reference-list>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary">Pano References</h3>
            {project.panoRefs.length === 0 && (
              <p className="text-sm text-secondary">No pano references yet.</p>
            )}
            {project.panoRefs.map((pano) => {
              const isActive = pano.id === activePano?.id;
              const isUploaded = pano.type === 'ai_global_reference' || pano.type === 'external_reference';
              const typeLabel = pano.type === 'graybox_render'
                ? 'Graybox render'
                : pano.type === 'ai_global_reference'
                  ? 'Uploaded styled pano'
                  : pano.type === 'external_reference'
                    ? 'External reference'
                    : pano.type;
              return (
                <div
                  key={pano.id}
                  className={`flex items-stretch gap-1 rounded-lg border transition ${
                    isActive ? 'border-[var(--accent)] bg-accent-soft' : 'border-subtle'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActivePano(pano.id)}
                    className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                  >
                    <div className="truncate font-medium text-primary">
                      {pano.name}
                      {pano.isCanonical ? ' · canonical' : ''}
                    </div>
                    <div className="truncate text-xs text-secondary">{typeLabel}</div>
                  </button>
                  <button
                    type="button"
                    title={isUploaded ? 'Remove uploaded pano' : 'Remove pano reference'}
                    aria-label={`Remove ${pano.name}`}
                    data-remove-pano={pano.id}
                    onClick={() => {
                      const label = isUploaded ? 'uploaded pano' : 'pano reference';
                      if (!window.confirm(`Remove this ${label}? Shots will re-link to the remaining canonical pano if one exists.`)) {
                        return;
                      }
                      removePanoReference(pano.id);
                    }}
                    className="inline-flex shrink-0 items-center justify-center px-2.5 text-secondary transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
          {activePano && (
            <>
              <Field label="Name">
                <TextInput value={activePano.name} readOnly />
              </Field>
              {activeAsset && (
                <IconButton onClick={() => void downloadActivePano()} className="w-full">
                  <FileDown className="h-4 w-4" />
                  Download Active Pano
                </IconButton>
              )}
              {(activePano.type === 'ai_global_reference' || activePano.type === 'external_reference') && (
                <IconButton
                  onClick={() => {
                    if (!window.confirm('Remove this uploaded pano reference?')) return;
                    removePanoReference(activePano.id);
                  }}
                  className="w-full border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                  data-remove-active-pano
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Uploaded Pano
                </IconButton>
              )}
            </>
          )}
          <label className="flex items-start gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={project.settings.panoLetterboxExports169}
              onChange={(event) => updateProjectSettings({ panoLetterboxExports169: event.target.checked })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              Letterbox panorama exports to 16:9
              <span className="mt-1 block text-xs text-muted">
                Wraps 2:1 equirectangular panos into {project.settings.defaultShotWidth}×{project.settings.defaultShotHeight} PNGs.
              </span>
            </span>
          </label>
          {needsReferenceAlignment(project) && !alignmentAccepted && (
            <button
              type="button"
              onClick={() => requestAlignmentIntro()}
              className="w-full rounded-lg border border-subtle px-3 py-2 text-sm text-secondary transition hover:border-accent hover:text-accent"
            >
              Reopen alignment guide
            </button>
          )}
          {!grayboxPano && (
            <p className="text-sm text-secondary">
              Render a graybox in Build first. Then open Objective for the image AI prompt.
            </p>
          )}
          {!canCalibrate && grayboxPano && (
            <p className="text-sm text-secondary">
              Import a {STYLED_PANO.short} to compare it against the graybox.
            </p>
          )}
        </div>
      </PrecisionDrawer>
    </FullBleedLayout>
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
