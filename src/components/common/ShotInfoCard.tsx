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
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-subtle bg-surface-raised shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-subtle px-4 py-4">
        <div className="min-w-0">
          <div className="text-base font-semibold text-primary">Shot {shot.shotNumber}</div>
          <div className="truncate text-sm text-secondary">{shot.name}</div>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-strong hover:text-primary"
            aria-label="Shot actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-subtle bg-surface-raised py-1 shadow-soft">
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

      <div className="space-y-3 px-4 py-4">
        <dl className="space-y-2 text-sm">
          <SpecRow label="Lens" value={`${lensMm}mm`} />
          <SpecRow label="Height" value={`${cameraHeight.toFixed(1)} m`} />
          <SpecRow label="FOV" value={`${shot.camera.fovDegrees.toFixed(1)}°`} />
        </dl>
        {shot.description && (
          <div className="rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-xs leading-relaxed text-primary">
            {shot.description}
          </div>
        )}
        {warnings.length > 0 && (
          <button
            type="button"
            onClick={onOpenPrecision}
            className="text-xs font-medium text-amber-600 transition hover:text-amber-700 dark:text-amber-400"
          >
            {warnings.length} issue{warnings.length === 1 ? '' : 's'} — tap to review
          </button>
        )}
      </div>

      <div className="px-4">
        <ShotThumbnail
          project={project}
          shot={shot}
          overrideSrc={previewSrc}
          className="aspect-video w-full"
          showSourceLabel
        />
      </div>

      <div className="mt-auto space-y-2 px-4 pb-4 pt-3">
        {onOpenIn360 && (
          <button
            type="button"
            onClick={onOpenIn360}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-subtle px-3 py-2 text-xs font-medium text-secondary transition hover:border-[var(--accent)] hover:text-accent"
          >
            <Globe className="h-3.5 w-3.5" />
            Open in 360
          </button>
        )}
        <button
          type="button"
          onClick={onOpenPrecision}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-subtle px-3 py-2 text-xs font-medium text-accent transition hover:border-[var(--accent)] hover:bg-accent-soft"
        >
          <Ruler className="h-3.5 w-3.5" />
          Camera settings
        </button>
      </div>
    </aside>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}