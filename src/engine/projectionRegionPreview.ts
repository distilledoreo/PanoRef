import type { ProjectionRegionAlignment } from '../domain/types';
import { decodeRegionDisplacement, generateProjectionRegionTexture, type ProjectionRegionTextureQuality } from './projectionRegionTexture';

export interface ProjectionRegionPreviewRenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  diagnostics: ReturnType<typeof generateProjectionRegionTexture>['diagnostics'];
}

interface PreviewRenderOptions {
  sourceYawRadians: number;
  targetYawRadians: number;
  sourceOrigin?: [number, number, number];
  targetOrigin?: [number, number, number];
  strength?: number;
  quality?: ProjectionRegionTextureQuality;
}

function dimensionsOf(source: CanvasImageSource): [number, number] {
  const candidate = source as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const width = candidate.naturalWidth || candidate.videoWidth || (candidate as unknown as { width: number }).width;
  const height = candidate.naturalHeight || candidate.videoHeight || (candidate as unknown as { height: number }).height;
  return [Math.max(1, width), Math.max(1, height)];
}

const wrapU = (value: number) => ((value % 1) + 1) % 1;
const clampV = (value: number) => Math.max(0, Math.min(1, value));

/** Render the same Region Fit displacement used by the projected shader into a small 2D review surface. */
export function renderProjectionRegionPreview(
  sourceImage: CanvasImageSource,
  alignment: ProjectionRegionAlignment | undefined,
  options: PreviewRenderOptions,
): ProjectionRegionPreviewRenderResult {
  const quality = options.quality ?? 'preview';
  const texture = alignment
    ? generateProjectionRegionTexture(alignment, { ...options, quality })
    : undefined;
  const width = texture?.width ?? 256;
  const height = texture?.height ?? 128;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('2D preview context is unavailable.');

  const [sourceWidth, sourceHeight] = dimensionsOf(sourceImage);
  const sampleWidth = Math.min(2048, sourceWidth);
  const sampleHeight = Math.max(1, Math.round(sourceHeight * (sampleWidth / sourceWidth)));
  const sample = document.createElement('canvas');
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext('2d');
  if (!sampleContext) throw new Error('2D preview sample context is unavailable.');
  sampleContext.drawImage(sourceImage, 0, 0, sampleWidth, sampleHeight);
  const sourcePixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const outputPixels = outputContext.createImageData(width, height);
  const strength = Math.max(0, Math.min(1, options.strength ?? alignment?.strength ?? 1));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputIndex = (y * width + x) * 4;
      const uvU = (x + 0.5) / width;
      const uvV = (y + 0.5) / height;
      let sampleU = uvU;
      let sampleV = uvV;
      if (texture) {
        const textureIndex = y * width + x;
        const displacement = decodeRegionDisplacement(texture.displacement[textureIndex * 2], texture.displacement[textureIndex * 2 + 1]);
        const weight = texture.weight[textureIndex] / 255;
        sampleU = wrapU(uvU + displacement[0] * strength * weight);
        sampleV = clampV(uvV + displacement[1] * strength * weight);
      }
      const sourceX = sampleU * (sampleWidth - 1);
      const sourceY = sampleV * (sampleHeight - 1);
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(sampleWidth - 1, x0 + 1);
      const y1 = Math.min(sampleHeight - 1, y0 + 1);
      const xWeight = sourceX - x0;
      const yWeight = sourceY - y0;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = sourcePixels[(y0 * sampleWidth + x0) * 4 + channel];
        const topRight = sourcePixels[(y0 * sampleWidth + x1) * 4 + channel];
        const bottomLeft = sourcePixels[(y1 * sampleWidth + x0) * 4 + channel];
        const bottomRight = sourcePixels[(y1 * sampleWidth + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * xWeight;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
        outputPixels.data[outputIndex + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }
  outputContext.putImageData(outputPixels, 0, 0);
  const diagnostics = texture?.diagnostics ?? [];
  texture?.release();
  return { canvas: output, width, height, diagnostics };
}
