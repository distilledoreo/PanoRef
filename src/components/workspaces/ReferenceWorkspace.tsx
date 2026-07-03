import React, { useMemo, useState } from 'react';
import { Check, FileDown, MapPin, Sparkles, Star } from 'lucide-react';
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
import { PanoViewer } from '../viewers/PanoViewer';
import {
  hasReferenceCandidate,
  isReferenceAlignmentAccepted,
  isReferenceReady,
  needsReferenceAlignment,
  resolveWorkspacePrimaryAction,
} from '../../engine/workflow';
import { FullBleedLayout } from './WorkspaceShell';

export function ReferenceWorkspace() {
  const [compareOpacity, setCompareOpacity] = useState(0.65);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [landmarksOpen, setLandmarksOpen] = useState(false);
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
    <FullBleedLayout>
      <div className="relative h-full min-h-0">
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <ContextualPanel className="max-w-sm text-center">
              <p className="text-sm text-secondary">
                {grayboxPano
                  ? 'Import a styled pano or approve the graybox to begin.'
                  : 'Render a graybox in Build first.'}
              </p>
              <div className="pointer-events-auto mt-3 flex flex-col gap-2">
                <StyledPanoImportButton primary highlighted={primaryAction?.id === 'import-styled-pano'} />
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
            </ContextualPanel>
          </div>
        )}

        {activeAsset && (
          <div className="pointer-events-none absolute left-1/2 top-1/3 z-10 -translate-x-1/2">
            <ContextualPanel className="text-center text-sm text-secondary">
              Drag to look around
              <span className="mt-1 block text-xs text-muted">Tap markers to focus</span>
            </ContextualPanel>
          </div>
        )}

        {project.landmarks.length > 0 && (
          <div className="pointer-events-none absolute bottom-28 left-6 z-10">
            <button
              type="button"
              onClick={() => setLandmarksOpen((open) => !open)}
              className="pointer-events-auto"
            >
              <ContextualPanel className="flex items-center gap-2 text-sm text-secondary">
                <MapPin className="h-4 w-4 text-accent" />
                Landmarks
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                  {project.landmarks.length}
                </span>
              </ContextualPanel>
            </button>
            {landmarksOpen && (
              <div className="pointer-events-auto mt-2 w-72 rounded-[var(--radius-card)] border border-subtle bg-surface-raised p-3 shadow-soft">
                <div className="space-y-2">
                  {project.landmarks.map((landmark) => (
                    <div key={landmark.id} className="rounded-lg border border-subtle px-3 py-2 text-sm">
                      <div className="font-medium text-primary">{landmark.displayName}</div>
                      {landmark.description && (
                        <div className="text-xs text-secondary">{landmark.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-6 right-6 z-10">
          <PrimaryCTA
            icon={<Check className="h-5 w-5" />}
            label="Approve as Reference"
            hint="Looks good? Lock this pano for your shots."
            onClick={approveReference}
            highlighted={primaryAction?.id === 'confirm-alignment' || isReferenceReady(project)}
          />
        </div>

        {canCalibrate && activePano && (
          <div className="pointer-events-none absolute right-6 top-20 z-10">
            <button type="button" onClick={() => setPrecisionOpen(true)} className="pointer-events-auto">
              <ContextualPanel className="text-sm text-secondary">
                Alignment controls
              </ContextualPanel>
            </button>
          </div>
        )}
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
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary">Pano References</h3>
            {project.panoRefs.map((pano) => (
              <button
                key={pano.id}
                type="button"
                onClick={() => setActivePano(pano.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  pano.id === activePano?.id ? 'border-[var(--accent)] bg-accent-soft' : 'border-subtle'
                }`}
              >
                <div className="font-medium text-primary">{pano.name}</div>
                <div className="text-xs text-secondary">{pano.type}</div>
              </button>
            ))}
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