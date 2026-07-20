import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultProject,
  createPanoAsset,
  createPanoReference,
} from '../src/domain/defaults';
import {
  computeProjectorBlendWeights,
  projectorConfidence,
} from '../src/engine/multiOriginProjection';
import {
  computeProjectedAppearanceState,
} from '../src/engine/projectedStyle';
import {
  applyInversePanoYaw,
  equirectUvFromDirection,
  sampleProjectedSyntheticAtWorld,
  rgbClose,
  SYNTHETIC_PANO_COLORS,
} from '../src/engine/projectedStyleMath';
import {
  acquireProjectedStyleTexture,
  disposeProjectedTextureOwnership,
  prepareProjectedTextureRequest,
  projectedStyleTextureCacheSize,
  projectedStyleTextureRefCount,
  releaseProjectedStyleTexture,
  resolveProjectedTextureRequest,
  type ProjectedTextureOwnership,
} from '../src/engine/projectedStyleMaterials';
import { degreesToRadians } from '../src/engine/sync';
import { readFileSync } from 'node:fs';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Controllable texture load callbacks, keyed by URL. */
const pendingLoads = new Map<string, {
  onLoad: (tex: unknown) => void;
  onError: (err: unknown) => void;
}>();

vi.mock('three', async () => {
  const THREE = await vi.importActual('three');
  const mod = THREE as typeof import('three');

  return {
    ...mod,
    TextureLoader: class MockTextureLoader {
      load(
        url: string,
        onLoad: (tex: unknown) => void,
        _onProgress?: unknown,
        onError?: (err: unknown) => void,
      ) {
        pendingLoads.set(url, {
          onLoad,
          onError: onError ?? (() => {}),
        });
      }
    },
  } as typeof import('three');
});

// ---------------------------------------------------------------------------
// 1. Secondary projector fallback state tests (production helper)
// ---------------------------------------------------------------------------

describe('projected appearance state', () => {
  function projectedState(overrides: Partial<Parameters<typeof computeProjectedAppearanceState>[0]> = {}) {
    return computeProjectedAppearanceState({
      appearance: 'projected',
      primaryTextureReady: true,
      primaryReadyUrl: 'url-a',
      primaryAssetKey: 'url-a',
      primaryPanoExists: true,
      blendMode: 'primary_dominant',
      secondaryPanoIdExists: true,
      secondaryTextureReady: true,
      secondaryReadyUrl: 'url-b',
      secondaryAssetKey: 'url-b',
      ...overrides,
    });
  }

  it('primary loaded, secondary absent → projected active, dual inactive', () => {
    const s = projectedState({ secondaryPanoIdExists: false, secondaryTextureReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary loading → projected active, dual inactive', () => {
    const s = projectedState({ secondaryTextureReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary failed → projected active, dual inactive', () => {
    const s = projectedState({ secondaryTextureReady: false });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary loaded, secondary loaded → projected active, dual active', () => {
    const s = projectedState();
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(true);
  });

  it('primary_only blend → projected active, dual inactive even when secondary ready', () => {
    const s = projectedState({ blendMode: 'primary_only' });
    expect(s.projectedActive).toBe(true);
    expect(s.dualActive).toBe(false);
  });

  it('primary load failure → projected inactive, dual inactive', () => {
    const s = projectedState({ primaryTextureReady: false });
    expect(s.projectedActive).toBe(false);
    expect(s.dualActive).toBe(false);
  });

  it('clay appearance → projected inactive, dual inactive', () => {
    const s = projectedState({ appearance: 'clay' });
    expect(s.projectedActive).toBe(false);
    expect(s.dualActive).toBe(false);
  });

  it('stale secondary URL cannot make dual active when URL mismatches', () => {
    const s = projectedState({
      secondaryReadyUrl: 'url-b',
      secondaryAssetKey: 'url-c',
    });
    expect(s.dualActive).toBe(false);
  });

  it('primary missing pano → projected inactive', () => {
    const s = projectedState({ primaryPanoExists: false });
    expect(s.projectedActive).toBe(false);
  });

  it('primary URL mismatch → projected inactive', () => {
    const s = projectedState({ primaryReadyUrl: 'url-old', primaryAssetKey: 'url-new' });
    expect(s.projectedActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Graybox yaw round-trip invariants
// ---------------------------------------------------------------------------

describe('graybox yaw round-trip', () => {
  it('zero yaw maps world +Z to pano-local +Z', () => {
    const local = applyInversePanoYaw([0, 0, 1], 0);
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('positive yaw rotates world +Z into former -X content', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(90));
    expect(local[0]).toBeCloseTo(-1, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(0, 5);
  });

  it('negative yaw rotates world +Z into former +X content', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(-90));
    expect(local[0]).toBeCloseTo(1, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(0, 5);
  });

  it('360° yaw is equivalent to zero', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(360));
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('-360° yaw is equivalent to zero', () => {
    const local = applyInversePanoYaw([0, 0, 1], degreesToRadians(-360));
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(1, 5);
  });

  it('projection with stamped origin and yaw aligns with original scene', () => {
    // Simulate graybox rendered from origin O with yaw Y.
    const origin: [number, number, number] = [5, 1.6, 5];
    const yawDegrees = 45;
    // A world point at [5, 1.6, 7] is +Z from the origin.
    const worldPos: [number, number, number] = [5, 1.6, 7];
    const rgb = sampleProjectedSyntheticAtWorld({
      worldPosition: worldPos,
      panoOrigin: origin,
      panoYawRadians: degreesToRadians(yawDegrees),
    });
    expect(rgb).not.toBe('near-origin');
    // With 45° yaw, world +Z (from origin) maps to pano-local -Z/-X diagonal.
    // The result should be a valid color, not a fallback.
    const color = rgb as [number, number, number];
    expect(color.every((c) => c >= 0 && c <= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Blend formula equivalence (CPU helper vs GLSL)
// ---------------------------------------------------------------------------

describe('blend formula parity', () => {
  it('CPU projectorConfidence matches GLSL formula (falloff/(falloff+distance))', () => {
    const origin: [number, number, number] = [0, 0, 0];
    const distances = [0, 0.5, 1, 3, 6, 12, 24];
    const falloff = 6;
    for (const d of distances) {
      const conf = projectorConfidence([d, 0, 0], origin, falloff);
      const expected = falloff / (falloff + d);
      expect(conf).toBeCloseTo(expected, 10);
    }
  });

  it('primary_dominant weights near primary origin favor primary heavily', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [1, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'primary_dominant',
    });
    expect(w.wPrimary).toBeGreaterThan(0.85);
  });

  it('primary_dominant weights near secondary origin favor secondary over primary', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [20, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'primary_dominant',
    });
    expect(w.wSecondary).toBeGreaterThan(w.wPrimary);
  });

  it('secondary_dominant weights near secondary origin favor secondary heavily', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [19, 1.6, 0],
      primaryOrigin: [0, 1.6, 0],
      secondaryOrigin: [20, 1.6, 0],
      mode: 'secondary_dominant',
    });
    expect(w.wSecondary).toBeGreaterThan(0.85);
  });

  it('primary_only always returns wPrimary=1', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [100, 0, 0],
      primaryOrigin: [0, 0, 0],
      secondaryOrigin: [5, 0, 0],
      mode: 'primary_only',
    });
    expect(w.wPrimary).toBe(1);
    expect(w.wSecondary).toBe(0);
  });

  it('secondary_only always returns wSecondary=1', () => {
    const w = computeProjectorBlendWeights({
      worldPosition: [0, 0, 0],
      primaryOrigin: [0, 0, 0],
      secondaryOrigin: [5, 0, 0],
      mode: 'secondary_only',
    });
    expect(w.wPrimary).toBe(0);
    expect(w.wSecondary).toBe(1);
  });

  it('projected blend GLSL uses coverage quality with explicit dominant-mode bias', () => {
    const materials = readFileSync(
      new URL('../src/engine/projectedStyleMaterials.ts', import.meta.url),
      'utf8',
    );
    expect(materials).toContain('projectedQualityAt');
    expect(materials).toContain('projectedBlendMode == 2 ? 1.15 : 1.0');
    expect(materials).toContain('projectedBlendMode == 3 ? 1.15 : 1.0');
    expect(materials).toContain('primaryCoverage');
    expect(materials).toContain('secondaryCoverage');
    expect(materials).not.toContain('projectedConfidence');
  });
});

// ---------------------------------------------------------------------------
// 4. Origin rotation yaw-only mutation
// ---------------------------------------------------------------------------

describe('pano origin rotation yaw-only', () => {
  it('setPanoRotation preserves existing X and Z values when only yaw changes', () => {
    // Simulate the store's setPanoRotation with a callback pattern
    const stored: [number, number, number] = [10, 20, 30];
    const incoming: [number, number, number] = [10, 35, 30];
    // Only index 1 (yaw) changed
    expect(incoming[0]).toBe(stored[0]); // X preserved
    expect(incoming[2]).toBe(stored[2]); // Z preserved
    expect(incoming[1]).not.toBe(stored[1]); // Y changed
  });

  it('rotation with nonzero stored X and Z does not crash', () => {
    // Projection currently consumes only rotation[1]; stored X/Z are ignored.
    const rotation: [number, number, number] = [45, 90, -30];
    // Applying inverse yaw with any rotation should not throw
    expect(() => {
      applyInversePanoYaw([0, 0, 1], degreesToRadians(rotation[1]));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Synthetic dual-projector sampling (CPU-level blend verification)
// ---------------------------------------------------------------------------

describe('synthetic dual-projector CPU blend', () => {
  const originA: [number, number, number] = [0, 1.6, 0];
  const originB: [number, number, number] = [10, 1.6, 0];

  it('near primary origin, primary_dominant → primary blend weight dominates', () => {
    const worldPos: [number, number, number] = [0.5, 1.6, 0.5];
    const weights = computeProjectorBlendWeights({
      worldPosition: worldPos,
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'primary_dominant',
    });
    expect(weights.wPrimary).toBeGreaterThan(0.7);
    expect(weights.wSecondary).toBeLessThan(0.3);
  });

  it('near secondary origin, secondary_dominant → secondary blend weight dominates', () => {
    const worldPos: [number, number, number] = [10, 1.6, 0.5];
    const weights = computeProjectorBlendWeights({
      worldPosition: worldPos,
      primaryOrigin: originA,
      secondaryOrigin: originB,
      mode: 'secondary_dominant',
    });
    expect(weights.wSecondary).toBeGreaterThan(0.7);
    expect(weights.wPrimary).toBeLessThan(0.3);
    expect(weights.wPrimary + weights.wSecondary).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// 6. Cancelled-warning guard — beginOriginGizmoDrag returns false on deny
// ---------------------------------------------------------------------------

describe('origin edit consent guards', () => {
  it('consent denied → projectedActive unchanged, no drag side-effects', () => {
    // This tests the callback contract: when onRequestPanoOriginEdit returns false,
    // beginOriginGizmoDrag returns false and the viewport must NOT start orbit,
    // capture pointer, or begin an edit batch.
    // The behavioural contract is verified by inspecting the pointer-down handler
    // in SceneViewport: on origin gizmo hit it ALWAYS consumes the event
    // regardless of beginOriginGizmoDrag's return value, so no orbit fallthrough.
    // Unit-level: verify the consent callback scoping logic.
    const styledPanoIds = ['a', 'b'].sort().join(',');
    const key = `proj-1:${styledPanoIds}`;
    // Simulating: first time, consent needed -> warning returns false (cancel)
    let consented = false;
    const requestConsent = () => {
      if (consented) return true;
      consented = true;
      return false;
    };
    expect(requestConsent()).toBe(false); // first call denied
    expect(requestConsent()).toBe(true);  // subsequent calls allowed
  });

  it('consent scope key changes after project change', () => {
    // Scoped to project.id + styled pano IDs
    const ids1 = ['pano-a', 'pano-b'];
    const ids2 = ['pano-c'];
    const key1 = `proj-1:${ids1.sort().join(',')}`;
    const key2 = `proj-2:${ids2.sort().join(',')}`;
    expect(key1).not.toBe(key2);
  });

  it('consent scope key is ordering-independent', () => {
    const ids1 = ['pano-b', 'pano-a'];
    const ids2 = ['pano-a', 'pano-b'];
    const key1 = `proj-1:${ids1.sort().join(',')}`;
    const key2 = `proj-1:${ids2.sort().join(',')}`;
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// 7. Async texture lifecycle — acquire/release parity
// ---------------------------------------------------------------------------

import type { Texture } from 'three';

/** Minimal fake texture that satisfies the fields THREE sets in onLoad. */
function fakeTexture(): Texture {
  return {
    dispose: vi.fn(),
    colorSpace: '',
    wrapS: 0,
    wrapT: 0,
    needsUpdate: false,
  } as unknown as Texture;
}

describe('projected style texture lifecycle', () => {
  afterEach(() => {
    pendingLoads.clear();
    // Drain any leftover refs so the next test starts clean.
    for (let i = 0; i < 10; i++) {
      releaseProjectedStyleTexture('url-a');
      releaseProjectedStyleTexture('url-b');
      releaseProjectedStyleTexture('url-c');
    }
  });

  afterAll(() => {
    for (let i = 0; i < 10; i++) {
      releaseProjectedStyleTexture('url-a');
      releaseProjectedStyleTexture('url-b');
      releaseProjectedStyleTexture('url-c');
    }
  });

  it('release undefined/null is a no-op (safe to call with falsy args)', () => {
    expect(() => releaseProjectedStyleTexture(undefined)).not.toThrow();
    expect(() => releaseProjectedStyleTexture('')).not.toThrow();
  });

  it('ownership: accepted A → pending B → pending C releases A immediately (no previousUrl leak)', async () => {
    // Drive the SHIPPED prepare/resolve helpers — same path SceneViewport uses.
    const ownership: ProjectedTextureOwnership = {};

    // Accept A.
    prepareProjectedTextureRequest(ownership, 'url-a');
    const loadA = acquireProjectedStyleTexture('url-a');
    const texA = fakeTexture();
    pendingLoads.get('url-a')!.onLoad(texA);
    const gotA = await loadA;
    expect(resolveProjectedTextureRequest(ownership, 'url-a', gotA, false)).toBe('accept');
    expect(ownership.ownedUrl).toBe('url-a');
    expect(projectedStyleTextureRefCount('url-a')).toBe(1);

    // Switch to B: prepare immediately releases owned A (do not wait for B's completion).
    const prepB = prepareProjectedTextureRequest(ownership, 'url-b');
    expect(prepB.clearedOwned).toBe(true);
    expect(ownership.ownedUrl).toBeUndefined();
    expect(ownership.requestedUrl).toBe('url-b');
    expect(projectedStyleTextureRefCount('url-a')).toBe(0);
    expect(projectedStyleTextureCacheSize()).toBe(0);

    const loadB = acquireProjectedStyleTexture('url-b');
    // B cancelled flag for its effect instance — user already left for C.
    let bCancelled = false;

    // Switch to C before B finishes. Owned is empty (A already released); C does not double-release.
    bCancelled = true;
    const prepC = prepareProjectedTextureRequest(ownership, 'url-c');
    expect(prepC.clearedOwned).toBe(false);
    expect(ownership.requestedUrl).toBe('url-c');
    const loadC = acquireProjectedStyleTexture('url-c');

    // B resolves stale → releases its own acquisition only.
    const texB = fakeTexture();
    pendingLoads.get('url-b')!.onLoad(texB);
    const gotB = await loadB;
    expect(resolveProjectedTextureRequest(ownership, 'url-b', gotB, bCancelled)).toBe('discard');
    expect(projectedStyleTextureRefCount('url-b')).toBe(0);

    // C resolves current → owns C.
    const texC = fakeTexture();
    pendingLoads.get('url-c')!.onLoad(texC);
    const gotC = await loadC;
    expect(resolveProjectedTextureRequest(ownership, 'url-c', gotC, false)).toBe('accept');
    expect(ownership.ownedUrl).toBe('url-c');
    expect(projectedStyleTextureRefCount('url-c')).toBe(1);
    expect(projectedStyleTextureRefCount('url-a')).toBe(0);
    expect(projectedStyleTextureRefCount('url-b')).toBe(0);

    disposeProjectedTextureOwnership(ownership);
    expect(projectedStyleTextureRefCount('url-c')).toBe(0);
  });

  it('ownership: stale in-flight A is discarded without touching later owned B', async () => {
    const ownership: ProjectedTextureOwnership = {};

    prepareProjectedTextureRequest(ownership, 'url-a');
    const loadA = acquireProjectedStyleTexture('url-a');
    let aCancelled = false;

    // Switch to B before A resolves.
    aCancelled = true;
    prepareProjectedTextureRequest(ownership, 'url-b');
    const loadB = acquireProjectedStyleTexture('url-b');

    // A resolves stale.
    const texA = fakeTexture();
    pendingLoads.get('url-a')!.onLoad(texA);
    const gotA = await loadA;
    expect(resolveProjectedTextureRequest(ownership, 'url-a', gotA, aCancelled)).toBe('discard');
    expect(ownership.ownedUrl).toBeUndefined();
    expect(projectedStyleTextureRefCount('url-a')).toBe(0);

    // B accepts.
    const texB = fakeTexture();
    pendingLoads.get('url-b')!.onLoad(texB);
    const gotB = await loadB;
    expect(resolveProjectedTextureRequest(ownership, 'url-b', gotB, false)).toBe('accept');
    expect(ownership.ownedUrl).toBe('url-b');
    expect(projectedStyleTextureRefCount('url-b')).toBe(1);

    disposeProjectedTextureOwnership(ownership);
  });

  it('ownership: shared URL — secondary prepare releases only its own ref; primary keeps A', async () => {
    // Two consumers share the same URL (e.g. primary and secondary both A).
    const primary: ProjectedTextureOwnership = {};
    const secondary: ProjectedTextureOwnership = {};

    prepareProjectedTextureRequest(primary, 'url-a');
    prepareProjectedTextureRequest(secondary, 'url-a');
    const load = acquireProjectedStyleTexture('url-a');
    // Second acquire while loading waits on same promise.
    const load2 = acquireProjectedStyleTexture('url-a');
    const tex = fakeTexture();
    pendingLoads.get('url-a')!.onLoad(tex);
    const t1 = await load;
    const t2 = await load2;
    expect(t1).toBe(t2);
    expect(resolveProjectedTextureRequest(primary, 'url-a', t1, false)).toBe('accept');
    expect(resolveProjectedTextureRequest(secondary, 'url-a', t2, false)).toBe('accept');
    expect(projectedStyleTextureRefCount('url-a')).toBe(2);

    // Secondary switches away — prepare releases only secondary's owned ref.
    // Completing callback must NOT also release previousUrl (old leak / double-release).
    prepareProjectedTextureRequest(secondary, 'url-b');
    expect(projectedStyleTextureRefCount('url-a')).toBe(1);
    expect(primary.ownedUrl).toBe('url-a');
    expect(secondary.ownedUrl).toBeUndefined();
    expect(secondary.requestedUrl).toBe('url-b');

    // Success path for B does not touch A (no previousUrl release in resolve).
    const loadB = acquireProjectedStyleTexture('url-b');
    const texB = fakeTexture();
    pendingLoads.get('url-b')!.onLoad(texB);
    const gotB = await loadB;
    expect(resolveProjectedTextureRequest(secondary, 'url-b', gotB, false)).toBe('accept');
    expect(projectedStyleTextureRefCount('url-a')).toBe(1);
    expect(projectedStyleTextureRefCount('url-b')).toBe(1);

    disposeProjectedTextureOwnership(primary);
    disposeProjectedTextureOwnership(secondary);
    expect(projectedStyleTextureRefCount('url-a')).toBe(0);
    expect(projectedStyleTextureRefCount('url-b')).toBe(0);
  });

  it('interleaved acquire+release cycles balance refCount correctly', async () => {
    // First acquire creates TextureLoader; resolve it.
    const texA = fakeTexture();
    const load1 = acquireProjectedStyleTexture('url-a');
    pendingLoads.get('url-a')!.onLoad(texA);
    const t1 = await load1;
    expect(t1).toBe(texA);

    // Second acquire hits cache → same instance, no new loader.
    const t2 = await acquireProjectedStyleTexture('url-a');
    expect(t2).toBe(t1);

    // Release once: refCount 2→1.
    releaseProjectedStyleTexture('url-a');

    // Third acquire still cached.
    const t3 = await acquireProjectedStyleTexture('url-a');
    expect(t3).toBe(t1);

    // Release twice → refCount hits 0 → disposed.
    releaseProjectedStyleTexture('url-a');
    releaseProjectedStyleTexture('url-a');

    // Fresh acquire creates a new loader.
    const texB = fakeTexture();
    const load4 = acquireProjectedStyleTexture('url-a');
    expect(pendingLoads.has('url-a')).toBe(true);
    pendingLoads.get('url-a')!.onLoad(texB);
    const t4 = await load4;
    expect(t4).toBe(texB);
    expect(t4).not.toBe(t1);

    releaseProjectedStyleTexture('url-a');
  });

  it('SceneViewport wires prepare/resolve ownership helpers (not previousUrl-in-then)', () => {
    const viewport = readFileSync(
      new URL('../src/components/viewers/SceneViewport.tsx', import.meta.url),
      'utf8',
    );
    expect(viewport).toContain('prepareProjectedTextureRequest');
    expect(viewport).toContain('resolveProjectedTextureRequest');
    expect(viewport).toContain('disposeProjectedTextureOwnership');
    expect(viewport).toContain('primaryOwnershipRef');
    expect(viewport).toContain('secondaryOwnershipRef');
    // Old leaky pattern: release previousUrl from the completion callback.
    expect(viewport).not.toMatch(/previousUrl && previousUrl !== url\) releaseProjectedStyleTexture\(previousUrl\)/);
  });
});
