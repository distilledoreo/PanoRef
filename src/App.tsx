import React, { useRef } from 'react';
import { Boxes, Download, FileJson, FolderOpen, Image, Package, Route, Video } from 'lucide-react';
import { Workspace } from './domain/types';
import { downloadProject, parseProject, readFileAsText } from './engine/projectIO';
import { useContinuityStore } from './state/useContinuityStore';
import { BuildWorkspace } from './components/workspaces/BuildWorkspace';
import { ReferenceWorkspace } from './components/workspaces/ReferenceWorkspace';
import { ShotsWorkspace } from './components/workspaces/ShotsWorkspace';
import { ReviewWorkspace } from './components/workspaces/ReviewWorkspace';
import { ExportWorkspace } from './components/workspaces/ExportWorkspace';
import { TextInput } from './components/common/Field';
import { ProductionPath } from './components/common/ProductionPath';

const workspaceItems: Array<{ id: Workspace; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'build', label: 'Build', icon: Boxes },
  { id: 'reference', label: 'Reference', icon: Image },
  { id: 'shots', label: 'Shots', icon: Route },
  { id: 'review', label: 'Review', icon: Video },
  { id: 'export', label: 'Export', icon: Package },
];

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    project,
    workspace,
    setWorkspace,
    setProject,
    updateProjectInfo,
    selectedShotId,
    shotCameraFlying,
  } = useContinuityStore();

  const importProject = async (file?: File) => {
    if (!file) return;
    const text = await readFileAsText(file);
    setProject(parseProject(text));
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-zinc-100 text-zinc-900">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-500 text-white shadow-sm">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">Continuity Stage</div>
            <TextInput
              value={project.name}
              onChange={(event) => updateProjectInfo({ name: event.target.value })}
              className="mt-1 h-7 border-transparent bg-transparent px-0 py-0 text-base font-semibold shadow-none focus:border-transparent focus:ring-0"
              aria-label="Project name"
            />
          </div>
        </div>

        <nav className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-1">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setWorkspace(item.id)}
                className={`inline-flex min-w-20 shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-teal-500 text-white shadow-sm'
                    : 'text-zinc-500 hover:bg-white hover:text-zinc-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => void importProject(event.target.files?.[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-teal-300 hover:text-teal-700"
          >
            <FolderOpen className="h-4 w-4" />
            Open
          </button>
          <button
            onClick={() => downloadProject(project)}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-teal-300 hover:text-teal-700"
          >
            <FileJson className="h-4 w-4" />
            Save
          </button>
          <button
            onClick={() => setWorkspace('export')}
            className="inline-flex items-center gap-2 rounded-md bg-teal-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600"
          >
            <Download className="h-4 w-4" />
            Package
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-zinc-200 bg-zinc-100 px-4 py-2">
        <ProductionPath project={project} selectedShotId={selectedShotId} shotCameraFlying={shotCameraFlying} />
      </div>

      <section className="min-h-0 flex-1">
        {workspace === 'build' && <BuildWorkspace />}
        {workspace === 'reference' && <ReferenceWorkspace />}
        {workspace === 'shots' && <ShotsWorkspace />}
        {workspace === 'review' && <ReviewWorkspace />}
        {workspace === 'export' && <ExportWorkspace />}
      </section>
    </div>
  );
}
