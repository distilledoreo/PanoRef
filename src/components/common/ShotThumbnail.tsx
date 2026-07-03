import React from 'react';
import { resolveShotThumbnail } from '../../domain/shotThumbnails';
import { LocationProject, Shot } from '../../domain/types';

function ShotThumbnailFallback({
  shotNumber,
  compact,
}: {
  shotNumber: string;
  compact?: boolean;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-shot-thumbnail-fallback
      data-shot-thumbnail-compact={compact ? 'true' : undefined}
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--thumbnail-fallback-sky)] via-[var(--thumbnail-fallback-mid)] to-[var(--thumbnail-fallback-ground)]" />
      <div className="absolute inset-x-0 bottom-[14%] h-px bg-[var(--thumbnail-fallback-horizon)]" />
      <div className="absolute bottom-[18%] left-[10%] h-[26%] w-[20%] rounded-sm bg-[var(--thumbnail-fallback-block-a)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
      <div className="absolute bottom-[22%] right-[12%] h-[32%] w-[26%] rounded-sm bg-[var(--thumbnail-fallback-block-b)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" />
      <div className="absolute bottom-[12%] left-[36%] h-[16%] w-[32%] rounded-sm bg-[var(--thumbnail-fallback-block-c)]" />
      {!compact && (
        <div className="absolute bottom-1.5 left-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--thumbnail-fallback-label)]">
          No preview
        </div>
      )}
      <div
        className={`absolute font-mono text-[var(--thumbnail-fallback-label)] ${
          compact ? 'bottom-0.5 right-0.5 text-[7px] leading-none' : 'bottom-1.5 right-2 text-[9px]'
        }`}
      >
        {shotNumber}
      </div>
    </div>
  );
}

export function ShotThumbnail({
  project,
  shot,
  overrideSrc,
  alt = '',
  className,
  showSourceLabel,
  compact,
}: {
  project: LocationProject;
  shot: Shot;
  overrideSrc?: string;
  alt?: string;
  className?: string;
  showSourceLabel?: boolean;
  compact?: boolean;
}) {
  const resolved = resolveShotThumbnail(project, shot);
  const src = overrideSrc ?? resolved.asset?.uri;
  const sourceLabel = overrideSrc ? 'Live preview' : resolved.label;
  const sizeClassName = className ?? 'h-full w-full';

  return (
    <div className={`relative overflow-hidden rounded-lg bg-surface-muted ${sizeClassName}`}>
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <ShotThumbnailFallback shotNumber={shot.shotNumber} compact={compact} />
      )}
      {showSourceLabel && (
        <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-secondary shadow-card">
          {sourceLabel}
        </span>
      )}
    </div>
  );
}