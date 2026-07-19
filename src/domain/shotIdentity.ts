import { Shot } from './types';

/** Trim and drop whitespace-only production IDs for backward-compatible loading. */
export function normalizeProductionShotId(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Primary label: production ID when set, otherwise the PanoRef sequence label. */
export function getShotPrimaryLabel(shot: Shot): string {
  return shot.productionShotId ?? `Shot ${shot.shotNumber}`;
}

/** Human-facing shot label: `42A · Courtyard entrance` or `Shot 020 · Courtyard entrance`. */
export function getShotDisplayName(shot: Shot): string {
  const primary = getShotPrimaryLabel(shot);
  const title = shot.name.trim();
  if (!title) return primary;
  return `${primary} · ${title}`;
}

export function getDefaultShotTitle(shot: Shot): string {
  return `Camera ${shot.shotNumber}`;
}

/** Normalize a user-edited title; empty input reverts to the default camera label. */
export function normalizeShotTitle(shot: Shot, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : getDefaultShotTitle(shot);
}
