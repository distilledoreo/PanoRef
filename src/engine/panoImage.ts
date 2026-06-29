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
  targetWidth = 1920,
  targetHeight = 1080,
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
  const analysis = analyzeEquirectImage(width, height);
  const extracted = await extractEquirectFromContainer(dataUrl, analysis);
  return { ...extracted, analysis };
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