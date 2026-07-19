import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { WarningItem } from '../../domain/types';
import { formatWarningSummary } from '../../engine/warnings';
import { PrecisionDrawer } from './PrecisionDrawer';
import { WarningList } from './WarningList';

const MOBILE_QUERY = '(max-width: 639px)';

function useIsMobileDrawer() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

function panelTone(warnings: WarningItem[]): string {
  if (warnings.some((warning) => warning.severity === 'danger')) {
    return 'border-red-400/50 bg-red-500/10 text-red-800 dark:text-red-200';
  }
  if (warnings.some((warning) => warning.severity === 'warning')) {
    return 'border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-200';
  }
  return 'border-subtle bg-surface-muted text-secondary';
}

/**
 * Single labeled control that opens warning details.
 * Desktop: fixed portal panel beside the button (flips above/below).
 * Mobile: PrecisionDrawer so the panel is never clipped by overflow parents.
 */
export function WarningDetailsButton({
  warnings,
  title = 'Issues',
  className,
}: {
  warnings: WarningItem[];
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('below');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isMobile = useIsMobileDrawer();
  const summary = formatWarningSummary(warnings);

  useLayoutEffect(() => {
    if (!open || isMobile || !buttonRef.current) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const panelWidth = Math.min(320, Math.max(240, window.innerWidth - 24));
      const estimatedHeight = Math.min(280, 48 + warnings.length * 44);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const nextPlacement = spaceBelow < estimatedHeight + 12 && spaceAbove > spaceBelow
        ? 'above'
        : 'below';
      const left = Math.min(
        Math.max(12, rect.right - panelWidth),
        window.innerWidth - panelWidth - 12,
      );
      const top = nextPlacement === 'below'
        ? rect.bottom + 8
        : Math.max(12, rect.top - estimatedHeight - 8);

      setPlacement(nextPlacement);
      setCoords({ top, left, width: panelWidth });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, isMobile, warnings.length]);

  useEffect(() => {
    if (!open || isMobile) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isMobile]);

  if (warnings.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-warning-details-trigger
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summary}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10px] font-semibold leading-tight transition hover:brightness-95 ${panelTone(warnings)} ${className ?? ''}`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{summary}</span>
      </button>

      {isMobile ? (
        <PrecisionDrawer open={open} title={title} onClose={() => setOpen(false)}>
          <WarningList warnings={warnings} />
        </PrecisionDrawer>
      ) : open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-warning-details-panel={placement}
          className="fixed z-[60] max-h-[min(50vh,20rem)] overflow-y-auto rounded-[var(--radius-card)] border border-subtle bg-surface-raised p-3 shadow-soft"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          <h3 id={titleId} className="mb-2 text-xs font-semibold text-primary">{title}</h3>
          <WarningList warnings={warnings} />
        </div>,
        document.body,
      )}
    </>
  );
}
