import React, { useState } from 'react';
import { Globe, MoreHorizontal, Ruler } from 'lucide-react';
import { LocationProject, Shot } from '../../domain/types';
import { getShotWarnings } from '../../engine/warnings';
import { ShotThumbnail } from './ShotThumbnail';

export function ShotInfoCard({
  project,
  shot,
  lensMm,
  cameraHeight,
  previewSrc,
  onOpenPrecision,
  onOpenMenuAction,
  onOpenIn360,
  menuItems,
}: {
  project: LocationProject;
  shot: Shot;
  lensMm: number;
  cameraHeight: number;
  previewSrc?: string;
  onOpenPrecision: () => void;
  onOpenMenuAction: (action: string) => void;
  onOpenIn360?: () => void;
  menuItems: Array<{ id: string; label: string; disabled?: boolean }>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const warnings = getShotWarnings(project, shot);

  return (
    <article
      data-shot-info-card="floating"
      className="flex w-[min(220px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-overlay shadow-soft backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2 border-b border-subtle px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-primary">Shot {shot.shotNumber}</div>
          <div className="truncate text-xs text-secondary">{shot.name}</div>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-strong hover:text-primary"
            aria-label="Shot actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-subtle bg-surface-raised py-1 shadow-soft">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    onOpenMenuAction(item.id);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-secondary transition hover:bg-surface-muted hover:text-primary disabled:opacity-45"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-1.5">
        <ShotThumbnail
          project={project}
          shot={shot}
          overrideSrc={previewSrc}
          className="aspect-video max-h-[4.75rem] w-full rounded-lg object-cover"
          showSourceLabel
        />
      </div>

      <div className="space-y-1.5 px-3 py-2">
        <dl className="grid grid-cols-3 gap-1 text-[10px]">
          <SpecCell label="Lens" value={`${lensMm}mm`} />
          <SpecCell label="Height" value={`${cameraHeight.toFixed(1)}m`} />
          <SpecCell label="FOV" value={`${shot.camera.fovDegrees.toFixed(0)}°`} />
        </dl>
        {shot.description && (
          <p className="line-clamp-2 text-[11px] leading-snug text-secondary">{shot.description}</p>
        )}
        {warnings.length > 0 && (
          <button
            type="button"
            onClick={onOpenPrecision}
            className="text-[11px] font-medium text-amber-600 transition hover:text-amber-700 dark:text-amber-400"
          >
            {warnings.length} issue{warnings.length === 1 ? '' : 's'} — review
          </button>
        )}
      </div>

      <div className="mt-auto space-y-1 border-t border-subtle px-3 py-2">
        {onOpenIn360 && (
          <button
            type="button"
            onClick={onOpenIn360}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-subtle px-2.5 py-1 text-[11px] font-medium text-secondary transition hover:border-[var(--accent)] hover:text-accent"
          >
            <Globe className="h-3 w-3" />
            Open in 360
          </button>
        )}
        <button
          type="button"
          onClick={onOpenPrecision}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-subtle px-2.5 py-1 text-[11px] font-medium text-accent transition hover:border-[var(--accent)] hover:bg-accent-soft"
        >
          <Ruler className="h-3 w-3" />
          Camera settings
        </button>
      </div>
    </article>
  );
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-muted px-1.5 py-1 text-center">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}