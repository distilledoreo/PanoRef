import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  EncodedPacketSink,
  Input,
  InputVideoTrack,
  Mp4InputFormat,
} from 'mediabunny';
import type { VideoResolutionPreset } from './videoPresets';

export interface Mp4ValidationIssue {
  code: string;
  message: string;
}

export interface Mp4ValidationResult {
  ok: boolean;
  issues: Mp4ValidationIssue[];
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  frameCount?: number;
  durationSeconds?: number;
  timestampsEven?: boolean;
  allFramesDecoded?: boolean;
  duplicateTimestamps?: boolean;
}

export interface ValidateCameraMoveMp4Options {
  blob: Blob;
  preset: VideoResolutionPreset;
  expectedDurationSeconds: number;
  expectedFrameCount: number;
  /** Allow small float drift in duration / timestamps. */
  durationToleranceSeconds?: number;
  /** Decode every frame (slower; skip in lightweight checks). */
  decodeAllFrames?: boolean;
}

/**
 * Inspect an exported camera-move MP4 for Resolve-compatible structure.
 */
export async function validateCameraMoveMp4(
  options: ValidateCameraMoveMp4Options,
): Promise<Mp4ValidationResult> {
  const issues: Mp4ValidationIssue[] = [];
  const {
    blob,
    preset,
    expectedDurationSeconds,
    expectedFrameCount,
    durationToleranceSeconds = 1 / preset.frameRate + 0.001,
    decodeAllFrames = true,
  } = options;

  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  try {
    const format = await input.getFormat();
    const isMp4 = format instanceof Mp4InputFormat
      || /mp4|isobmff/i.test(format.name ?? '');
    const container = isMp4 ? 'mp4' : (format.name ?? 'unknown');

    if (container !== 'mp4') {
      issues.push({ code: 'container', message: `Expected MP4 container, got ${container}.` });
    }

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      issues.push({ code: 'track', message: 'No primary video track found.' });
      return { ok: false, issues, container };
    }

    const codec = (await videoTrack.getCodec()) ?? videoTrack.codec ?? undefined;
    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();
    const durationSeconds = await videoTrack.computeDuration();
    const packetStats = await videoTrack.computePacketStats();
    const timestampStats = await collectTimestampStats(videoTrack);
    const frameCount = timestampStats.frameCount || packetStats.packetCount;
    const frameRate = packetStats.averagePacketRate || (
      frameCount > 1 && durationSeconds > 0
        ? frameCount / durationSeconds
        : preset.frameRate
    );

    if (!codec || !/avc|avc1|h\.?264/i.test(codec)) {
      issues.push({
        code: 'codec',
        message: `Expected H.264/AVC, got ${codec ?? 'unknown'}.`,
      });
    }

    // Profile: require the preset's AVC profile IDC (e.g. High = 0x64). Encoders often
    // negotiate a lower level than requested for small frames; that is still valid.
    const codecParam = await videoTrack.getCodecParameterString() ?? codec;
    if (codecParam) {
      const expectedProfileIdc = preset.avcCodecString.slice(5, 7).toLowerCase();
      const encoded = codecParam.toLowerCase();
      const profileOk = encoded.includes(`avc1.${expectedProfileIdc}`)
        || encoded.startsWith(expectedProfileIdc)
        || encoded.includes(preset.avcCodecString.slice(5).toLowerCase());
      if (!profileOk) {
        issues.push({
          code: 'profileLevel',
          message: `Expected AVC profile near ${preset.avcCodecString}, got ${codecParam}.`,
        });
      }
    }

    if (width !== preset.width || height !== preset.height) {
      issues.push({
        code: 'resolution',
        message: `Expected ${preset.width}×${preset.height}, got ${width}×${height}.`,
      });
    }

    if (Math.abs(frameRate - preset.frameRate) > 0.5) {
      issues.push({
        code: 'frameRate',
        message: `Expected ~${preset.frameRate} fps, got ${frameRate.toFixed(3)}.`,
      });
    }

    if (frameCount !== expectedFrameCount) {
      issues.push({
        code: 'frameCount',
        message: `Expected ${expectedFrameCount} frames, got ${frameCount}.`,
      });
    }

    if (Math.abs(durationSeconds - expectedDurationSeconds) > durationToleranceSeconds) {
      issues.push({
        code: 'duration',
        message: `Expected duration ~${expectedDurationSeconds}s, got ${durationSeconds.toFixed(4)}s.`,
      });
    }

    if (!timestampStats.timestampsEven) {
      issues.push({
        code: 'timestamps',
        message: 'Frame timestamps are not evenly spaced.',
      });
    }

    if (timestampStats.duplicateTimestamps) {
      issues.push({
        code: 'duplicateTimestamps',
        message: 'One or more frames share a duplicate timestamp.',
      });
    }

    let allFramesDecoded = true;
    if (decodeAllFrames) {
      try {
        const canDecode = await videoTrack.canDecode();
        if (!canDecode) {
          allFramesDecoded = false;
          issues.push({ code: 'decode', message: 'Track reports it cannot be decoded.' });
        } else {
          allFramesDecoded = await decodeAllVideoFrames(videoTrack, expectedFrameCount);
          if (!allFramesDecoded) {
            issues.push({
              code: 'decode',
              message: 'Not every frame decoded successfully.',
            });
          }
        }
      } catch (error) {
        allFramesDecoded = false;
        issues.push({
          code: 'decode',
          message: error instanceof Error ? error.message : 'Frame decode failed.',
        });
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      container,
      codec,
      width,
      height,
      frameRate,
      frameCount,
      durationSeconds,
      timestampsEven: timestampStats.timestampsEven,
      duplicateTimestamps: timestampStats.duplicateTimestamps,
      allFramesDecoded,
    };
  } finally {
    input.dispose();
  }
}

async function collectTimestampStats(videoTrack: InputVideoTrack): Promise<{
  frameCount: number;
  timestampsEven: boolean;
  duplicateTimestamps: boolean;
}> {
  const sink = new EncodedPacketSink(videoTrack);
  const timestamps: number[] = [];
  for await (const packet of sink.packets()) {
    timestamps.push(packet.timestamp);
  }
  return analyzeTimestamps(timestamps);
}

export function analyzeTimestamps(timestamps: number[]): {
  frameCount: number;
  timestampsEven: boolean;
  duplicateTimestamps: boolean;
} {
  const frameCount = timestamps.length;
  if (frameCount === 0) {
    return { frameCount: 0, timestampsEven: false, duplicateTimestamps: false };
  }

  const seen = new Set<number>();
  let duplicateTimestamps = false;
  for (const ts of timestamps) {
    const key = Math.round(ts * 1_000_000);
    if (seen.has(key)) duplicateTimestamps = true;
    seen.add(key);
  }

  if (frameCount < 3) {
    return { frameCount, timestampsEven: true, duplicateTimestamps };
  }

  const deltas: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    deltas.push(timestamps[i] - timestamps[i - 1]);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const timestampsEven = deltas.every((d) => Math.abs(d - mean) < mean * 0.05 + 1e-4);

  return { frameCount, timestampsEven, duplicateTimestamps };
}

async function decodeAllVideoFrames(
  videoTrack: InputVideoTrack,
  expectedFrameCount: number,
): Promise<boolean> {
  const sink = new CanvasSink(videoTrack, {
    width: await videoTrack.getDisplayWidth(),
    height: await videoTrack.getDisplayHeight(),
    fit: 'fill',
  });
  let count = 0;
  for await (const _frame of sink.canvases()) {
    count += 1;
  }
  return count === expectedFrameCount;
}
