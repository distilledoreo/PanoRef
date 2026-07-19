import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const fallbackId = useId();
  const titleId = `${fallbackId}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  onCancelRef.current = onCancel;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR),
      ).filter((node): node is HTMLElement => (
        node instanceof HTMLElement && !node.hasAttribute('disabled') && node.tabIndex !== -1
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    cancelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-white/10 bg-zinc-950 px-5 py-4 shadow-soft outline-none"
        data-confirm-dialog
      >
        <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
        <div className="mt-2 text-sm text-white/75">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              destructive
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-[var(--accent)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
