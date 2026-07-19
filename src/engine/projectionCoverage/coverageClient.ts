import type { CoverageOptimizationRequest, CoverageOptimizationResult } from './types';

export interface CoverageOptimizationTask {
  promise: Promise<CoverageOptimizationResult>;
  cancel(): void;
}

export function runCoverageOptimization(
  request: CoverageOptimizationRequest,
  onProgress?: (progress: number, message: string) => void,
): CoverageOptimizationTask {
  const worker = new Worker(new URL('./coverage.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  let settled = false;
  let rejectTask: (reason?: unknown) => void = () => undefined;

  const promise = new Promise<CoverageOptimizationResult>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{
      id: string;
      type: 'progress' | 'complete' | 'error';
      progress?: number;
      message?: string;
      result?: CoverageOptimizationResult;
    }>) => {
      if (event.data.id !== id || settled) return;
      if (event.data.type === 'progress') {
        onProgress?.(event.data.progress ?? 0, event.data.message ?? 'Analyzing coverage…');
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === 'complete' && event.data.result) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.message ?? 'Coverage analysis failed.'));
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(event.message || 'Coverage analysis worker failed.'));
    };
    worker.postMessage({ id, request });
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectTask(new DOMException('Coverage analysis was cancelled.', 'AbortError'));
    },
  };
}

