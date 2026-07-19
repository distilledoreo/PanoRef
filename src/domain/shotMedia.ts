import { LocationProject, ProjectAsset, Shot } from './types';

export type ShotMediaSource =
  | 'camera_move'
  | 'captured_still'
  | 'ai_result'
  | 'final_frame'
  | 'pano_crop';

export interface ShotMediaItem {
  id: string;
  asset: ProjectAsset;
  kind: 'image' | 'video';
  label: string;
  source: ShotMediaSource;
}

const shotMediaPriority: Array<{
  key: keyof Shot['assets'];
  source: ShotMediaSource;
  label: string;
  kind: 'image' | 'video';
}> = [
  { key: 'cameraMoveVideoAssetId', source: 'camera_move', label: 'Camera move', kind: 'video' },
  { key: 'viewportRenderAssetId', source: 'captured_still', label: 'Captured still', kind: 'image' },
  { key: 'aiResultFrameAssetId', source: 'ai_result', label: 'AI result', kind: 'image' },
  { key: 'finalBaseFrameAssetId', source: 'final_frame', label: 'Final frame', kind: 'image' },
  { key: 'panoCropAssetId', source: 'pano_crop', label: 'Pano crop', kind: 'image' },
];

function resolveAsset(
  project: LocationProject,
  assetId?: string,
): ProjectAsset | undefined {
  if (!assetId) return undefined;
  return project.assets.assets[assetId];
}

/**
 * Strict camera-roll media list — only assets actually captured or attached to the shot.
 * Linked/canonical panoramas are intentionally excluded.
 */
export function resolveShotMedia(project: LocationProject, shot: Shot): ShotMediaItem[] {
  const items: ShotMediaItem[] = [];

  for (const candidate of shotMediaPriority) {
    const asset = resolveAsset(project, shot.assets[candidate.key]);
    if (!asset) continue;
    const kind = asset.type === 'video' ? 'video' : candidate.kind;
    items.push({
      id: `${shot.id}:${candidate.source}`,
      asset,
      kind,
      label: candidate.label,
      source: candidate.source,
    });
  }

  return items;
}

/** First camera-roll media item suitable for reel thumbnails. */
export function resolveShotMediaPoster(
  project: LocationProject,
  shot: Shot,
): ShotMediaItem | undefined {
  return resolveShotMedia(project, shot)[0];
}

export function getShotMediaCount(project: LocationProject, shot: Shot): number {
  return resolveShotMedia(project, shot).length;
}

export function hasShotCapture(project: LocationProject, shot: Shot): boolean {
  return getShotMediaCount(project, shot) > 0;
}
