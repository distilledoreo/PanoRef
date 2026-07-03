import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Film,
  KeyRound,
  Lock,
  Move3D,
  Plus,
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
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { ShotFilmstrip } from '../common/ShotFilmstrip';
import { ShotInfoCard } from '../common/ShotInfoCard';
import { ShotThumbnail } from '../common/ShotThumbnail';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';
import { ShotPanoCropPreview } from '../viewers/ShotPanoCropPreview';
import { FullBleedLayout } from './WorkspaceShell';

const statuses: ShotStatus[] = ['planned', 'exported', 'needs_fix', 'approved', 'rejected'];

export function ShotsWorkspace() {
  const {
    project,
    selectedShotId,
    addCamera,
    selectShot,
    updateShot,
    removeShot,
    toggleShotLandmark,
    shotCameraFlying,
    setShotCameraFlying,
    lockShotCamera,
    acceptShotFraming,
    attachCameraMoveVideoToShot,
    setWorkspace,
    setActivePano,
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
  const [showCompare, setShowCompare] = useState(false);
  const [flyCameraRevision, setFlyCameraRevision] = useState(0);

  const getEffectiveCamera = useCallback((): CameraData | undefined => {
    if (!selectedShot) return undefined;
    return draftCameraRef.current ?? selectedShot.camera;
  }, [selectedShot]);

  const getPreviewShot = useCallback(() => {
    if (!selectedShot) return undefined;
    const camera = getEffectiveCamera();
    if (!camera) return selectedShot;
    return {
      ...selectedShot,
      camera: {
        ...camera,
        position: [...camera.position] as CameraData['position'],
        target: [...camera.target] as CameraData['target'],
      },
    };
  }, [getEffectiveCamera, selectedShot]);

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
    const previewShot = getPreviewShot();
    if (!previewShot) return;
    setIsExportingFrame(true);
    try {
      const frame = await renderShotFrame(project, previewShot);
      setFramePreviewUrl(frame.dataUrl);
      downloadDataUrl(frame.dataUrl, exportFrameFileName);
      if (!shotCameraFlying) {
        updateShot(previewShot.id, { status: 'exported' });
      }
    } finally {
      setIsExportingFrame(false);
    }
  }, [exportFrameFileName, getPreviewShot, project, shotCameraFlying, updateShot]);

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
    const camera = getEffectiveCamera();
    if (!camera) return;
    updateCameraMoveKeyframes(setTwoPointCameraKeyframe({
      keyframes: selectedShot.cameraKeyframes,
      slot,
      camera,
      durationSeconds: cameraMoveDurationSeconds,
    }));
  }, [cameraMoveDurationSeconds, getEffectiveCamera, selectedShot, updateCameraMoveKeyframes]);

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
    if (!selectedShot) return;
    draftCameraRef.current = selectedShot.camera;
    setFlyCameraRevision((revision) => revision + 1);
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
    const previewShot = getPreviewShot();
    if (!previewShot) return '';
    return JSON.stringify({
      scene: project.scene,
      camera: previewShot.camera,
      width: previewShot.exportSettings.width,
      height: previewShot.exportSettings.height,
      flyCameraRevision,
    });
  }, [
    flyCameraRevision,
    getPreviewShot,
    project.scene,
    selectedShot?.exportSettings.height,
    selectedShot?.exportSettings.width,
    selectedShot?.id,
  ]);

  useEffect(() => {
    const previewShot = getPreviewShot();
    if (!previewShot) return;

    let cancelled = false;
    setIsRenderingFrame(true);
    void renderShotFrame(project, previewShot)
      .then((frame) => {
        if (!cancelled) setFramePreviewUrl(frame.dataUrl);
      })
      .finally(() => {
        if (!cancelled) setIsRenderingFrame(false);
      });

    return () => {
      cancelled = true;
    };
  }, [framePreviewKey, getPreviewShot, project]);

  const handleFramingCameraChange = useCallback((camera: CameraData) => {
    if (!selectedShot) return;
    draftCameraRef.current = camera;
    if (shotCameraFlying) {
      setFlyCameraRevision((revision) => revision + 1);
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

  const openLinkedPanoIn360 = useCallback(() => {
    if (!linkedPano) return;
    setActivePano(linkedPano.id);
    setWorkspace('reference');
  }, [linkedPano, setActivePano, setWorkspace]);

  const handleShotMenuAction = useCallback((action: string) => {
    if (!selectedShot) return;
    if (action === 'fly') startFlyCamera();
    if (action === 'accept-framing') acceptShotFraming(selectedShot.id);
    if (action === 'precision') setPrecisionOpen(true);
  }, [acceptShotFraming, selectedShot, startFlyCamera]);

  return (
    <FullBleedLayout reserveHeader>
      <div className="relative h-full min-h-0 overflow-hidden bg-surface-base">
        <div className="absolute inset-0">
          <SceneViewport
            project={project}
            selectedShotId={selectedShot?.id}
            shotFraming={shotFraming}
            minHeightClassName="min-h-0"
          />
        </div>

        {selectedShot && (
          <div
            data-shots-info-safe-area
            className="pointer-events-none absolute inset-x-0 top-0 bottom-[var(--shots-overlay-bottom-safe)] left-0 z-20 flex items-start pl-3 pt-3"
          >
            <div className="pointer-events-auto min-h-0 max-h-full overflow-y-auto">
              <ShotInfoCard
                project={project}
                shot={selectedShot}
                lensMm={lensMm}
                cameraHeight={cameraHeight}
                previewSrc={framePreviewUrl}
                onOpenPrecision={() => setPrecisionOpen(true)}
                onOpenMenuAction={handleShotMenuAction}
                onOpenIn360={linkedPano ? openLinkedPanoIn360 : undefined}
                menuItems={[
                  { id: 'fly', label: 'Fly Camera' },
                  {
                    id: 'accept-framing',
                    label: 'Accept Framing',
                    disabled: framingAccepted || shotCameraFlying,
                  },
                  { id: 'precision', label: 'Camera Settings' },
                ]}
              />
            </div>
          </div>
        )}

        {showCompare && selectedShot && (
          <div className="pointer-events-auto absolute inset-y-3 right-3 z-20 w-72 overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface-overlay shadow-soft backdrop-blur-sm">
            <ShotPanoCropPreview
              imageUrl={linkedAsset?.uri}
              crop={selectedShot.panoCrop}
              panoRotation={linkedPano?.rotation}
              label={linkedPano?.name ?? 'Linked Pano'}
              matchQuality={panoMatch?.quality}
              matchDistanceMeters={panoMatch?.distanceMeters}
              disabledReason={undefined}
            />
          </div>
        )}

        <div
          data-shots-bottom-chrome
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-[var(--shots-bottom-chrome-gap)] px-3 pb-[var(--shots-bottom-chrome-pad)]"
        >
          <div className="pointer-events-auto shrink-0">
            <ShotFilmstrip
              appearance="overlay"
              compact
              project={project}
              selectedShotId={selectedShot?.id}
              onSelectShot={selectShot}
              renderThumbnail={(shot) => (
                shot.id === selectedShot?.id && framePreviewUrl ? (
                  <ShotThumbnail project={project} shot={shot} overrideSrc={framePreviewUrl} />
                ) : undefined
              )}
            />
          </div>
          <div
            data-shots-action-dock
            className="pointer-events-auto flex min-h-0 items-end justify-between gap-2"
          >
            <div className="flex max-w-[min(100%,42rem)] flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-subtle bg-surface-overlay px-2 py-1 shadow-card backdrop-blur-sm">
              <ToolbarButton icon={<Plus className="h-4 w-4" />} label="Add Shot" onClick={addCamera} />
              <ToolbarButton
                icon={<Copy className="h-4 w-4" />}
                label="Duplicate"
                onClick={duplicateSelectedShot}
                disabled={!selectedShot}
              />
              <ToolbarButton
                icon={shotCameraFlying ? <Lock className="h-4 w-4" /> : <Move3D className="h-4 w-4" />}
                label={shotCameraFlying ? 'Lock View' : 'Fly Camera'}
                onClick={shotCameraFlying ? commitDraftCameraAndLock : startFlyCamera}
                disabled={!selectedShot}
                active={shotCameraFlying}
              />
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
                <span className="hidden px-1 text-xs text-secondary sm:inline">Use Lock View to save camera position</span>
              )}
              {!shotCameraFlying && selectedShot && !framingAccepted && (
                <button
                  type="button"
                  onClick={() => acceptShotFraming(selectedShot.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Accept Framing
                </button>
              )}
            </div>
            <PrimaryCTA
              icon={<Film className="h-5 w-5" />}
              label={isRenderingFrame ? 'Rendering...' : 'Render Shot Preview'}
              hint="Preview this shot from the reference."
              onClick={() => void exportCameraFrame()}
              disabled={!selectedShot || isExportingFrame || isRenderingFrame}
              highlighted={primaryAction?.id === 'accept-framing' || primaryAction?.id === 'lock-camera'}
              layout="inline"
            />
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
                disabled={isExportingFrame || isRenderingFrame}
                className="w-full"
              >
                <Download className="h-4 w-4" />
                {isExportingFrame ? 'Exporting...' : `Download Frame (${selectedShot.exportSettings.width}×${selectedShot.exportSettings.height})`}
              </IconButton>
            </Panel>

            <Panel title="Camera Move MP4">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <IconButton onClick={() => captureCameraMoveKeyframe('start')} className="w-full">
                    <KeyRound className="h-4 w-4" />
                    Set Start
                  </IconButton>
                  <IconButton onClick={() => captureCameraMoveKeyframe('end')} className="w-full">
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
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-45 ${
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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
