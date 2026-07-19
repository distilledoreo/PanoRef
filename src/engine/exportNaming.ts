import { getShotDisplayName } from '../domain/shotIdentity';
import { Shot } from '../domain/types';

/** Sanitize a path/filename segment for export packages. */
export function sanitizeExportSegment(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return normalized || 'untitled';
}

/** Production-aware identifier used in folder and ZIP names. */
export function getShotDisplayIdentifier(shot: Shot): string {
  return shot.productionShotId?.trim() || `shot_${shot.shotNumber}`;
}

/** Root folder / package base name, optionally suffixed with the descriptive title. */
export function getShotPackageBaseName(shot: Shot): string {
  const identifier = sanitizeExportSegment(getShotDisplayIdentifier(shot));
  const title = shot.name.trim();
  if (!title) return identifier;
  return `${identifier}_${sanitizeExportSegment(title)}`;
}

export function getShotExportProgressLabel(shot: Shot): string {
  return getShotDisplayName(shot);
}

export interface ShotPackageFolderAssignment {
  shotId: string;
  rootFolder: string;
  baseName: string;
}

/**
 * Assign unique package root folders for a shot selection.
 * Colliding sanitized names receive numeric suffixes: `_2`, `_3`, etc.
 */
export function assignShotPackageRootFolders(shots: Shot[]): ShotPackageFolderAssignment[] {
  const used = new Map<string, number>();
  return shots.map((shot) => {
    const baseName = getShotPackageBaseName(shot);
    const seen = used.get(baseName) ?? 0;
    used.set(baseName, seen + 1);
    const rootFolder = seen === 0 ? baseName : `${baseName}_${seen + 1}`;
    return { shotId: shot.id, rootFolder, baseName };
  });
}

/** Production IDs that appear on more than one selected shot (after trim). */
export function findDuplicateProductionShotIds(shots: Shot[]): string[] {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    const id = shot.productionShotId?.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
}

export function getShotCaptureDownloadBaseName(shot: Shot): string {
  return getShotPackageBaseName(shot);
}

export function getViewportStillDownloadName(shot: Shot): string {
  return `${getShotCaptureDownloadBaseName(shot)}_viewport.png`;
}

export function getProjectedStillDownloadName(shot: Shot): string {
  return `${getShotCaptureDownloadBaseName(shot)}_viewport_projected.png`;
}

export function getCameraMoveDownloadName(shot: Shot): string {
  return `${getShotCaptureDownloadBaseName(shot)}_camera_move.mp4`;
}

export function getProjectedCameraMoveDownloadName(shot: Shot): string {
  return `${getShotCaptureDownloadBaseName(shot)}_camera_move_projected.mp4`;
}