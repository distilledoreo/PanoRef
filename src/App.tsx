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
import { DirectorQuest } from './components/common/DirectorQuest';

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
  } = useContinuityStore();

  const importProject = async (file?: File) => {
    if (!file) return;
    const text = await readFileAsText(file);
    setProject(parseProject(text));
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-400 text-slate-950">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Continuity Stage</div>
            <TextInput
              value={project.name}
              onChange={(event) => updateProjectInfo({ name: event.target.value })}
              className="mt-1 h-7 border-transparent bg-transparent px-0 py-0 text-base font-semibold focus:border-transparent"
              aria-label="Project name"
            />
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 p-1">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setWorkspace(item.id)}
                className={`inline-flex min-w-24 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
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
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
          >
            <FolderOpen className="h-4 w-4" />
            Open
          </button>
          <button
            onClick={() => downloadProject(project)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
          >
            <FileJson className="h-4 w-4" />
            Save
          </button>
          <button
            onClick={() => setWorkspace('export')}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            <Download className="h-4 w-4" />
            Package
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-slate-800 bg-slate-950 px-4 py-2">
        <DirectorQuest project={project} />
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
