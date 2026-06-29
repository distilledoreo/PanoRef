import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Euler, PanoCropSettings } from '../../domain/types';
import { renderPanoPerspectiveCrop } from '../../engine/renderers';

const PREVIEW_MAX_WIDTH = 640;

export function ShotPanoCropPreview({
  imageUrl,
  crop,
  panoRotation = [0, 0, 0],
  label,
  matchQuality,
  matchDistanceMeters,
}: {
  imageUrl?: string;
  crop?: PanoCropSettings;
  panoRotation?: Euler;
  label?: string;
  matchQuality?: 'good' | 'moderate' | 'poor';
  matchDistanceMeters?: number;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    if (!imageUrl || !crop) {
      setPreviewUrl(undefined);
      return;
    }

    const scale = crop.width > PREVIEW_MAX_WIDTH ? PREVIEW_MAX_WIDTH / crop.width : 1;
    const previewCrop: PanoCropSettings = {
      ...crop,
      width: Math.max(1, Math.round(crop.width * scale)),
      height: Math.max(1, Math.round(crop.height * scale)),
    };

    let cancelled = false;
    setIsRendering(true);
    void renderPanoPerspectiveCrop(imageUrl, previewCrop, panoRotation)
      .then((result) => {
        if (!cancelled) setPreviewUrl(result.dataUrl);
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    imageUrl,
    crop?.panoId,
    crop?.yawDegrees,
    crop?.pitchDegrees,
    crop?.rollDegrees,
    crop?.fovDegrees,
    crop?.aspectRatio,
    crop?.width,
    crop?.height,
    panoRotation[0],
    panoRotation[1],
    panoRotation[2],
  ]);

  const showParallaxWarning = matchQuality && matchQuality !== 'good';

  return (
    <div className="flex min-h-0 flex-col bg-zinc-50 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-zinc-800">Pano Crop Preview</h3>
        {crop && (
          <span className="font-mono text-xs text-zinc-500">
            {crop.fovDegrees.toFixed(0)}° · {crop.width}×{crop.height}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
        {!imageUrl ? (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-sm text-zinc-400">
            Link a panorama reference to preview the shot crop.
          </div>
        ) : !crop ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-zinc-400">
            No crop settings for this shot.
          </div>
        ) : isRendering && !previewUrl ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-zinc-400">
            Rendering pano crop...
          </div>
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={`Pano crop preview for ${label ?? 'shot'}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-zinc-400">
            No preview yet.
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs text-zinc-500">
          Perspective crop from the linked pano at the locked camera angle — same as exported <span className="font-mono">pano_crop.png</span>, including the yaw offset calibrated in Reference.
        </p>
        {showParallaxWarning && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Camera is {matchDistanceMeters?.toFixed(1)}m from the pano origin. The pano was captured at a fixed point, so framing only aligns by direction — move the camera back to the origin for a closer match.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}