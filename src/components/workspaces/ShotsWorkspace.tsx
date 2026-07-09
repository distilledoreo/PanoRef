import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { CameraData, ShotStatus } from '../../domain/types';
import {
  DEFAULT_CAMERA_LENS_MM,
  DEFAULT_CAMERA_HEIGHT_METERS,
} from '../../domain/defaults';
import {
  DEFAULT_CAMERA_MOVE_DURATION_SECONDS,
  MAX_CAMERA_MOVE_DURATION_SECONDS,
  MIN_CAMERA_MOVE_DURATION_SECONDS,
  CameraMoveKeyframeSlot,
  getCameraMoveDurationSeconds,
  getSortedCameraKeyframes,
  hasRenderableCameraMove,
  setTwoPointCameraKeyframe,
  updateCameraMoveDuration,
} from '../../engine/cameraKeyframes';
import { downloadDataUrl } from '../../engine/projectIO';
import { getSupportedCameraMoveMp4MimeType, renderShotCameraMoveMp4, renderShotFrame } from '../../engine/renderers';
import { isShotFramingAccepted } from '../../engine/workflow';
import { getPanoMatchQuality, resolveShotLinkedPano } from '../../engine/sync';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { ShotThumbnail } from '../common/ShotThumbnail';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';
import { ShotPanoCropPreview } from '../viewers/ShotPanoCropPreview';
import { FullBleedLayout } from './WorkspaceShell';

const statuses: ShotStatus[] = ['planned', 'exported', 'needs_fix', 'approved', 'rejected'];

/** Quick picks shown on the camera chrome while capturing a move end. */
const VIDEO_DURATION_PRESETS_SECONDS = [1, 2, 3, 5, 8] as const;

type CaptureMode = 'still' | 'video';

function clampVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_CAMERA_MOVE_DURATION_SECONDS;
  return Math.min(
    MAX_CAMERA_MOVE_DURATION_SECONDS,
    Math.max(MIN_CAMERA_MOVE_DURATION_SECONDS, seconds),
  );
}

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
    landShotFraming,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('still');
  const [landFlash, setLandFlash] = useState(false);
  /** Pending move length — applied when end is captured (and updates existing end if present). */
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(DEFAULT_CAMERA_MOVE_DURATION_SECONDS);
  /**
   * Video shutter phases: pose end → export. Independent of shotCameraFlying so keepFlying
   * stills/viewfinder can stay live without trapping the shutter on recapture-end.
   */
  const [videoEndCaptured, setVideoEndCaptured] = useState(false);

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
  const storedCameraMoveDurationSeconds = selectedShot
    ? getCameraMoveDurationSeconds(cameraMoveKeyframes, DEFAULT_CAMERA_MOVE_DURATION_SECONDS)
    : DEFAULT_CAMERA_MOVE_DURATION_SECONDS;
  const cameraMoveDurationSeconds = captureMode === 'video'
    ? videoDurationSeconds
    : storedCameraMoveDurationSeconds;
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
    // Keep main shutter phase in sync with advanced drawer Set Start / Set End.
    if (slot === 'end') setVideoEndCaptured(true);
    if (slot === 'start') setVideoEndCaptured(false);
  }, [cameraMoveDurationSeconds, getEffectiveCamera, selectedShot, updateCameraMoveKeyframes]);

  const changeCameraMoveDuration = useCallback((durationSeconds: number) => {
    if (!selectedShot) return;
    const next = clampVideoDuration(durationSeconds);
    setVideoDurationSeconds(next);
    // Only rewrite keyframes when an end pose already exists; otherwise the
    // pending duration is applied on the next end capture.
    if (hasRenderableCameraMove(selectedShot.cameraKeyframes)) {
      updateCameraMoveKeyframes(updateCameraMoveDuration(selectedShot.cameraKeyframes, next));
    }
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
  }, [selectedShot?.id, selectedShot?.camera, shotCameraFlying]);

  useEffect(() => {
    setCameraMovePreviewUrl(cameraMoveAsset?.uri);
  }, [cameraMoveAsset?.uri, selectedShot?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'i' && selectedShot && !isEditableTarget(event.target)) {
        event.preventDefault();
        setSettingsOpen((open) => !open);
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
    });
  }, [
    getPreviewShot,
    project.scene,
    selectedShot?.exportSettings.height,
    selectedShot?.exportSettings.width,
    selectedShot?.id,
  ]);

  useEffect(() => {
    if (shotCameraFlying) return;

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
  }, [framePreviewKey, getPreviewShot, project, shotCameraFlying]);

  const handleFramingCameraChange = useCallback((camera: CameraData) => {
    if (!selectedShot) return;
    draftCameraRef.current = camera;
    if (shotCameraFlying) return;
    updateShot(selectedShot.id, { camera });
  }, [selectedShot?.id, shotCameraFlying, updateShot]);

  const startFlyCamera = useCallback((options?: { clearFramingAcceptance?: boolean }) => {
    if (selectedShot) draftCameraRef.current = selectedShot.camera;
    setShotCameraFlying(true, options);
  }, [selectedShot?.camera, setShotCameraFlying]);

  const snapshotPreview = useCallback((shot: { id: string; exportSettings: { width: number; height: number }; camera: CameraData }, camera: CameraData) => {
    // Use latest project from the store so freshly created shots are not missing
    // from a stale React closure after addCamera.
    const latestProject = useContinuityStore.getState().project;
    const latestShot = latestProject.shots.find((item) => item.id === shot.id) ?? shot;
    const previewShot = {
      ...latestShot,
      camera: {
        ...camera,
        position: [...camera.position] as CameraData['position'],
        target: [...camera.target] as CameraData['target'],
      },
    };
    void renderShotFrame(latestProject, previewShot as typeof latestProject.shots[number]).then((frame) => {
      setFramePreviewUrl(frame.dataUrl);
    });
  }, []);

  /**
   * Still capture = iPhone shutter: commit pose to gallery, keep viewfinder live.
   * First press fills the active unlanded shot; later presses create new gallery shots.
   */
  const captureStill = useCallback(() => {
    if (!selectedShot) {
      addCamera();
      return;
    }
    const camera = draftCameraRef.current ?? selectedShot.camera;
    const alreadyCaptured = isShotFramingAccepted(
      useContinuityStore.getState().project,
      selectedShot.id,
    );

    let targetShot = selectedShot;
    if (alreadyCaptured) {
      targetShot = addCamera({ navigateToShots: false });
    }

    landShotFraming(targetShot.id, camera, { keepFlying: true });
    // Stay live at the same pose — do not clear draft / freeze the viewfinder.
    draftCameraRef.current = {
      ...camera,
      position: [...camera.position] as CameraData['position'],
      target: [...camera.target] as CameraData['target'],
    };
    snapshotPreview(targetShot, camera);
    setLandFlash(true);
    window.setTimeout(() => setLandFlash(false), 700);
  }, [addCamera, landShotFraming, selectedShot, snapshotPreview]);

  const setCameraMoveEnd = useCallback(() => {
    if (!selectedShot) return;
    const camera = getEffectiveCamera();
    if (!camera) return;
    updateCameraMoveKeyframes(setTwoPointCameraKeyframe({
      keyframes: selectedShot.cameraKeyframes,
      slot: 'end',
      camera,
      durationSeconds: cameraMoveDurationSeconds,
    }));
    // Keep viewfinder live; shutter phase advances via videoEndCaptured (not flying flag).
    landShotFraming(selectedShot.id, camera, { keepFlying: true });
    draftCameraRef.current = {
      ...camera,
      position: [...camera.position] as CameraData['position'],
      target: [...camera.target] as CameraData['target'],
    };
    setVideoEndCaptured(true);
    snapshotPreview(selectedShot, camera);
    setLandFlash(true);
    window.setTimeout(() => setLandFlash(false), 700);
  }, [
    cameraMoveDurationSeconds,
    getEffectiveCamera,
    landShotFraming,
    selectedShot,
    snapshotPreview,
    updateCameraMoveKeyframes,
  ]);

  const enterVideoMode = useCallback(() => {
    if (!selectedShot) return;
    const duration = clampVideoDuration(
      getCameraMoveDurationSeconds(selectedShot.cameraKeyframes, videoDurationSeconds),
    );
    setVideoDurationSeconds(duration);
    setCaptureMode('video');
    setVideoEndCaptured(false);
    // Fresh move session: start from current still, clear prior end by rewriting start only
    // and dropping other keyframes so the shutter is not already "export ready."
    updateCameraMoveKeyframes(setTwoPointCameraKeyframe({
      keyframes: [],
      slot: 'start',
      camera: selectedShot.camera,
      durationSeconds: duration,
    }));
    setCameraMoveError(undefined);
    startFlyCamera({ clearFramingAcceptance: false });
  }, [selectedShot, startFlyCamera, updateCameraMoveKeyframes, videoDurationSeconds]);

  const enterStillMode = useCallback(() => {
    setCaptureMode('still');
    setVideoEndCaptured(false);
    // Still camera is always live — like a phone camera app.
    startFlyCamera({ clearFramingAcceptance: false });
  }, [startFlyCamera]);

  const setMode = useCallback((mode: CaptureMode) => {
    if (mode === captureMode) return;
    if (mode === 'video') enterVideoMode();
    else enterStillMode();
  }, [captureMode, enterStillMode, enterVideoMode]);

  const onCapture = useCallback(() => {
    if (!selectedShot) {
      addCamera();
      return;
    }
    if (captureMode === 'video') {
      // Phase is tracked explicitly — do not gate export on !shotCameraFlying.
      if (!videoEndCaptured) {
        setCameraMoveEnd();
        return;
      }
      void exportCameraMoveVideo();
      return;
    }
    captureStill();
  }, [
    addCamera,
    captureMode,
    captureStill,
    exportCameraMoveVideo,
    selectedShot,
    setCameraMoveEnd,
    videoEndCaptured,
  ]);

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
        onLockCamera: captureMode === 'video' ? setCameraMoveEnd : captureStill,
      }
      : undefined
  ), [
    captureMode,
    captureStill,
    handleFramingCameraChange,
    selectedShot?.camera,
    selectedShot?.exportSettings.height,
    selectedShot?.exportSettings.width,
    setCameraMoveEnd,
    shotCameraFlying,
  ]);

  const framingAccepted = selectedShot ? isShotFramingAccepted(project, selectedShot.id) : false;
  const lensMm = project.settings.defaultCameraLensMm ?? DEFAULT_CAMERA_LENS_MM;
  const cameraHeight = selectedShot?.camera.position[1] ?? DEFAULT_CAMERA_HEIGHT_METERS;

  useEffect(() => {
    setCaptureMode('still');
    setLibraryOpen(false);
    setVideoEndCaptured(false);
    if (selectedShot) {
      setVideoDurationSeconds(
        getCameraMoveDurationSeconds(selectedShot.cameraKeyframes, DEFAULT_CAMERA_MOVE_DURATION_SECONDS),
      );
    }
  }, [selectedShot?.id]);

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

  const selectedIndex = selectedShot
    ? project.shots.findIndex((shot) => shot.id === selectedShot.id)
    : -1;
  // iPhone-style recents: most recently captured shot (highest index with framing accepted).
  const lastCapturedShot = [...project.shots]
    .reverse()
    .find((shot) => isShotFramingAccepted(project, shot.id));
  const libraryThumbShot = lastCapturedShot
    ?? project.shots.find((shot) => shot.id !== selectedShot?.id)
    ?? selectedShot
    ?? project.shots[0];

  const captureLabel = !selectedShot
    ? 'Add shot'
    : captureMode === 'video'
      ? (!videoEndCaptured
        ? 'Capture end'
        : isExportingCameraMove
          ? `Exporting ${Math.round(cameraMoveProgress * 100)}%`
          : 'Export video')
      : 'Capture';

  const captureHint = captureMode === 'video'
    ? (!videoEndCaptured
      ? 'Fly to the end pose, then capture'
      : 'Export the graybox move as MP4')
    : 'Capture adds a shot — viewfinder stays live';

  const goAdjacentShot = (direction: -1 | 1) => {
    if (selectedIndex < 0) return;
    const next = project.shots[selectedIndex + direction];
    if (next) selectShot(next.id);
  };

  return (
    <FullBleedLayout reserveHeader>
      <div className="relative h-full min-h-0 overflow-hidden bg-black" data-shots-camera-shell>
        <div className="absolute inset-0">
          <SceneViewport
            project={project}
            selectedShotId={selectedShot?.id}
            shotFraming={shotFraming}
            minHeightClassName="min-h-0"
          />
        </div>

        {/* Top chrome: shot index + settings */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-[calc(var(--stage-header-safe)+0.35rem)]">
          <div className="pointer-events-auto rounded-full bg-black/45 px-3 py-1 text-xs font-semibold tabular-nums text-white/90 backdrop-blur-sm">
            {selectedShot
              ? `${selectedIndex + 1} / ${project.shots.length}`
              : 'No shots'}
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-card backdrop-blur-sm transition hover:bg-black/60"
            aria-label="Camera settings"
            data-shots-settings-trigger
            title="Settings (I)"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>

        {/* Quiet landed flash */}
        {landFlash && (
          <div
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/10"
            data-shots-capture-flash
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              Captured
            </span>
          </div>
        )}

        {showCompare && selectedShot && (
          <div className="pointer-events-auto absolute inset-y-[calc(var(--stage-header-safe)+3rem)] right-3 z-20 w-72 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-black/70 shadow-soft backdrop-blur-md">
            <ShotPanoCropPreview
              imageUrl={linkedAsset?.uri}
              crop={selectedShot.panoCrop}
              panoRotation={linkedPano?.rotation}
              label={linkedPano?.name ?? 'Pano match'}
              matchQuality={panoMatch?.quality}
              matchDistanceMeters={panoMatch?.distanceMeters}
              disabledReason={undefined}
            />
          </div>
        )}

        {/* Library sheet (opened from thumbnail) */}
        {libraryOpen && (
          <div
            className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-[2px]"
            data-shots-library
            onClick={() => setLibraryOpen(false)}
          >
            <div
              className="rounded-t-3xl border border-white/10 bg-zinc-950/95 px-4 pb-8 pt-3 shadow-soft"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Shots</h2>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(false)}
                  className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                  aria-label="Close shot library"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {project.shots.map((shot) => {
                  const selected = shot.id === selectedShot?.id;
                  const landed = isShotFramingAccepted(project, shot.id);
                  const canDelete = project.shots.length > 1;
                  return (
                    <div
                      key={shot.id}
                      className={`relative shrink-0 overflow-hidden rounded-xl border transition ${
                        selected
                          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                          : 'border-white/15'
                      }`}
                      data-shots-library-card
                    >
                      <button
                        type="button"
                        onClick={() => {
                          selectShot(shot.id);
                          setLibraryOpen(false);
                        }}
                        className="block"
                        aria-label={`Select shot ${shot.shotNumber}`}
                      >
                        <ShotThumbnail
                          project={project}
                          shot={shot}
                          overrideSrc={shot.id === selectedShot?.id ? framePreviewUrl : undefined}
                          className="h-20 w-28 object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {shot.shotNumber}{landed ? ' · ✓' : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canDelete) return;
                          removeShot(shot.id);
                        }}
                        disabled={!canDelete}
                        className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white/90 backdrop-blur-sm transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={canDelete ? `Delete shot ${shot.shotNumber}` : 'Cannot delete the only shot'}
                        title={canDelete ? 'Delete shot' : 'Keep at least one shot'}
                        data-shots-library-delete
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    addCamera();
                    setLibraryOpen(false);
                  }}
                  className="inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 text-white/80 transition hover:border-[var(--accent)] hover:text-accent"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">New</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom camera chrome */}
        <div
          data-shots-camera-chrome
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-6 pt-10"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
          }}
        >
          {/* Mode switcher */}
          <div
            data-shots-mode-switcher
            className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/40 p-1 backdrop-blur-md"
          >
            <ModePill
              label="Still"
              active={captureMode === 'still'}
              onClick={() => setMode('still')}
            />
            <ModePill
              label="Video"
              active={captureMode === 'video'}
              onClick={() => setMode('video')}
            />
          </div>

          {captureMode === 'video' && (
            <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
              <p className="text-center text-[11px] font-medium text-white/75">
                {!videoEndCaptured
                  ? 'Start set · pick length · fly to end · capture'
                  : 'End set · export when ready'}
              </p>
              <div
                data-shots-video-duration
                className="flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-black/45 px-2 py-1.5 backdrop-blur-md"
                role="group"
                aria-label="Video duration"
              >
                <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  Length
                </span>
                {VIDEO_DURATION_PRESETS_SECONDS.map((seconds) => {
                  const active = Math.abs(videoDurationSeconds - seconds) < 0.05;
                  return (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => changeCameraMoveDuration(seconds)}
                      className={`min-w-[2.5rem] rounded-full px-2.5 py-1 text-xs font-bold tabular-nums transition ${
                        active
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                      }`}
                      aria-pressed={active}
                    >
                      {seconds}s
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shutter row */}
          <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-4 px-2">
            {/* Last / library thumbnail */}
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 border-white/80 bg-zinc-900 shadow-card"
              aria-label="Open shot library"
              data-shots-library-thumb
              title="Previous shots"
            >
              {libraryThumbShot ? (
                <ShotThumbnail
                  project={project}
                  shot={libraryThumbShot}
                  overrideSrc={
                    libraryThumbShot.id === selectedShot?.id ? framePreviewUrl : undefined
                  }
                  className="h-full w-full object-cover"
                  compact
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-white/40">
                  <ImageIcon className="h-5 w-5" />
                </span>
              )}
            </button>

            {/* Capture shutter */}
            <button
              type="button"
              onClick={onCapture}
              disabled={captureMode === 'video' && videoEndCaptured && (isExportingCameraMove || !supportedMp4MimeType)}
              className="group relative flex h-[4.75rem] w-[4.75rem] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              aria-label={captureLabel}
              data-shots-shutter
              data-shots-video-phase={captureMode === 'video' ? (videoEndCaptured ? 'export' : 'capture-end') : undefined}
              title={captureHint}
            >
              <span className="absolute inset-0 rounded-full border-[3px] border-white/90" />
              <span
                className={`h-[3.65rem] w-[3.65rem] rounded-full transition ${
                  captureMode === 'video'
                    ? (!videoEndCaptured
                      ? 'bg-red-500 group-active:scale-95'
                      : 'bg-[var(--accent)] group-active:scale-95')
                    : 'bg-white group-active:scale-90'
                }`}
              />
              {captureMode === 'video' && videoEndCaptured && !isExportingCameraMove && (
                <Film className="pointer-events-none absolute h-5 w-5 text-white" />
              )}
            </button>

            {/* Adjacent shot nav (keeps layout balanced; light affordance) */}
            <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => goAdjacentShot(-1)}
                  disabled={selectedIndex <= 0}
                  className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
                  aria-label="Previous shot"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => goAdjacentShot(1)}
                  disabled={selectedIndex < 0 || selectedIndex >= project.shots.length - 1}
                  className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
                  aria-label="Next shot"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <p className="pointer-events-none text-center text-[11px] font-medium text-white/70">
            {captureHint}
            {shotCameraFlying ? ' · WASD / mouse' : ''}
          </p>
        </div>
      </div>

      <PrecisionDrawer
        open={settingsOpen && Boolean(selectedShot)}
        title="Camera Settings"
        onClose={() => setSettingsOpen(false)}
      >
        {selectedShot && (
          <div className="space-y-4" data-shots-advanced-settings>
            <div className="grid grid-cols-2 gap-2">
              <IconButton onClick={() => addCamera()} className="w-full">
                <Plus className="h-4 w-4" />
                New shot
              </IconButton>
              <IconButton onClick={duplicateSelectedShot} className="w-full">
                <Copy className="h-4 w-4" />
                Duplicate
              </IconButton>
            </div>

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
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-subtle px-2 py-2">
                <div className="text-muted">Lens</div>
                <div className="font-semibold text-primary">{lensMm}mm</div>
              </div>
              <div className="rounded-lg border border-subtle px-2 py-2">
                <div className="text-muted">Height</div>
                <div className="font-semibold text-primary">{cameraHeight.toFixed(1)}m</div>
              </div>
              <div className="rounded-lg border border-subtle px-2 py-2">
                <div className="text-muted">FOV</div>
                <div className="font-semibold text-primary">{selectedShot.camera.fovDegrees.toFixed(0)}°</div>
              </div>
            </div>
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

            <Panel title="Tools">
              <div className="space-y-2">
                <IconButton
                  onClick={() => setShowCompare((value) => !value)}
                  disabled={!linkedPano}
                  className="w-full"
                >
                  <Film className="h-4 w-4" />
                  {showCompare ? 'Hide pano match' : 'Pano match'}
                </IconButton>
                {linkedPano && (
                  <IconButton onClick={openLinkedPanoIn360} className="w-full">
                    <Globe className="h-4 w-4" />
                    Open in 360
                  </IconButton>
                )}
                <IconButton
                  onClick={() => void exportCameraFrame()}
                  disabled={isExportingFrame || isRenderingFrame}
                  className="w-full"
                >
                  <Download className="h-4 w-4" />
                  {isExportingFrame ? 'Exporting...' : `Download PNG (${selectedShot.exportSettings.width}×${selectedShot.exportSettings.height})`}
                </IconButton>
              </div>
            </Panel>

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
                {project.landmarks.length === 0 && (
                  <p className="text-xs text-secondary">No landmarks in this project.</p>
                )}
              </div>
            </Panel>

            <Panel title="Video mode (advanced)">
              <div className="space-y-3">
                <p className="text-xs text-secondary">
                  Use the Video mode on the camera chrome for the simple path. Manual keyframes live here.
                </p>
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
                  hint="Also available as quick picks on the Video camera chrome while capturing the end pose."
                >
                  <TextInput
                    type="number"
                    min={MIN_CAMERA_MOVE_DURATION_SECONDS}
                    max={MAX_CAMERA_MOVE_DURATION_SECONDS}
                    step="0.5"
                    value={cameraMoveDurationSeconds}
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-45"
            >
              <Trash2 className="h-4 w-4" />
              Delete Shot
            </button>
          </div>
        )}
      </PrecisionDrawer>
    </FullBleedLayout>
  );
}

function ModePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
        active
          ? 'bg-white text-zinc-900 shadow-sm'
          : 'text-white/70 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
