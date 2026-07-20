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
import { CameraData, Shot, ShotStatus } from '../../domain/types';
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
import {
  getCameraMoveDownloadName,
  getProjectedCameraMoveDownloadName,
  getProjectedStillDownloadName,
  getViewportStillDownloadName,
} from '../../engine/exportNaming';
import { downloadBlob, downloadDataUrl } from '../../engine/projectIO';
import {
  canUseRenderMp4Export,
  getSupportedCameraMoveMp4MimeType,
  renderShotCameraMoveMp4,
  renderShotFrame,
  renderShotProjectedFrame,
  renderViewportProjected,
  type CameraMoveExportProgress,
} from '../../engine/renderers';
import type { VideoResolutionPresetId } from '../../engine/videoPresets';
import { VIDEO_RESOLUTION_PRESETS } from '../../engine/videoPresets';
import { getCameraMoveReferenceFrames } from '../../engine/cameraKeyframes';
import { isShotFramingAccepted } from '../../engine/workflow';
import { getPanoMatchQuality, resolveShotLinkedPano } from '../../engine/sync';
import { useContinuityStore } from '../../state/useContinuityStore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Field, IconButton, Panel, Select, TextArea, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { ShotCameraRollThumbnail } from '../common/ShotCameraRollThumbnail';
import { ShotMediaModal } from '../common/ShotMediaModal';
import { ShotsLibraryCard } from '../common/ShotsLibraryCard';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';
import { ShotPanoCropPreview } from '../viewers/ShotPanoCropPreview';
import { canUseProjectedAppearance } from '../../engine/projectedStyle';
import { AppearanceModeToggle } from '../common/AppearanceModeToggle';
import { FullBleedLayout } from './WorkspaceShell';
import {
  getShotPrimaryLabel,
  hasCustomShotTitle,
  normalizeProductionShotId,
  normalizeShotTitle,
} from '../../domain/shotIdentity';

const statuses: ShotStatus[] = ['planned', 'exported', 'needs_fix', 'approved', 'rejected'];
const STATUS_LABELS: Record<ShotStatus, string> = {
  planned: 'Planned',
  exported: 'Exported',
  needs_fix: 'Needs fix',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** Compact chrome slider range: 1–20s in whole-second steps. */
const VIDEO_DURATION_UI_MIN_SECONDS = 1;
const VIDEO_DURATION_UI_MAX_SECONDS = 20;

type CaptureMode = 'still' | 'video';

/**
 * Video shutter phases (iPhone-style record → stop → export):
 * - record: press red shutter to capture the starting keyframe
 * - stop: press stop to capture the ending keyframe
 * - export: press to encode the graybox MP4
 */
type VideoShutterPhase = 'record' | 'stop' | 'export';

function clampVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_CAMERA_MOVE_DURATION_SECONDS;
  return Math.min(
    MAX_CAMERA_MOVE_DURATION_SECONDS,
    Math.max(MIN_CAMERA_MOVE_DURATION_SECONDS, seconds),
  );
}

/** Round to whole seconds for the chrome slider (1–20). */
function clampVideoDurationUiSeconds(seconds: number): number {
  const rounded = Math.round(clampVideoDuration(seconds));
  return Math.min(
    VIDEO_DURATION_UI_MAX_SECONDS,
    Math.max(VIDEO_DURATION_UI_MIN_SECONDS, rounded),
  );
}

function videoPhaseFromKeyframes(keyframes: readonly { label: string }[]): VideoShutterPhase {
  const labels = new Set(keyframes.map((keyframe) => keyframe.label.toLowerCase()));
  if (labels.has('start') && labels.has('end')) return 'export';
  if (labels.has('start')) return 'stop';
  return 'record';
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
    attachViewportRenderToShot,
    setWorkspace,
    setActivePano,
  } = useContinuityStore();
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
  const linkedPano = selectedShot ? resolveShotLinkedPano(project, selectedShot) : undefined;
  const linkedAsset = linkedPano ? project.assets.assets[linkedPano.imageAssetId] : undefined;
  const draftCameraRef = useRef<CameraData | undefined>();
  /** Transient live previews keyed by shot id — never reuse across shots. */
  const [framePreviewByShotId, setFramePreviewByShotId] = useState<Record<string, string>>({});
  const framePreviewUrl = selectedShot ? framePreviewByShotId[selectedShot.id] : undefined;
  const [isRenderingFrame, setIsRenderingFrame] = useState(false);
  const [isExportingFrame, setIsExportingFrame] = useState(false);
  const [cameraMovePreviewUrl, setCameraMovePreviewUrl] = useState<string | undefined>();
  const [isExportingCameraMove, setIsExportingCameraMove] = useState(false);
  const [cameraMoveProgress, setCameraMoveProgress] = useState(0);
  const [cameraMoveProgressMessage, setCameraMoveProgressMessage] = useState('Preparing scene');
  const [cameraMoveError, setCameraMoveError] = useState<string | undefined>();
  const [snapshotError, setSnapshotError] = useState<string | undefined>();
  const cameraMoveAbortRef = useRef<{ cancelled: boolean; abort?: () => void }>({ cancelled: false });
  const [videoExportMode, setVideoExportMode] = useState<'render' | 'quickPreview'>('render');
  const [videoResolutionPreset, setVideoResolutionPreset] = useState<VideoResolutionPresetId>('1080p');
  const [canRenderMp4, setCanRenderMp4] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shotPendingDelete, setShotPendingDelete] = useState<Shot | null>(null);
  const [mediaModalShotId, setMediaModalShotId] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('still');
  const [appearance, setAppearance] = useState<'clay' | 'projected'>('clay');
  const [landFlash, setLandFlash] = useState(false);
  /** Pending move length — applied when end is captured (and updates existing end if present). */
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(DEFAULT_CAMERA_MOVE_DURATION_SECONDS);
  /**
   * Video shutter phase is independent of shotCameraFlying so keepFlying stills/viewfinder
   * can stay live without trapping the shutter after stop.
   */
  const [videoPhase, setVideoPhase] = useState<VideoShutterPhase>('record');

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
    ? getViewportStillDownloadName(selectedShot)
    : 'camera_frame.png';
  const cameraMoveFileName = selectedShot
    ? getCameraMoveDownloadName(selectedShot)
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
  const canExportVideo = canRenderMp4 === true || Boolean(supportedMp4MimeType);

  useEffect(() => {
    let cancelled = false;
    setCanRenderMp4(null);
    void canUseRenderMp4Export(videoResolutionPreset).then((supported) => {
      if (!cancelled) setCanRenderMp4(supported);
    });
    return () => {
      cancelled = true;
    };
  }, [videoResolutionPreset]);

  // Keep the mode selector honest: if Render is confirmed unsupported for the current preset,
  // switch the control to Quick Preview when that path exists (never silently encode as preview).
  useEffect(() => {
    if (videoExportMode === 'render' && canRenderMp4 === false && supportedMp4MimeType) {
      setVideoExportMode('quickPreview');
    }
  }, [canRenderMp4, supportedMp4MimeType, videoExportMode]);

  const selectedExportModeAvailable = videoExportMode === 'render'
    ? canRenderMp4 === true
    : Boolean(supportedMp4MimeType);
  const applyExportProgress = useCallback((
    progress: number | CameraMoveExportProgress,
    mapProgress: (value: number) => number = (value) => value,
  ) => {
    if (cameraMoveAbortRef.current.cancelled) return;
    if (typeof progress === 'number') {
      setCameraMoveProgress(mapProgress(progress));
      return;
    }
    setCameraMoveProgress(mapProgress(progress.progress));
    setCameraMoveProgressMessage(progress.message);
  }, []);

  const cancelCameraMoveExport = useCallback(() => {
    cameraMoveAbortRef.current.cancelled = true;
    cameraMoveAbortRef.current.abort?.();
    setIsExportingCameraMove(false);
    setCameraMoveProgress(0);
    setCameraMoveProgressMessage('Preparing scene');
    setCameraMoveError('MP4 export was cancelled.');
  }, []);

  const setShotFramePreview = useCallback((shotId: string, dataUrl: string) => {
    setFramePreviewByShotId((current) => ({ ...current, [shotId]: dataUrl }));
  }, []);

  const handleLibraryRename = useCallback((shotId: string, updates: { productionShotId?: string; name: string }) => {
    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot) return;
    updateShot(shotId, {
      productionShotId: normalizeProductionShotId(updates.productionShotId),
      name: normalizeShotTitle(shot, updates.name),
    });
  }, [project.shots, updateShot]);

  const handleOpenShotFromLibrary = useCallback((shotId: string) => {
    selectShot(shotId);
    setLibraryOpen(false);
  }, [selectShot]);

  const handleRequestDeleteShot = useCallback((shot: Shot) => {
    setShotPendingDelete(shot);
  }, []);

  const handleConfirmDeleteShot = useCallback(() => {
    if (!shotPendingDelete) return;
    removeShot(shotPendingDelete.id);
    setShotPendingDelete(null);
  }, [removeShot, shotPendingDelete]);

  const handleOpenShotFromMedia = useCallback((shotId: string) => {
    selectShot(shotId);
    setMediaModalShotId(null);
    setLibraryOpen(false);
  }, [selectShot]);

  const exportCameraFrame = useCallback(async () => {
    const previewShot = getPreviewShot();
    if (!previewShot) return;
    setIsExportingFrame(true);
    try {
      // Clay remains the shot-attached geometric control frame.
      const frame = await renderShotFrame(project, previewShot);
      setShotFramePreview(previewShot.id, frame.dataUrl);
      attachViewportRenderToShot(previewShot.id, {
        name: exportFrameFileName,
        dataUrl: frame.dataUrl,
        width: frame.width,
        height: frame.height,
      });
      downloadDataUrl(frame.dataUrl, exportFrameFileName);
      // Also download a projected still when a styled pano is available (dual output).
      if (canUseProjectedAppearance(project)) {
        try {
          const projected = await renderShotProjectedFrame(project, previewShot);
          const projectedName = selectedShot
            ? getProjectedStillDownloadName(selectedShot)
            : exportFrameFileName.replace(/\.png$/i, '_projected.png');
          downloadDataUrl(projected.dataUrl, projectedName);
        } catch {
          // Soft-fail projected companion; clay already succeeded.
        }
      }
      if (!shotCameraFlying) {
        updateShot(previewShot.id, { status: 'exported' });
      }
    } finally {
      setIsExportingFrame(false);
    }
  }, [attachViewportRenderToShot, exportFrameFileName, getPreviewShot, project, setShotFramePreview, shotCameraFlying, updateShot]);

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
    const nextKeyframes = setTwoPointCameraKeyframe({
      keyframes: selectedShot.cameraKeyframes,
      slot,
      camera,
      durationSeconds: cameraMoveDurationSeconds,
    });
    updateCameraMoveKeyframes(nextKeyframes);
    // Keep main shutter phase in sync with advanced drawer Set Start / Set End.
    setVideoPhase(videoPhaseFromKeyframes(nextKeyframes));
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
    if (!canExportVideo) {
      setCameraMoveError('MP4 export is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (!hasRenderableCameraMove(selectedShot.cameraKeyframes)) {
      setCameraMoveError('Capture start and end camera keyframes before exporting MP4.');
      return;
    }

    if (videoExportMode === 'render' && canRenderMp4 !== true) {
      setCameraMoveError(
        `Render MP4 is unavailable for ${videoResolutionPreset === '4k' ? '4K' : '1080p'} in this browser. `
        + 'Choose Quick Preview, or try Chrome/Edge with a supported resolution.',
      );
      return;
    }
    if (videoExportMode === 'quickPreview' && !supportedMp4MimeType) {
      setCameraMoveError('Quick Preview MP4 is not supported in this browser.');
      return;
    }

    const preferredMode = videoExportMode;

    const abortController = new AbortController();
    cameraMoveAbortRef.current = { cancelled: false, abort: () => abortController.abort() };
    setIsExportingCameraMove(true);
    setCameraMoveProgress(0);
    setCameraMoveProgressMessage('Preparing scene');
    setCameraMoveError(undefined);

    try {
      // Progress splits: clay motion 0–55%, projected motion 55–100% when dual.
      const dualProjectedVideo = canUseProjectedAppearance(project);
      const video = await renderShotCameraMoveMp4(project, selectedShot, {
        mode: preferredMode,
        resolutionPreset: videoResolutionPreset,
        frameRate: 30,
        appearance: 'clay',
        // Persist clay in the shot library as a data URL; downloads use the blob.
        includeDataUrl: true,
        signal: abortController.signal,
        onProgress: (progress) => {
          applyExportProgress(progress, (value) => (dualProjectedVideo ? value * 0.55 : value));
        },
      });
      if (cameraMoveAbortRef.current.cancelled) return;
      if (!video.dataUrl) {
        throw new Error('Camera move export did not produce a persistable video URI.');
      }
      const asset = attachCameraMoveVideoToShot(selectedShot.id, {
        name: cameraMoveFileName,
        dataUrl: video.dataUrl,
        mimeType: video.mimeType,
        width: video.width,
        height: video.height,
        durationSeconds: video.durationSeconds,
        frameRate: video.frameRate,
        encodeMode: video.encodeMode ?? preferredMode,
        codecString: video.codecString,
        frameCount: video.frameCount,
        resolutionPreset: videoResolutionPreset,
      });
      setCameraMovePreviewUrl(asset.uri);
      // Download from the encoded blob — multi‑MB data: URLs fail as anchor hrefs.
      downloadBlob(video.blob, asset.name || cameraMoveFileName);

      if (dualProjectedVideo && !cameraMoveAbortRef.current.cancelled) {
        try {
          const projectedVideo = await renderShotCameraMoveMp4(project, selectedShot, {
            mode: preferredMode,
            resolutionPreset: videoResolutionPreset,
            frameRate: 30,
            appearance: 'projected',
            occlusionFilter: preferredMode === 'render' ? 'fast' : 'soft',
            includeDataUrl: false,
            signal: abortController.signal,
            onProgress: (progress) => {
              applyExportProgress(progress, (value) => 0.55 + value * 0.45);
            },
          });
          if (cameraMoveAbortRef.current.cancelled) return;
          const projectedName = getProjectedCameraMoveDownloadName(selectedShot);
          downloadBlob(projectedVideo.blob, projectedName);
          // Optional still contact sheet companions (still export resolution).
          const frames = getCameraMoveReferenceFrames(selectedShot.cameraKeyframes);
          const base = (asset.name || cameraMoveFileName).replace(/\.mp4$/i, '');
          for (const frame of frames) {
            const projected = await renderViewportProjected(
              project,
              frame.camera,
              selectedShot.exportSettings.width,
              selectedShot.exportSettings.height,
            );
            downloadDataUrl(projected.dataUrl, `${base}_projected_${frame.id}.png`);
          }
          setCameraMoveProgress(1);
          setCameraMoveProgressMessage('Complete');
        } catch {
          // Soft-fail projected companions; clay MP4 already succeeded.
        }
      }
    } catch (error) {
      if (!cameraMoveAbortRef.current.cancelled) {
        setCameraMoveError(error instanceof Error ? error.message : 'MP4 export failed.');
      }
    } finally {
      if (!cameraMoveAbortRef.current.cancelled) {
        setIsExportingCameraMove(false);
      }
    }
  }, [
    applyExportProgress,
    attachCameraMoveVideoToShot,
    cameraMoveFileName,
    canExportVideo,
    canRenderMp4,
    project,
    selectedShot,
    supportedMp4MimeType,
    videoExportMode,
    videoResolutionPreset,
  ]);

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
    // Transient preview only — do not write project assets here (would re-trigger this effect).
    void renderShotFrame(project, previewShot)
      .then((frame) => {
        if (cancelled) return;
        setShotFramePreview(previewShot.id, frame.dataUrl);
      })
      .finally(() => {
        if (!cancelled) setIsRenderingFrame(false);
      });

    return () => {
      cancelled = true;
    };
  }, [framePreviewKey, getPreviewShot, project, setShotFramePreview, shotCameraFlying]);

  const handleFramingCameraChange = useCallback((camera: CameraData) => {
    if (!selectedShot) return;
    draftCameraRef.current = camera;
    if (shotCameraFlying) return;
    updateShot(selectedShot.id, { camera });
  }, [selectedShot?.id, shotCameraFlying, updateShot]);

  const startFlyCamera = useCallback((options?: { clearFramingAcceptance?: boolean }) => {
    // Seed from the stored shot only when entering fly — never clobber a live draft pose.
    if (selectedShot && !shotCameraFlying) {
      draftCameraRef.current = selectedShot.camera;
    }
    setShotCameraFlying(true, options);
  }, [selectedShot?.camera, setShotCameraFlying, shotCameraFlying]);

  const snapshotPreview = useCallback((shot: { id: string; name?: string; exportSettings: { width: number; height: number }; camera: CameraData }, camera: CameraData) => {
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
    setSnapshotError(undefined);
    const shotForNaming = previewShot as typeof latestProject.shots[number];
    const viewportFileName = getViewportStillDownloadName(shotForNaming);
    void renderShotFrame(latestProject, shotForNaming)
      .then(async (frame) => {
        setShotFramePreview(shot.id, frame.dataUrl);
        useContinuityStore.getState().attachViewportRenderToShot(shot.id, {
          name: viewportFileName,
          dataUrl: frame.dataUrl,
          width: frame.width,
          height: frame.height,
        });
        // Dual download: clay control frame is attached; projected companion downloads when available.
        if (canUseProjectedAppearance(latestProject)) {
          try {
            const projected = await renderShotProjectedFrame(latestProject, shotForNaming);
            downloadDataUrl(
              projected.dataUrl,
              getProjectedStillDownloadName(shotForNaming),
            );
          } catch {
            // Soft-fail projected companion.
          }
        }
      })
      .catch(() => {
        setSnapshotError('Could not save the shot preview. Try Capture again.');
      });
  }, [setShotFramePreview]);

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

  const setCameraMoveStart = useCallback(() => {
    if (!selectedShot) return;
    const camera = getEffectiveCamera();
    if (!camera) return;
    const pose: CameraData = {
      ...camera,
      position: [...camera.position] as CameraData['position'],
      target: [...camera.target] as CameraData['target'],
    };
    // Start pose only — keep flying so the user can continue to the end.
    // Persist the live pose onto the shot so chrome re-renders cannot reseat the camera at an old origin.
    updateShot(selectedShot.id, {
      camera: pose,
      cameraKeyframes: setTwoPointCameraKeyframe({
        keyframes: [],
        slot: 'start',
        camera: pose,
        durationSeconds: cameraMoveDurationSeconds,
      }),
      assets: {
        ...selectedShot.assets,
        cameraMoveVideoAssetId: undefined,
      },
    });
    setCameraMovePreviewUrl(undefined);
    setCameraMoveError(undefined);
    draftCameraRef.current = pose;
    setVideoPhase('stop');
    setLandFlash(true);
    window.setTimeout(() => setLandFlash(false), 500);
  }, [
    cameraMoveDurationSeconds,
    getEffectiveCamera,
    selectedShot,
    updateShot,
  ]);

  const setCameraMoveEnd = useCallback(() => {
    if (!selectedShot) return;
    const camera = getEffectiveCamera();
    if (!camera) return;
    // Preserve an existing start keyframe when stopping; only rewrite end.
    const baseKeyframes = selectedShot.cameraKeyframes.some(
      (keyframe) => keyframe.label.toLowerCase() === 'start',
    )
      ? selectedShot.cameraKeyframes
      : setTwoPointCameraKeyframe({
        keyframes: selectedShot.cameraKeyframes,
        slot: 'start',
        camera: selectedShot.camera,
        durationSeconds: cameraMoveDurationSeconds,
      });
    updateCameraMoveKeyframes(setTwoPointCameraKeyframe({
      keyframes: baseKeyframes,
      slot: 'end',
      camera,
      durationSeconds: cameraMoveDurationSeconds,
    }));
    // Keep viewfinder live; shutter phase advances via videoPhase (not flying flag).
    landShotFraming(selectedShot.id, camera, { keepFlying: true });
    draftCameraRef.current = {
      ...camera,
      position: [...camera.position] as CameraData['position'],
      target: [...camera.target] as CameraData['target'],
    };
    setVideoPhase('export');
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
    // Fresh move session: do not auto-capture start — wait for the red record button.
    setVideoPhase('record');
    updateCameraMoveKeyframes([]);
    setCameraMoveError(undefined);
    startFlyCamera({ clearFramingAcceptance: false });
  }, [selectedShot, startFlyCamera, updateCameraMoveKeyframes, videoDurationSeconds]);

  const enterStillMode = useCallback(() => {
    setCaptureMode('still');
    setVideoPhase('record');
    // Still camera is always live — like a phone camera app.
    startFlyCamera({ clearFramingAcceptance: false });
  }, [startFlyCamera]);

  const setMode = useCallback((mode: CaptureMode) => {
    if (mode === captureMode) return;
    if (mode === 'video') enterVideoMode();
    else enterStillMode();
  }, [captureMode, enterStillMode, enterVideoMode]);

  const retakeVideoMove = useCallback(() => {
    if (!selectedShot) return;
    updateCameraMoveKeyframes([]);
    setVideoPhase('record');
    setCameraMoveError(undefined);
    startFlyCamera({ clearFramingAcceptance: false });
  }, [selectedShot, startFlyCamera, updateCameraMoveKeyframes]);

  const onCapture = useCallback(() => {
    if (!selectedShot) {
      addCamera();
      return;
    }
    if (captureMode === 'video') {
      // Phase is tracked explicitly — do not gate export on !shotCameraFlying.
      if (videoPhase === 'record') {
        setCameraMoveStart();
        return;
      }
      if (videoPhase === 'stop') {
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
    setCameraMoveStart,
    videoPhase,
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
        onLockCamera: captureMode === 'video'
          ? (videoPhase === 'record' ? setCameraMoveStart : videoPhase === 'stop' ? setCameraMoveEnd : undefined)
          : captureStill,
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
    setCameraMoveStart,
    shotCameraFlying,
    videoPhase,
  ]);

  const framingAccepted = selectedShot ? isShotFramingAccepted(project, selectedShot.id) : false;
  const lensMm = project.settings.defaultCameraLensMm ?? DEFAULT_CAMERA_LENS_MM;
  const cameraHeight = selectedShot?.camera.position[1] ?? DEFAULT_CAMERA_HEIGHT_METERS;

  useEffect(() => {
    setCaptureMode('still');
    setLibraryOpen(false);
    setVideoPhase('record');
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
      ? (videoPhase === 'record'
        ? 'Record start'
        : videoPhase === 'stop'
          ? 'Stop and set end'
          : isExportingCameraMove
            ? `${cameraMoveProgressMessage} · ${Math.round(cameraMoveProgress * 100)}%`
            : 'Export video')
      : 'Capture';

  const captureHint = captureMode === 'video'
    ? (videoPhase === 'record'
      ? 'Pose the start, then press record'
      : videoPhase === 'stop'
        ? 'Fly to the end pose, then press stop'
        : 'Render a smooth 1080p30 MP4 (or Quick Preview)')
    : 'Capture adds a shot — viewfinder stays live';

  const captureFlashLabel = captureMode === 'video'
    ? (videoPhase === 'stop' ? 'Start set' : videoPhase === 'export' ? 'End set' : 'Captured')
    : 'Captured';

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
            appearance={appearance}
            minHeightClassName="min-h-0"
            onOcclusionStatusChange={(status) => useContinuityStore.getState().setProjectedOcclusionStatus(status)}
          />
        </div>

        {/* Top chrome: shot index + settings */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pt-[calc(var(--stage-header-safe)+0.35rem)]">
          <div className="pointer-events-auto rounded-full bg-black/45 px-3 py-1 text-xs font-semibold tabular-nums text-white/90 backdrop-blur-sm">
            {selectedShot
              ? `${selectedIndex + 1} / ${project.shots.length}`
              : 'No shots'}
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <AppearanceModeToggle
                value={appearance}
                projectedAvailable={canUseProjectedAppearance(project)}
                onChange={setAppearance}
                compact
                className="border-white/15 bg-black/50 text-white [&_button]:text-white/80 [&_button[aria-pressed=true]]:bg-white [&_button[aria-pressed=true]]:text-zinc-900"
              />
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-card backdrop-blur-sm transition hover:bg-black/60"
                aria-label="Camera settings"
                data-shots-settings-trigger
                title="Settings (I)"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
            <p className="max-w-[14rem] text-right text-[10px] font-medium text-white/55" data-shots-dual-output-hint>
              {canUseProjectedAppearance(project)
                ? 'View mode only · exports include clay + projected'
                : 'View mode only · exports save clay frames'}
            </p>
          </div>
        </div>

        {/* Quiet landed flash */}
        {landFlash && (
          <div
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/10"
            data-shots-capture-flash
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              {captureFlashLabel}
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
                    <React.Fragment key={shot.id}>
                      <ShotsLibraryCard
                        project={project}
                        shot={shot}
                        selected={selected}
                        landed={landed}
                        canDelete={canDelete}
                        sheetOpen={libraryOpen}
                        onOpenMedia={setMediaModalShotId}
                        onOpenShot={handleOpenShotFromLibrary}
                        onRename={handleLibraryRename}
                        onRequestDelete={handleRequestDeleteShot}
                      />
                    </React.Fragment>
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

        <ConfirmDialog
          open={shotPendingDelete != null}
          title={shotPendingDelete ? `Delete ${getShotPrimaryLabel(shotPendingDelete)}?` : 'Delete shot?'}
          confirmLabel="Delete shot"
          destructive
          onCancel={() => setShotPendingDelete(null)}
          onConfirm={handleConfirmDeleteShot}
        >
          {shotPendingDelete && (
            hasCustomShotTitle(shotPendingDelete)
              ? `"${shotPendingDelete.name.trim()}" and its saved captures will be removed from this project. This cannot be undone.`
              : 'Its saved captures will be removed from this project. This cannot be undone.'
          )}
        </ConfirmDialog>

        <ShotMediaModal
          open={mediaModalShotId != null}
          project={project}
          shots={project.shots}
          shotId={mediaModalShotId}
          onClose={() => setMediaModalShotId(null)}
          onOpenShot={handleOpenShotFromMedia}
          onUpdateShot={updateShot}
          onNavigateShot={setMediaModalShotId}
        />

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
              <div className="flex items-center gap-2">
                {videoPhase === 'stop' && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
                    data-shots-video-rec-badge
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    Rec
                  </span>
                )}
                <p className="text-center text-[11px] font-medium text-white/75">
                  {videoPhase === 'record'
                    ? 'Pick length · pose start · record'
                    : videoPhase === 'stop'
                      ? 'Fly to end · press stop'
                      : 'End set · export when ready'}
                </p>
              </div>
              <div
                data-shots-video-duration
                className="flex w-full max-w-sm items-center gap-3 rounded-full bg-black/45 px-3 py-2 backdrop-blur-md"
                role="group"
                aria-label="Video duration"
              >
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  Length
                </span>
                <input
                  type="range"
                  min={VIDEO_DURATION_UI_MIN_SECONDS}
                  max={VIDEO_DURATION_UI_MAX_SECONDS}
                  step={1}
                  value={clampVideoDurationUiSeconds(videoDurationSeconds)}
                  onChange={(event) => changeCameraMoveDuration(Number(event.target.value))}
                  className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-red-500 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                  aria-valuemin={VIDEO_DURATION_UI_MIN_SECONDS}
                  aria-valuemax={VIDEO_DURATION_UI_MAX_SECONDS}
                  aria-valuenow={clampVideoDurationUiSeconds(videoDurationSeconds)}
                  aria-valuetext={`${clampVideoDurationUiSeconds(videoDurationSeconds)} seconds`}
                />
                <span className="min-w-[2.75rem] shrink-0 text-center text-sm font-bold tabular-nums text-white">
                  {clampVideoDurationUiSeconds(videoDurationSeconds)}s
                </span>
              </div>
              {videoPhase === 'export' && !isExportingCameraMove && (
                <button
                  type="button"
                  onClick={retakeVideoMove}
                  className="text-[11px] font-semibold text-white/70 underline-offset-2 transition hover:text-white hover:underline"
                  data-shots-video-retake
                >
                  Retake move
                </button>
              )}
            </div>
          )}

          {captureMode === 'video' && (!canExportVideo || cameraMoveError) && (
            <p
              role="alert"
              data-shots-camera-move-status
              className="pointer-events-auto max-w-md rounded-lg border border-amber-200/70 bg-black/65 px-3 py-2 text-center text-xs text-amber-100 shadow-soft backdrop-blur-sm"
            >
              {cameraMoveError ?? 'MP4 export is not supported in this browser. Try Chrome or Edge.'}
            </p>
          )}

          {captureMode === 'video' && isExportingCameraMove && (
            <div
              data-shots-camera-move-progress
              className="pointer-events-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-white/15 bg-black/65 px-3 py-2 text-center shadow-soft backdrop-blur-sm"
            >
              <p className="text-xs text-white/85">{cameraMoveProgressMessage}</p>
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-white/80 transition-[width]"
                  style={{ width: `${Math.round(cameraMoveProgress * 100)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={cancelCameraMoveExport}
                className="text-[11px] font-semibold uppercase tracking-wide text-white/70 underline-offset-2 hover:text-white hover:underline"
              >
                Cancel
              </button>
            </div>
          )}

          {captureMode === 'still' && snapshotError && (
            <p
              role="alert"
              data-shots-snapshot-status
              className="pointer-events-auto max-w-md rounded-lg border border-red-300/70 bg-black/65 px-3 py-2 text-center text-xs text-red-100 shadow-soft backdrop-blur-sm"
            >
              {snapshotError}
            </p>
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
                <ShotCameraRollThumbnail
                  project={project}
                  shot={libraryThumbShot}
                  overrideSrc={framePreviewByShotId[libraryThumbShot.id]}
                  allowLivePreview
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
              disabled={captureMode === 'video' && videoPhase === 'export' && (isExportingCameraMove || !canExportVideo)}
              className="group relative flex h-[4.75rem] w-[4.75rem] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              aria-label={captureLabel}
              data-shots-shutter
              data-shots-video-phase={captureMode === 'video' ? videoPhase : undefined}
              title={captureHint}
            >
              <span className="absolute inset-0 rounded-full border-[3px] border-white/90" />
              {captureMode === 'video' && videoPhase === 'stop' ? (
                // Classic stop control while the start keyframe is locked.
                <span className="flex h-[3.65rem] w-[3.65rem] items-center justify-center rounded-full bg-red-500 transition group-active:scale-95">
                  <span className="h-5 w-5 rounded-[4px] bg-white shadow-sm" />
                </span>
              ) : (
                <span
                  className={`h-[3.65rem] w-[3.65rem] rounded-full transition ${
                    captureMode === 'video'
                      ? (videoPhase === 'record'
                        ? 'bg-red-500 group-active:scale-95'
                        : 'bg-[var(--accent)] group-active:scale-95')
                      : 'bg-white group-active:scale-90'
                  }`}
                />
              )}
              {captureMode === 'video' && videoPhase === 'export' && !isExportingCameraMove && (
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
                {statuses.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
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
                  Prefer the Video mode shutter: record captures start, stop captures end. Manual keyframes live here for fine control.
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
                  hint="Also available as quick picks on the Video camera chrome while recording."
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
                <Field label="Export mode" hint="Render MP4 is fixed-step H.264 for Resolve. Quick Preview is real-time and may drop frames.">
                  <Select
                    value={videoExportMode}
                    onChange={(event) => setVideoExportMode(event.target.value as 'render' | 'quickPreview')}
                  >
                    <option value="render" disabled={canRenderMp4 !== true}>
                      Render MP4{canRenderMp4 === true ? '' : canRenderMp4 === false ? ' (unavailable)' : '…'}
                    </option>
                    <option value="quickPreview" disabled={!supportedMp4MimeType}>
                      Quick Preview{supportedMp4MimeType ? '' : ' (unavailable)'}
                    </option>
                  </Select>
                </Field>
                <Field label="Video resolution" hint="Stills stay at shot resolution. Video defaults to 1080p30.">
                  <Select
                    value={videoResolutionPreset}
                    onChange={(event) => setVideoResolutionPreset(event.target.value as VideoResolutionPresetId)}
                  >
                    <option value="1080p">{VIDEO_RESOLUTION_PRESETS['1080p'].label}</option>
                    <option value="4k">{VIDEO_RESOLUTION_PRESETS['4k'].label}</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <IconButton
                    onClick={() => void exportCameraMoveVideo()}
                    disabled={!cameraMoveReady || isExportingCameraMove || !canExportVideo || !selectedExportModeAvailable}
                    className="w-full"
                  >
                    <Film className="h-4 w-4" />
                    {isExportingCameraMove
                      ? `${Math.round(cameraMoveProgress * 100)}%`
                      : videoExportMode === 'quickPreview'
                        ? 'Quick Preview'
                        : 'Render MP4'}
                  </IconButton>
                  <IconButton
                    onClick={cancelCameraMoveExport}
                    disabled={!isExportingCameraMove}
                    className="w-full"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </IconButton>
                </div>
                {isExportingCameraMove && (
                  <p className="rounded-lg border border-subtle bg-panel px-3 py-2 text-xs text-muted">
                    {cameraMoveProgressMessage}
                  </p>
                )}
                {!canExportVideo && (
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
      className={`min-h-11 rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
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
