import type { PeopleExportMode } from '../domain/types';

export type PeopleRenderVariant = 'with_people' | 'clean_plate';

export function normalizePeopleExportMode(mode?: PeopleExportMode): PeopleExportMode {
  return mode === 'clean_plate' || mode === 'both' ? mode : 'with_people';
}

export function getPeopleRenderVariants(mode?: PeopleExportMode): PeopleRenderVariant[] {
  const normalized = normalizePeopleExportMode(mode);
  if (normalized === 'both') return ['with_people', 'clean_plate'];
  return [normalized];
}

export function peopleVariantLabel(variant: PeopleRenderVariant): string {
  return variant === 'clean_plate' ? 'clean plate' : 'with people';
}

export function getPeopleVariantPath(
  path: string,
  variant: PeopleRenderVariant,
  mode?: PeopleExportMode,
): string {
  const normalized = normalizePeopleExportMode(mode);
  if (normalized === 'with_people' && variant === 'with_people') return path;
  const suffix = variant === 'clean_plate' ? '_clean_plate' : '_with_people';
  const extensionIndex = path.lastIndexOf('.');
  if (extensionIndex < 0) return `${path}${suffix}`;
  return `${path.slice(0, extensionIndex)}${suffix}${path.slice(extensionIndex)}`;
}
