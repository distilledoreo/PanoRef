import React, { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Camera,
  Clapperboard,
  Compass,
  FileJson,
  FolderOpen,
  Globe,
  Moon,
  Package,
  Sun,
  Upload,
} from 'lucide-react';
import { Workspace } from './domain/types';
import { downloadProject, parseProject, readFileAsText } from './engine/projectIO';
import { useAppModeStore } from './state/useAppModeStore';
import { useContinuityStore } from './state/useContinuityStore';
import { useThemeStore } from './state/useThemeStore';
import { BuildWorkspace } from './components/workspaces/BuildWorkspace';
import { ReferenceWorkspace } from './components/workspaces/ReferenceWorkspace';
import { ShotsWorkspace } from './components/workspaces/ShotsWorkspace';
import { ExportWorkspace } from './components/workspaces/ExportWorkspace';
import { PanoViewerWorkspace } from './components/workspaces/PanoViewerWorkspace';
import { ModeChooser } from './components/common/ModeChooser';
import { WorkflowGuidance } from './components/common/WorkflowGuidance';
import SplashScreen from './components/common/SplashScreen';
import { TextInput } from './components/common/Field';

const workspaceItems: Array<{ id: Workspace; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'build', label: 'Build', icon: Boxes },
  { id: 'reference', label: 'Reference', icon: Camera },
  { id: 'shots', label: 'Shots', icon: Clapperboard },
  { id: 'export', label: 'Export', icon: Upload },
];

const IMPORT_STATUS_DISMISS_MS = 4000;
const SPLASH_SEEN_KEY = 'panoref-splash-seen';

function hasSeenSplash(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SPLASH_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [splashDone, setSplashDone] = useState(() => hasSeenSplash());
  const [projectImportStatus, setProjectImportStatus] = useState<{
    tone: 'success' | 'error';
    message: string;
  }>();
  const { theme, toggleTheme } = useThemeStore();
  const { appMode, setAppMode } = useAppModeStore();
  const {
    project,
    workspace,
    setWorkspace,
    setProject,
    updateProjectInfo,
    requestObjectiveModal,
  } = useContinuityStore();

  const isPanoViewer = appMode === 'panoViewer';
  const showModeChooser = splashDone && appMode === null;

  const openProjectPicker = () => {
    setProjectImportStatus(undefined);
    fileRef.current?.click();
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const importedProject = parseProject(text);
      setProject(importedProject);
      setAppMode('continuity');
      setProjectImportStatus({
        tone: 'success',
        message: `Project opened: ${importedProject.name}`,
      });
    } catch (error) {
      setProjectImportStatus({
        tone: 'error',
        message: error instanceof Error
          ? `Could not open project: ${error.message}`
          : 'Could not open project: invalid project file.',
      });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!projectImportStatus) return;
    const timer = window.setTimeout(() => setProjectImportStatus(undefined), IMPORT_STATUS_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [projectImportStatus]);

  useEffect(() => {
    if (!projectMenuOpen) return;

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (projectMenuRef.current && target && !projectMenuRef.current.contains(target)) {
        setProjectMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [projectMenuOpen]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-surface-base text-primary">
      <main className="absolute inset-0">
        {isPanoViewer ? (
          <PanoViewerWorkspace />
        ) : (
          <>
            {workspace === 'build' && <BuildWorkspace />}
            {workspace === 'reference' && <ReferenceWorkspace />}
            {workspace === 'shots' && <ShotsWorkspace />}
            {workspace === 'export' && <ExportWorkspace />}
          </>
        )}
      </main>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-40">
        <div className="flex h-[72px] items-center justify-between gap-4 px-7 pt-3">
          <div ref={projectMenuRef} className="pointer-events-auto relative min-w-0">
            <button
              type="button"
              onClick={() => setProjectMenuOpen((open) => !open)}
              className="flex min-w-0 items-center gap-3 rounded-2xl pr-3 transition hover:bg-surface-overlay/60"
              title="Project actions"
              aria-expanded={projectMenuOpen}
              aria-haspopup="menu"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center text-accent">
                <Boxes className="h-9 w-9" strokeWidth={2.2} />
              </span>
              <span className="truncate text-xl font-semibold tracking-normal text-primary">
                {isPanoViewer ? '360 Viewer' : 'Continuity Stage'}
              </span>
            </button>
            {projectMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+10px)] z-50 w-72 overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-overlay p-2 shadow-soft backdrop-blur"
              >
                {!isPanoViewer && (
                  <div className="border-b border-subtle px-3 py-2">
                    <label className="block text-xs text-secondary" htmlFor="project-name-input">
                      Project name
                    </label>
                    <TextInput
                      id="project-name-input"
                      value={project.name}
                      onChange={(event) => updateProjectInfo({ name: event.target.value })}
                      aria-label="Project name"
                      data-project-name-input
                      className="mt-1 h-8 border-subtle bg-surface-raised px-2 py-1 text-sm font-semibold"
                    />
                    <div className="mt-1 text-xs text-secondary">Project actions</div>
                  </div>
                )}
                {isPanoViewer ? (
                  <ProjectMenuButton
                    icon={<Boxes className="h-4 w-4" />}
                    label="Open Continuity Stage"
                    onClick={() => {
                      setAppMode('continuity');
                      setProjectMenuOpen(false);
                    }}
                  />
                ) : (
                  <>
                    <ProjectMenuButton
                      icon={<Compass className="h-4 w-4" />}
                      label="Current Objective"
                      onClick={() => {
                        requestObjectiveModal();
                        setProjectMenuOpen(false);
                      }}
                    />
                    <ProjectMenuButton
                      icon={<Globe className="h-4 w-4" />}
                      label="Simple 360 Viewer"
                      onClick={() => {
                        setAppMode('panoViewer');
                        setProjectMenuOpen(false);
                      }}
                    />
                    <ProjectMenuButton
                      icon={<FolderOpen className="h-4 w-4" />}
                      label="Open Project"
                      onClick={() => {
                        openProjectPicker();
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
                  </>
                )}
              </div>
            )}
          </div>

          {!isPanoViewer && (
            <>
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
            </>
          )}

          <div className="pointer-events-auto flex items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              aria-label="Open project JSON"
              data-project-import-input
              className="hidden"
              onChange={(event) => void importProject(event.target.files?.[0])}
            />
            {!isPanoViewer && (
              <>
                <IconHeaderButton onClick={openProjectPicker} title="Open project">
                  <FolderOpen className="h-4 w-4" />
                </IconHeaderButton>
                <IconHeaderButton
                  onClick={() => downloadProject(project)}
                  title="Save project"
                  data-project-export-button
                >
                  <FileJson className="h-4 w-4" />
                </IconHeaderButton>
              </>
            )}
            <IconHeaderButton onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </IconHeaderButton>
          </div>
        </div>
      </header>

      {projectImportStatus && (
        <div
          className={`pointer-events-none absolute right-7 top-20 z-50 max-w-sm rounded-[var(--radius-card)] border px-3 py-2 text-sm shadow-card backdrop-blur ${
            projectImportStatus.tone === 'success'
              ? 'border-[var(--accent)] bg-surface-overlay text-primary'
              : 'border-red-400/70 bg-surface-overlay text-primary'
          }`}
          role={projectImportStatus.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          data-project-import-status={projectImportStatus.tone}
        >
          {projectImportStatus.message}
        </div>
      )}

      {!isPanoViewer && <WorkflowGuidance />}

      <ModeChooser visible={showModeChooser} />
      <SplashScreen onDismissed={() => setSplashDone(true)} />
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
      role="menuitem"
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
  className,
  ...rest
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      onClick={onClick}
      title={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-subtle/80 bg-surface-overlay/80 text-secondary shadow-card backdrop-blur-sm transition hover:border-strong hover:text-primary ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
