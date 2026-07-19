import type { Vec3 } from '../../domain/types';
import { createCoverageBitset, setCoverageBit } from './coverageBitset';
import type { SceneAccelerationStructure } from './sceneAcceleration';
import type {
  CoverageOptimizationOptions,
  OriginCandidate,
  OriginEvaluation,
  SurfaceSample,
} from './types';

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function evaluateOrigin(
  candidate: OriginCandidate,
  samples: SurfaceSample[],
  acceleration: SceneAccelerationStructure,
  sceneDiagonal: number,
  options: CoverageOptimizationOptions,
): OriginEvaluation {
  const coverageBits = createCoverageBitset(samples.length);
  const visibleBits = createCoverageBitset(samples.length);
  const quality = new Uint8Array(samples.length);
  let usableCount = 0;
  let qualitySum = 0;
  const texelConstant = options.panoramaWidth * options.panoramaHeight / (2 * Math.PI * Math.PI);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const offset: Vec3 = [
      sample.position[0] - candidate.position[0],
      sample.position[1] - candidate.position[1],
      sample.position[2] - candidate.position[2],
    ];
    const distance = Math.hypot(offset[0], offset[1], offset[2]);
    if (!(distance > 1e-6)) continue;
    const direction: Vec3 = [offset[0] / distance, offset[1] / distance, offset[2] / distance];
    const towardOrigin: Vec3 = [-direction[0], -direction[1], -direction[2]];
    const facing = Math.max(0,
      sample.geometricNormal[0] * towardOrigin[0]
      + sample.geometricNormal[1] * towardOrigin[1]
      + sample.geometricNormal[2] * towardOrigin[2]);
    const epsilon = Math.max(sceneDiagonal * 1e-5, distance * 1e-4);
    const visible = !acceleration.raycastAny(
      candidate.position,
      direction,
      Math.max(0, distance - epsilon),
      sample.triangleIndex,
      epsilon * 0.25,
    );
    if (!visible) continue;
    setCoverageBit(visibleBits, index);

    const texelDensity = texelConstant * facing / Math.max(distance * distance, 1e-6);
    const angleQuality = smoothstep(options.minimumFacing, 0.55, facing);
    const resolutionQuality = smoothstep(
      options.minimumTexelDensity,
      options.targetTexelDensity,
      texelDensity,
    );
    const sampleQuality = angleQuality * resolutionQuality;
    const qualityByte = Math.max(0, Math.min(255, Math.round(sampleQuality * 255)));
    quality[index] = qualityByte;
    qualitySum += qualityByte;

    if (facing >= options.minimumFacing && texelDensity >= options.minimumTexelDensity) {
      setCoverageBit(coverageBits, index);
      usableCount += 1;
    }
  }

  return {
    position: [...candidate.position],
    coverageBits,
    visibleBits,
    quality,
    individualCoverage: samples.length > 0 ? usableCount / samples.length : 0,
    averageQuality: samples.length > 0 ? qualitySum / (255 * samples.length) : 0,
    clearance: candidate.clearance,
  };
}

