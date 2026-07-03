import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Grid3X3,
  ImagePlus,
  List,
  MessageSquare,
  Package,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react';
import { Shot, ShotStatus } from '../../domain/types';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { generateImagePrompt, generateVideoPrompt } from '../../engine/prompts';
import { downloadDataUrl, readFileAsDataUrl } from '../../engine/projectIO';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, TextArea } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { StatusGlow } from '../common/StatusBadge';
import { isAiBriefSent, resolveWorkspacePrimaryAction } from '../../engine/workflow';
import { FullBleedLayout } from './WorkspaceShell';

type ReviewFilter = 'all' | 'approved' | 'needs_work';
type ReviewView = 'grid' | 'list';

export function ReviewWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isBuildingBrief, setIsBuildingBrief] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [view, setView] = useState<ReviewView>('grid');
  const [selectedDetailShotId, setSelectedDetailShotId] = useState<string | undefined>();
  const [precisionOpen, setPrecisionOpen] = useState(false);
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
  const detailShot = project.shots.find((shot) => shot.id === selectedDetailShotId) ?? selectedShot;
  const selectedShotPano = detailShot?.linkedPanoId
    ? project.panoRefs.find((pano) => pano.id === detailShot.linkedPanoId)
    : undefined;
  const selectedPanoAsset = selectedShotPano ? project.assets.assets[selectedShotPano.imageAssetId] : undefined;
  const selectedAiResultAsset = detailShot?.assets.aiResultFrameAssetId
    ? project.assets.assets[detailShot.assets.aiResultFrameAssetId]
    : detailShot?.assets.finalBaseFrameAssetId
      ? project.assets.assets[detailShot.assets.finalBaseFrameAssetId]
      : undefined;

  const setStatus = (status: ShotStatus, shotId?: string) => {
    const id = shotId ?? detailShot?.id;
    if (id) updateShot(id, { status });
  };

  const exportAiBrief = async (shot = detailShot) => {
    if (!shot) return;
    setIsBuildingBrief(true);
    try {
      const result = await buildShotPackage(project, shot);
      downloadBlob(result.blob, result.fileName);
      markAiBriefSent(shot.id);
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

  const importAiResult = async (file?: File, shotId?: string) => {
    const shot = project.shots.find((item) => item.id === (shotId ?? detailShot?.id));
    if (!file || !shot) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    attachAiResultFrameToShot(shot.id, {
      name: file.name || `shot_${shot.shotNumber}_ai_result_frame.png`,
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
    });
  };

  const approvedCount = project.shots.filter((shot) => shot.status === 'approved').length;
  const needsWorkCount = project.shots.filter((shot) => shot.status === 'needs_fix' || getShotWarnings(project, shot).length > 0).length;
  const progress = project.shots.length > 0 ? approvedCount / project.shots.length : 0;

  const filteredShots = project.shots.filter((shot) => {
    if (filter === 'approved') return shot.status === 'approved';
    if (filter === 'needs_work') return shot.status === 'needs_fix' || getShotWarnings(project, shot).length > 0;
    return true;
  });

  return (
    <FullBleedLayout>
      <div className="flex h-full min-h-0 flex-col bg-surface-base p-5">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-primary">Review Your Shots</h1>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="text-sm text-secondary">
              Approved <span className="font-semibold text-primary">{approvedCount}</span> / {project.shots.length}
            </div>
            <div className="h-2 w-48 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <FilterTab active={filter === 'all'} onClick={() => setFilter('all')} label={`All (${project.shots.length})`} />
              <FilterTab active={filter === 'approved'} onClick={() => setFilter('approved')} label={`Approved (${approvedCount})`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
              <FilterTab active={filter === 'needs_work'} onClick={() => setFilter('needs_work')} label={`Needs Work (${needsWorkCount})`} icon={<Clock className="h-3.5 w-3.5" />} warning />
            </div>
            <div className="flex gap-1 rounded-lg border border-subtle p-1">
              <ViewToggle active={view === 'grid'} onClick={() => setView('grid')} icon={<Grid3X3 className="h-4 w-4" />} label="Grid" />
              <ViewToggle active={view === 'list'} onClick={() => setView('list')} icon={<List className="h-4 w-4" />} label="List" />
            </div>
          </div>
        </header>

        <div className={`min-h-0 flex-1 ${view === 'grid' ? 'grid grid-cols-2 gap-4 md:grid-cols-3' : 'space-y-2 overflow-y-auto'}`}>
          {filteredShots.map((shot) => (
            <div key={shot.id}>
              <ShotReviewCard
                shot={shot}
                project={project}
                view={view}
                selected={shot.id === detailShot?.id}
                onSelect={() => {
                  setSelectedDetailShotId(shot.id);
                  selectShot(shot.id);
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <ActionBarButton icon={<Grid3X3 className="h-4 w-4" />} label="Compare" onClick={() => setPrecisionOpen(true)} />
          <ActionBarButton
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Approve All"
            onClick={() => project.shots.forEach((shot) => setStatus('approved', shot.id))}
          />
          <ActionBarButton
            icon={<RotateCcw className="h-4 w-4" />}
            label="Mark for Rework"
            onClick={() => detailShot && setStatus('needs_fix')}
          />
          <ActionBarButton icon={<MessageSquare className="h-4 w-4" />} label="Add Notes" onClick={() => setPrecisionOpen(true)} />
          <div className="ml-auto flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void importAiResult(event.target.files?.[0])}
            />
            <ActionBarButton
              icon={<Package className="h-4 w-4" />}
              label={isBuildingBrief ? 'Building...' : 'Export AI Brief'}
              onClick={() => void exportAiBrief()}
              highlighted={primaryAction?.id === 'export-ai-brief'}
            />
            <ActionBarButton
              icon={<ImagePlus className="h-4 w-4" />}
              label="Import Result"
              onClick={() => fileRef.current?.click()}
              highlighted={primaryAction?.id === 'import-ai-result'}
            />
          </div>
        </div>
      </div>

      <PrecisionDrawer open={precisionOpen} title="Shot Review Detail" onClose={() => setPrecisionOpen(false)}>
        {detailShot && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <ReviewImage title="Linked Pano Reference" src={selectedPanoAsset?.uri} emptyText="No linked pano reference" />
              <ReviewImage title="AI Result Frame" src={selectedAiResultAsset?.uri} emptyText="Import a result frame after exporting the AI brief." />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <IconButton onClick={() => setStatus('approved')} active={detailShot.status === 'approved'}>
                <CheckCircle2 className="h-4 w-4" />
                Approve
              </IconButton>
              <IconButton onClick={() => setStatus('needs_fix')} active={detailShot.status === 'needs_fix'}>
                <RotateCcw className="h-4 w-4" />
                Needs Fix
              </IconButton>
              <IconButton onClick={() => setStatus('rejected')} active={detailShot.status === 'rejected'}>
                <XCircle className="h-4 w-4" />
                Reject
              </IconButton>
            </div>
            <IconButton
              onClick={() => selectedAiResultAsset && downloadDataUrl(selectedAiResultAsset.uri, selectedAiResultAsset.name)}
              disabled={!selectedAiResultAsset}
              className="w-full"
            >
              <Download className="h-4 w-4" />
              Download AI Result
            </IconButton>
            <Field label="Image Prompt">
              <TextArea readOnly value={generateImagePrompt(project, detailShot)} className="min-h-32 font-mono text-xs" />
            </Field>
            <Field label="Video Prompt">
              <TextArea readOnly value={generateVideoPrompt(detailShot)} className="min-h-32 font-mono text-xs" />
            </Field>
            <Field label="Notes">
              <TextArea
                value={detailShot.description}
                onChange={(event) => updateShot(detailShot.id, { description: event.target.value })}
                className="min-h-24"
              />
            </Field>
            {isAiBriefSent(project, detailShot.id) && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30">
                <Send className="mr-1 inline h-3.5 w-3.5" />
                AI brief marked sent.
              </p>
            )}
            <IconButton onClick={addCamera} className="w-full">
              Add Camera
            </IconButton>
          </div>
        )}
      </PrecisionDrawer>
    </FullBleedLayout>
  );
}

function ShotReviewCard({
  shot,
  project,
  view,
  selected,
  onSelect,
}: {
  shot: Shot;
  project: Parameters<typeof getShotWarnings>[0];
  view: ReviewView;
  selected: boolean;
  onSelect: () => void;
}) {
  const warnings = getShotWarnings(project, shot);
  const level = shot.status === 'approved'
    ? 'approved'
    : shot.status === 'needs_fix' || warnings.length > 0
      ? 'needs_work'
      : 'ready';
  const aiAsset = shot.assets.aiResultFrameAssetId
    ? project.assets.assets[shot.assets.aiResultFrameAssetId]
    : shot.assets.finalBaseFrameAssetId
      ? project.assets.assets[shot.assets.finalBaseFrameAssetId]
      : undefined;

  if (view === 'list') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
          selected ? 'border-[var(--accent)] bg-accent-soft' : 'border-subtle bg-surface-raised hover:border-strong'
        }`}
      >
        <StatusGlow level={level}>
          <div className="h-12 w-20 overflow-hidden rounded-lg bg-surface-muted">
            {aiAsset?.uri ? <img src={aiAsset.uri} alt="" className="h-full w-full object-cover" /> : null}
          </div>
        </StatusGlow>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-primary">{shot.shotNumber} {shot.name}</div>
          <div className="text-xs text-secondary">{shot.status}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition ${
        selected ? 'border-[var(--accent)] bg-accent-soft shadow-card' : 'border-subtle bg-surface-raised hover:border-strong'
      }`}
    >
      <StatusGlow level={level}>
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-muted">
          {aiAsset?.uri ? (
            <img src={aiAsset.uri} alt={shot.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">{shot.shotNumber}</div>
          )}
        </div>
      </StatusGlow>
      <div className="mt-2 truncate text-sm font-medium text-primary">{shot.shotNumber}</div>
      <div className="truncate text-xs text-secondary">{shot.name}</div>
    </button>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  icon,
  warning,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-[var(--accent)] text-white'
          : warning
            ? 'border border-amber-200 text-amber-700 hover:bg-amber-50'
            : 'border border-subtle text-secondary hover:border-strong'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ViewToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
        active ? 'bg-accent-soft text-accent' : 'text-secondary hover:text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ActionBarButton({
  icon,
  label,
  onClick,
  highlighted,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        highlighted
          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-subtle text-secondary hover:border-strong hover:text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ReviewImage({ title, src, emptyText }: { title: string; src?: string; emptyText: string }) {
  return (
    <div className="relative min-h-40 overflow-hidden rounded-xl border border-subtle bg-surface-muted">
      <div className="absolute left-3 top-3 z-10 rounded-lg bg-surface-overlay px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
        {title}
      </div>
      {src ? (
        <img src={src} alt={title} className="h-full min-h-40 w-full object-contain" />
      ) : (
        <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-muted">{emptyText}</div>
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