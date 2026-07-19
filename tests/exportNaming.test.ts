import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain/defaults';
import {
  assignShotPackageRootFolders,
  findDuplicateProductionShotIds,
  getShotCaptureDownloadBaseName,
  getShotDisplayIdentifier,
  getShotPackageBaseName,
  getViewportStillDownloadName,
  sanitizeExportSegment,
  sanitizeProductionIdSegment,
} from '../src/engine/exportNaming';

describe('export naming', () => {
  it('builds production-aware package names', () => {
    const project = createDefaultProject();
    const shot = {
      ...project.shots[0],
      shotNumber: '020',
      productionShotId: '42A',
      name: 'Courtyard Entrance',
    };

    expect(getShotDisplayIdentifier(shot)).toBe('42A');
    expect(getShotPackageBaseName(shot)).toBe('42A_courtyard_entrance');
    expect(getShotCaptureDownloadBaseName({
      ...shot,
      productionShotId: undefined,
      name: 'Courtyard Entrance',
    })).toBe('shot_020_courtyard_entrance');
  });

  it('omits generated default titles from package names', () => {
    const project = createDefaultProject();
    const untouched = {
      ...project.shots[0],
      shotNumber: '020',
      name: 'Camera 020',
    };
    const productionOnly = {
      ...untouched,
      productionShotId: '42A',
    };

    expect(getShotPackageBaseName(untouched)).toBe('shot_020');
    expect(getShotPackageBaseName(productionOnly)).toBe('42A');
  });

  it('sanitizes punctuation, spaces, and unicode', () => {
    expect(sanitizeExportSegment(' SC_120 ')).toBe('sc_120');
    expect(sanitizeExportSegment('Café façade')).toBe('cafe_facade');
    expect(sanitizeExportSegment('   ')).toBe('untitled');
    expect(sanitizeProductionIdSegment('42A')).toBe('42A');
    expect(sanitizeProductionIdSegment(' SC_120 ')).toBe('SC_120');
  });

  it('suffixes duplicate package folders without blocking export', () => {
    const project = createDefaultProject();
    const first = {
      ...project.shots[0],
      id: 'shot-a',
      productionShotId: '42A',
      name: 'Courtyard entrance',
    };
    const second = {
      ...project.shots[0],
      id: 'shot-b',
      productionShotId: '42A',
      name: 'Courtyard entrance',
    };

    expect(findDuplicateProductionShotIds([first, second])).toEqual(['42A']);
    expect(assignShotPackageRootFolders([first, second]).map((item) => item.rootFolder)).toEqual([
      '42A_courtyard_entrance',
      '42A_courtyard_entrance_2',
    ]);
  });

  it('treats blank production IDs as absent', () => {
    const project = createDefaultProject();
    const shot = {
      ...project.shots[0],
      shotNumber: '020',
      productionShotId: '   ',
      name: 'Courtyard Entrance',
    };

    expect(getShotPackageBaseName(shot)).toBe('shot_020_courtyard_entrance');
    expect(findDuplicateProductionShotIds([shot])).toEqual([]);
  });

  it('builds direct capture download names from production metadata', () => {
    const project = createDefaultProject();
    const shot = {
      ...project.shots[0],
      productionShotId: '42A',
      name: 'Courtyard entrance',
    };

    expect(getViewportStillDownloadName(shot)).toBe('42A_courtyard_entrance_viewport.png');
    expect(getShotCaptureDownloadBaseName({
      ...shot,
      productionShotId: undefined,
      shotNumber: '020',
      name: 'Courtyard Entrance',
    })).toBe('shot_020_courtyard_entrance');
  });
});
