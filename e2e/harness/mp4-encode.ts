/**
 * Browser harness for a real WebCodecs encode → validate → decode round-trip.
 * Loaded by Playwright via /e2e/harness/mp4-encode.html (multi-page Vite build).
 */
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
} from 'mediabunny';
import { createCameraData, createCameraKeyframe, createDefaultProject } from '../../src/domain/defaults';
import { validateCameraMoveMp4 } from '../../src/engine/mp4Validate';
import {
  renderShotCameraMoveMp4,
  renderViewportClay,
} from '../../src/engine/renderers';
import {
  cameraMoveFrameTimeSeconds,
  computeCameraMoveFrameCount,
  resolveVideoPreset,
} from '../../src/engine/videoPresets';

declare global {
  interface Window {
    __mp4EncodeTestResult?: Mp4EncodeHarnessResult;
  }
}

interface Mp4EncodeHarnessResult {
  done: boolean;
  ok: boolean;
  error?: string;
  frameCount?: number;
  durationSeconds?: number;
  timestampsEven?: boolean;
  allFramesDecoded?: boolean;
  cameraTimeStart?: number;
  cameraTimeEnd?: number;
  firstFrameMae?: number;
  lastFrameMae?: number;
  startEndFrameDelta?: number;
  validationIssues?: Array<{ code: string; message: string }>;
}

const WIDTH = 320;
const HEIGHT = 180;
const DURATION_SECONDS = 1;
const FRAME_RATE = 30;

function setStatus(message: string) {
  const el = document.getElementById('status');
  if (el) el.textContent = message;
}

function publish(result: Mp4EncodeHarnessResult) {
  window.__mp4EncodeTestResult = result;
  setStatus(JSON.stringify(result, null, 2));
}

function meanAbsoluteError(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i += 4) {
    sum += Math.abs(a[i]! - b[i]!);
    sum += Math.abs(a[i + 1]! - b[i + 1]!);
    sum += Math.abs(a[i + 2]! - b[i + 2]!);
    count += 3;
  }
  return sum / count;
}

async function loadImageDataFromDataUrl(dataUrl: string): Promise<ImageData> {
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to decode reference still.'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable.');
  ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return ctx.getImageData(0, 0, WIDTH, HEIGHT);
}

async function decodeEndpointFrames(blob: Blob): Promise<{
  first: ImageData;
  last: ImageData;
  frameCount: number;
}> {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track in encoded MP4.');
    const sink = new CanvasSink(track, { width: WIDTH, height: HEIGHT, fit: 'fill' });
    const frames: ImageData[] = [];
    for await (const wrapped of sink.canvases()) {
      const source = wrapped.canvas;
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable for decode.');
      ctx.drawImage(source as CanvasImageSource, 0, 0, WIDTH, HEIGHT);
      frames.push(ctx.getImageData(0, 0, WIDTH, HEIGHT));
    }
    if (frames.length < 2) {
      throw new Error(`Expected at least 2 decoded frames, got ${frames.length}.`);
    }
    return {
      first: frames[0]!,
      last: frames[frames.length - 1]!,
      frameCount: frames.length,
    };
  } finally {
    input.dispose();
  }
}

async function run() {
  const expectedFrameCount = computeCameraMoveFrameCount(DURATION_SECONDS, FRAME_RATE);
  const cameraTimeStart = cameraMoveFrameTimeSeconds(0, FRAME_RATE, DURATION_SECONDS);
  const cameraTimeEnd = cameraMoveFrameTimeSeconds(
    expectedFrameCount - 1,
    FRAME_RATE,
    DURATION_SECONDS,
  );

  if (cameraTimeStart !== 0 || cameraTimeEnd !== DURATION_SECONDS) {
    throw new Error(
      `Camera sample times must be exact endpoints; got start=${cameraTimeStart}, end=${cameraTimeEnd}.`,
    );
  }

  const project = createDefaultProject();
  const shot = project.shots[0]!;
  // Distinct start/end poses so first vs last decoded frames differ materially.
  const startCamera = createCameraData([0, 1.65, 6], [0, 1.65, 0], 55);
  const endCamera = createCameraData([4, 1.65, -2], [0, 1.2, -8], 55);
  shot.cameraKeyframes = [
    createCameraKeyframe({ label: 'Start', timeSeconds: 0, camera: startCamera }),
    createCameraKeyframe({ label: 'End', timeSeconds: DURATION_SECONDS, camera: endCamera }),
  ];
  shot.camera = startCamera;

  const basePreset = resolveVideoPreset('1080p');
  const preset = {
    ...basePreset,
    width: WIDTH,
    height: HEIGHT,
    frameRate: FRAME_RATE,
    // Lower bitrate + Level 3.0 for a tiny harness clip (encoder may negotiate below 1080p Level 4.0).
    bitrate: 1_500_000,
    avcCodecString: 'avc1.64001e',
    level: '3.0',
    label: '320x180@30 harness',
  };

  setStatus('Rendering reference stills…');
  const startStill = await renderViewportClay(project, startCamera, WIDTH, HEIGHT);
  const endStill = await renderViewportClay(project, endCamera, WIDTH, HEIGHT);
  const startPixels = await loadImageDataFromDataUrl(startStill.dataUrl);
  const endPixels = await loadImageDataFromDataUrl(endStill.dataUrl);

  setStatus('Encoding 1s Render MP4…');
  const encoded = await renderShotCameraMoveMp4(project, shot, {
    mode: 'render',
    resolutionPreset: '1080p',
    width: WIDTH,
    height: HEIGHT,
    frameRate: FRAME_RATE,
    appearance: 'clay',
    includeDataUrl: false,
  });

  if (encoded.encodeMode !== 'render') {
    throw new Error(`Expected encodeMode render, got ${encoded.encodeMode ?? 'undefined'}.`);
  }

  setStatus('Validating container…');
  const validation = await validateCameraMoveMp4({
    blob: encoded.blob,
    preset,
    expectedDurationSeconds: DURATION_SECONDS,
    expectedFrameCount,
    decodeAllFrames: true,
  });

  setStatus('Decoding endpoint frames…');
  const decoded = await decodeEndpointFrames(encoded.blob);
  const firstFrameMae = meanAbsoluteError(decoded.first.data, startPixels.data);
  const lastFrameMae = meanAbsoluteError(decoded.last.data, endPixels.data);
  const startEndFrameDelta = meanAbsoluteError(decoded.first.data, decoded.last.data);

  // Lossy H.264 at tiny res: allow moderate MAE vs stills, but endpoints must differ.
  const stillMatchOk = firstFrameMae < 45 && lastFrameMae < 45;
  const endpointsDiffer = startEndFrameDelta > 8;
  const ok = validation.ok && stillMatchOk && endpointsDiffer
    && decoded.frameCount === expectedFrameCount
    && cameraTimeEnd === DURATION_SECONDS;

  publish({
    done: true,
    ok,
    frameCount: validation.frameCount ?? decoded.frameCount,
    durationSeconds: validation.durationSeconds,
    timestampsEven: validation.timestampsEven,
    allFramesDecoded: validation.allFramesDecoded,
    cameraTimeStart,
    cameraTimeEnd,
    firstFrameMae,
    lastFrameMae,
    startEndFrameDelta,
    validationIssues: validation.issues,
    error: ok
      ? undefined
      : [
          !validation.ok ? `validation: ${validation.issues.map((i) => i.message).join('; ')}` : '',
          !stillMatchOk ? `still MAE first=${firstFrameMae.toFixed(2)} last=${lastFrameMae.toFixed(2)}` : '',
          !endpointsDiffer ? `start/end delta too small (${startEndFrameDelta.toFixed(2)})` : '',
        ].filter(Boolean).join(' | ') || 'unknown failure',
  });
}

run().catch((error) => {
  publish({
    done: true,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
});
