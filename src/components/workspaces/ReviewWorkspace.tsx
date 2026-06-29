import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, ImagePlus, Package, RotateCcw, XCircle } from 'lucide-react';
import { ShotStatus } from '../../domain/types';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { generateImagePrompt, generateVideoPrompt } from '../../engine/prompts';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, TextArea } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { WorkspaceLayout } from './BuildWorkspace';

export function ReviewWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isBuildingBrief, setIsBuildingBrief] = useState(false);
  const {
    project,
    selectedShotId,
    selectShot,
    updateShot,
    attachAiResultFrameToShot,
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
    } finally {
      setIsBuildingBrief(false);
    }
  };

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
        <>
          <Panel title="Shots">
            <div className="space-y-2">
              {project.shots.map((shot) => (
                <button
                  key={shot.id}
                  onClick={() => selectShot(shot.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    selectedShot?.id === shot.id
                      ? 'border-teal-500 bg-teal-50 shadow-sm'
                      : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-900">{shot.name}</span>
                    <span className="text-xs text-zinc-500">{shot.status}</span>
                  </div>
                </button>
              ))}
              {project.shots.length === 0 && <p className="text-sm text-zinc-500">No shots are ready for review.</p>}
            </div>
          </Panel>

          {selectedShot && (
            <>
              <Panel title="AI Image Handoff">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => void importAiResult(event.target.files?.[0])}
                />
                <IconButton onClick={() => void exportAiBrief()} disabled={isBuildingBrief} className="w-full border-teal-500 bg-teal-500 text-white hover:bg-teal-600">
                  <Package className="h-4 w-4" />
                  {isBuildingBrief ? 'Building Brief...' : 'Export AI Brief ZIP'}
                </IconButton>
                <IconButton onClick={() => fileRef.current?.click()} className="mt-2 w-full">
                  <ImagePlus className="h-4 w-4" />
                  Import AI Result Frame
                </IconButton>
                <IconButton
                  onClick={() => selectedAiResultAsset && downloadDataUrl(selectedAiResultAsset.uri, selectedAiResultAsset.name)}
                  disabled={!selectedAiResultAsset}
                  className="mt-2 w-full"
                >
                  <Download className="h-4 w-4" />
                  Download AI Result
                </IconButton>
              </Panel>

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

              <Panel title="Checks">
                <WarningList warnings={getShotWarnings(project, selectedShot)} />
              </Panel>
            </>
          )}
        </>
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
