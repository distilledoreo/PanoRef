import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeVideo,
} from 'mediabunny';
import type { VideoResolutionPreset } from './videoPresets';

export interface DeterministicEncodeOptions {
  canvas: HTMLCanvasElement;
  preset: VideoResolutionPreset;
  totalFrames: number;
  /** Render the canvas for the given frame index before encoding. */
  renderFrame: (frameIndex: number) => void | Promise<void>;
  signal?: AbortSignal;
  onFrameEncoded?: (completedFrames: number, totalFrames: number) => void;
}

export interface DeterministicEncodeResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
  codecString: string;
}

export async function canUseDeterministicMp4Export(
  preset: VideoResolutionPreset,
): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const mediabunnyOk = await canEncodeVideo('avc', {
      width: preset.width,
      height: preset.height,
      bitrate: preset.bitrate,
    });
    if (!mediabunnyOk) return false;
  } catch {
    return false;
  }

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: preset.avcCodecString,
      width: preset.width,
      height: preset.height,
      framerate: preset.frameRate,
      bitrate: preset.bitrate,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' },
    });
    return Boolean(support.supported);
  } catch {
    return false;
  }
}

/**
 * Fixed-step canvas → WebCodecs H.264 → Mediabunny MP4.
 * Awaits CanvasSource.add for encoder/muxer backpressure.
 */
export async function encodeCanvasFramesToMp4(
  options: DeterministicEncodeOptions,
): Promise<DeterministicEncodeResult> {
  const { canvas, preset, totalFrames, renderFrame, signal, onFrameEncoded } = options;
  if (totalFrames < 1) {
    throw new Error('Camera move export requires at least one frame.');
  }
  if (signal?.aborted) {
    throw new Error('MP4 export was cancelled.');
  }

  const supported = await canUseDeterministicMp4Export(preset);
  if (!supported) {
    throw new Error(
      `H.264 ${preset.label} (${preset.avcCodecString}) is not supported in this browser.`,
    );
  }

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  const frameDuration = 1 / preset.frameRate;
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: preset.bitrate,
    fullCodecString: preset.avcCodecString,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    bitrateMode: 'constant',
    keyFrameInterval: 2,
  });

  output.addVideoTrack(videoSource, { frameRate: preset.frameRate });
  await output.start();

  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
  };
  signal?.addEventListener('abort', onAbort);

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (cancelled || signal?.aborted) {
        throw new Error('MP4 export was cancelled.');
      }

      await renderFrame(frameIndex);
      const timestamp = frameIndex * frameDuration;
      // Await add() so muxer/encoder backpressure stalls the render loop
      // instead of buffering unbounded VideoFrames in memory.
      await videoSource.add(timestamp, frameDuration);
      onFrameEncoded?.(frameIndex + 1, totalFrames);
    }

    videoSource.close();
    await output.finalize();
  } catch (error) {
    try {
      videoSource.close();
    } catch {
      // ignore
    }
    try {
      await output.cancel();
    } catch {
      // ignore
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('MP4 encoding produced an empty file.');
  }

  const blob = new Blob([buffer], { type: 'video/mp4' });
  return {
    blob,
    mimeType: 'video/mp4',
    width: preset.width,
    height: preset.height,
    frameRate: preset.frameRate,
    frameCount: totalFrames,
    codecString: preset.avcCodecString,
  };
}
