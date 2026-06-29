import React, { useEffect, useState } from 'react';
import { computeExportFrameLayout, type ExportFrameLayout } from '../../engine/sync';

export function ShotViewfinderOverlay({
  containerRef,
  aspectRatio,
  fovDegrees,
  resolutionLabel,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  aspectRatio: number;
  fovDegrees: number;
  resolutionLabel: string;
}) {
  const [frameBox, setFrameBox] = useState<ExportFrameLayout>({ left: 0, top: 0, width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      setFrameBox(computeExportFrameLayout(width, height, aspectRatio));
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [aspectRatio, containerRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute border-2 border-teal-500 shadow-[0_0_0_9999px_rgba(244,246,244,0.38)]"
        style={{
          left: frameBox.left,
          top: frameBox.top,
          width: frameBox.width,
          height: frameBox.height,
        }}
      >
        <span className="absolute -top-6 left-0 rounded bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Shot frame
        </span>
        <CornerMark className="left-0 top-0 -translate-x-px -translate-y-px border-l-2 border-t-2" />
        <CornerMark className="right-0 top-0 translate-x-px -translate-y-px border-r-2 border-t-2" />
        <CornerMark className="bottom-0 left-0 -translate-x-px translate-y-px border-b-2 border-l-2" />
        <CornerMark className="bottom-0 right-0 translate-x-px translate-y-px border-b-2 border-r-2" />
      </div>
      <div className="absolute bottom-4 left-4 rounded-md border border-white/70 bg-white/90 px-3 py-2 font-mono text-xs text-zinc-700 shadow-sm backdrop-blur">
        <span className="mr-3">FOV {fovDegrees.toFixed(0)}°</span>
        <span>{resolutionLabel}</span>
      </div>
    </div>
  );
}

function CornerMark({ className }: { className: string }) {
  return <span className={`absolute h-4 w-4 border-teal-500 ${className}`} />;
}