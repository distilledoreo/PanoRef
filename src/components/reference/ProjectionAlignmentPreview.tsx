import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Eye, X } from 'lucide-react';
import { LocationProject } from '../../domain/types';
import { SceneViewport } from '../viewers/SceneViewport';
import {
  ProjectionAlignmentDraft,
} from './projectionAlignmentEditorState';
import { createProjectionAlignmentPreviewProject } from './projectionAlignmentPreviewProject';

export interface ProjectionAlignmentPreviewProps {
  project: LocationProject;
  draft: ProjectionAlignmentDraft;
  onBack: () => void;
  onApply: () => void;
  onCancel: () => void;
  onStrengthChange: (strength: number) => void;
}

export function ProjectionAlignmentPreview({
  project,
  draft,
  onBack,
  onApply,
  onCancel,
  onStrengthChange,
}: ProjectionAlignmentPreviewProps) {
  const [viewMode, setViewMode] = useState<'before' | 'after'>('after');
  const previewProject = useMemo(
    () => createProjectionAlignmentPreviewProject(project, draft),
    [project, draft],
  );
  const displayedProject = viewMode === 'after' ? previewProject : project;
  const matchCount = draft.pairs.filter((pair) => pair.enabled).length;
  const strengthPercent = Math.round(draft.strength * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-projection-preview="true">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-subtle px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm font-medium text-secondary transition hover:border-accent hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to matches
        </button>
        <div className="mr-auto min-w-[12rem]">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-accent" />
            <h2 id="projection-preview-title" className="text-base font-semibold text-primary">Preview local fit</h2>
          </div>
          <p className="mt-1 text-xs text-secondary">Inspect the correction on your geometry before saving it.</p>
        </div>
        <div className="flex rounded-lg border border-subtle bg-surface-base p-1" aria-label="Preview comparison">
          <button
            type="button"
            onClick={() => setViewMode('before')}
            aria-pressed={viewMode === 'before'}
            className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold ${viewMode === 'before' ? 'bg-accent text-white' : 'text-secondary'}`}
          >
            Before
          </button>
          <button
            type="button"
            onClick={() => setViewMode('after')}
            aria-pressed={viewMode === 'after'}
            className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold ${viewMode === 'after' ? 'bg-accent text-white' : 'text-secondary'}`}
          >
            After
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-accent hover:text-accent"
          aria-label="Close Projection Assist preview"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <main className="min-h-0 flex-1 bg-surface-base p-2 sm:p-3">
        <div className="relative h-full min-h-[24rem] overflow-hidden rounded-xl border border-subtle bg-surface-raised">
          <SceneViewport
            project={displayedProject}
            appearance="projected"
            minHeightClassName="min-h-[24rem]"
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-subtle bg-surface-overlay/90 px-3 py-2 text-xs text-primary shadow-card backdrop-blur-sm">
            {viewMode === 'after' ? 'After · draft local fit' : 'Before · saved project'}
          </div>
        </div>
      </main>

      <footer className="shrink-0 border-t border-subtle bg-surface-raised px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="mr-auto min-w-[13rem]" aria-live="polite">
            <p className="text-sm font-medium text-primary">{matchCount} match{matchCount === 1 ? '' : 'es'} · {strengthPercent}% local fit strength</p>
            <p className="mt-0.5 text-xs text-secondary">Adjust the strength here; nothing is saved until you apply it.</p>
          </div>
          <label className="flex min-w-[15rem] flex-1 items-center gap-3 sm:max-w-sm" htmlFor="projection-preview-strength">
            <span className="whitespace-nowrap text-xs font-medium text-secondary">Local fit strength</span>
            <input
              id="projection-preview-strength"
              type="range"
              min="0"
              max="100"
              step="1"
              value={strengthPercent}
              onChange={(event) => onStrengthChange(Number(event.target.value) / 100)}
              className="min-w-0 flex-1 accent-[var(--accent)]"
            />
            <span className="w-10 text-right text-xs tabular-nums text-secondary">{strengthPercent}%</span>
          </label>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-secondary transition hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            <Check className="h-4 w-4" />
            Apply local fit
          </button>
        </div>
      </footer>
    </div>
  );
}
