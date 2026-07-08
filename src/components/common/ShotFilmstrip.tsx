import React, { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { LocationProject, Shot } from '../../domain/types';
import { getShotWarnings } from '../../engine/warnings';
import { ShotThumbnail } from './ShotThumbnail';
import { WarningPopover } from './StatusBadge';

export function ShotFilmstrip({
  project,
  selectedShotId,
  onSelectShot,
  renderThumbnail,
  appearance = 'default',
  compact = false,
}: {
  project: LocationProject;
  selectedShotId?: string;
  onSelectShot: (shotId: string) => void;
  renderThumbnail?: (shot: Shot) => React.ReactNode;
  appearance?: 'default' | 'overlay';
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isOverlay = appearance === 'overlay';
  const useCompactOverlay = isOverlay && (compact || project.shots.length >= 5);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 4);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
  }, []);

  const scrollBy = (direction: -1 | 1) => {
    const element = scrollRef.current;
    if (!element) return;
    const step = isOverlay ? 180 : 220;
    element.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <div
      data-shot-filmstrip={appearance}
      className={`relative flex items-center gap-1.5 ${
        isOverlay
          ? `rounded-[var(--radius-card)] border border-[var(--filmstrip-border)] bg-[var(--filmstrip-overlay)] shadow-[var(--filmstrip-shadow)] backdrop-blur-md ${
            useCompactOverlay ? 'px-1.5 py-1' : 'px-2 py-1.5'
          }`
          : ''
      }`}
    >
      <FilmstripNavButton
        direction="left"
        disabled={!canScrollLeft}
        onClick={() => scrollBy(-1)}
        overlay={isOverlay}
      />
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className={`flex min-w-0 flex-1 gap-2 overflow-x-auto ${
          isOverlay ? 'px-0.5 pb-0.5' : 'gap-3 px-1 pb-1'
        }`}
      >
        {project.shots.map((shot) => {
          const selected = shot.id === selectedShotId;
          const warnings = getShotWarnings(project, shot);
          const customThumbnail = renderThumbnail?.(shot);

          const card = (
            <div className="relative">
              <button
                type="button"
                onClick={() => onSelectShot(shot.id)}
                aria-label={`Select shot ${shot.shotNumber}`}
                className={`block shrink-0 overflow-hidden rounded-lg transition ${
                  isOverlay
                    ? `${useCompactOverlay ? 'w-[4.25rem]' : 'w-[5.25rem]'} ${
                      selected
                        ? 'ring-2 ring-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                        : 'ring-1 ring-white/10 hover:ring-white/25'
                    }`
                    : `flex w-[7.5rem] flex-col gap-1.5 rounded-xl border p-2 text-left ${
                      selected
                        ? 'border-[var(--accent)] bg-accent-soft shadow-[0_0_0_1px_var(--accent-glow)]'
                        : 'border-subtle bg-surface-raised hover:border-strong'
                    }`
                }`}
              >
                <div className={`aspect-video w-full overflow-hidden ${isOverlay ? 'rounded-lg' : 'rounded-lg bg-surface-muted'}`}>
                  {customThumbnail ?? <ShotThumbnail project={project} shot={shot} />}
                </div>
                {!isOverlay && (
                  <div>
                    <div className="truncate text-[11px] font-semibold text-primary">{shot.shotNumber}</div>
                    <div className="truncate text-[10px] text-secondary">{shot.name}</div>
                  </div>
                )}
              </button>
              {isOverlay && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-1 right-1 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white/70"
                >
                  <MoreHorizontal className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
          );

          return (
            <div key={shot.id} className="shrink-0">
              {warnings.length > 0 ? (
                <WarningPopover warnings={warnings}>
                  {card}
                </WarningPopover>
              ) : (
                card
              )}
            </div>
          );
        })}
      </div>
      <FilmstripNavButton
        direction="right"
        disabled={!canScrollRight}
        onClick={() => scrollBy(1)}
        overlay={isOverlay}
      />
      <ScrollStateObserver onChange={updateScrollState} targetRef={scrollRef} />
    </div>
  );
}

function FilmstripNavButton({
  direction,
  disabled,
  onClick,
  overlay,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
  overlay?: boolean;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll shots left' : 'Scroll shots right'}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-35 ${
        overlay
          ? 'h-8 w-8 border border-white/20 bg-black/40 text-white hover:border-white/40 hover:bg-black/55'
          : 'h-9 w-9 border border-subtle bg-surface-raised text-secondary hover:border-strong hover:text-primary'
      }`}
    >
      <Icon className={overlay ? 'h-5 w-5' : 'h-4 w-4'} />
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