import * as THREE from 'three';
import { Euler, ProjectionAlignment, Vec2, Vec3 } from '../domain/types';
import { equirectUvToUnitDirection, applyYawRotation } from './projectionAlignmentMath';
import { degreesToRadians } from './sync';

const MARKER_RADIUS = 0.07;
const RAY_RADIUS = 4;

const TARGET_COLOR = 0x22c55e;
const SOURCE_COLOR = 0xef4444;
const CONNECTION_COLOR = 0xfbbf24;

function uvToWorldPosition(
  uv: Vec2,
  origin: Vec3,
  yawRadians: number,
  radius: number,
): THREE.Vector3 {
  const localDir = equirectUvToUnitDirection(uv);
  const worldDir = applyYawRotation(localDir, yawRadians);
  return new THREE.Vector3(
    origin[0] + worldDir[0] * radius,
    origin[1] + worldDir[1] * radius,
    origin[2] + worldDir[2] * radius,
  );
}

function createMarkerSphere(color: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999;
  return mesh;
}

function createConnectingLine(from: THREE.Vector3, to: THREE.Vector3): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: CONNECTION_COLOR,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 998;
  return line;
}

/**
 * Create a 3D overlay showing alignment marker pairs in the scene.
 * - Green spheres: target UV positions (on the graybox)
 * - Red spheres: source UV positions (on the source pano)
 * - Yellow lines: connection between each target → source pair
 */
export function createAlignmentMarkerOverlay(
  alignment: ProjectionAlignment,
  panoOrigin: Vec3,
  panoRotation: Euler,
  targetOrigin: Vec3 = panoOrigin,
  targetYawRadians = 0,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AlignmentMarkers';
  const sourceYawRadians = degreesToRadians(panoRotation[1] ?? 0);

  for (const pair of alignment.pairs) {
    if (!pair.enabled) continue;

    const targetPos = uvToWorldPosition(pair.targetUv, targetOrigin, targetYawRadians, RAY_RADIUS);
    const sourcePos = uvToWorldPosition(pair.sourceUv, panoOrigin, sourceYawRadians, RAY_RADIUS);

    const targetSphere = createMarkerSphere(TARGET_COLOR);
    targetSphere.position.copy(targetPos);
    targetSphere.userData.markerType = 'target';
    targetSphere.userData.pairId = pair.id;
    targetSphere.userData.order = pair.order;
    group.add(targetSphere);

    const sourceSphere = createMarkerSphere(SOURCE_COLOR);
    sourceSphere.position.copy(sourcePos);
    sourceSphere.userData.markerType = 'source';
    sourceSphere.userData.pairId = pair.id;
    sourceSphere.userData.order = pair.order;
    group.add(sourceSphere);

    const line = createConnectingLine(targetPos, sourcePos);
    line.userData.pairId = pair.id;
    group.add(line);
  }

  return group;
}

/**
 * Remove all child objects and dispose GPU resources for an alignment overlay.
 */
export function disposeAlignmentOverlay(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}
