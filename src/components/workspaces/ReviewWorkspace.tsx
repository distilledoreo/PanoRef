import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, ImagePlus, Package, RotateCcw, Send, XCircle } from 'lucide-react';
import { ShotStatus } from '../../domain/types';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { generateImagePrompt, generateVideoPrompt } from '../../engine/prompts';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { WorkspaceSidebar } from '../common/WorkspaceSidebar';
import { ShotSelector } from '../common/ShotSelector';
import { Field, IconButton, Panel, TextArea } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { isAiBriefSent, resolveWorkspacePrimaryAction } from '../../engine/workflow';
import { NextStepHighlight } from '../common/NextStepHighlight';
import { WorkspaceLayout } from './WorkspaceShell';

export function ReviewWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isBuildingBrief, setIsBuildingBrief] = useState(false);
  const {
    project,
    selectedShotId,
    selectShot,
    updateShot,
    attachAiResultFrameToShot,
    markAiBriefSent,
    addCamera,
  } = useContinuityStore();
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const selectedShotPano = selectedShot?.linkedPanoId
    ? project.panoRefs.find((pano) => pano.id === selectedShot.linkedPanoId)
    : undefined;
  const selectedPanoAsset = selectedShotPano ? project.assets.assets[selectedShotPano.imageAssetId] : undefined;
  const selectedAiResultAsset = selectedShot?.assets.aiResultFrameAssetId
    ? project.assets.assets[selectedShot.assets.aiResultFrameAssetId]
    : selectedShot?.assets.finalBaseFrameAssetId
      ? project.assets.assets[selectedShot.assets.finalBaseFrameAssetId]
      : undefined;

  const setStatus = (status: ShotStatus) => {
    if (selectedShot) updateShot(selectedShot.id, { status });
  };

  const exportAiBrief = async () => {
    if (!selectedShot) return;
    setIsBuildingBrief(true);
    try {
      const result = await buildShotPackage(project, selectedShot);
      downloadBlob(result.blob, result.fileName);
      markAiBriefSent(selectedShot.id);
    } finally {
      setIsBuildingBrief(false);
    }
  };

  const primaryAction = useMemo(
    () => resolveWorkspacePrimaryAction({
      project,
      workspace: 'review',
      selectedShotId: selectedShot?.id,
      shotCameraFlying: false,
    }),
    [project, selectedShot?.id],
  );

  const importAiResult = async (file?: File) => {
    if (!file || !selectedShot) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    attachAiResultFrameToShot(selectedShot.id, {
      name: file.name || `shot_${selectedShot.shotNumber}_ai_result_frame.png`,
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
    });
  };

  return (
    <WorkspaceLayout
      sidebar={(
        <WorkspaceSidebar
          primary={(
            <>
              <ShotSelector
                project={project}
                selectedShotId={selectedShot?.id}
                onSelectShot={selectShot}
                onAddShot={addCamera}
              />
              {selectedShot ? (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void importAiResult(event.target.files?.[0])}
              />
              <NextStepHighlight
                active={primaryAction?.id === 'export-ai-brief'}
                hint={primaryAction?.hint}
              >
                <IconButton
                  onClick={() => void exportAiBrief()}
                  disabled={isBuildingBrief}
                  highlighted={primaryAction?.id === 'export-ai-brief'}
                  className={`w-full ${primaryAction?.id === 'export-ai-brief' ? '' : 'border-teal-500 bg-teal-500 text-white hover:bg-teal-600'}`}
                >
                  <Package className="h-4 w-4" />
                  {isBuildingBrief ? 'Building Brief...' : 'Export AI Brief ZIP'}
                </IconButton>
              </NextStepHighlight>
              {!isAiBriefSent(project, selectedShot.id) && (
                <p className="text-xs text-zinc-500">Exporting the brief also marks it sent for the production path.</p>
              )}
              {isAiBriefSent(project, selectedShot.id) && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <Send className="mr-1 inline h-3.5 w-3.5" />
                  AI brief marked sent.
                </p>
              )}
              <NextStepHighlight
                active={primaryAction?.id === 'import-ai-result'}
                hint={primaryAction?.hint}
              >
                <IconButton
                  onClick={() => fileRef.current?.click()}
                  highlighted={primaryAction?.id === 'import-ai-result'}
                  className="w-full"
                >
                  <ImagePlus className="h-4 w-4" />
                  Import AI Result Frame
                </IconButton>
              </NextStepHighlight>
            </div>
              ) : null}
            </>
          )}
          diagnostics={selectedShot ? (
            <WarningList warnings={getShotWarnings(project, selectedShot)} />
          ) : (
            <p className="text-sm text-zinc-500">No shot selected.</p>
          )}
          advanced={selectedShot && (
            <>
              <Panel title="Review Actions">
                <div className="grid grid-cols-1 gap-2">
                  <IconButton onClick={() => setStatus('approved')} active={selectedShot.status === 'approved'}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </IconButton>
                  <IconButton onClick={() => setStatus('needs_fix')} active={selectedShot.status === 'needs_fix'}>
                    <RotateCcw className="h-4 w-4" />
                    Needs Fix
                  </IconButton>
                  <IconButton onClick={() => setStatus('rejected')} active={selectedShot.status === 'rejected'}>
                    <XCircle className="h-4 w-4" />
                    Reject
                  </IconButton>
                </div>
              </Panel>
              <IconButton
                onClick={() => selectedAiResultAsset && downloadDataUrl(selectedAiResultAsset.uri, selectedAiResultAsset.name)}
                disabled={!selectedAiResultAsset}
                className="w-full"
              >
                <Download className="h-4 w-4" />
                Download AI Result
              </IconButton>
              <Field label="Image Prompt">
                <TextArea readOnly value={generateImagePrompt(project, selectedShot)} className="min-h-32 font-mono text-xs" />
              </Field>
              <Field label="Video Prompt">
                <TextArea readOnly value={generateVideoPrompt(selectedShot)} className="min-h-32 font-mono text-xs" />
              </Field>
            </>
          )}
        />
      )}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_300px] bg-white">
        <div className="grid min-h-0 grid-cols-1 gap-0 lg:grid-cols-2">
          <ReviewImage title="Linked Pano Reference" src={selectedPanoAsset?.uri} emptyText="No linked pano reference" />
          <ReviewImage title="AI Result Frame" src={selectedAiResultAsset?.uri} emptyText="Export the AI brief, generate externally, then import a result frame." />
        </div>
        <div className="grid min-h-0 grid-cols-1 border-t border-zinc-200 lg:grid-cols-2">
          <div className="min-h-0 overflow-y-auto border-b border-zinc-200 p-4 lg:border-b-0 lg:border-r">
            <Field label="Image Prompt">
              <TextArea readOnly value={selectedShot ? generateImagePrompt(project, selectedShot) : ''} className="min-h-56 font-mono text-xs" />
            </Field>
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <Field label="Video Prompt">
              <TextArea readOnly value={selectedShot ? generateVideoPrompt(selectedShot) : ''} className="min-h-56 font-mono text-xs" />
            </Field>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}

function ReviewImage({ title, src, emptyText }: { title: string; src?: string; emptyText: string }) {
  return (
    <div className="relative min-h-0 border-b border-zinc-200 bg-zinc-50 lg:border-b-0 lg:border-r">
      <div className="absolute left-4 top-4 z-10 rounded-md border border-white/70 bg-white/90 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-700 shadow-sm backdrop-blur">
        {title}
      </div>
      {src ? (
        <img src={src} alt={title} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-500">{emptyText}</div>
      )}
    </div>
  );
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 1920, height: 1080 });
    image.src = dataUrl;
  });
}
