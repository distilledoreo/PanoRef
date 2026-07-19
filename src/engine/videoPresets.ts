/** Production-safe DaVinci Resolve target for camera-move exports. */
export const DEFAULT_VIDEO_WIDTH = 1920;
export const DEFAULT_VIDEO_HEIGHT = 1080;
export const DEFAULT_VIDEO_FRAME_RATE = 30;

export type VideoResolutionPresetId = '1080p' | '4k';

export interface VideoResolutionPreset {
  id: VideoResolutionPresetId;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  /** Full AVC codec string for VideoEncoder / Mediabunny. */
  avcCodecString: string;
  profile: 'high';
  level: string;
  /** Target bitrate for H.264 (bits/sec). */
  bitrate: number;
}

/**
 * Resolution-aware H.264 High Profile configs.
 * 1080p30 → Level 4.0; 4K30 → Level 5.1.
 */
export const VIDEO_RESOLUTION_PRESETS: Record<VideoResolutionPresetId, VideoResolutionPreset> = {
  '1080p': {
    id: '1080p',
    label: '1080p30 (Resolve)',
    width: 1920,
    height: 1080,
    frameRate: DEFAULT_VIDEO_FRAME_RATE,
    // High Profile (0x64), Level 4.0 (0x28)
    avcCodecString: 'avc1.640028',
    profile: 'high',
    level: '4.0',
    bitrate: 12_000_000,
  },
  '4k': {
    id: '4k',
    label: '4K30 (High quality)',
    width: 3840,
    height: 2160,
    frameRate: DEFAULT_VIDEO_FRAME_RATE,
    // High Profile (0x64), Level 5.1 (0x33)
    avcCodecString: 'avc1.640033',
    profile: 'high',
    level: '5.1',
    bitrate: 35_000_000,
  },
};

export function resolveVideoPreset(
  presetId: VideoResolutionPresetId = '1080p',
): VideoResolutionPreset {
  return VIDEO_RESOLUTION_PRESETS[presetId] ?? VIDEO_RESOLUTION_PRESETS['1080p'];
}

export function videoPresetForSize(width: number, height: number): VideoResolutionPreset {
  if (width >= 3840 || height >= 2160) return VIDEO_RESOLUTION_PRESETS['4k'];
  return VIDEO_RESOLUTION_PRESETS['1080p'];
}

export function computeCameraMoveFrameCount(durationSeconds: number, frameRate: number): number {
  const fps = Math.max(1, frameRate);
  const duration = Math.max(0, durationSeconds);
  // Inclusive of the end keyframe: duration * fps frames spanning [0, duration).
  // Final authored pose is sampled at the last frame time (frameCount-1)/fps ≈ duration.
  return Math.max(1, Math.round(duration * fps));
}

export function cameraMoveFrameTimeSeconds(
  frameIndex: number,
  frameRate: number,
  durationSeconds: number,
): number {
  const fps = Math.max(1, frameRate);
  const frameCount = computeCameraMoveFrameCount(durationSeconds, fps);
  if (frameCount <= 1) return durationSeconds;
  const t = frameIndex / fps;
  return Math.min(durationSeconds, t);
}
