import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin, Sparkles, Wrench } from 'lucide-react';
import { useThemeStore } from '../../state/useThemeStore';
import { useContinuityStore } from '../../state/useContinuityStore';
import { downloadDataUrl } from '../../engine/projectIO';
import { downloadPanoImage } from '../../engine/panoImage';
import {
  estimateRemainingSeconds,
  formatDurationSeconds,
  prepareSuggestedSecondCapture,
  SUGGESTED_CAPTURE_ANALYSIS_ETA_SECONDS,
  SUGGESTED_CAPTURE_RENDER_ETA_SECONDS,
  type SuggestedSecondCapturePhase,
  type SuggestedSecondCaptureProgress,
  type SuggestedSecondCaptureTask,
} from '../../engine/prepareSuggestedSecondCapture';
import { ContextualPanel } from './ContextualPanel';
import { StyledPanoImportButton } from './StyledPanoImportButton';

type ForkStep = 'choose' | 'place_method' | 'running' | 'awaiting_import' | 'failed';

export function SecondCaptureForkContent({
  open,
  onClose,
  onContinue,
  onAwaitingImport,
  onPlaceInBuild,
  compactIntro = false,
}: {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAwaitingImport: () => void;
  /** Called after switching to Build origin mode (default closes). */
  onPlaceInBuild?: () => void;
  /** Hide the small “Reference ready” eyebrow when the parent modal already titles the step. */
  compactIntro?: boolean;
}) {
  const project = useContinuityStore((state) => state.project);
  const setPanoOrigin = useContinuityStore((state) => state.setPanoOrigin);
  const setWorkspace = useContinuityStore((state) => state.setWorkspace);
  const setBuildMode = useContinuityStore((state) => state.setBuildMode);
  const theme = useThemeStore((state) => state.theme);

  const [step, setStep] = useState<ForkStep>('choose');
  const [progress, setProgress] = useState<SuggestedSecondCaptureProgress | undefined>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const taskRef = useRef<SuggestedSecondCaptureTask | undefined>();
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      taskRef.current?.cancel();
      taskRef.current = undefined;
      setStep('choose');
      setProgress(undefined);
      setElapsedMs(0);
      setError(undefined);
    }
  }, [open]);

  useEffect(() => {
    if (step !== 'running') return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    return () => window.clearInterval(id);
  }, [step]);

  if (!open) return null;

  const phaseDefault = progress?.phase === 'rendering' || progress?.phase === 'moving_origin'
    ? SUGGESTED_CAPTURE_RENDER_ETA_SECONDS
    : SUGGESTED_CAPTURE_ANALYSIS_ETA_SECONDS;
  const remainingSeconds = progress
    ? estimateRemainingSeconds({
      elapsedMs,
      progress: progress.progress,
      phaseDefaultSeconds: phaseDefault,
    })
    : SUGGESTED_CAPTURE_ANALYSIS_ETA_SECONDS
      + SUGGESTED_CAPTURE_RENDER_ETA_SECONDS;

  const startAutoSuggest = () => {
    taskRef.current?.cancel();
    setError(undefined);
    setStep('running');
    setProgress({
      phase: 'preparing',
      progress: 0.01,
      message: 'Starting coverage analysis…',
    });
    startedAtRef.current = Date.now();
    setElapsedMs(0);

    const task = prepareSuggestedSecondCapture(project, theme, (next) => {
      setProgress(next);
    });
    taskRef.current = task;

    void task.promise.then(async (result) => {
      if (taskRef.current !== task) return;
      setPanoOrigin(result.originB);
      try {
        await downloadPanoImage(
          result.projected.dataUrl,
          result.projected.width,
          result.projected.height,
          'projected_360_second_capture.png',
          {
            letterboxEnabled: false,
            targetWidth: project.settings.defaultShotWidth,
            targetHeight: project.settings.defaultShotHeight,
          },
          downloadDataUrl,
        );
      } catch {
        // Origin is still moved; user can re-download from Build if needed.
      }
      taskRef.current = undefined;
      setStep('awaiting_import');
      onAwaitingImport();
    }).catch((err) => {
      if (taskRef.current !== task) return;
      taskRef.current = undefined;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not suggest a second vantage.');
      setStep('failed');
    });
  };

  const cancelRunning = () => {
    taskRef.current?.cancel();
    taskRef.current = undefined;
    setStep('place_method');
    setProgress(undefined);
  };

  const goPlaceInBuild = () => {
    setBuildMode('pano_origin');
    setWorkspace('build');
    onPlaceInBuild?.();
    onClose();
  };

  return (
    <div className="space-y-3" data-second-capture-fork>
      {step === 'choose' && (
        <>
          <div>
            {!compactIntro && (
              <div className="text-xs font-semibold uppercase tracking-wide text-secondary">Reference ready</div>
            )}
            <p className={`text-sm text-primary ${compactIntro ? '' : 'mt-1'}`}>
              Continue with this capture, or add a second vantage to fill areas that look thin far from the origin.
            </p>
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
            data-second-capture-continue
          >
            Continue with this reference
          </button>
          <button
            type="button"
            onClick={() => setStep('place_method')}
            className="w-full rounded-lg border border-subtle px-3 py-2.5 text-sm font-medium text-primary transition hover:border-[var(--accent)] hover:text-accent"
            data-second-capture-fill-gaps
          >
            Fill missing areas
          </button>
          <p className="text-[11px] leading-snug text-muted">
            Projection is strongest near this capture. Distant walls and corners can look weak — a second vantage fills those gaps when blended.
          </p>
        </>
      )}

      {step === 'place_method' && (
        <>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-secondary">Second vantage</div>
            <p className="mt-1 text-sm text-primary">
              How do you want to pick the next capture point?
            </p>
          </div>
          <button
            type="button"
            onClick={startAutoSuggest}
            className="flex w-full items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
            data-second-capture-suggest
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Suggest a spot for me
              <span className="mt-0.5 block text-[11px] font-normal text-white/85">
                Finds a complementary origin, moves capture there, and downloads a projected 360 seed.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={goPlaceInBuild}
            className="flex w-full items-center gap-2 rounded-lg border border-subtle px-3 py-2.5 text-left text-sm font-medium text-primary transition hover:border-[var(--accent)] hover:text-accent"
            data-second-capture-place-build
          >
            <Wrench className="h-4 w-4 shrink-0" />
            <span>
              I&apos;ll place it in Build
              <span className="mt-0.5 block text-[11px] font-normal text-muted">
                Opens Origin mode so you can move the capture yourself.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setStep('choose')}
            className="text-xs font-medium text-secondary hover:text-accent"
          >
            Back
          </button>
        </>
      )}

      {step === 'running' && (
        <div className="space-y-3" data-second-capture-progress aria-live="polite">
          <div className="flex items-start gap-2">
            <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />
            <div>
              <div className="text-sm font-semibold text-primary">
                {phaseLabel(progress?.phase)}
              </div>
              <p className="mt-0.5 text-xs text-secondary">
                {progress?.message ?? 'Working…'}
              </p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${Math.round((progress?.progress ?? 0.05) * 100)}%` }}
              data-second-capture-progress-bar
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span data-second-capture-eta>
              About {formatDurationSeconds(remainingSeconds)} remaining
              <span className="text-secondary"> · {formatElapsed(elapsedMs)} elapsed</span>
            </span>
            <span>{Math.round((progress?.progress ?? 0) * 100)}%</span>
          </div>
          <p className="text-[11px] leading-snug text-muted">
            Coverage search can take half a minute on larger sets — the app is still working.
          </p>
          <button
            type="button"
            onClick={cancelRunning}
            className="text-xs font-medium text-secondary hover:text-accent"
            data-second-capture-cancel
          >
            Cancel
          </button>
        </div>
      )}

      {step === 'awaiting_import' && (
        <>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary">
              <MapPin className="h-3.5 w-3.5 text-accent" />
              Ready for second capture
            </div>
            <p className="mt-1 text-sm text-primary">
              Capture origin moved to the suggested spot. A projected 360 seed was downloaded — style or inpaint it, then import here to blend.
            </p>
          </div>
          <StyledPanoImportButton
            modeAware
            primary
            onImported={(mode) => {
              if (mode === 'add_secondary') {
                onAwaitingImport();
                onClose();
              }
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-secondary hover:text-accent"
          >
            Dismiss
          </button>
        </>
      )}

      {step === 'failed' && (
        <>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error ?? 'Could not suggest a second vantage.'}
          </p>
          <p className="text-xs text-secondary">
            You can place the second origin manually in Build instead.
          </p>
          <button
            type="button"
            onClick={goPlaceInBuild}
            className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-semibold text-white"
            data-second-capture-fallback-build
          >
            Place in Build
          </button>
          <button
            type="button"
            onClick={() => setStep('place_method')}
            className="text-xs font-medium text-secondary hover:text-accent"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}

export function SecondCaptureForkPanel({
  open,
  onClose,
  onContinue,
  onAwaitingImport,
}: {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAwaitingImport: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-x-3 top-3 z-30 mx-auto max-w-md sm:inset-x-auto sm:left-5 sm:right-auto"
      data-second-capture-fork-panel
    >
      <ContextualPanel className="shadow-soft">
        <SecondCaptureForkContent
          open={open}
          onClose={onClose}
          onContinue={onContinue}
          onAwaitingImport={onAwaitingImport}
        />
      </ContextualPanel>
    </div>
  );
}

function phaseLabel(phase?: SuggestedSecondCapturePhase): string {
  switch (phase) {
    case 'preparing':
      return 'Preparing geometry…';
    case 'analyzing':
      return 'Finding a second vantage…';
    case 'moving_origin':
      return 'Moving capture origin…';
    case 'rendering':
      return 'Rendering projected 360…';
    case 'complete':
      return 'Done';
    case 'failed':
      return 'Something went wrong';
    default:
      return 'Working…';
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
