import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, Download, FileJson, FolderArchive, Settings } from 'lucide-react';
import { createShotPackageManifest, selectExportPathPreview } from '../../engine/exportManifest';
import { reconcileExportSelectedShotIds } from '../../engine/exportSelection';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { getProjectWarnings, getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { ShotThumbnail } from '../common/ShotThumbnail';
import { WarningPopover } from '../common/StatusBadge';
import { resolveWorkspacePrimaryAction } from '../../engine/workflow';
import { FullBleedLayout } from './WorkspaceShell';

export function ExportWorkspace() {
  const {
    project,
    selectedShotId,
    selectShot,
    addCamera,
    updateShot,
    isExportingPackage,
    setExportingPackage,
    markFinalPackageExported,
  } = useContinuityStore();
  const [lastExport, setLastExport] = useState<string[]>([]);
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(() => new Set(project.shots.map((shot) => shot.id)));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportingShotId, setExportingShotId] = useState<string | undefined>();
  const [exportError, setExportError] = useState<string | undefined>();
  const projectIdRef = useRef(project.id);
  const prevShotIdsRef = useRef(project.shots.map((shot) => shot.id));
  const shotIdsKey = project.shots.map((shot) => shot.id).join('\0');
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const manifest = useMemo(() => selectedShot ? createShotPackageManifest(project, selectedShot) : undefined, [project, selectedShot]);
  const primaryAction = useMemo(
    () => resolveWorkspacePrimaryAction({
      project,
      workspace: 'export',
      selectedShotId: selectedShot?.id,
      shotCameraFlying: false,
    }),
    [project, selectedShot?.id],
  );

  // Keep multi-select in sync when opening another project or adding/removing shots.
  useEffect(() => {
    const nextIds = project.shots.map((shot) => shot.id);
    const projectChanged = projectIdRef.current !== project.id;
    const previousShotIds = prevShotIdsRef.current;
    projectIdRef.current = project.id;
    prevShotIdsRef.current = nextIds;

    setSelectedShotIds((current) => reconcileExportSelectedShotIds({
      projectChanged,
      previousShotIds,
      nextShotIds: nextIds,
      currentSelected: current,
    }));
  }, [project.id, shotIdsKey]);

  const toggleShotSelection = (shotId: string) => {
    setSelectedShotIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  const exportSelectedShots = async () => {
    const shotsToExport = project.shots.filter((shot) => selectedShotIds.has(shot.id));
    if (shotsToExport.length === 0) return;
    setExportingPackage(true);
    setExportError(undefined);
    const exported: string[] = [];
    const failed: string[] = [];
    try {
      for (const shot of shotsToExport) {
        setExportingShotId(shot.id);
        try {
          const result = await buildShotPackage(project, shot);
          downloadBlob(result.blob, result.fileName);
          setLastExport(result.manifestPaths);
          updateShot(shot.id, { status: 'exported' });
          markFinalPackageExported(shot.id);
          exported.push(shot.shotNumber);
        } catch (error) {
          failed.push(shot.shotNumber);
          const message = error instanceof Error ? error.message : 'Unknown export error';
          setExportError(
            failed.length === shotsToExport.length
              ? `Export failed for ${shot.shotNumber}: ${message}`
              : `Exported ${exported.join(', ')}; failed on ${shot.shotNumber}: ${message}`,
          );
          // Continue remaining shots so one failure does not abort the batch silently.
        }
      }
    } finally {
      setExportingPackage(false);
      setExportingShotId(undefined);
    }
  };

  const exportShot = async () => {
    if (!selectedShot) return;
    setExportingPackage(true);
    setExportError(undefined);
    try {
      const result = await buildShotPackage(project, selectedShot);
      downloadBlob(result.blob, result.fileName);
      setLastExport(result.manifestPaths);
      updateShot(selectedShot.id, { status: 'exported' });
      markFinalPackageExported(selectedShot.id);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExportingPackage(false);
    }
  };

  const packageContents = [
    { name: 'inputs', description: 'Reference and camera data' },
    { name: 'outputs', description: 'Final frames and media' },
    { name: 'metadata', description: 'Shot and scene info' },
    { name: 'prompts', description: 'AI prompts and notes' },
    { name: 'manifest.json', description: 'Package manifest' },
  ];

  const fitsCompactShotList = project.shots.length > 0 && project.shots.length <= 6;
  const manifestPreviewPaths = useMemo(
    () => (manifest ? selectExportPathPreview(manifest.files.map((file) => file.path), 3) : []),
    [manifest],
  );
  const lastExportPreviewPaths = useMemo(
    () => selectExportPathPreview(lastExport, 3),
    [lastExport],
  );

  return (
    <FullBleedLayout reserveHeader>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-base p-4">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div
            data-export-package-panel="composed"
            className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-raised p-4 shadow-card"
          >
            <header data-export-package-header className="mb-3 shrink-0">
              <h1 className="text-xl font-semibold text-primary">Export Your Shots</h1>
              <p className="mt-0.5 text-sm text-secondary">
                Handoff packages for your AI and pipeline tools. Each shot is a ZIP — deliverables stay outside this app.
              </p>
            </header>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2">
              <div
                data-export-package-visual
                className="flex shrink-0 items-start justify-center gap-3"
              >
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <div className="flex h-16 w-20 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-[var(--cta-glow)]">
                    <FolderArchive className="h-8 w-8" />
                  </div>
                  <div className="rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                    ZIP Package
                  </div>
                </div>
                <div className="w-44 max-w-[11rem] shrink-0 rounded-lg border border-subtle bg-surface-muted p-2 shadow-card">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-secondary">
                    Package Contents
                  </div>
                  <ul className="space-y-0.5">
                    {packageContents.map((item) => (
                      <li key={item.name} className="flex items-center gap-1.5 rounded-md border border-subtle bg-surface-raised px-1.5 py-0.5">
                        <Archive className="h-3 w-3 shrink-0 text-accent" />
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[10px] font-medium text-primary">{item.name}</div>
                          <div className="truncate text-[9px] text-secondary">{item.description}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-3 shrink-0 space-y-2">
              {manifest && (
                <div data-export-manifest-preview className="max-h-8 space-y-0.5 overflow-hidden opacity-70">
                  {manifestPreviewPaths.map((path) => (
                    <div key={path} className="truncate font-mono text-[10px] text-muted">{path}</div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                data-export-settings-trigger
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-secondary transition hover:text-accent"
              >
                <Settings className="h-3.5 w-3.5" />
                Export Settings
              </button>
              {lastExport.length > 0 && (
                <div data-export-last-export className="max-h-8 space-y-0.5 overflow-hidden opacity-80">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary">
                    <Check className="h-3 w-3 text-emerald-500" />
                    Last Export
                  </div>
                  {lastExportPreviewPaths.map((path) => (
                    <div key={path} className="truncate font-mono text-[10px] text-emerald-700 dark:text-emerald-400">{path}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-raised shadow-card">
            <div className="shrink-0 border-b border-subtle px-3 py-2">
              <h2 className="text-sm font-semibold text-primary">Select Shots to Export</h2>
              <p className="text-[11px] text-secondary">{selectedShotIds.size} shot{selectedShotIds.size === 1 ? '' : 's'} selected</p>
            </div>
            <div
              className={`min-h-0 flex-1 space-y-1 p-2 ${
                fitsCompactShotList ? 'overflow-hidden' : 'overflow-y-auto'
              }`}
            >
              {project.shots.map((shot) => {
                const warnings = [...getProjectWarnings(project), ...getShotWarnings(project, shot)];
                const checked = selectedShotIds.has(shot.id);
                const active = selectedShotId === shot.id;
                return (
                  <div
                    key={shot.id}
                    data-export-shot-row={checked ? 'selected' : 'default'}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 transition ${
                      checked
                        ? 'border-[var(--accent)] bg-surface-raised shadow-[inset_3px_0_0_var(--accent)]'
                        : 'border-subtle bg-surface-raised hover:border-strong'
                    } ${active ? 'ring-1 ring-[var(--accent)]' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleShotSelection(shot.id)}
                      className="accent-[var(--accent)]"
                      aria-label={`Export Shot ${shot.shotNumber}`}
                    />
                    <button
                      type="button"
                      onClick={() => selectShot(shot.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ShotThumbnail project={project} shot={shot} compact className="h-9 w-16 shrink-0" />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-xs font-medium text-primary">Shot {shot.shotNumber}</span>
                        <span className="block truncate text-[11px] text-secondary">{shot.name}</span>
                      </span>
                    </button>
                    {warnings.length > 0 && (
                      <WarningPopover warnings={warnings}>
                        <span
                          className="shrink-0 cursor-pointer rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                          title="Show warning details"
                        >
                          {warnings.length}
                        </span>
                      </WarningPopover>
                    )}
                    {exportingShotId === shot.id && (
                      <span className="shrink-0 text-[10px] text-accent">Exporting...</span>
                    )}
                  </div>
                );
              })}
              {project.shots.length === 0 && (
                <p className="text-sm text-secondary">No shots yet.</p>
              )}
            </div>
            <div className="shrink-0 border-t border-subtle space-y-2 px-2 py-2">
              {exportError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-xs text-primary"
                  data-export-error
                >
                  {exportError}
                </p>
              )}
              <PrimaryCTA
                icon={<Download className="h-4 w-4" />}
                label={isExportingPackage ? 'Building Package...' : 'Export Selected Shots'}
                hint="Download continuity ZIPs for each selected shot. No need to import results back."
                onClick={() => void exportSelectedShots()}
                disabled={isExportingPackage || selectedShotIds.size === 0}
                highlighted={primaryAction?.id === 'export-final-zip'}
                layout="inline"
              />
            </div>
          </div>
        </div>
      </div>

      <PrecisionDrawer open={settingsOpen} title="Export Settings" onClose={() => setSettingsOpen(false)}>
        {selectedShot ? (
          <div className="space-y-4">
            <p
              data-export-settings-scope
              className="rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-xs text-secondary"
            >
              Settings apply to the <span className="font-semibold text-primary">active shot</span>
              {' '}(Shot {selectedShot.shotNumber}: {selectedShot.name}) only — not every checked shot in the multi-select list.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width">
                <TextInput
                  type="number"
                  value={selectedShot.exportSettings.width}
                  onChange={(event) => updateShot(selectedShot.id, {
                    exportSettings: { ...selectedShot.exportSettings, width: Number(event.target.value) },
                  })}
                />
              </Field>
              <Field label="Height">
                <TextInput
                  type="number"
                  value={selectedShot.exportSettings.height}
                  onChange={(event) => updateShot(selectedShot.id, {
                    exportSettings: { ...selectedShot.exportSettings, height: Number(event.target.value) },
                  })}
                />
              </Field>
            </div>
            {([
              ['includeViewport', 'Viewport clay render'],
              ['includeAiResultFrame', 'AI result frame (if already attached)'],
              ['includePanoCrop', 'Pano crop'],
              ['includeFullPano', 'Styled reference pano'],
              ['includeGrayboxPano', 'Graybox pano'],
              ['includeCameraMoveVideo', 'Camera move MP4'],
              ['includeCameraMoveReferenceFrames', 'Camera move clay frames'],
              ['includeMetadata', 'Metadata JSON'],
              ['includePrompt', 'Prompts'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={selectedShot.exportSettings[key]}
                  onChange={(event) => updateShot(selectedShot.id, {
                    exportSettings: { ...selectedShot.exportSettings, [key]: event.target.checked },
                  })}
                  className="accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
            <IconButton onClick={() => void exportShot()} disabled={isExportingPackage} className="w-full">
              <FileJson className="h-4 w-4" />
              Export Final ZIP (current shot)
            </IconButton>
            <IconButton onClick={() => addCamera({ navigateToShots: false })} className="w-full">
              Add Camera
            </IconButton>
          </div>
        ) : (
          <p className="text-sm text-secondary">Select a shot to configure export settings.</p>
        )}
      </PrecisionDrawer>
    </FullBleedLayout>
  );
}
