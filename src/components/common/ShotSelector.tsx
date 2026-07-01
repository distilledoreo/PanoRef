import React from 'react';
import { Circle, CircleCheck, Plus } from 'lucide-react';
import { LocationProject } from '../../domain/types';
import { getShotWorkflowProgress } from '../../engine/workflow';
import { IconButton, Panel } from './Field';

export function ShotSelector({
  project,
  selectedShotId,
  onSelectShot,
  onAddShot,
}: {
  project: LocationProject;
  selectedShotId?: string;
  onSelectShot: (shotId: string) => void;
  onAddShot?: () => void;
}) {
  if (project.shots.length === 0) {
    return (
      <Panel title="Shots">
        <p className="text-sm text-zinc-500">No shots yet.</p>
        {onAddShot && (
          <IconButton onClick={onAddShot} className="mt-2 w-full">
            <Plus className="h-4 w-4" />
            Add Camera
          </IconButton>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title="Shots"
      actions={onAddShot ? (
        <button
          type="button"
          onClick={onAddShot}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-teal-400 hover:text-teal-700"
        >
          Add
        </button>
      ) : undefined}
    >
      <div className="space-y-2">
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
              className={`w-full rounded-md border px-3 py-2 text-left transition ${
                selected
                  ? 'border-teal-500 bg-teal-50 shadow-sm'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-900">{shot.name}</span>
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {shot.status}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-zinc-500">
                <span>{completedSteps}/4 checkpoints</span>
                <div className="flex items-center gap-1">
                  <ShotCheckpoint done={progress.framingAccepted} title="Framing" />
                  <ShotCheckpoint done={progress.aiBriefSent} title="Brief" />
                  <ShotCheckpoint done={progress.aiResultImported} title="Result" />
                  <ShotCheckpoint done={progress.finalPackageExported} title="Export" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function ShotCheckpoint({ done, title }: { done: boolean; title: string }) {
  const Icon = done ? CircleCheck : Circle;
  return (
    <span title={title} className={done ? 'text-emerald-600' : 'text-zinc-300'}>
      <Icon className="h-3 w-3" />
    </span>
  );
}