import React, { useMemo, useState } from 'react';
import { Archive, Check, Download } from 'lucide-react';
import { createShotPackageManifest } from '../../engine/exportManifest';
import { buildShotPackage, downloadBlob } from '../../engine/packageExport';
import { getProjectWarnings, getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextInput } from '../common/Field';
import { WarningList } from '../common/WarningList';
import { WorkspaceLayout } from './BuildWorkspace';

export function ExportWorkspace() {
  const { project, selectedShotId, selectShot, updateShot, isExportingPackage, setExportingPackage } = useContinuityStore();
  const [lastExport, setLastExport] = useState<string[]>([]);
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const manifest = useMemo(() => selectedShot ? createShotPackageManifest(project, selectedShot) : undefined, [project, selectedShot]);

  const exportShot = async () => {
    if (!selectedShot) return;
    setExportingPackage(true);
    try {
      const result = await buildShotPackage(project, selectedShot);
      downloadBlob(result.blob, result.fileName);
      setLastExport(result.manifestPaths);
      updateShot(selectedShot.id, { status: 'exported' });
    } finally {
      setExportingPackage(false);
    }
  };

  return (
    <WorkspaceLayout
      sidebar={(
        <>
          <Panel title="Shot Selection">
            <Field label="Active Shot">
              <Select value={selectedShot?.id ?? ''} onChange={(event) => selectShot(event.target.value)}>
                {project.shots.map((shot) => <option key={shot.id} value={shot.id}>{shot.name}</option>)}
              </Select>
            </Field>
          </Panel>

          {selectedShot && (
            <>
              <Panel title="Package Settings">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Width">
                      <TextInput
                        type="number"
                        value={selectedShot.exportSettings.width}
                        onChange={(event) => updateShot(selectedShot.id, {
                          exportSettings: {
                            ...selectedShot.exportSettings,
                            width: Number(event.target.value),
                          },
                        })}
                      />
                    </Field>
                    <Field label="Height">
                      <TextInput
                        type="number"
                        value={selectedShot.exportSettings.height}
                        onChange={(event) => updateShot(selectedShot.id, {
                          exportSettings: {
                            ...selectedShot.exportSettings,
                            height: Number(event.target.value),
                          },
                        })}
                      />
                    </Field>
                  </div>
                  {([
                    ['includeViewport', 'Viewport clay render'],
                    ['includeAiResultFrame', 'Imported AI result frame'],
                    ['includePanoCrop', 'Pano crop'],
                    ['includeFullPano', 'Canonical global pano'],
                    ['includeGrayboxPano', 'Graybox pano'],
                    ['includeMetadata', 'Metadata JSON'],
                    ['includePrompt', 'Prompts'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={selectedShot.exportSettings[key]}
                        onChange={(event) => updateShot(selectedShot.id, {
                          exportSettings: { ...selectedShot.exportSettings, [key]: event.target.checked },
                        })}
                        className="accent-teal-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Panel>

              <Panel title="Export Checks">
                <WarningList warnings={[...getProjectWarnings(project), ...getShotWarnings(project, selectedShot)]} />
              </Panel>
            </>
          )}
        </>
      )}
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="border-b border-zinc-200 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-zinc-900">AI Shot Package</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Export a ZIP containing reference images, prompts, and metadata for the selected shot.
              </p>
            </div>
            <IconButton onClick={() => void exportShot()} disabled={!selectedShot || isExportingPackage}>
              <Download className="h-4 w-4" />
              {isExportingPackage ? 'Building Package...' : 'Export ZIP'}
            </IconButton>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          <div className="min-h-0 overflow-y-auto border-b border-zinc-200 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-center gap-2 text-zinc-800">
              <Archive className="h-5 w-5 text-teal-600" />
              <h3 className="font-semibold">Manifest Preview</h3>
            </div>
            <div className="space-y-2">
              {manifest?.files.map((file) => (
                <div key={file.path} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700">
                  <span className="truncate">{file.path}</span>
                  <span className={file.required ? 'text-teal-700' : 'text-zinc-500'}>{file.required ? 'required' : 'optional'}</span>
                </div>
              ))}
              {!manifest && <p className="text-sm text-zinc-500">Create a shot before exporting.</p>}
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="mb-4 flex items-center gap-2 text-zinc-800">
              <Check className="h-5 w-5 text-emerald-600" />
              <h3 className="font-semibold">Last Export</h3>
            </div>
            {lastExport.length > 0 ? (
              <div className="space-y-2">
                {lastExport.map((path) => (
                  <div key={path} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-xs text-emerald-800">
                    {path}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No package has been exported in this session.</p>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
