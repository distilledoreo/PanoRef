import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Film,
  Frame,
  KeyRound,
  MoreHorizontal,
  Move3D,
  Plus,
  Ruler,
  Trash2,
} from 'lucide-react';
import { CameraData, ShotStatus } from '../../domain/types';
import {
  DEFAULT_CAMERA_LENS_MM,
  DEFAULT_CAMERA_HEIGHT_METERS,
} from '../../domain/defaults';
import {
  DEFAULT_CAMERA_MOVE_DURATION_SECONDS,
  CameraMoveKeyframeSlot,
  getCameraMoveDurationSeconds,
  getSortedCameraKeyframes,
  hasRenderableCameraMove,
  setTwoPointCameraKeyframe,
  updateCameraMoveDuration,
} from '../../engine/cameraKeyframes';
import { downloadDataUrl } from '../../engine/projectIO';
import { getSupportedCameraMoveMp4MimeType, renderShotCameraMoveMp4, renderShotFrame } from '../../engine/renderers';
import { isShotFramingAccepted, resolveWorkspacePrimaryAction } from '../../engine/workflow';
import { getPanoMatchQuality, resolveShotLinkedPano } from '../../engine/sync';
import { getShotWarnings } from '../../engine/warnings';
import { useContinuityStore } from '../../state/useContinuityStore';
import { ContextualPanel } from '../common/ContextualPanel';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { ShotFilmstrip } from '../common/ShotFilmstrip';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';
import { ShotPanoCropPreview } from '../viewers/ShotPanoCropPreview';
import { FullBleedLayout } from './WorkspaceShell';

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
    attachCameraMoveVideoToShot,
  } = useContinuityStore();
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const linkedPano = selectedShot ? resolveShotLinkedPano(project, selectedShot) : undefined;
  const linkedAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const draftCameraRef = useRef<CameraData | undefined>();
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | undefined>();
  const [isRenderingFrame, setIsRenderingFrame] = useState(false);
  const [isExportingFrame, setIsExportingFrame] = useState(false);
  const [cameraMovePreviewUrl, setCameraMovePreviewUrl] = useState<string | undefined>();
  const [isExportingCameraMove, setIsExportingCameraMove] = useState(false);
  const [cameraMoveProgress, setCameraMoveProgress] = useState(0);
  const [cameraMoveError, setCameraMoveError] = useState<string | undefined>();
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [shotMenuOpen, setShotMenuOpen] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  const exportFrameFileName = selectedShot
    ? `${selectedShot.name.replace(/\s+/g, '_').toLowerCase()}_${selectedShot.exportSettings.width}x${selectedShot.exportSettings.height}.png`
    : 'camera_frame.png';
  const cameraMoveFileName = selectedShot
    ? `${selectedShot.name.replace(/\s+/g, '_').toLowerCase()}_camera_move.mp4`
    : 'camera_move.mp4';
  const cameraMoveKeyframes = useMemo(
    () => getSortedCameraKeyframes(selectedShot?.cameraKeyframes ?? []),
    [selectedShot?.cameraKeyframes],
  );
  const cameraMoveDurationSeconds = selectedShot
    ? getCameraMoveDurationSeconds(cameraMoveKeyframes, DEFAULT_CAMERA_MOVE_DURATION_SECONDS)
    : DEFAULT_CAMERA_MOVE_DURATION_SECONDS;
  const cameraMoveReady = hasRenderableCameraMove(cameraMoveKeyframes);
  const cameraMoveAsset = selectedShot?.assets.cameraMoveVideoAssetId
    ? project.assets.assets[selectedShot.assets.cameraMoveVideoAssetId]
    : undefined;
  const supportedMp4MimeType = getSupportedCameraMoveMp4MimeType();

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

  const updateCameraMoveKeyframes = useCallback((keyframes: typeof cameraMoveKeyframes) => {
    if (!selectedShot) return;
    updateShot(selectedShot.id, {
      cameraKeyframes: keyframes,
      assets: {
        ...selectedShot.assets,
        cameraMoveVideoAssetId: undefined,
      },
    });
    setCameraMovePreviewUrl(undefined);
    setCameraMoveError(undefined);
  }, [selectedShot, updateShot]);

  const captureCameraMoveKeyframe = useCallback((slot: CameraMoveKeyframeSlot) => {
    if (!selectedShot) return;
    updateCameraMoveKeyframes(setTwoPointCameraKeyframe({
      keyframes: selectedShot.cameraKeyframes,
      slot,
      camera: selectedShot.camera,
      durationSeconds: cameraMoveDurationSeconds,
    }));
  }, [cameraMoveDurationSeconds, selectedShot, updateCameraMoveKeyframes]);

  const changeCameraMoveDuration = useCallback((durationSeconds: number) => {
    if (!selectedShot) return;
    updateCameraMoveKeyframes(updateCameraMoveDuration(selectedShot.cameraKeyframes, durationSeconds));
  }, [selectedShot, updateCameraMoveKeyframes]);

  const exportCameraMoveVideo = useCallback(async () => {
    if (!selectedShot) return;
    const mimeType = getSupportedCameraMoveMp4MimeType();
    if (!mimeType) {
      setCameraMoveError('MP4 export is not supported in this browser.');
      return;
    }
    if (!hasRenderableCameraMove(selectedShot.cameraKeyframes)) {
      setCameraMoveError('Capture start and end camera keyframes before exporting MP4.');
      return;
    }

    setIsExportingCameraMove(true);
    setCameraMoveProgress(0);
    setCameraMoveError(undefined);
    try {
      const video = await renderShotCameraMoveMp4(project, selectedShot, {
        mimeType,
        frameRate: 30,
        onProgress: setCameraMoveProgress,
      });
      const asset = attachCameraMoveVideoToShot(selectedShot.id, {
        name: cameraMoveFileName,
        dataUrl: video.dataUrl,
        mimeType: video.mimeType,
        width: video.width,
        height: video.height,
        durationSeconds: video.durationSeconds,
        frameRate: video.frameRate,
      });
      setCameraMovePreviewUrl(asset.uri);
      downloadDataUrl(asset.uri, asset.name);
    } catch (error) {
      setCameraMoveError(error instanceof Error ? error.message : 'MP4 export failed.');
    } finally {
      setIsExportingCameraMove(false);
    }
  }, [attachCameraMoveVideoToShot, cameraMoveFileName, project, selectedShot]);

  useEffect(() => {
    if (!selectedShot || !shotCameraFlying) return;
    draftCameraRef.current = selectedShot.camera;
    setFramePreviewUrl(undefined);
  }, [selectedShot?.id, selectedShot?.camera, shotCameraFlying]);

  useEffect(() => {
    setCameraMovePreviewUrl(cameraMoveAsset?.uri);
  }, [cameraMoveAsset?.uri, selectedShot?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'i' && selectedShot && !isEditableTarget(event.target)) {
        event.preventDefault();
        setPrecisionOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShot]);

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
  }, [framePreviewKey, selectedShot?.id, shotCameraFlying]);

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

  const framingAccepted = selectedShot ? isShotFramingAccepted(project, selectedShot.id) : false;
  const primaryAction = useMemo(
    () => resolveWorkspacePrimaryAction({
      project,
      workspace: 'shots',
      selectedShotId: selectedShot?.id,
      shotCameraFlying,
    }),
    [project, selectedShot?.id, shotCameraFlying],
  );
  const shotWarnings = selectedShot ? getShotWarnings(project, selectedShot) : [];
  const lensMm = project.settings.defaultCameraLensMm ?? DEFAULT_CAMERA_LENS_MM;
  const cameraHeight = selectedShot?.camera.position[1] ?? DEFAULT_CAMERA_HEIGHT_METERS;

  const duplicateSelectedShot = useCallback(() => {
    if (!selectedShot) return;
    const newShot = addCamera();
    updateShot(newShot.id, {
      camera: {
        ...selectedShot.camera,
        position: [...selectedShot.camera.position] as CameraData['position'],
        target: [...selectedShot.camera.target] as CameraData['target'],
      },
      description: selectedShot.description,
      landmarkIds: [...selectedShot.landmarkIds],
      exportSettings: { ...selectedShot.exportSettings },
      cameraKeyframes: selectedShot.cameraKeyframes.map((keyframe) => ({
        ...keyframe,
        camera: {
          ...keyframe.camera,
          position: [...keyframe.camera.position] as CameraData['position'],
          target: [...keyframe.camera.target] as CameraData['target'],
        },
      })),
    });
  }, [addCamera, selectedShot, updateShot]);

  return (
    <FullBleedLayout>
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className="relative min-h-0">
          <SceneViewport
            project={project}
            selectedObjectId={selectedObjectId}
            selectedShotId={selectedShot?.id}
            shotFraming={shotFraming}
            onSelectObject={selectObject}
            minHeightClassName="min-h-0"
          />

          {showCompare && selectedShot && (
            <div className="absolute inset-y-0 right-0 z-10 w-80 border-l border-subtle bg-surface-raised shadow-soft">
              <ShotPanoCropPreview
                imageUrl={linkedAsset?.uri}
                crop={selectedShot.panoCrop}
                panoRotation={linkedPano?.rotation}
                label={linkedPano?.name ?? 'Linked Pano'}
                matchQuality={panoMatch?.quality}
                matchDistanceMeters={panoMatch?.distanceMeters}
                disabledReason={shotCameraFlying ? 'Lock the camera to render the pano crop preview.' : undefined}
              />
            </div>
          )}

          {selectedShot && (
            <div className="pointer-events-none absolute left-5 top-5 z-10">
              <ContextualPanel>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-primary">Shot {selectedShot.shotNumber}</div>
                    <div className="text-xs text-secondary">{selectedShot.name}</div>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShotMenuOpen((open) => !open)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-subtle text-secondary hover:text-primary"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {shotMenuOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-subtle bg-surface-raised py-1 shadow-soft">
                        <MenuItem onClick={startFlyCamera}>Fly Camera</MenuItem>
                        {!framingAccepted && !shotCameraFlying && (
                          <MenuItem onClick={() => acceptShotFraming(selectedShot.id)}>Accept Framing</MenuItem>
                        )}
                        <MenuItem onClick={() => setPrecisionOpen(true)}>Camera Settings</MenuItem>
                      </div>
                    )}
                  </div>
                </div>
                <dl className="mt-3 space-y-1 text-xs text-secondary">
                  <div className="flex justify-between gap-4"><dt>Lens</dt><dd className="text-primary">{lensMm}mm</dd></div>
                  <div className="flex justify-between gap-4"><dt>Height</dt><dd className="text-primary">{cameraHeight.toFixed(1)}m</dd></div>
                  <div className="flex justify-between gap-4"><dt>FOV</dt><dd className="text-primary">{selectedShot.camera.fovDegrees.toFixed(1)}°</dd></div>
                  {selectedShot.description && (
                    <div className="pt-1 text-primary">{selectedShot.description}</div>
                  )}
                </dl>
                {shotWarnings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPrecisionOpen(true)}
                    className="mt-2 text-xs text-amber-600"
                  >
                    {shotWarnings.length} issue{shotWarnings.length === 1 ? '' : 's'} — tap to review
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPrecisionOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent"
                >
                  <Ruler className="h-3.5 w-3.5" />
                  Open precision drawer
                </button>
              </ContextualPanel>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-6 right-6 z-10">
            <PrimaryCTA
              icon={<Film className="h-5 w-5" />}
              label={isRenderingFrame ? 'Rendering...' : 'Render Shot Preview'}
              hint="Preview this shot from the reference."
              onClick={() => void exportCameraFrame()}
              disabled={!selectedShot || shotCameraFlying || isExportingFrame || isRenderingFrame}
              highlighted={primaryAction?.id === 'accept-framing' || primaryAction?.id === 'lock-camera'}
            />
          </div>
        </div>

        <div className="border-t border-subtle bg-surface-raised px-4 py-3 shadow-card">
          <ShotFilmstrip
            project={project}
            selectedShotId={selectedShot?.id}
            onSelectShot={selectShot}
            renderThumbnail={(shot) => (
              shot.id === selectedShot?.id && framePreviewUrl ? (
                <img src={framePreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : undefined
            )}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ToolbarButton icon={<Plus className="h-4 w-4" />} label="Add Shot" onClick={addCamera} />
            <ToolbarButton
              icon={<Copy className="h-4 w-4" />}
              label="Duplicate"
              onClick={duplicateSelectedShot}
              disabled={!selectedShot}
            />
            <ToolbarButton icon={<Frame className="h-4 w-4" />} label="Frame" onClick={startFlyCamera} disabled={!selectedShot} />
            <ToolbarButton
              icon={<Film className="h-4 w-4" />}
              label="Compare"
              onClick={() => setShowCompare((value) => !value)}
              active={showCompare}
            />
            <ToolbarButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              onClick={() => selectedShot && removeShot(selectedShot.id)}
              disabled={!selectedShot || project.shots.length <= 1}
              danger
            />
            {shotCameraFlying && (
              <span className="ml-auto text-xs text-secondary">Click viewport to lock camera</span>
            )}
            {!shotCameraFlying && selectedShot && !framingAccepted && (
              <button
                type="button"
                onClick={() => acceptShotFraming(selectedShot.id)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accept Framing
              </button>
            )}
          </div>
        </div>
      </div>

      <PrecisionDrawer
        open={precisionOpen && Boolean(selectedShot)}
        title="Camera Settings"
        onClose={() => setPrecisionOpen(false)}
      >
        {selectedShot && (
          <div className="space-y-4">
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
            <Field label="Lens (mm)">
              <TextInput type="number" value={lensMm} readOnly />
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
            <Field label="Resolution">
              <div className="grid grid-cols-2 gap-2">
                <TextInput
                  type="number"
                  value={selectedShot.exportSettings.width}
                  onChange={(event) => updateShot(selectedShot.id, {
                    exportSettings: { ...selectedShot.exportSettings, width: Number(event.target.value) },
                  })}
                />
                <TextInput
                  type="number"
                  value={selectedShot.exportSettings.height}
                  onChange={(event) => updateShot(selectedShot.id, {
                    exportSettings: { ...selectedShot.exportSettings, height: Number(event.target.value) },
                  })}
                />
              </div>
            </Field>

            <Panel title="Landmarks">
              <div className="space-y-2">
                {project.landmarks.map((landmark) => (
                  <label key={landmark.id} className="flex items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedShot.landmarkIds.includes(landmark.id)}
                      onChange={() => toggleShotLandmark(selectedShot.id, landmark.id)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="flex-1 text-primary">{landmark.displayName}</span>
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

            <Panel title="Camera Move MP4">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <IconButton onClick={() => captureCameraMoveKeyframe('start')} disabled={shotCameraFlying} className="w-full">
                    <KeyRound className="h-4 w-4" />
                    Set Start
                  </IconButton>
                  <IconButton onClick={() => captureCameraMoveKeyframe('end')} disabled={shotCameraFlying} className="w-full">
                    <KeyRound className="h-4 w-4" />
                    Set End
                  </IconButton>
                </div>
                <Field
                  label="Duration Seconds"
                  hint={cameraMoveKeyframes.length < 2 ? 'Capture the end keyframe before changing duration.' : undefined}
                >
                  <TextInput
                    type="number"
                    min="0.5"
                    max="30"
                    step="0.5"
                    value={cameraMoveDurationSeconds}
                    disabled={cameraMoveKeyframes.length < 2}
                    onChange={(event) => changeCameraMoveDuration(Number(event.target.value))}
                  />
                </Field>
                <IconButton
                  onClick={() => void exportCameraMoveVideo()}
                  disabled={!cameraMoveReady || isExportingCameraMove || !supportedMp4MimeType}
                  className="w-full"
                >
                  <Film className="h-4 w-4" />
                  {isExportingCameraMove ? `Exporting ${Math.round(cameraMoveProgress * 100)}%` : 'Export MP4'}
                </IconButton>
                {!supportedMp4MimeType && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    MP4 export is not supported in this browser.
                  </p>
                )}
                {cameraMoveError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{cameraMoveError}</p>
                )}
                {cameraMovePreviewUrl && (
                  <video src={cameraMovePreviewUrl} controls className="aspect-video w-full rounded-lg border border-subtle" />
                )}
              </div>
            </Panel>

            <button
              type="button"
              onClick={() => removeShot(selectedShot.id)}
              disabled={project.shots.length <= 1}
              className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-45"
            >
              Delete Shot
            </button>
          </div>
        )}
      </PrecisionDrawer>
    </FullBleedLayout>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-45 ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50'
          : active
            ? 'border-[var(--accent)] bg-accent-soft text-accent'
            : 'border-subtle text-secondary hover:border-strong hover:text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs text-secondary hover:bg-surface-muted hover:text-primary"
    >
      {children}
    </button>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}