import React, { useRef } from 'react';
import {
  Boxes,
  Camera,
  Clapperboard,
  FileJson,
  FolderOpen,
  Moon,
  Package,
  Sun,
  Upload,
  Users,
} from 'lucide-react';
import { Workspace } from './domain/types';
import { downloadProject, parseProject, readFileAsText } from './engine/projectIO';
import { useContinuityStore } from './state/useContinuityStore';
import { useThemeStore } from './state/useThemeStore';
import { BuildWorkspace } from './components/workspaces/BuildWorkspace';
import { ReferenceWorkspace } from './components/workspaces/ReferenceWorkspace';
import { ShotsWorkspace } from './components/workspaces/ShotsWorkspace';
import { ReviewWorkspace } from './components/workspaces/ReviewWorkspace';
import { ExportWorkspace } from './components/workspaces/ExportWorkspace';
import { ObjectiveHelpButton, WorkflowGuidance } from './components/common/WorkflowGuidance';

const workspaceItems: Array<{ id: Workspace; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'build', label: 'Build', icon: Boxes },
  { id: 'reference', label: 'Reference', icon: Camera },
  { id: 'shots', label: 'Shots', icon: Clapperboard },
  { id: 'review', label: 'Review', icon: Users },
  { id: 'export', label: 'Export', icon: Upload },
];

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useThemeStore();
  const {
    project,
    workspace,
    setWorkspace,
    setProject,
  } = useContinuityStore();

  const importProject = async (file?: File) => {
    if (!file) return;
    const text = await readFileAsText(file);
    setProject(parseProject(text));
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-surface-base text-primary">
      <header className="relative z-30 flex shrink-0 items-center justify-between gap-4 border-b border-subtle bg-surface-raised px-5 py-3 shadow-card">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-card">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-primary">Continuity Stage</div>
            <div className="truncate text-xs text-secondary">{project.name}</div>
          </div>
        </div>

        <nav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-6 md:flex">
          {workspaceItems.map((item, index) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return (
              <React.Fragment key={item.id}>
                <button
                  onClick={() => setWorkspace(item.id)}
                  className="group flex flex-col items-center gap-1.5"
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_0_16px_var(--accent-glow)]'
                        : 'border-subtle bg-surface-muted text-secondary group-hover:border-strong group-hover:text-primary'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`text-[11px] font-medium ${active ? 'text-accent' : 'text-secondary'}`}>
                    {item.label}
                  </span>
                </button>
                {index < workspaceItems.length - 1 && (
                  <span className="mb-5 h-px w-8 bg-border-subtle" aria-hidden />
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <nav className="flex max-w-[42vw] items-center gap-1 overflow-x-auto md:hidden">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setWorkspace(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active ? 'bg-[var(--accent)] text-white' : 'text-secondary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5">
          <ObjectiveHelpButton />
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => void importProject(event.target.files?.[0])}
          />
          <IconHeaderButton onClick={() => fileRef.current?.click()} title="Open project">
            <FolderOpen className="h-4 w-4" />
          </IconHeaderButton>
          <IconHeaderButton onClick={() => downloadProject(project)} title="Save project">
            <FileJson className="h-4 w-4" />
          </IconHeaderButton>
          <IconHeaderButton onClick={() => setWorkspace('export')} title="Package export">
            <Package className="h-4 w-4" />
          </IconHeaderButton>
          <IconHeaderButton onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </IconHeaderButton>
        </div>
      </header>

      <section className="min-h-0 flex-1">
        {workspace === 'build' && <BuildWorkspace />}
        {workspace === 'reference' && <ReferenceWorkspace />}
        {workspace === 'shots' && <ShotsWorkspace />}
        {workspace === 'review' && <ReviewWorkspace />}
        {workspace === 'export' && <ExportWorkspace />}
      </section>

      <WorkflowGuidance />
    </div>
  );
}

function IconHeaderButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-subtle bg-surface-raised text-secondary transition hover:border-strong hover:text-primary"
    >
      {children}
    </button>
  );
}