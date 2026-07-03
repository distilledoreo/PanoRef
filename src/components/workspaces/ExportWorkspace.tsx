import React, { useMemo, useState } from 'react';
import { Archive, Check, Download, FileJson, FolderArchive, Settings } from 'lucide-react';
import { createShotPackageManifest } from '../../engine/exportManifest';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { getProjectWarnings, getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { ShotThumbnail } from '../common/ShotThumbnail';
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
    try {
      for (const shot of shotsToExport) {
        setExportingShotId(shot.id);
        const result = await buildShotPackage(project, shot);
        downloadBlob(result.blob, result.fileName);
        setLastExport(result.manifestPaths);
        updateShot(shot.id, { status: 'exported' });
        markFinalPackageExported(shot.id);
      }
    } finally {
      setExportingPackage(false);
      setExportingShotId(undefined);
    }
  };

  const exportShot = async () => {
    if (!selectedShot) return;
    setExportingPackage(true);
    try {
      const result = await buildShotPackage(project, selectedShot);
      downloadBlob(result.blob, result.fileName);
      setLastExport(result.manifestPaths);
      updateShot(selectedShot.id, { status: 'exported' });
      markFinalPackageExported(selectedShot.id);
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

  return (
    <FullBleedLayout>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-base p-5">
        <header className="mb-3 shrink-0">
          <h1 className="text-xl font-semibold text-primary">Export Your Shots</h1>
          <p className="mt-1 text-sm text-secondary">Choose what to export. Each shot is packaged individually.</p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-raised p-4 shadow-card">
            <div className="mb-4 flex items-end gap-3">
              <div className="flex h-16 w-20 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-card">
                <FolderArchive className="h-9 w-9" />
              </div>
              <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs font-bold uppercase tracking-wider text-secondary">
                ZIP
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-secondary transition hover:text-accent"
            >
              <Settings className="h-4 w-4" />
              Export Settings
            </button>
            <ul className="w-full max-w-sm space-y-1.5">
              {packageContents.map((item) => (
                <li key={item.name} className="flex items-start gap-3 rounded-lg border border-subtle px-3 py-2">
                  <Archive className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div>
                    <div className="font-mono text-sm font-medium text-primary">{item.name}</div>
                    <div className="text-xs text-secondary">{item.description}</div>
                  </div>
                </li>
              ))}
            </ul>
            {manifest && (
              <div className="mt-4 max-h-14 w-full max-w-sm space-y-1 overflow-hidden">
                {manifest.files.slice(0, 6).map((file) => (
                  <div key={file.path} className="truncate font-mono text-[10px] text-muted">{file.path}</div>
                ))}
              </div>
            )}
            {lastExport.length > 0 && (
              <div className="mt-4 w-full max-w-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                  <Check className="h-4 w-4 text-emerald-500" />
                  Last Export
                </div>
                {lastExport.map((path) => (
                  <div key={path} className="truncate font-mono text-[10px] text-emerald-700 dark:text-emerald-400">{path}</div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-raised shadow-card">
            <div className="shrink-0 border-b border-subtle px-4 py-3">
              <h2 className="text-sm font-semibold text-primary">Select Shots to Export</h2>
              <p className="text-xs text-secondary">{selectedShotIds.size} shot{selectedShotIds.size === 1 ? '' : 's'} selected</p>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              {project.shots.map((shot) => {
                const warnings = [...getProjectWarnings(project), ...getShotWarnings(project, shot)];
                const checked = selectedShotIds.has(shot.id);
                const active = selectedShotId === shot.id;
                return (
                  <div
                    key={shot.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                      checked ? 'border-[var(--accent)] bg-accent-soft shadow-[0_0_0_1px_var(--accent-glow)]' : 'border-subtle hover:border-strong'
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
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ShotThumbnail project={project} shot={shot} className="h-14 w-24 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-primary">Shot {shot.shotNumber}</span>
                        <span className="block truncate text-xs text-secondary">{shot.name}</span>
                      </span>
                    </button>
                    {warnings.length > 0 && (
                      <span className="shrink-0 text-[10px] text-amber-600">{warnings.length}</span>
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
            <div className="shrink-0 border-t border-subtle p-3">
              <PrimaryCTA
                icon={<Download className="h-5 w-5" />}
                label={isExportingPackage ? 'Building Package...' : 'Export Selected Shots'}
                hint="Create ZIP packages for each selected shot."
                onClick={() => void exportSelectedShots()}
                disabled={isExportingPackage || selectedShotIds.size === 0}
                highlighted={primaryAction?.id === 'export-final-zip'}
                tone="success"
                layout="inline"
              />
            </div>
          </div>
        </div>
      </div>

      <PrecisionDrawer open={settingsOpen} title="Export Settings" onClose={() => setSettingsOpen(false)}>
        {selectedShot ? (
          <div className="space-y-4">
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
              ['includeAiResultFrame', 'Imported AI result frame'],
              ['includePanoCrop', 'Pano crop'],
              ['includeFullPano', 'Styled reference pano'],
              ['includeGrayboxPano', 'Graybox pano'],
              ['includeCameraMoveVideo', 'Camera move MP4'],
              ['includeCameraMoveReferenceFrames', 'Camera move cubemap references'],
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
            <IconButton onClick={addCamera} className="w-full">
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
