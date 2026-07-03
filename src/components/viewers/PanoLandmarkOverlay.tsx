import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Landmark, PanoViewState, Vec3 } from '../../domain/types';
import { landmarkStripBackgroundPosition, projectLandmarkToScreen } from '../../engine/panoOverlay';

export function PanoLandmarkMarkers({
  landmarks,
  panoOrigin,
  view,
  focusedLandmarkId,
  onFocusLandmark,
}: {
  landmarks: Landmark[];
  panoOrigin: Vec3;
  view: PanoViewState;
  focusedLandmarkId?: string;
  onFocusLandmark: (landmarkId: string, yawDegrees: number, pitchDegrees: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const positions = useMemo(
    () => landmarks
      .filter((landmark) => landmark.visible)
      .map((landmark) => projectLandmarkToScreen({
        landmark,
        panoOrigin,
        view,
        viewportWidth: size.width,
        viewportHeight: size.height,
      })),
    [landmarks, panoOrigin, size.height, size.width, view],
  );

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
      {positions.map((position) => {
        const landmark = landmarks.find((item) => item.id === position.landmarkId);
        if (!landmark || !position.visible) return null;
        const focused = focusedLandmarkId === landmark.id;
        return (
          <button
            key={landmark.id}
            type="button"
            title={landmark.displayName}
            onClick={() => onFocusLandmark(landmark.id, position.yawDegrees, position.pitchDegrees)}
            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-full transition-transform ${
              focused ? 'scale-110' : 'hover:scale-105'
            }`}
            style={{
              left: `${position.x * 100}%`,
              top: `${position.y * 100}%`,
            }}
          >
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-[0_4px_14px_var(--accent-glow)] ${
                focused
                  ? 'border-white bg-[var(--accent)] text-white'
                  : 'border-white/90 bg-[var(--accent)]/85 text-white'
              }`}
            >
              <MapPin className="h-4 w-4" fill="currentColor" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LandmarkStrip({
  landmarks,
  panoImageUrl,
  panoOrigin,
  focusedLandmarkId,
  onFocusLandmark,
}: {
  landmarks: Landmark[];
  panoImageUrl?: string;
  panoOrigin: Vec3;
  focusedLandmarkId?: string;
  onFocusLandmark: (landmarkId: string) => void;
}) {
  if (landmarks.length === 0) return null;

  return (
    <div className="pointer-events-auto mx-3 mb-3 flex shrink-0 items-center gap-2 rounded-full border border-subtle bg-surface-overlay/90 px-3 py-1.5 shadow-soft backdrop-blur">
      <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-secondary">
        <MapPin className="h-3.5 w-3.5 text-accent" />
        <span className="hidden sm:inline">Landmarks</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {landmarks.map((landmark) => {
          const focused = focusedLandmarkId === landmark.id;
          const backgroundPosition = landmarkStripBackgroundPosition(landmark.position, panoOrigin);
          return (
            <button
              key={landmark.id}
              type="button"
              title={landmark.displayName}
              onClick={() => onFocusLandmark(landmark.id)}
              className={`group flex shrink-0 items-center gap-1.5 rounded-full px-1 py-0.5 transition ${
                focused ? 'bg-accent-soft ring-1 ring-[var(--accent)]' : 'hover:bg-surface-muted'
              }`}
            >
              <div
                className={`h-8 w-11 overflow-hidden rounded-md border bg-surface-muted ${
                  focused ? 'border-[var(--accent)]' : 'border-subtle'
                }`}
                style={panoImageUrl ? {
                  backgroundImage: `url(${panoImageUrl})`,
                  backgroundSize: '320% 100%',
                  backgroundPosition,
                } : undefined}
              >
                {!panoImageUrl && (
                  <div className="flex h-full w-full items-center justify-center text-muted">
                    <MapPin className="h-3 w-3" />
                  </div>
                )}
              </div>
              <span className="max-w-20 truncate text-[10px] font-medium text-secondary group-hover:text-primary">
                {landmark.displayName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}