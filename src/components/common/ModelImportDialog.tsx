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
  const addImportedModel = useContinuityStore((state) => state.addImportedModel);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [report, setReport] = useState<ImportReportItem[]>([]);

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
        const result = await importModelJob(job);
        addImportedModel(result);
        imported.push(result.object);
        const details = result.object.importedModel;
        nextReport.push({
          id: result.object.id,
          tone: 'success',
          title: result.object.name,
          message: details
            ? `${details.triangleCount.toLocaleString()} triangles · ${details.vertexCount.toLocaleString()} vertices · imported unchanged`
            : 'Imported as graybox geometry.',
        });
        details?.warnings?.forEach((warning, warningIndex) => nextReport.push({
          id: `${result.object.id}-warning-${warningIndex}`,
          tone: 'warning',
          title: result.object.name,
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
      title="Import 3D model or scene"
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
            <div>
              <p className="text-sm font-semibold text-primary">Geometry-only, local, and exact</p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                GLB/glTF, OBJ, STL, PLY, and FBX are converted locally into one texture-free graybox object.
                Triangles are not reduced. Materials, textures, cameras, lights, rigs, and animation are omitted.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BridgeCard title="Blender" native=".blend" bridge="Select it with a same-name geometry-only .glb." />
          <BridgeCard title="Maya" native=".ma / .mb" bridge="Select it with a same-name .fbx or .glb." />
          <BridgeCard title="Unreal" native=".umap / .uasset" bridge="Select it with an exported level/actor .glb or .fbx." />
        </div>

        <div className="flex gap-3 rounded-xl border border-subtle px-4 py-3 text-sm text-secondary">
          <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            Pipeline handoffs can use a <code className="text-primary">.panoscene</code> ZIP containing
            <code className="ml-1 text-primary">panoref-scene.json</code> and one geometry entry. Native DCC bytes are never executed or uploaded.
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

function BridgeCard({ title, native, bridge }: { title: string; native: string; bridge: string }) {
  return (
    <div className="rounded-xl border border-subtle p-3">
      <p className="text-sm font-semibold text-primary">{title}</p>
      <p className="mt-1 font-mono text-xs text-accent">{native}</p>
      <p className="mt-2 text-xs leading-relaxed text-secondary">{bridge}</p>
    </div>
  );
}
