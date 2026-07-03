import React from 'react';

export function WorkspaceLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-zinc-100 p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <main className="order-1 min-h-[520px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm lg:min-h-0">{children}</main>
      <aside className="order-2 min-h-0 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-sm">{sidebar}</aside>
    </div>
  );
}