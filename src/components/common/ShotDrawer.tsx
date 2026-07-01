import React, { useState } from 'react';
import { ChevronUp, Circle, CircleCheck } from 'lucide-react';
import { LocationProject } from '../../domain/types';
import { getShotWorkflowProgress } from '../../engine/workflow';

export function ShotDrawer({
  project,
  selectedShotId,
  onSelectShot,
}: {
  project: LocationProject;
  selectedShotId?: string;
  onSelectShot: (shotId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (project.shots.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Shot Drawer</div>
          <div className="truncate text-sm font-medium text-zinc-800">
            {project.shots.length} shot{project.shots.length === 1 ? '' : 's'} in production
          </div>
        </div>
        <ChevronUp className={`h-4 w-4 shrink-0 text-zinc-500 transition ${expanded ? '' : 'rotate-180'}`} />
      </button>

      <div className={`overflow-hidden transition-[max-height] duration-200 ${expanded ? 'max-h-72' : 'max-h-14'}`}>
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {project.shots.map((shot) => {
            const progress = getShotWorkflowProgress(project, shot);
            const selected = shot.id === selectedShotId;
            const completedSteps = [
              progress.framingAccepted,
              progress.aiBriefSent,
              progress.aiResultImported,
              progress.finalPackageExported,
            ].filter(Boolean).length;

            return (
              <button
                key={shot.id}
                type="button"
                onClick={() => onSelectShot(shot.id)}
                className={`min-w-[180px] shrink-0 rounded-md border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-teal-500 bg-teal-50 shadow-sm'
                    : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-900">{shot.name}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                    {shot.status}
                  </span>
                </div>
                {expanded ? (
                  <div className="mt-2 space-y-1 text-xs text-zinc-600">
                    <ShotProgressRow label="Framing accepted" done={progress.framingAccepted} />
                    <ShotProgressRow label="AI brief sent" done={progress.aiBriefSent} />
                    <ShotProgressRow label="AI result imported" done={progress.aiResultImported} />
                    <ShotProgressRow label="Final package exported" done={progress.finalPackageExported} />
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-zinc-500">
                    {completedSteps}/4 checkpoints
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShotProgressRow({ label, done }: { label: string; done: boolean }) {
  const Icon = done ? CircleCheck : Circle;
  return (
    <div className={`flex items-center gap-1.5 ${done ? 'text-emerald-700' : 'text-zinc-500'}`}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </div>
  );
}