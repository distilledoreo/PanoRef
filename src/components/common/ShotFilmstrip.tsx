import React from 'react';
import { LocationProject, Shot } from '../../domain/types';
import { getShotWarnings } from '../../engine/warnings';
import { WarningPopover } from './StatusBadge';

export function ShotFilmstrip({
  project,
  selectedShotId,
  onSelectShot,
  renderThumbnail,
}: {
  project: LocationProject;
  selectedShotId?: string;
  onSelectShot: (shotId: string) => void;
  renderThumbnail?: (shot: Shot) => React.ReactNode;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto px-1 pb-1">
      {project.shots.map((shot) => {
        const selected = shot.id === selectedShotId;
        const warnings = getShotWarnings(project, shot);
        const card = (
          <button
            type="button"
            onClick={() => onSelectShot(shot.id)}
            className={`flex w-28 shrink-0 flex-col gap-1.5 rounded-xl border p-2 text-left transition ${
              selected
                ? 'border-[var(--accent)] bg-accent-soft shadow-card'
                : 'border-subtle bg-surface-raised hover:border-strong'
            }`}
          >
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-muted">
              {renderThumbnail?.(shot) ?? (
                <div className="flex h-full items-center justify-center text-[10px] text-muted">
                  {shot.shotNumber}
                </div>
              )}
            </div>
            <div>
              <div className="truncate text-[11px] font-semibold text-primary">{shot.shotNumber}</div>
              <div className="truncate text-[10px] text-secondary">{shot.name}</div>
            </div>
          </button>
        );

        return (
          <div key={shot.id}>
            <WarningPopover warnings={warnings}>
              {card}
            </WarningPopover>
          </div>
        );
      })}
    </div>
  );
}