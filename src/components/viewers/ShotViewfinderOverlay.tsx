import React, { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { computeExportFrameLayout, type ExportFrameLayout } from '../../engine/sync';
import { useThemeStore } from '../../state/useThemeStore';

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
  const theme = useThemeStore((state) => state.theme);
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

  const dimColor = theme === 'dark' ? 'rgba(8, 12, 18, 0.62)' : 'rgba(28, 25, 23, 0.28)';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute border-2 border-[var(--accent)] shadow-[0_0_0_9999px_var(--viewfinder-dim)]"
        style={{
          left: frameBox.left,
          top: frameBox.top,
          width: frameBox.width,
          height: frameBox.height,
          ['--viewfinder-dim' as string]: dimColor,
        }}
      >
        <CornerMark className="left-0 top-0 -translate-x-px -translate-y-px border-l-2 border-t-2" />
        <CornerMark className="right-0 top-0 translate-x-px -translate-y-px border-r-2 border-t-2" />
        <CornerMark className="bottom-0 left-0 -translate-x-px translate-y-px border-b-2 border-l-2" />
        <CornerMark className="bottom-0 right-0 translate-x-px translate-y-px border-b-2 border-r-2" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-white/90 shadow-sm" />
          <span className="absolute left-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white/90 shadow-sm" />
          <span className="absolute right-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white/90 shadow-sm" />
          <span className="absolute bottom-0 left-1/2 h-5 w-px -translate-x-1/2 bg-white/90 shadow-sm" />
        </div>

        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-surface-overlay px-3 py-1.5 shadow-card backdrop-blur">
          <Camera className="h-3.5 w-3.5 text-accent" />
          <span className="text-[10px] font-medium text-primary">FOV {fovDegrees.toFixed(0)}°</span>
          <span className="text-[10px] text-muted">·</span>
          <span className="font-mono text-[10px] text-secondary">{resolutionLabel}</span>
        </div>
      </div>
    </div>
  );
}

function CornerMark({ className }: { className: string }) {
  return <span className={`absolute h-3.5 w-3.5 border-[var(--accent)] ${className}`} />;
}