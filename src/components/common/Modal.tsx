import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const sizeClasses = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
} as const;

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  labelledBy,
  size = 'md',
  scrollBody = false,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  labelledBy?: string;
  size?: keyof typeof sizeClasses;
  scrollBody?: boolean;
}) {
  const fallbackId = useId();
  const titleId = labelledBy ?? `${fallbackId}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog backdrop"
        className="absolute inset-0 bg-zinc-900/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[min(90vh,960px)] w-full flex-col rounded-lg border border-zinc-200 bg-white shadow-xl outline-none ${sizeClasses[size]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-zinc-900">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className={`px-5 py-4 ${scrollBody ? 'min-h-0 overflow-y-auto' : ''}`}>{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}