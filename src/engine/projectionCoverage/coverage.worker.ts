/// <reference lib="webworker" />

import { optimizeProjectionCoverage } from './optimizer';
import type { CoverageOptimizationRequest } from './types';

interface WorkerRequest {
  id: string;
  request: CoverageOptimizationRequest;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, type: 'progress', progress: 0.05, message: 'Building geometry acceleration…' });
    const result = optimizeProjectionCoverage(request);
    self.postMessage({ id, type: 'complete', result });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};

