import { Vec3 } from '../domain/types';
import { normalize } from './sync';

export function equirectUvToDirection(u: number, v: number): Vec3 {
  const theta = u * 2 * Math.PI - Math.PI;
  const phi = v * Math.PI - Math.PI * 0.5;
  return normalize([
    Math.sin(theta) * Math.cos(phi),
    Math.sin(phi),
    Math.cos(theta) * Math.cos(phi),
  ]);
}

