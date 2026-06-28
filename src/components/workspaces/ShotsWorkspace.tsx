import React from 'react';
import { Camera, CopyPlus, Crosshair, Plus, Trash2 } from 'lucide-react';
import { ShotStatus } from '../../domain/types';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore, shotPresetOptions, ShotPresetId } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { Vec3Input } from '../common/Vec3Input';
import { WarningList } from '../common/WarningList';
import { SceneViewport } from '../viewers/SceneViewport';
import { PanoViewer } from '../viewers/PanoViewer';
import { WorkspaceLayout } from './BuildWorkspace';

const statuses: ShotStatus[] = ['planned', 'exported', 'needs_fix', 'approved', 'rejected'];

export function ShotsWorkspace() {
  const {
    project,
    selectedShotId,
    selectedObjectId,
    activePanoId,
    panoView,
    createPresetShot,
    createMainStructureWideShot,
    createShotFromCurrentPanoView,
    selectShot,
    updateShot,
    removeShot,
    toggleShotLandmark,
    setPanoView,
    selectObject,
  } = useContinuityStore();
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId);
  const activePano = project.panoRefs.find((pano) => pano.id === activePanoId) ?? project.panoRefs.find((pano) => pano.isCanonical);
  const activeAsset = activePano ? project.assets.assets[activePano.imageAssetId] : undefined;

  return (
    <WorkspaceLayout
      sidebar={(
        <>
          <Panel title="Create Shot">
            <div className="space-y-2">
              <IconButton onClick={() => createMainStructureWideShot()} className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                <Crosshair className="h-4 w-4" />
                Main Structure Wide Shot
              </IconButton>
              <IconButton onClick={() => createShotFromCurrentPanoView()} disabled={!activePano} className="w-full">
                <Plus className="h-4 w-4" />
                Create From Pano View
              </IconButton>
              <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                The guided wide shot frames the central structure and keeps the man visible facing the camera.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {shotPresetOptions.map((preset) => (
                  <IconButton key={preset.id} onClick={() => createPresetShot(preset.id as ShotPresetId)} className="justify-start">
                    <Camera className="h-4 w-4" />
                    {preset.label}
                  </IconButton>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Shot List">
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {project.shots.length === 0 && (
                <p className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-500">
                  Create a shot from a preset or from the active pano view.
                </p>
              )}
              {project.shots.map((shot) => (
                <button
                  key={shot.id}
                  onClick={() => selectShot(shot.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    selectedShotId === shot.id
                      ? 'border-cyan-400 bg-cyan-950/60'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100">{shot.name}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{shot.status}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-500">
                    {shot.camera.fovDegrees.toFixed(0)}° · {shot.exportSettings.width}x{shot.exportSettings.height}
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          {selectedShot && (
            <Panel
              title="Shot Inspector"
              actions={(
                <button
                  onClick={() => removeShot(selectedShot.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-950 hover:text-red-300"
                  title="Delete selected shot"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            >
              <div className="space-y-3">
                <Field label="Name">
                  <TextInput value={selectedShot.name} onChange={(event) => updateShot(selectedShot.id, { name: event.target.value })} />
                </Field>
                <Field label="Status">
                  <Select value={selectedShot.status} onChange={(event) => updateShot(selectedShot.id, { status: event.target.value as ShotStatus })}>
                    {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </Select>
                </Field>
                <Field label="Description">
                  <TextArea value={selectedShot.description} onChange={(event) => updateShot(selectedShot.id, { description: event.target.value })} />
                </Field>
                <Field label="Camera Position">
                  <Vec3Input
                    value={selectedShot.camera.position}
                    onChange={(position) => updateShot(selectedShot.id, { camera: { ...selectedShot.camera, position } })}
                  />
                </Field>
                <Field label="Camera Target">
                  <Vec3Input
                    value={selectedShot.camera.target}
                    onChange={(target) => updateShot(selectedShot.id, { camera: { ...selectedShot.camera, target } })}
                  />
                </Field>
                <Field label="FOV">
                  <TextInput
                    type="number"
                    value={selectedShot.camera.fovDegrees}
                    onChange={(event) => updateShot(selectedShot.id, {
                      camera: { ...selectedShot.camera, fovDegrees: Number(event.target.value) },
                    })}
                  />
                </Field>
              </div>
            </Panel>
          )}

          {selectedShot && (
            <Panel title="Landmarks">
              <div className="space-y-2">
                {project.landmarks.map((landmark) => (
                  <label key={landmark.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={selectedShot.landmarkIds.includes(landmark.id)}
                      onChange={() => toggleShotLandmark(selectedShot.id, landmark.id)}
                      className="accent-cyan-400"
                    />
                    <span className="flex-1">{landmark.displayName}</span>
                    {landmark.promptCritical && <span className="text-xs text-cyan-300">critical</span>}
                  </label>
                ))}
              </div>
            </Panel>
          )}

          {selectedShot && (
            <Panel title="Shot Checks">
              <WarningList warnings={getShotWarnings(project, selectedShot)} />
            </Panel>
          )}
        </>
      )}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(320px,42%)]">
        <SceneViewport project={project} selectedObjectId={selectedObjectId} onSelectObject={selectObject} />
        <div className="grid min-h-0 grid-cols-2 border-t border-slate-800">
          <PanoViewer
            imageUrl={activeAsset?.uri}
            view={panoView}
            onViewChange={setPanoView}
            label={activePano?.name ?? 'Linked Pano'}
            panoRotation={activePano?.rotation}
          />
          <div className="min-h-0 border-l border-slate-800 bg-slate-950 p-5">
            {selectedShot ? (
              <div className="flex h-full flex-col">
                <div className="mb-4 flex items-center gap-2 text-slate-200">
                  <CopyPlus className="h-5 w-5 text-cyan-300" />
                  <h3 className="font-semibold">Shot Package Preview</h3>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <InfoLabel label="Shot" value={selectedShot.name} />
                  <InfoLabel label="Linked Pano" value={activePano?.name ?? 'None'} />
                  <InfoLabel label="Yaw" value={`${selectedShot.panoCrop?.yawDegrees.toFixed(1) ?? 'n/a'}°`} />
                  <InfoLabel label="Pitch" value={`${selectedShot.panoCrop?.pitchDegrees.toFixed(1) ?? 'n/a'}°`} />
                  <InfoLabel label="FOV" value={`${selectedShot.camera.fovDegrees.toFixed(1)}°`} />
                  <InfoLabel label="Landmarks" value={String(selectedShot.landmarkIds.length)} />
                </dl>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Select or create a shot to preview continuity metadata.
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}

function InfoLabel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-slate-100">{value}</dd>
    </div>
  );
}
