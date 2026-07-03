import React, { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LocationProject, Shot } from '../../domain/types';
import { getShotWarnings } from '../../engine/warnings';
import { ShotThumbnail } from './ShotThumbnail';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 4);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
  }, []);

  const scrollBy = (direction: -1 | 1) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollBy({ left: direction * 220, behavior: 'smooth' });
  };

  return (
    <div className="relative flex items-center gap-2">
      <FilmstripNavButton
        direction="left"
        disabled={!canScrollLeft}
        onClick={() => scrollBy(-1)}
      />
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex min-w-0 flex-1 gap-3 overflow-x-auto px-1 pb-1"
      >
        {project.shots.map((shot) => {
          const selected = shot.id === selectedShotId;
          const warnings = getShotWarnings(project, shot);
          const customThumbnail = renderThumbnail?.(shot);
          const card = (
            <button
              type="button"
              onClick={() => onSelectShot(shot.id)}
              className={`flex w-[7.5rem] shrink-0 flex-col gap-1.5 rounded-xl border p-2 text-left transition ${
                selected
                  ? 'border-[var(--accent)] bg-accent-soft shadow-[0_0_0_1px_var(--accent-glow)]'
                  : 'border-subtle bg-surface-raised hover:border-strong'
              }`}
            >
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-muted">
                {customThumbnail ?? <ShotThumbnail project={project} shot={shot} />}
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
      <FilmstripNavButton
        direction="right"
        disabled={!canScrollRight}
        onClick={() => scrollBy(1)}
      />
      <ScrollStateObserver onChange={updateScrollState} targetRef={scrollRef} />
    </div>
  );
}

function FilmstripNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll shots left' : 'Scroll shots right'}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-subtle bg-surface-raised text-secondary transition hover:border-strong hover:text-primary disabled:opacity-35"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ScrollStateObserver({
  targetRef,
  onChange,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  onChange: () => void;
}) {
  React.useEffect(() => {
    onChange();
    const element = targetRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(onChange);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [onChange, targetRef]);

  return null;
}