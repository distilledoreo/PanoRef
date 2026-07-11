import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  FileArchive,
  LoaderCircle,
  Upload,
} from 'lucide-react';
import { SceneObject } from '../../domain/types';
import {
  MODEL_IMPORT_ACCEPT,
  ModelImportMode,
  createModelImportPlan,
  importModelJob,
} from '../../engine/modelImport';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Modal } from './Modal';

interface ImportReportItem {
  id: string;
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

export function ModelImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: (objects: SceneObject[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addImportedModels = useContinuityStore((state) => state.addImportedModels);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [report, setReport] = useState<ImportReportItem[]>([]);
  const [mode, setMode] = useState<ModelImportMode>('separate');

  const selectFiles = () => {
    if (!busy) inputRef.current?.click();
  };

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    const plan = createModelImportPlan(Array.from(files));
    const nextReport: ImportReportItem[] = plan.issues.map((issue, index) => ({
      id: `plan-${index}-${issue.fileName}`,
      tone: issue.tone,
      title: issue.fileName,
      message: issue.message,
    }));
    const imported: SceneObject[] = [];
    setBusy(true);
    setReport(nextReport);

    for (let index = 0; index < plan.jobs.length; index += 1) {
      const job = plan.jobs[index];
      setProgress(`Converting ${job.file.name} (${index + 1} of ${plan.jobs.length})…`);
      try {
        // Sequential conversion keeps peak memory predictable on low-power devices.
        const batch = await importModelJob(job, { mode });
        addImportedModels(batch.items);
        imported.push(...batch.items.map((i) => i.object));

        // Per-file success card
        if (batch.summary.combined) {
          nextReport.push({
            id: `${batch.items[0]?.object.importedModel?.sourceImportId ?? batch.items[0]?.object.id}-summary`,
            tone: 'success',
            title: batch.summary.sourceName,
            message: `Imported 1 combined object from ${batch.summary.sourceNodeCount} mesh nodes · ${batch.summary.totalTriangles.toLocaleString()} triangles · layout preserved`,
          });
        } else {
          nextReport.push({
            id: `${batch.summary.sourceName}-summary`,
            tone: 'success',
            title: batch.summary.sourceName,
            message: `Imported ${batch.summary.totalObjects} selectable object${batch.summary.totalObjects === 1 ? '' : 's'} · ${batch.summary.totalTriangles.toLocaleString()} triangles · layout preserved, hierarchy flattened`,
          });
        }

        // Per-object breakdown (only in separate mode when >1 object, to avoid clutter)
        if (!batch.summary.combined && batch.items.length > 1) {
          batch.items.forEach((result) => {
            const src = result.object.importedModel;
            nextReport.push({
              id: `${result.object.id}-detail`,
              tone: 'success',
              title: result.object.name,
              message: `${src?.triangleCount.toLocaleString()} tri · ${src?.vertexCount.toLocaleString()} verts · center [${result.object.transform.position.map((v) => v.toFixed(2)).join(', ')}]`,
            });
          });
        }

        batch.warnings.forEach((warning, warningIndex) => nextReport.push({
          id: `${batch.items[0]?.object.id ?? index}-warning-${warningIndex}`,
          tone: 'warning',
          title: batch.summary.sourceName,
          message: warning,
        }));
      } catch (error) {
        nextReport.push({
          id: `error-${index}-${job.file.name}`,
          tone: 'error',
          title: job.file.name,
          message: error instanceof Error ? error.message : 'Could not import this file.',
        });
      }
      setReport([...nextReport]);
    }

    setProgress(undefined);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    if (imported.length > 0) onImported?.(imported);
  };

  return (
    <Modal
      open={open}
      title="Import 3D scene"
      onClose={busy ? undefined : onClose}
      size="lg"
      scrollBody
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary transition hover:text-primary disabled:opacity-40"
          >
            Close
          </button>
          <button
            type="button"
            onClick={selectFiles}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
            data-model-import-choose
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? 'Importing…' : 'Choose files'}
          </button>
        </>
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MODEL_IMPORT_ACCEPT}
        className="sr-only"
        onChange={(event) => void importFiles(event.target.files)}
        data-model-import-input
      />

      <div className="space-y-4" data-model-import-dialog>
        <div className="rounded-xl border border-subtle bg-surface-muted p-4">
          <div className="flex gap-3">
            <Box className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-primary">Export from your DCC, then import the export</p>
              <ul className="list-disc pl-4 text-sm leading-relaxed text-secondary">
                <li><span className="font-medium text-primary">Blender:</span> File → Export → glTF 2.0 (.glb) – include the whole scene – apply export transforms if you want final world space.</li>
                <li><span className="font-medium text-primary">Maya:</span> File → Export All → FBX – include all visible objects in world space.</li>
                <li><span className="font-medium text-primary">Unreal:</span> File → Export All – export selected level or actors as GLB.</li>
              </ul>
              <p className="text-xs leading-relaxed text-secondary">
                Direct import formats: GLB, embedded glTF, FBX, OBJ, STL, PLY, .panoscene bundles. Materials, textures, cameras, lights, animation, rigs, and morphs are stripped. PanoRef keeps world-space placement, with hierarchy flattened.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-subtle p-3">
          <p className="text-sm font-semibold text-primary">How to import</p>
          <div className="mt-3 flex flex-col gap-2">
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${mode === 'separate' ? 'border-accent bg-accent-soft' : 'border-subtle hover:border-accent/50'}`}>
              <input
                type="radio"
                name="importMode"
                value="separate"
                checked={mode === 'separate'}
                onChange={() => setMode('separate')}
                className="mt-1"
                disabled={busy}
                data-import-mode="separate"
              />
              <div>
                <p className="text-sm font-medium text-primary">Keep objects separate (default)</p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">One Mesh = one object. One InstancedMesh = one object containing all instances. No per-instance objects. Hierarchy not recreated – world transforms baked. Each object: position = center of world bounds, rotation [0,0,0], scale [1,1,1]. Selecting one chair selects that entire chair.</p>
              </div>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${mode === 'combined' ? 'border-accent bg-accent-soft' : 'border-subtle hover:border-accent/50'}`}>
              <input
                type="radio"
                name="importMode"
                value="combined"
                checked={mode === 'combined'}
                onChange={() => setMode('combined')}
                className="mt-1"
                disabled={busy}
                data-import-mode="combined"
              />
              <div>
                <p className="text-sm font-medium text-primary">Combine into one object</p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">All nodes are world-transformed into one asset and one object. Good for very heavy scenes or when you need a single collision/flow blocker.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 rounded-xl border border-subtle px-4 py-3 text-sm text-secondary">
          <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            Pipeline handoffs can use a <code className="text-primary">.panoscene</code> ZIP containing
            <code className="ml-1 text-primary">panoref-scene.json</code> and one geometry entry. Materials are still stripped.
          </p>
        </div>

        {progress && (
          <div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-primary" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
            {progress}
          </div>
        )}

        {report.length > 0 && (
          <div className="space-y-2 border-t border-subtle pt-4" aria-live="polite">
            <h3 className="text-sm font-semibold text-primary">Import report</h3>
            {report.map((item) => (
              <div key={item.id} className="flex gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm">
                {item.tone === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.tone === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium text-primary">{item.title}</div>
                  <div className="mt-0.5 leading-relaxed text-secondary">{item.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
