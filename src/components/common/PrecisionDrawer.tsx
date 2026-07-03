import React, { useEffect } from 'react';
import { Ruler, X } from 'lucide-react';

export function PrecisionDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close precision drawer"
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] dark:bg-black/50"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-subtle bg-surface-raised shadow-soft"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 border-b border-subtle px-5 py-4">
          <div className="flex items-center gap-2 text-primary">
            <Ruler className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-accent hover:text-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </aside>
    </>
  );
}