import React from 'react';
import { ImageIcon } from 'lucide-react';
import { resolveShotThumbnail } from '../../domain/shotThumbnails';
import { LocationProject, Shot } from '../../domain/types';

export function ShotThumbnail({
  project,
  shot,
  overrideSrc,
  alt = '',
  className,
  showSourceLabel,
}: {
  project: LocationProject;
  shot: Shot;
  overrideSrc?: string;
  alt?: string;
  className?: string;
  showSourceLabel?: boolean;
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
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-muted">
          <ImageIcon className="h-4 w-4" />
          <span className="max-w-full truncate text-[10px] font-medium">{shot.shotNumber}</span>
        </div>
      )}
      {showSourceLabel && (
        <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-secondary shadow-card">
          {sourceLabel}
        </span>
      )}
    </div>
  );
}
