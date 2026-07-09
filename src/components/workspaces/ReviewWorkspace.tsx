import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { renderViewportClay } from '../../engine/renderers';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, TextArea } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { ShotThumbnail } from '../common/ShotThumbnail';
import { StatusGlow, StatusIcon, WarningPopover } from '../common/StatusBadge';
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
  const [shotControlFrames, setShotControlFrames] = useState<Record<string, string>>({});
  const [renderingShotIds, setRenderingShotIds] = useState<Record<string, boolean>>({});
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
  const selectedAiResultAsset = detailShot?.assets.aiResultFrameAssetId
    ? project.assets.assets[detailShot.assets.aiResultFrameAssetId]
    : detailShot?.assets.finalBaseFrameAssetId
      ? project.assets.assets[detailShot.assets.finalBaseFrameAssetId]
      : undefined;
  const detailShotControlFrame = detailShot ? shotControlFrames[detailShot.id] : undefined;

  const shotControlRenderKey = useMemo(() => JSON.stringify({
    scene: project.scene,
    shots: project.shots.map((shot) => ({
      id: shot.id,
      camera: shot.camera,
      width: shot.exportSettings.width,
      height: shot.exportSettings.height,
    })),
  }), [project.scene, project.shots]);

  useEffect(() => {
    let cancelled = false;

    const renderShotControls = async () => {
      const activeShotIds = new Set(project.shots.map((shot) => shot.id));
      setShotControlFrames((current) => (
        Object.fromEntries(Object.entries(current).filter(([shotId]) => activeShotIds.has(shotId)))
      ));
      setRenderingShotIds(Object.fromEntries(project.shots.map((shot) => [shot.id, true])));

      await Promise.all(project.shots.map(async (shot) => {
        try {
          const previewSize = getReviewShotControlSize(shot);
          const frame = await renderViewportClay(project, shot.camera, previewSize.width, previewSize.height);
          if (!cancelled) {
            setShotControlFrames((current) => ({ ...current, [shot.id]: frame.dataUrl }));
          }
        } catch {
          if (!cancelled) {
            setShotControlFrames((current) => {
              const { [shot.id]: _unused, ...rest } = current;
              return rest;
            });
          }
        } finally {
          if (!cancelled) {
            setRenderingShotIds((current) => ({ ...current, [shot.id]: false }));
          }
        }
      }));
    };

    void renderShotControls();

    return () => {
      cancelled = true;
    };
  }, [project, shotControlRenderKey]);

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

  const fitsCompactGrid = view === 'grid' && filteredShots.length > 0 && filteredShots.length <= 6;

  return (
    <FullBleedLayout reserveHeader>
      <div className="flex h-full min-h-0 flex-col bg-surface-base p-4">
        <header className="mb-2 shrink-0">
          <h1 className="text-xl font-semibold text-primary">Review Your Shots</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div className="text-sm text-secondary">
              Approved <span className="font-semibold text-primary">{approvedCount}</span> / {project.shots.length}
            </div>
            <div className="text-sm text-secondary">Check the graybox shot frame, export the AI brief, then compare the imported result.</div>
            <div className="h-1.5 min-w-[10rem] flex-1 max-w-xs overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <FilterTab active={filter === 'all'} onClick={() => setFilter('all')} label={`All (${project.shots.length})`} />
              <FilterTab active={filter === 'approved'} onClick={() => setFilter('approved')} label={`Approved (${approvedCount})`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
              <FilterTab active={filter === 'needs_work'} onClick={() => setFilter('needs_work')} label={`Needs Work (${needsWorkCount})`} icon={<Clock className="h-3.5 w-3.5" />} warning />
            </div>
            <div className="flex gap-1 rounded-full border border-subtle p-1">
              <ViewToggle active={view === 'grid'} onClick={() => setView('grid')} icon={<Grid3X3 className="h-4 w-4" />} label="Grid View" />
              <ViewToggle active={view === 'list'} onClick={() => setView('list')} icon={<List className="h-4 w-4" />} label="List View" />
            </div>
          </div>
        </header>

        <div
          className={
            view === 'grid'
              ? `grid min-h-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 ${
                  fitsCompactGrid ? 'content-start auto-rows-min overflow-hidden' : 'auto-rows-min overflow-y-auto'
                }`
              : 'min-h-0 flex-1 space-y-1.5 overflow-y-auto'
          }
        >
          {filteredShots.map((shot) => (
            <div key={shot.id}>
              <ShotReviewCard
                shot={shot}
                project={project}
                view={view}
                compactGrid={fitsCompactGrid}
                selected={shot.id === detailShot?.id}
                shotControlSrc={shotControlFrames[shot.id]}
                shotControlRendering={Boolean(renderingShotIds[shot.id])}
                onSelect={() => {
                  setSelectedDetailShotId(shot.id);
                  selectShot(shot.id);
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5 border-t border-subtle pt-2">
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
              <ReviewImage
                title="Graybox Shot Control"
                src={detailShotControlFrame}
                emptyText={renderingShotIds[detailShot.id] ? 'Rendering the locked shot frame...' : 'No shot control frame available.'}
              />
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
            <IconButton onClick={() => addCamera({ navigateToShots: false })} className="w-full">
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
  compactGrid,
  selected,
  shotControlSrc,
  shotControlRendering,
  onSelect,
}: {
  shot: Shot;
  project: Parameters<typeof getShotWarnings>[0];
  view: ReviewView;
  compactGrid?: boolean;
  selected: boolean;
  shotControlSrc?: string;
  shotControlRendering?: boolean;
  onSelect: () => void;
}) {
  const warnings = getShotWarnings(project, shot);
  const aiResultAsset = getShotResultAsset(project, shot);
  const level = shot.status === 'approved'
    ? 'approved'
    : shot.status === 'needs_fix' || warnings.length > 0
      ? 'needs_work'
      : 'ready';

  if (view === 'list') {
    return (
      <div
        className={`relative flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 transition ${
          selected ? 'border-[var(--accent)] bg-accent-soft' : 'border-subtle bg-surface-raised hover:border-strong'
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <StatusGlow level={level} showIcon={false}>
            <ShotThumbnail
              project={project}
              shot={shot}
              overrideSrc={shotControlSrc}
              overrideLabel="Graybox shot"
              className="h-11 w-20 shrink-0"
              showSourceLabel
              fallbackOnly
            />
          </StatusGlow>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-primary">{shot.shotNumber} {shot.name}</div>
            <div className="text-[11px] text-secondary">{formatShotStatus(shot.status, warnings.length)} · {shotControlRendering ? 'Rendering shot frame' : 'Graybox shot frame'}</div>
          </div>
        </button>
        {warnings.length > 0 ? (
          <div className="relative h-5 w-5 shrink-0" data-review-warning>
            <WarningPopover warnings={warnings}>
              <span className="block h-5 w-5" aria-hidden />
            </WarningPopover>
          </div>
        ) : (
          <StatusIcon level={level} className="!h-4 !w-4 shrink-0 [&_svg]:!h-3 [&_svg]:!w-3" />
        )}
      </div>
    );
  }

  return (
    <div
      data-review-grid-card={compactGrid ? 'compact' : 'default'}
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border transition ${
        selected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] bg-surface-raised shadow-card' : 'border-subtle bg-surface-raised hover:border-strong'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-1">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[11px] font-semibold text-primary">{shot.shotNumber} {shot.name}</div>
        </button>
        {warnings.length > 0 ? (
          <div className="relative h-5 w-5 shrink-0" data-review-warning>
            <WarningPopover warnings={warnings}>
              <span className="block h-5 w-5" aria-hidden />
            </WarningPopover>
          </div>
        ) : (
          <StatusIcon level={level} className="!h-4 !w-4 shrink-0 [&_svg]:!h-3 [&_svg]:!w-3" />
        )}
      </div>
      <button type="button" onClick={onSelect} className="w-full text-left">
        <StatusGlow level={level} showIcon={false} className="w-full">
          <div className="relative">
            <ShotThumbnail
              project={project}
              shot={shot}
              overrideSrc={shotControlSrc}
              overrideLabel="Graybox shot"
              className={`w-full rounded-none border-y border-subtle ${
                compactGrid ? 'aspect-video max-h-[8.5rem]' : 'aspect-video'
              }`}
              showSourceLabel
              fallbackOnly
            />
            {shotControlRendering && (
              <span className="absolute bottom-2 left-2 rounded-md bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-secondary shadow-card">
                Rendering shot frame
              </span>
            )}
            {aiResultAsset && (
              <div className="absolute bottom-2 right-2 h-[36%] w-[36%] overflow-hidden rounded-md border border-white/70 bg-surface-muted shadow-card">
                <img src={aiResultAsset.uri} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
                  Result
                </span>
              </div>
            )}
          </div>
        </StatusGlow>
      </button>
      <div className="shrink-0 px-2.5 py-0.5 text-[11px] font-medium text-secondary">
        {formatShotStatus(shot.status, warnings.length)} · Graybox shot frame
      </div>
    </div>
  );
}

function getShotResultAsset(project: Parameters<typeof getShotWarnings>[0], shot: Shot) {
  const assetId = shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId;
  return assetId ? project.assets.assets[assetId] : undefined;
}

function getReviewShotControlSize(shot: Shot) {
  const aspectRatio = shot.exportSettings.width / shot.exportSettings.height;
  const width = Math.min(640, shot.exportSettings.width);
  return {
    width,
    height: Math.max(1, Math.round(width / aspectRatio)),
  };
}

function formatShotStatus(status: ShotStatus, warningCount: number) {
  if (status === 'approved') return 'Approved';
  if (status === 'needs_fix' || warningCount > 0) return 'Needs Work';
  if (status === 'rejected') return 'Rejected';
  if (status === 'exported') return 'Exported';
  return 'Planned';
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
          ? 'bg-[var(--accent)] text-white shadow-sm'
          : warning
            ? 'border border-amber-300/70 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-950/30'
            : 'border border-subtle bg-surface-raised text-secondary hover:border-strong'
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
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-[var(--accent)] text-white' : 'text-secondary hover:bg-surface-muted hover:text-primary'
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
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
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
