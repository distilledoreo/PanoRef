import React, { useRef, useState } from 'react';
import {
  Boxes,
  Camera,
  Clapperboard,
  Compass,
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
import { WorkflowGuidance } from './components/common/WorkflowGuidance';

const workspaceItems: Array<{ id: Workspace; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'build', label: 'Build', icon: Boxes },
  { id: 'reference', label: 'Reference', icon: Camera },
  { id: 'shots', label: 'Shots', icon: Clapperboard },
  { id: 'review', label: 'Review', icon: Users },
  { id: 'export', label: 'Export', icon: Upload },
];

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const { theme, toggleTheme } = useThemeStore();
  const {
    project,
    workspace,
    setWorkspace,
    setProject,
    requestObjectiveModal,
  } = useContinuityStore();

  const importProject = async (file?: File) => {
    if (!file) return;
    const text = await readFileAsText(file);
    setProject(parseProject(text));
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-surface-base text-primary">
      <main className="absolute inset-0">
        {workspace === 'build' && <BuildWorkspace />}
        {workspace === 'reference' && <ReferenceWorkspace />}
        {workspace === 'shots' && <ShotsWorkspace />}
        {workspace === 'review' && <ReviewWorkspace />}
        {workspace === 'export' && <ExportWorkspace />}
      </main>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-40">
        <div className="flex h-[72px] items-center justify-between gap-4 px-7 pt-3">
          <div className="pointer-events-auto relative min-w-0">
            <button
              type="button"
              onClick={() => setProjectMenuOpen((open) => !open)}
              className="flex min-w-0 items-center gap-3 rounded-2xl pr-3 transition hover:bg-surface-overlay/60"
              title="Project actions"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center text-accent">
                <Boxes className="h-9 w-9" strokeWidth={2.2} />
              </span>
              <span className="truncate text-xl font-semibold tracking-normal text-primary">Continuity Stage</span>
            </button>
            {projectMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-64 overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-overlay p-2 shadow-soft backdrop-blur">
                <div className="border-b border-subtle px-3 py-2">
                  <div className="truncate text-sm font-semibold text-primary">{project.name}</div>
                  <div className="text-xs text-secondary">Project actions</div>
                </div>
                <ProjectMenuButton
                  icon={<Compass className="h-4 w-4" />}
                  label="Current Objective"
                  onClick={() => {
                    requestObjectiveModal();
                    setProjectMenuOpen(false);
                  }}
                />
                <ProjectMenuButton
                  icon={<FolderOpen className="h-4 w-4" />}
                  label="Open Project"
                  onClick={() => {
                    fileRef.current?.click();
                    setProjectMenuOpen(false);
                  }}
                />
                <ProjectMenuButton
                  icon={<FileJson className="h-4 w-4" />}
                  label="Save Project"
                  onClick={() => {
                    downloadProject(project);
                    setProjectMenuOpen(false);
                  }}
                />
                <ProjectMenuButton
                  icon={<Package className="h-4 w-4" />}
                  label="Package Export"
                  onClick={() => {
                    setWorkspace('export');
                    setProjectMenuOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          <nav className="pointer-events-auto absolute left-1/2 top-5 hidden w-[min(700px,56vw)] -translate-x-1/2 items-start justify-between md:flex">
            <span className="absolute left-8 right-8 top-[22px] h-px bg-border-subtle/80" aria-hidden />
            {workspaceItems.map((item) => {
              const Icon = item.icon;
              const active = workspace === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setWorkspace(item.id)}
                  className="group relative z-10 flex min-w-20 flex-col items-center gap-1.5"
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_0_22px_var(--accent-glow)]'
                        : 'border-subtle/80 bg-surface-overlay/75 text-secondary backdrop-blur-sm group-hover:border-strong group-hover:text-primary'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`text-[11px] font-medium ${active ? 'text-accent' : 'text-secondary'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          <nav className="pointer-events-auto flex max-w-[42vw] items-center gap-1 overflow-x-auto md:hidden">
            {workspaceItems.map((item) => {
              const Icon = item.icon;
              const active = workspace === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setWorkspace(item.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active ? 'bg-[var(--accent)] text-white' : 'bg-surface-overlay/80 text-secondary backdrop-blur-sm'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => void importProject(event.target.files?.[0])}
            />
            <IconHeaderButton onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </IconHeaderButton>
          </div>
        </div>
      </header>

      <WorkflowGuidance />
    </div>
  );
}

function ProjectMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-secondary transition hover:bg-surface-muted hover:text-primary"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-subtle/80 bg-surface-overlay/80 text-secondary shadow-card backdrop-blur-sm transition hover:border-strong hover:text-primary"
    >
      {children}
    </button>
  );
}