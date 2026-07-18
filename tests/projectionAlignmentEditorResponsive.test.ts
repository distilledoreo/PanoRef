import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/components/reference/ProjectionAlignmentEditor.tsx', import.meta.url), 'utf8');

describe('Projection Assist responsive editor contract', () => {
  it('uses one-column mobile layout and two viewers on desktop', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain('md:grid-cols-2');
    expect(source).toContain("mobilePane !== 'graybox' ? 'hidden' : 'flex'");
    expect(source).toContain("mobilePane !== 'styled' ? 'hidden' : 'flex'");
  });

  it('keeps the shared view while switching the mobile segmented control', () => {
    expect(source).toContain("setMobilePane('graybox')");
    expect(source).toContain("setMobilePane('styled')");
    expect(source).toContain('view={sharedView}');
    expect(source).toContain('setSharedView((current) => ({ ...current, ...update }))');
  });

  it('automatically changes tabs after target and source picks', () => {
    expect(source).toContain('updateDraft((current) => addTargetPick(current, uv));');
    expect(source).toContain('updateDraft((current) => completeSourcePick(current, uv));');
    expect(source).toContain("setMobilePane('styled');");
    expect(source).toContain("setMobilePane('graybox');");
  });
});

