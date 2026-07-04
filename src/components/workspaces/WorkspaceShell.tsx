import React from 'react';

export function FullBleedLayout({
  children,
  reserveHeader = false,
}: {
  children: React.ReactNode;
  reserveHeader?: boolean;
}) {
  return (
    <div
      className={`relative box-border h-full min-h-0 bg-surface-base ${
        reserveHeader ? 'pt-[var(--stage-header-safe)]' : ''
      }`}
    >
      {children}
    </div>
  );
}

/** @deprecated Use FullBleedLayout — retained for gradual migration */
export function WorkspaceLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-surface-base p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <main className="order-1 min-h-[520px] overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-raised shadow-card lg:min-h-0">{children}</main>
      <aside className="order-2 min-h-0 overflow-y-auto rounded-[var(--radius-card)] border border-subtle bg-surface-raised shadow-card">{sidebar}</aside>
    </div>
  );
}