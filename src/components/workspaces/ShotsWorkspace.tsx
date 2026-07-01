import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Move3D, Plus, Trash2 } from 'lucide-react';
import { CameraData, ShotStatus } from '../../domain/types';
import { downloadDataUrl } from '../../engine/projectIO';
import { renderShotFrame } from '../../engine/renderers';
import { GuidedSidebar } from '../common/GuidedSidebar';
import { isShotFramingAccepted, resolveWorkspaceObjective } from '../../engine/workflow';
import { getPanoMatchQuality, resolveShotLinkedPano } from '../../engine/sync';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { Vec3Input } from '../common/Vec3Input';
import { WarningList } from '../common/WarningList';
import { SceneViewport } from '../viewers/SceneViewport';
import { ShotPanoCropPreview } from '../viewers/ShotPanoCropPreview';
import { WorkspaceWithDrawer } from './WorkspaceShell';

const statuses: ShotStatus[] = ['planned', 'exported', 'needs_fix', 'approved', 'rejected'];

export function ShotsWorkspace() {
  const {
    project,
    selectedShotId,
    selectedObjectId,
    addCamera,
    selectShot,
    updateShot,
    removeShot,
    toggleShotLandmark,
    selectObject,
    shotCameraFlying,
    setShotCameraFlying,
    lockShotCamera,
    acceptShotFraming,
    setWorkspace,
  } = useContinuityStore();
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const linkedPano = selectedShot ? resolveShotLinkedPano(project, selectedShot) : undefined;
  const linkedAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const draftCameraRef = useRef<CameraData | undefined>();
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | undefined>();
  const [isRenderingFrame, setIsRenderingFrame] = useState(false);
  const [isExportingFrame, setIsExportingFrame] = useState(false);

  const exportFrameFileName = selectedShot
    ? `${selectedShot.name.replace(/\s+/g, '_').toLowerCase()}_${selectedShot.exportSettings.width}x${selectedShot.exportSettings.height}.png`
    : 'camera_frame.png';

  const exportCameraFrame = useCallback(async () => {
    if (!selectedShot) return;
    setIsExportingFrame(true);
    try {
      const frame = await renderShotFrame(project, selectedShot);
      setFramePreviewUrl(frame.dataUrl);
      downloadDataUrl(frame.dataUrl, exportFrameFileName);
      updateShot(selectedShot.id, { status: 'exported' });
    } finally {
      setIsExportingFrame(false);
    }
  }, [exportFrameFileName, project, selectedShot, updateShot]);

  useEffect(() => {
    if (!selectedShot || !shotCameraFlying) return;
    draftCameraRef.current = selectedShot.camera;
    setFramePreviewUrl(undefined);
  }, [selectedShot?.id, selectedShot?.camera, shotCameraFlying]);

  const framePreviewKey = useMemo(() => {
    if (!selectedShot) return '';
    return JSON.stringify({
      scene: project.scene,
      camera: selectedShot.camera,
      width: selectedShot.exportSettings.width,
      height: selectedShot.exportSettings.height,
    });
  }, [
    project.scene,
    selectedShot?.id,
    selectedShot?.camera,
    selectedShot?.exportSettings.width,
    selectedShot?.exportSettings.height,
  ]);

  useEffect(() => {
    if (!selectedShot || shotCameraFlying) {
      if (shotCameraFlying) setFramePreviewUrl(undefined);
      return;
    }

    let cancelled = false;
    setIsRenderingFrame(true);
    void renderShotFrame(project, selectedShot)
      .then((frame) => {
        if (!cancelled) setFramePreviewUrl(frame.dataUrl);
      })
      .finally(() => {
        if (!cancelled) setIsRenderingFrame(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    framePreviewKey,
    selectedShot?.id,
    shotCameraFlying,
  ]);

  const handleFramingCameraChange = useCallback((camera: CameraData) => {
    if (!selectedShot) return;
    if (shotCameraFlying) {
      draftCameraRef.current = camera;
      return;
    }
    updateShot(selectedShot.id, { camera });
  }, [selectedShot?.id, shotCameraFlying, updateShot]);

  const startFlyCamera = useCallback(() => {
    if (selectedShot) draftCameraRef.current = selectedShot.camera;
    setFramePreviewUrl(undefined);
    setShotCameraFlying(true);
  }, [selectedShot?.camera, setShotCameraFlying]);

  const commitDraftCameraAndLock = useCallback(() => {
    if (selectedShot && draftCameraRef.current) {
      updateShot(selectedShot.id, { camera: draftCameraRef.current });
    }
    draftCameraRef.current = undefined;
    lockShotCamera();
  }, [lockShotCamera, selectedShot?.id, updateShot]);

  const panoMatch = selectedShot && linkedPano
    ? getPanoMatchQuality(selectedShot.camera, linkedPano, project.settings)
    : undefined;

  const shotFraming = useMemo(() => (
    selectedShot
      ? {
        camera: selectedShot.camera,
        frameAspectRatio: selectedShot.exportSettings.width / selectedShot.exportSettings.height,
        frameResolutionLabel: `${selectedShot.exportSettings.width}×${selectedShot.exportSettings.height}`,
        flyActive: shotCameraFlying,
        onCameraChange: handleFramingCameraChange,
        onLockCamera: commitDraftCameraAndLock,
      }
      : undefined
  ), [
    commitDraftCameraAndLock,
    handleFramingCameraChange,
    selectedShot?.camera,
    selectedShot?.exportSettings.height,
    selectedShot?.exportSettings.width,
    shotCameraFlying,
  ]);

  const objective = resolveWorkspaceObjective({
    project,
    workspace: 'shots',
    selectedShotId: selectedShot?.id,
    shotCameraFlying,
  });
  const framingAccepted = selectedShot ? isShotFramingAccepted(project, selectedShot.id) : false;

  return (
    <WorkspaceWithDrawer
      showDrawer
      project={project}
      selectedShotId={selectedShot?.id}
      onSelectShot={selectShot}
      sidebar={(
        <GuidedSidebar
          objective={objective}
          doThisNext={selectedShot ? (
            <div className="space-y-2">
              <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900">
                {shotCameraFlying
                  ? 'Fly with WASD, drag to look, then left-click the viewport to lock the camera. The teal rectangle is the export frame.'
                  : 'Camera is locked. Accept framing when the clay and pano crop previews look right.'}
              </p>
              {shotCameraFlying ? (
                <p className="text-xs text-zinc-500">Use the viewport to lock the camera — no separate lock button needed.</p>
              ) : (
                <>
                  <IconButton onClick={startFlyCamera} className="w-full">
                    <Move3D className="h-4 w-4" />
                    Fly Camera
                  </IconButton>
                  {!framingAccepted && (
                    <IconButton
                      onClick={() => acceptShotFraming(selectedShot.id)}
                      className="w-full border-teal-500 bg-teal-500 text-white hover:bg-teal-600"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Accept Framing
                    </IconButton>
                  )}
                  {framingAccepted && (
                    <IconButton onClick={() => setWorkspace('review')} className="w-full border-teal-500 bg-teal-500 text-white hover:bg-teal-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Continue to Review
                    </IconButton>
                  )}
                </>
              )}
              <IconButton onClick={() => addCamera()} className="w-full">
                <Plus className="h-4 w-4" />
                Add Camera
              </IconButton>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Add a camera from the shot drawer.</p>
          )}
          checkYourWork={selectedShot ? (
            <WarningList warnings={getShotWarnings(project, selectedShot)} />
          ) : (
            <p className="text-sm text-zinc-500">Select a shot in the drawer to see readiness checks.</p>
          )}
          adjustAdvanced={selectedShot && (
            <>
            <Panel
              title="Camera Inspector"
              actions={(
                <button
                  onClick={() => removeShot(selectedShot.id)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-700"
                  title="Delete selected camera"
                  disabled={project.shots.length <= 1}
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

            <Panel title="Landmarks">
              <div className="space-y-2">
                {project.landmarks.map((landmark) => (
                  <label key={landmark.id} className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={selectedShot.landmarkIds.includes(landmark.id)}
                      onChange={() => toggleShotLandmark(selectedShot.id, landmark.id)}
                      className="accent-teal-500"
                    />
                    <span className="flex-1">{landmark.displayName}</span>
                    {landmark.promptCritical && <span className="text-xs text-teal-700">critical</span>}
                  </label>
                ))}
              </div>
            </Panel>
            <Panel title="Export Frame">
              <IconButton
                onClick={() => void exportCameraFrame()}
                disabled={shotCameraFlying || isExportingFrame || isRenderingFrame}
                className="w-full"
              >
                <Download className="h-4 w-4" />
                {isExportingFrame ? 'Exporting...' : `Download Frame (${selectedShot.exportSettings.width}×${selectedShot.exportSettings.height})`}
              </IconButton>
            </Panel>
            </>
          )}
        />
      )}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(240px,38%)] lg:grid-rows-[minmax(0,1fr)_minmax(260px,40%)]">
        <SceneViewport
          project={project}
          selectedObjectId={selectedObjectId}
          selectedShotId={selectedShot?.id}
          shotFraming={shotFraming}
          onSelectObject={selectObject}
          minHeightClassName="min-h-0"
        />
        <div className="grid min-h-0 grid-cols-1 border-t border-zinc-200 lg:grid-cols-2">
          <ShotPanoCropPreview
            imageUrl={linkedAsset?.uri}
            crop={selectedShot?.panoCrop}
            panoRotation={linkedPano?.rotation}
            label={linkedPano?.name ?? 'Linked Pano'}
            matchQuality={panoMatch?.quality}
            matchDistanceMeters={panoMatch?.distanceMeters}
            disabledReason={shotCameraFlying ? 'Lock the camera to render the pano crop preview.' : undefined}
          />
          <div className="flex min-h-0 flex-col border-t border-zinc-200 bg-white p-5 lg:border-l lg:border-t-0">
            {selectedShot ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-zinc-800">Export Frame Preview</h3>
                  <span className="font-mono text-xs text-zinc-500">
                    {selectedShot.exportSettings.width}×{selectedShot.exportSettings.height}
                  </span>
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
                  {shotCameraFlying ? (
                    <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-sm text-zinc-400">
                      Lock the camera to preview and export the exact frame.
                    </div>
                  ) : isRenderingFrame && !framePreviewUrl ? (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-zinc-400">
                      Rendering frame...
                    </div>
                  ) : framePreviewUrl ? (
                    <img
                      src={framePreviewUrl}
                      alt={`Export preview for ${selectedShot.name}`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-zinc-400">
                      No preview yet.
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-zinc-500">
                    Clay render from the locked camera — matches the exported PNG.
                  </p>
                  <IconButton
                    onClick={() => void exportCameraFrame()}
                    disabled={shotCameraFlying || isExportingFrame || isRenderingFrame}
                    className="shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    {isExportingFrame ? 'Exporting...' : 'Download'}
                  </IconButton>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Select a camera to preview the export frame.
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceWithDrawer>
  );
}
