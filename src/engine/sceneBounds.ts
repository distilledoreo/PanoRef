import * as THREE from 'three';
import { LocationProject, Vec3 } from '../domain/types';

/**
 * Enclose every rendered object so a 360 export / depth cubemap has no
 * fixed-distance clipping plane. Shared by graybox pano exports and
 * projector-occlusion depth maps.
 */
export function computeGrayboxPanoFarPlane(scene: THREE.Scene, panoOrigin: Vec3, near = 0.1): number {
  const bounds = new THREE.Box3().setFromObject(scene);
  if (bounds.isEmpty()) return near + 1;

  const origin = new THREE.Vector3(...panoOrigin);
  let farthestDistance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        farthestDistance = Math.max(farthestDistance, origin.distanceTo(new THREE.Vector3(x, y, z)));
      }
    }
  }
  return Math.max(near + 1, farthestDistance * 1.01 + 1);
}
