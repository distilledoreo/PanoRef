import React from 'react';

export function ContextualPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-auto rounded-[var(--radius-card)] border border-subtle bg-surface-overlay px-4 py-3 shadow-card backdrop-blur ${className ?? ''}`}
    >
      {children}
    </div>
  );
}