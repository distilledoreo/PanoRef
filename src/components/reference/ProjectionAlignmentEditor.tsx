import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanoReference, ProjectionAlignment, ProjectionControlPair, Vec2 } from '../../domain/types';
import { PanoViewer, PanoViewerMarker } from '../viewers/PanoViewer';
import { createId } from '../../utils/ids';
import { X, Undo2, Trash2, Eye, EyeOff } from 'lucide-react';

interface Props {
  open: boolean;
  sourcePano: PanoReference | undefined;
  sourceImageUrl: string | undefined;
  targetPano: PanoReference | undefined;
  targetImageUrl: string | undefined;
  initialAlignment: ProjectionAlignment | undefined;
  onCancel: () => void;
  onApply: (alignment: ProjectionAlignment) => void;
  onPreviewGeometry: (alignment: ProjectionAlignment) => void;
}

type PairStep = 'idle' | 'pick-target' | 'pick-source';

export function ProjectionAlignmentEditor({
  open,
  sourcePano,
  sourceImageUrl,
  targetPano,
  targetImageUrl,
  initialAlignment,
  onCancel,
  onApply,
  onPreviewGeometry,
}: Props) {
  const [pairs, setPairs] = useState<ProjectionControlPair[]>([]);
  const [step, setStep] = useState<PairStep>('idle');
  const [pendingUv, setPendingUv] = useState<{ targetUv?: Vec2; sourceUv?: Vec2 }>({});
  const [selectedSide, setSelectedSide] = useState<'target' | 'source'>('target');
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const lastActionRef = useRef<{ type: 'add' | 'remove' | 'toggle' | 'clear'; pairs: ProjectionControlPair[] }>({ type: 'clear', pairs: [] });

  useEffect(() => {
    if (open && initialAlignment) {
      setPairs(initialAlignment.pairs.map((p) => ({ ...p })));
    } else if (open) {
      setPairs([]);
    }
    setStep('idle');
    setPendingUv({});
    setShowConfirmClear(false);
  }, [open, initialAlignment]);

  const startAddPair = useCallback(() => {
    setPendingUv({});
    setStep('pick-target');
  }, []);

  const handleTargetPick = useCallback((uv: Vec2) => {
    setPendingUv((prev) => ({ ...prev, targetUv: uv }));
    setStep('pick-source');
  }, []);

  const handleSourcePick = useCallback((uv: Vec2) => {
    setPendingUv((prev) => {
      const targetUv = prev.targetUv;
      if (!targetUv) return prev;
      const pair: ProjectionControlPair = {
        id: createId('pair'),
        targetUv,
        sourceUv: uv,
        enabled: true,
      };
      setPairs((current) => {
        const next = [...current, pair];
        lastActionRef.current = { type: 'add', pairs: next };
        return next;
      });
      setStep('idle');
      return {};
    });
  }, []);

  const undoLast = useCallback(() => {
    if (pairs.length === 0) return;
    setPairs((current) => {
      const next = current.slice(0, -1);
      lastActionRef.current = { type: 'remove', pairs: next };
      return next;
    });
    setStep('idle');
    setPendingUv({});
  }, [pairs.length]);

  const clearAll = useCallback(() => {
    setPairs([]);
    setShowConfirmClear(false);
    setStep('idle');
    setPendingUv({});
    lastActionRef.current = { type: 'clear', pairs: [] };
  }, []);

  const togglePair = useCallback((id: string) => {
    setPairs((current) => {
      const next = current.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p);
      lastActionRef.current = { type: 'toggle', pairs: next };
      return next;
    });
  }, []);

  const removePair = useCallback((id: string) => {
    setPairs((current) => {
      const next = current.filter((p) => p.id !== id);
      lastActionRef.current = { type: 'remove', pairs: next };
      return next;
    });
  }, []);

  const buildAlignment = useCallback((): ProjectionAlignment => {
    const now = new Date().toISOString();
    return {
      sourcePanoId: sourcePano?.id ?? '',
      targetGrayboxPanoId: targetPano?.id ?? '',
      pairs,
      strength: initialAlignment?.strength ?? 1,
      savedAt: now,
    };
  }, [sourcePano, targetPano, pairs, initialAlignment]);

  const handleApply = useCallback(() => {
    if (pairs.length < 1) return;
    onApply(buildAlignment());
  }, [pairs, onApply, buildAlignment]);

  const handlePreview = useCallback(() => {
    if (pairs.filter((p) => p.enabled).length < 3) return;
    onPreviewGeometry(buildAlignment());
  }, [pairs, onPreviewGeometry, buildAlignment]);

  const showUndo = pairs.length > 0 && step === 'idle';
  const enabledCount = pairs.filter((p) => p.enabled).length;

  const targetMarkers: PanoViewerMarker[] = useMemo(() => {
    const result: PanoViewerMarker[] = pairs.map((p, i) => ({
      id: `target-${p.id}`,
      label: `Graybox match ${i + 1}`,
      uv: p.targetUv,
      state: p.enabled ? 'normal' : 'warning',
      side: 'target',
    }));
    if (pendingUv.targetUv && step === 'pick-source') {
      result.push({
        id: 'pending-target',
        label: `Graybox match ${pairs.length + 1}`,
        uv: pendingUv.targetUv,
        state: 'pending',
        side: 'target',
      });
    }
    return result;
  }, [pairs, pendingUv, step]);

  const sourceMarkers: PanoViewerMarker[] = useMemo(() => {
    const result: PanoViewerMarker[] = pairs.map((p, i) => ({
      id: `source-${p.id}`,
      label: `Styled match ${i + 1}`,
      uv: p.sourceUv,
      state: p.enabled ? 'normal' : 'warning',
      side: 'source',
    }));
    if (pendingUv.sourceUv && step === 'idle') {
      const idx = pairs.length;
      result.push({
        id: 'pending-source',
        label: `Styled match ${idx}`,
        uv: pendingUv.sourceUv,
        state: 'pending',
        side: 'source',
      });
    }
    return result;
  }, [pairs, pendingUv, step]);

  if (!open) return null;

  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (pairs.length > 0) {
        if (!window.confirm('Discard your current local fit changes?')) return;
      }
      onCancel();
    }
  };

  const handleEscape = useCallback(() => {
    if (pairs.length > 0) {
      if (!window.confirm('Discard your current local fit changes?')) return;
    }
    onCancel();
  }, [pairs.length, onCancel]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleEscape]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Projection Alignment Editor"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-base font-semibold text-white">Projection Assist</h2>
          <div className="flex items-center gap-2">
            {showUndo && (
              <button
                type="button"
                onClick={undoLast}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/40 hover:text-white"
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </button>
            )}
            {pairs.length > 0 && !showConfirmClear && (
              <button
                type="button"
                onClick={() => setShowConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-sm text-red-300 transition hover:border-red-400 hover:text-red-200"
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </button>
            )}
            {showConfirmClear && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-300">Clear all {pairs.length} pairs?</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-lg bg-red-500/80 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500"
                >
                  Yes, clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmClear(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/40"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleEscape}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/40 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-sm font-medium text-white/80">
                Graybox
                {step === 'pick-target' && (
                  <span className="ml-2 text-amber-300">Click to place the matching point on the graybox</span>
                )}
              </span>
              {selectedSide !== 'target' && (
                <button
                  type="button"
                  onClick={() => setSelectedSide('target')}
                  className="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white/80"
                >
                  Switch to graybox
                </button>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              <PanoViewer
                imageUrl={targetImageUrl}
                view={{ yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 }}
                onViewChange={() => {}}
                panoRotation={targetPano?.rotation}
                label="Graybox 360"
                interactionMode={step === 'pick-target' ? 'pick' : 'navigate'}
                onPickUv={step === 'pick-target' ? handleTargetPick : undefined}
                markers={targetMarkers}
              />
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-sm font-medium text-white/80">
                Styled
                {step === 'pick-source' && (
                  <span className="ml-2 text-amber-300">Click to place the matching point on the styled image</span>
                )}
                {step === 'idle' && pairs.length === 0 && (
                  <span className="ml-2 text-white/50">Click "Add match" to start</span>
                )}
              </span>
              {selectedSide !== 'source' && (
                <button
                  type="button"
                  onClick={() => setSelectedSide('source')}
                  className="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white/80"
                >
                  Switch to styled
                </button>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              <PanoViewer
                imageUrl={sourceImageUrl}
                view={{ yawDegrees: 0, pitchDegrees: 0, fovDegrees: 65 }}
                onViewChange={() => {}}
                panoRotation={sourcePano?.rotation}
                label="Styled 360"
                interactionMode={step === 'pick-source' ? 'pick' : 'navigate'}
                onPickUv={step === 'pick-source' ? handleSourcePick : undefined}
                markers={sourceMarkers}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {step === 'idle' && (
                <button
                  type="button"
                  onClick={startAddPair}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
                >
                  + Add match
                </button>
              )}
              {step !== 'idle' && (
                <button
                  type="button"
                  onClick={() => { setStep('idle'); setPendingUv({}); }}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  Cancel
                </button>
              )}
              <div className="flex flex-wrap gap-1.5">
                {pairs.map((pair, i) => (
                  <div
                    key={pair.id}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition ${
                      pair.enabled
                        ? 'border-accent/60 bg-accent/10 text-accent'
                        : 'border-white/10 text-white/50'
                    }`}
                  >
                    <span>{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => togglePair(pair.id)}
                      className="hover:text-white/80"
                      aria-label={pair.enabled ? 'Disable pair' : 'Enable pair'}
                    >
                      {pair.enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePair(pair.id)}
                      className="hover:text-red-400"
                      aria-label={`Remove pair ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEscape}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={enabledCount < 3}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Preview ({Math.max(0, 3 - enabledCount)} more needed)
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={pairs.length < 1}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent/80 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Use improved projection
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
