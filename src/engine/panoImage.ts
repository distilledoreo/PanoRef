import { DEFAULT_SHOT_HEIGHT, DEFAULT_SHOT_WIDTH } from '../domain/defaults';

export const EQUIRECT_ASPECT = 2;
export const LETTERBOX_169_ASPECT = 16 / 9;
const ASPECT_TOLERANCE = 0.025;

export interface EquirectCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EquirectImageAnalysis {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  wasLetterboxed: boolean;
  crop?: EquirectCropRect;
}

export interface PanoImageResult {
  dataUrl: string;
  width: number;
  height: number;
}

export function isAspectRatio(value: number, target: number, tolerance = ASPECT_TOLERANCE): boolean {
  return Math.abs(value - target) <= tolerance;
}

export function analyzeEquirectImage(width: number, height: number): EquirectImageAnalysis {
  const aspect = width / height;

  if (isAspectRatio(aspect, EQUIRECT_ASPECT)) {
    return {
      width,
      height,
      sourceWidth: width,
      sourceHeight: height,
      wasLetterboxed: false,
    };
  }

  if (isAspectRatio(aspect, LETTERBOX_169_ASPECT)) {
    const equirectHeight = Math.round(width / EQUIRECT_ASPECT);
    if (equirectHeight > 0 && equirectHeight <= height) {
      const y = Math.round((height - equirectHeight) / 2);
      return {
        width,
        height: equirectHeight,
        sourceWidth: width,
        sourceHeight: height,
        wasLetterboxed: true,
        crop: { x: 0, y, width, height: equirectHeight },
      };
    }
  }

  return {
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    wasLetterboxed: false,
  };
}

export function shouldLetterboxPanoExport(
  width: number,
  height: number,
  letterboxEnabled: boolean,
): boolean {
  if (!letterboxEnabled || width <= 0 || height <= 0) return false;
  const aspect = width / height;
  return isAspectRatio(aspect, EQUIRECT_ASPECT);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = dataUrl;
  });
}

export async function extractEquirectFromContainer(
  dataUrl: string,
  analysis: EquirectImageAnalysis,
): Promise<PanoImageResult> {
  if (!analysis.wasLetterboxed || !analysis.crop) {
    return { dataUrl, width: analysis.width, height: analysis.height };
  }

  const image = await loadImage(dataUrl);
  const { x, y, width, height } = analysis.crop;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create canvas context.');
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

export async function letterboxEquirectTo169(
  dataUrl: string,
  targetWidth = DEFAULT_SHOT_WIDTH,
  targetHeight = DEFAULT_SHOT_HEIGHT,
): Promise<PanoImageResult> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create canvas context.');

  context.fillStyle = '#000000';
  context.fillRect(0, 0, targetWidth, targetHeight);

  const drawHeight = targetWidth / EQUIRECT_ASPECT;
  const drawY = (targetHeight - drawHeight) / 2;
  context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, drawY, targetWidth, drawHeight);

  return { dataUrl: canvas.toDataURL('image/png'), width: targetWidth, height: targetHeight };
}

export async function preparePanoImport(
  dataUrl: string,
  width: number,
  height: number,
): Promise<PanoImageResult & { analysis: EquirectImageAnalysis }> {
  const initialAnalysis = analyzeEquirectImage(width, height);
  const analysis = initialAnalysis.wasLetterboxed
    ? initialAnalysis
    : await detectLetterboxedEquirectImage(dataUrl, initialAnalysis);
  const extracted = await extractEquirectFromContainer(dataUrl, analysis);
  return { ...extracted, analysis };
}

async function detectLetterboxedEquirectImage(
  dataUrl: string,
  analysis: EquirectImageAnalysis,
): Promise<EquirectImageAnalysis> {
  if (analysis.width <= 0 || analysis.height <= 0) return analysis;

  const image = await loadImage(dataUrl);
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const sampleWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const sampleHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return analysis;
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const crop = detectCenteredPaddingCrop(pixels, sampleWidth, sampleHeight);
  if (!crop) return analysis;

  return {
    ...analysis,
    width: Math.round(crop.width / scale),
    height: Math.round(crop.height / scale),
    wasLetterboxed: true,
    crop: {
      x: Math.round(crop.x / scale),
      y: Math.round(crop.y / scale),
      width: Math.round(crop.width / scale),
      height: Math.round(crop.height / scale),
    },
  };
}

export function detectCenteredPaddingCrop(pixels: Uint8ClampedArray, width: number, height: number): EquirectCropRect | undefined {
  const top = countFromEdge(Array.from({ length: height }, (_, y) => isUniformEdgeBand(pixels, width, height, y, true, 0)));
  const bottom = countFromEdge(Array.from({ length: height }, (_, y) => isUniformEdgeBand(pixels, width, height, height - 1 - y, true, height - 1)));
  const left = countFromEdge(Array.from({ length: width }, (_, x) => isUniformEdgeBand(pixels, width, height, x, false, 0)));
  const right = countFromEdge(Array.from({ length: width }, (_, x) => isUniformEdgeBand(pixels, width, height, width - 1 - x, false, width - 1)));

  const verticalCrop = { x: 0, y: top, width, height: height - top - bottom };
  const horizontalCrop = { x: left, y: 0, width: width - left - right, height };
  const candidates = [verticalCrop, horizontalCrop]
    .filter((candidate) => candidate.width > 0 && candidate.height > 0)
    .filter((candidate) => Math.abs(candidate.width / candidate.height - EQUIRECT_ASPECT) <= 0.08)
    .filter((candidate) => candidate.width * candidate.height < width * height * 0.98)
    .sort((a, b) => b.width * b.height - a.width * a.height);

  return candidates[0];
}

function isUniformEdgeBand(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  offset: number,
  row: boolean,
  edgeOffset: number,
) {
  const length = row ? width : height;
  const step = Math.max(1, Math.floor(length / 64));
  const baseIndex = row
    ? edgeOffset * width * 4
    : (Math.floor(height / 2) * width + edgeOffset) * 4;
  const base = [pixels[baseIndex], pixels[baseIndex + 1], pixels[baseIndex + 2]];
  let matches = 0;
  let samples = 0;
  for (let i = 0; i < length; i += step) {
    const index = row ? (offset * width + i) * 4 : (i * width + offset) * 4;
    const difference = Math.abs(pixels[index] - base[0]) + Math.abs(pixels[index + 1] - base[1]) + Math.abs(pixels[index + 2] - base[2]);
    if (difference <= 24) matches += 1;
    samples += 1;
  }
  return matches / Math.max(1, samples) >= 0.94;
}

function countFromEdge(values: boolean[]) {
  let count = 0;
  for (const value of values) {
    if (!value) break;
    count += 1;
  }
  return count;
}

export async function preparePanoExportDataUrl(
  dataUrl: string,
  width: number,
  height: number,
  options: {
    letterboxEnabled: boolean;
    targetWidth: number;
    targetHeight: number;
  },
): Promise<string> {
  if (!shouldLetterboxPanoExport(width, height, options.letterboxEnabled)) {
    return dataUrl;
  }
  const letterboxed = await letterboxEquirectTo169(dataUrl, options.targetWidth, options.targetHeight);
  return letterboxed.dataUrl;
}

export async function downloadPanoImage(
  dataUrl: string,
  width: number,
  height: number,
  fileName: string,
  options: {
    letterboxEnabled: boolean;
    targetWidth: number;
    targetHeight: number;
  },
  download: (url: string, name: string) => void,
): Promise<void> {
  const exportUrl = await preparePanoExportDataUrl(dataUrl, width, height, options);
  download(exportUrl, fileName);
}
