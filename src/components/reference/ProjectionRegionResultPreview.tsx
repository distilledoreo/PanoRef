import React, { useEffect, useRef, useState } from 'react';
import type { ProjectionRegionAlignment, Vec3 } from '../../domain/types';
import { renderProjectionRegionPreview } from '../../engine/projectionRegionPreview';
import type { PanoViewerRegion } from '../viewers/PanoViewer';

export function ProjectionRegionResultPreview({
  imageUrl,
  alignment,
  sourceYawRadians,
  targetYawRadians,
  sourceOrigin,
  targetOrigin,
  strength,
  regions,
  showOutlines,
  statusLabel,
}: {
  imageUrl?: string;
  alignment?: ProjectionRegionAlignment;
  sourceYawRadians: number;
  targetYawRadians: number;
  sourceOrigin?: Vec3;
  targetOrigin?: Vec3;
  strength: number;
  regions: PanoViewerRegion[];
  showOutlines: boolean;
  statusLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderGenerationRef = useRef(0);
  const [status, setStatus] = useState('Loading result…');

  useEffect(() => {
    const generation = ++renderGenerationRef.current;
    if (!imageUrl) {
      setStatus('Result unavailable: panorama image is missing.');
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const rendered = renderProjectionRegionPreview(image, alignment, {
          sourceYawRadians,
          targetYawRadians,
          sourceOrigin,
          targetOrigin,
          strength,
          quality: 'preview',
        });
        if (generation !== renderGenerationRef.current || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2D result context is unavailable.');
        context.drawImage(rendered.canvas, 0, 0);
        const invalid = rendered.diagnostics.find((diagnostic) => !diagnostic.valid);
        setStatus(invalid?.message ? `Result unavailable: ${invalid.message}` : `${statusLabel} · 256×128 preview`);
      } catch (error) {
        if (generation !== renderGenerationRef.current) return;
        setStatus(`Result unavailable: ${error instanceof Error ? error.message : 'could not render preview.'}`);
      }
    };
    image.onerror = () => {
      if (generation === renderGenerationRef.current) setStatus('Result unavailable: panorama image could not be decoded.');
    };
    image.src = imageUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [alignment, imageUrl, sourceOrigin, sourceYawRadians, statusLabel, strength, targetOrigin, targetYawRadians]);

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center bg-black/10" data-projection-region-result data-projection-region-preview-quality="256x128">
      <canvas ref={canvasRef} aria-label="Mapped panorama result" className="max-h-full max-w-full object-contain" />
      {showOutlines && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {regions.map((region) => (
            <polygon
              key={region.id}
              points={region.vertices.map((vertex) => `${vertex.uv[0]},${vertex.uv[1]}`).join(' ')}
              fill="none"
              stroke={region.state === 'invalid' ? '#ef4444' : region.state === 'active' ? '#facc15' : '#38bdf8'}
              strokeWidth="0.006"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white" aria-live="polite">{status}</span>
    </div>
  );
}
