import React from 'react';
import { ShotDrawer } from '../common/ShotDrawer';
import { Workspace } from '../../domain/types';

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

export function WorkspaceWithDrawer({
  sidebar,
  children,
  showDrawer,
  project,
  selectedShotId,
  onSelectShot,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  showDrawer: boolean;
  project: Parameters<typeof ShotDrawer>[0]['project'];
  selectedShotId?: string;
  onSelectShot: (shotId: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-zinc-100 p-3">
      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-3">
        <main className="min-h-[420px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm lg:min-h-0">{children}</main>
        <aside className="min-h-0 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-sm">{sidebar}</aside>
      </div>
      {showDrawer && (
        <div className="shrink-0 overflow-hidden rounded-md border border-zinc-200">
          <ShotDrawer project={project} selectedShotId={selectedShotId} onSelectShot={onSelectShot} />
        </div>
      )}
    </div>
  );
}

export const DRAWER_WORKSPACES: Workspace[] = ['shots', 'review', 'export'];