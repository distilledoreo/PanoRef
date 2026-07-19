import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import {
  getDefaultShotTitle,
  getShotDisplayName,
  getShotPrimaryLabel,
  normalizeProductionShotId,
  normalizeShotTitle,
} from '../src/domain/shotIdentity';

describe('shot identity', () => {
  it('normalizes whitespace-only production IDs to undefined', () => {
    expect(normalizeProductionShotId('  42A  ')).toBe('42A');
    expect(normalizeProductionShotId('   ')).toBeUndefined();
    expect(normalizeProductionShotId(undefined)).toBeUndefined();
  });

  it('uses production ID as the primary label when present', () => {
    const project = createDefaultProject();
    const shot = {
      ...project.shots[0],
      productionShotId: '42A',
      name: 'Courtyard entrance',
    };

    expect(getShotPrimaryLabel(shot)).toBe('42A');
    expect(getShotDisplayName(shot)).toBe('42A · Courtyard entrance');
  });

  it('falls back to the PanoRef sequence when no production ID is set', () => {
    const project = createDefaultProject();
    const shot = {
      ...project.shots[0],
      shotNumber: '020',
      name: 'Courtyard entrance',
    };

    expect(getShotPrimaryLabel(shot)).toBe('Shot 020');
    expect(getShotDisplayName(shot)).toBe('Shot 020 · Courtyard entrance');
  });

  it('normalizes empty titles back to the default camera label', () => {
    const project = createDefaultProject();
    const shot = { ...project.shots[0], shotNumber: '020' };

    expect(getDefaultShotTitle(shot)).toBe('Camera 020');
    expect(normalizeShotTitle(shot, '   ')).toBe('Camera 020');
    expect(normalizeShotTitle(shot, ' Doorway ')).toBe('Doorway');
  });
});
