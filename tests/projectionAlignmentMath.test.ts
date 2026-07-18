import { describe, expect, it } from 'vitest';
import { Vec2, Vec3 } from '../src/domain/types';
import {
  equirectUvToUnitDirection,
  unitDirectionToEquirectUv,
  shortestWrappedDeltaU,
  wrapUvU,
  clampUvV,
  angularDistanceRadians,
  axisAngleVectorBetween,
  rotateDirectionByAxisAngleVector,
  applyYawRotation,
  applyInverseYawRotation,
  wendlandC2,
} from '../src/engine/projectionAlignmentMath';

const EPS = 1e-6;
const PI = Math.PI;
const DEG = PI / 180;

function vecClose(a: Vec3, b: Vec3, eps = EPS): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  );
}

function uvClose(a: Vec2, b: Vec2, eps = EPS): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

describe('equirectUvToUnitDirection', () => {
  it('center (0.5, 0.5) faces +Z', () => {
    const dir = equirectUvToUnitDirection([0.5, 0.5]);
    expect(vecClose(dir, [0, 0, 1])).toBe(true);
  });

  it('u=0 faces -Z', () => {
    const dir = equirectUvToUnitDirection([0, 0.5]);
    expect(dir[2]).toBeLessThan(0);
    expect(Math.abs(dir[0])).toBeLessThan(EPS);
  });

  it('u=0.25 faces -X', () => {
    const dir = equirectUvToUnitDirection([0.25, 0.5]);
    expect(dir[0]).toBeLessThan(0);
    expect(Math.abs(dir[2])).toBeLessThan(EPS);
  });

  it('u=0.75 faces +X', () => {
    const dir = equirectUvToUnitDirection([0.75, 0.5]);
    expect(dir[0]).toBeGreaterThan(0);
    expect(Math.abs(dir[2])).toBeLessThan(EPS);
  });

  it('v=0 is south pole (down)', () => {
    const dir = equirectUvToUnitDirection([0.5, 0]);
    expect(dir[1]).toBeLessThan(0);
  });

  it('v=1 is north pole (up)', () => {
    const dir = equirectUvToUnitDirection([0.5, 1]);
    expect(dir[1]).toBeGreaterThan(0);
  });
});

describe('unitDirectionToEquirectUv', () => {
  it('+Z center', () => {
    const uv = unitDirectionToEquirectUv([0, 0, 1]);
    expect(uvClose(uv, [0.5, 0.5])).toBe(true);
  });

  it('-X', () => {
    const uv = unitDirectionToEquirectUv([-1, 0, 0]);
    expect(uv[0]).toBeCloseTo(0.25, 3);
    expect(uv[1]).toBeCloseTo(0.5, 3);
  });

  it('+X', () => {
    const uv = unitDirectionToEquirectUv([1, 0, 0]);
    expect(uv[0]).toBeCloseTo(0.75, 3);
    expect(uv[1]).toBeCloseTo(0.5, 3);
  });

  it('straight up (north pole)', () => {
    const uv = unitDirectionToEquirectUv([0, 1, 0]);
    expect(uv[1]).toBeCloseTo(1, 3);
  });

  it('straight down (south pole)', () => {
    const uv = unitDirectionToEquirectUv([0, -1, 0]);
    expect(uv[1]).toBeCloseTo(0, 3);
  });
});

describe('UV ↔ direction round-trip', () => {
  const cases: Vec2[] = [
    [0.5, 0.5],
    [0, 0.5],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0],
    [0.5, 1],
    [0.125, 0.25],
    [0.9, 0.8],
    [0.3, 0.7],
    [0.99, 0.01],
  ];

  for (const uv of cases) {
    it(`round-trip UV [${uv[0]}, ${uv[1]}]`, () => {
      const dir = equirectUvToUnitDirection(uv);
      const back = unitDirectionToEquirectUv(dir);
      expect(Math.abs(back[0] - uv[0])).toBeLessThan(1e-5);
      expect(Math.abs(back[1] - uv[1])).toBeLessThan(1e-5);
    });
  }
});

describe('seam at u=0/1', () => {
  it('u=0 and u=1 map to same direction (-Z)', () => {
    const d0 = equirectUvToUnitDirection([0, 0.5]);
    const d1 = equirectUvToUnitDirection([1, 0.5]);
    expect(vecClose(d0, [0, 0, -1])).toBe(true);
    expect(vecClose(d1, [0, 0, -1])).toBe(true);
  });

  it('wrapping near seam is continuous', () => {
    const uvA = unitDirectionToEquirectUv([-0.999, 0, -0.01]);
    const uvB = unitDirectionToEquirectUv([-0.999, 0, 0.01]);
    const delta = shortestWrappedDeltaU(uvA[0], uvB[0]);
    expect(Math.abs(delta)).toBeLessThan(0.02);
  });
});

describe('poles', () => {
  it('v=0 is south pole (down)', () => {
    const dir = equirectUvToUnitDirection([0.5, 0]);
    expect(Math.abs(dir[1] - (-1))).toBeLessThan(EPS);
  });

  it('v=1 is north pole (up)', () => {
    const dir = equirectUvToUnitDirection([0.5, 1]);
    expect(Math.abs(dir[1] - 1)).toBeLessThan(EPS);
  });
});

describe('shortestWrappedDeltaU', () => {
  it('simple forward delta', () => {
    expect(shortestWrappedDeltaU(0.5, 0.7)).toBeCloseTo(0.2);
  });

  it('wrapped crossing 0/1 seam forward', () => {
    expect(shortestWrappedDeltaU(0.9, 0.1)).toBeCloseTo(0.2);
  });

  it('wrapped crossing 0/1 seam backward', () => {
    expect(shortestWrappedDeltaU(0.1, 0.9)).toBeCloseTo(-0.2);
  });

  it('no delta for same position', () => {
    expect(shortestWrappedDeltaU(0.5, 0.5)).toBe(0);
  });

  it('maximum delta is 0.5', () => {
    expect(Math.abs(shortestWrappedDeltaU(0, 0.5))).toBeCloseTo(0.5);
    expect(Math.abs(shortestWrappedDeltaU(0.5, 0))).toBeCloseTo(0.5);
  });

  it('wraps correctly at all boundaries', () => {
    expect(shortestWrappedDeltaU(0.0, 0.0)).toBeCloseTo(0);
    expect(shortestWrappedDeltaU(0.99, 0.01)).toBeCloseTo(0.02);
    expect(shortestWrappedDeltaU(0.01, 0.99)).toBeCloseTo(-0.02);
  });
});

describe('wrapUvU', () => {
  it('keeps values in [0,1)', () => {
    for (const u of [0, 0.3, 0.99]) {
      const w = wrapUvU(u);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(1);
    }
  });

  it('wraps negative values', () => {
    expect(wrapUvU(-0.1)).toBeCloseTo(0.9);
    expect(wrapUvU(-1)).toBeCloseTo(0);
  });

  it('wraps values >= 1', () => {
    expect(wrapUvU(1.3)).toBeCloseTo(0.3);
    expect(wrapUvU(2)).toBeCloseTo(0);
  });
});

describe('clampUvV', () => {
  it('passes through valid values', () => {
    expect(clampUvV(0.5)).toBe(0.5);
    expect(clampUvV(0)).toBe(0);
    expect(clampUvV(1)).toBe(1);
  });

  it('clamps below 0', () => {
    expect(clampUvV(-0.1)).toBe(0);
    expect(clampUvV(-5)).toBe(0);
  });

  it('clamps above 1', () => {
    expect(clampUvV(1.1)).toBe(1);
    expect(clampUvV(10)).toBe(1);
  });
});

describe('angularDistanceRadians', () => {
  it('same direction is zero', () => {
    expect(angularDistanceRadians([0, 0, 1], [0, 0, 1])).toBeCloseTo(0);
  });

  it('opposite direction is PI', () => {
    expect(angularDistanceRadians([0, 0, 1], [0, 0, -1])).toBeCloseTo(PI);
  });

  it('90 degrees', () => {
    expect(angularDistanceRadians([0, 0, 1], [1, 0, 0])).toBeCloseTo(PI / 2);
  });

  it('45 degrees', () => {
    const d = angularDistanceRadians(
      [0, 0, 1],
      [Math.sin(PI / 4), 0, Math.cos(PI / 4)],
    );
    expect(d).toBeCloseTo(PI / 4);
  });
});

describe('axisAngleVectorBetween', () => {
  it('zero for parallel vectors', () => {
    const aa = axisAngleVectorBetween([0, 0, 1], [0, 0, 1]);
    expect(length(aa)).toBeCloseTo(0);
  });

  it('PI for antiparallel vectors', () => {
    const aa = axisAngleVectorBetween([0, 0, 1], [0, 0, -1]);
    expect(length(aa)).toBeCloseTo(PI, 2);
  });

  it('PI/2 around Y for +Z to +X', () => {
    const aa = axisAngleVectorBetween([0, 0, 1], [1, 0, 0]);
    expect(length(aa)).toBeCloseTo(PI / 2, 2);
    expect(aa[1]).toBeGreaterThan(0);
  });

  it('rotation from +Z to +X then back cancels', () => {
    const dir = normalize([1, 0, 0]);
    const aa = axisAngleVectorBetween([0, 0, 1], dir);
    const rotated = rotateDirectionByAxisAngleVector([0, 0, 1], aa);
    expect(vecClose(rotated, dir)).toBe(true);
  });

  it('zero-length guard', () => {
    const aa = axisAngleVectorBetween([0, 0, 0], [0, 0, 1]);
    expect(length(aa)).toBeCloseTo(0);
  });
});

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-10) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

describe('rotateDirectionByAxisAngleVector', () => {
  it('zero rotation leaves direction unchanged', () => {
    const result = rotateDirectionByAxisAngleVector([0, 0, 1], [0, 0, 0]);
    expect(vecClose(result, [0, 0, 1])).toBe(true);
  });

  it('90° around Y rotates +Z to +X', () => {
    const result = rotateDirectionByAxisAngleVector([0, 0, 1], [0, PI / 2, 0]);
    expect(vecClose(result, [1, 0, 0])).toBe(true);
  });

  it('180° around Y flips +Z to -Z', () => {
    const result = rotateDirectionByAxisAngleVector([0, 0, 1], [0, PI, 0]);
    expect(vecClose(result, [0, 0, -1])).toBe(true);
  });

  it('random rotation preserves length', () => {
    const dir: Vec3 = normalize([1, 2, 3]);
    const axisAngle: Vec3 = [0.5, 0.3, -0.4];
    const result = rotateDirectionByAxisAngleVector(dir, axisAngle);
    expect(length(result)).toBeCloseTo(1, 5);
  });
});

describe('applyYawRotation and applyInverseYawRotation', () => {
  it('zero yaw is identity', () => {
    const dir: Vec3 = [1, 0, 0];
    expect(vecClose(applyYawRotation(dir, 0), dir)).toBe(true);
  });

  it('90° yaw rotates +Z to +X', () => {
    const result = applyYawRotation([0, 0, 1], PI / 2);
    expect(vecClose(result, [1, 0, 0])).toBe(true);
  });

  it('inverse yaw cancels yaw', () => {
    const dir: Vec3 = normalize([1, 2, 3]);
    const yaw = 0.7;
    const forward = applyYawRotation(dir, yaw);
    const back = applyInverseYawRotation(forward, yaw);
    expect(vecClose(back, dir)).toBe(true);
  });

  it('forward and inverse yaw compose to identity', () => {
    const dir: Vec3 = normalize([1, 2, 3]);
    const yaw = 1.2;
    const result = applyInverseYawRotation(applyYawRotation(dir, yaw), yaw);
    expect(vecClose(result, dir)).toBe(true);
  });

  it('-90° inverse yaw rotates +Z to +X', () => {
    const result = applyInverseYawRotation([0, 0, 1], -PI / 2);
    expect(vecClose(result, [1, 0, 0])).toBe(true);
  });
});

describe('wendlandC2', () => {
  it('returns 1 at r=0', () => {
    expect(wendlandC2(0)).toBeCloseTo(1);
  });

  it('returns 0 at r=1', () => {
    expect(wendlandC2(1)).toBeCloseTo(0);
  });

  it('returns 0 for r>1', () => {
    expect(wendlandC2(1.5)).toBeCloseTo(0);
    expect(wendlandC2(10)).toBeCloseTo(0);
  });

  it('returns 1 for r<0', () => {
    expect(wendlandC2(-1)).toBeCloseTo(1);
  });

  it('monotonically decreasing on [0,1]', () => {
    const r = [0, 0.25, 0.5, 0.75, 1];
    const values = r.map(wendlandC2);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1] + 1e-10);
    }
  });

  it('known values: r=0.5', () => {
    const v = wendlandC2(0.5);
    const expected = Math.pow(0.5, 4) * (4 * 0.5 + 1);
    expect(v).toBeCloseTo(expected);
  });

  it('C2 continuity: zero at boundary', () => {
    expect(wendlandC2(1)).toBeCloseTo(0);
    const eps = 1e-6;
    expect(wendlandC2(1 - eps)).toBeGreaterThan(0);
    expect(wendlandC2(1 + eps)).toBeCloseTo(0);
  });
});
