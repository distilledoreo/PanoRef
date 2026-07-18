import type { ProjectionRegionAlignment } from '../domain/types';
import { generateProjectionRegionTexture, type ProjectionRegionTextureQuality, type ProjectionRegionTextureResult } from '../engine/projectionRegionTexture';

export class ProjectionRegionWorkerCoordinator {
  private latestJob = 0;
  async generate(alignment: ProjectionRegionAlignment, options: { sourceYawRadians: number; targetYawRadians: number; quality: ProjectionRegionTextureQuality }): Promise<ProjectionRegionTextureResult | undefined> {
    const job = ++this.latestJob;
    await Promise.resolve();
    const result = generateProjectionRegionTexture(alignment, options);
    if (job !== this.latestJob) { result.release(); return undefined; }
    return result;
  }
  invalidate(): void { this.latestJob += 1; }
}
