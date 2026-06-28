import { LocationProject, PanoReference, ProjectAsset } from './types';

export function getLatestGrayboxPano(project: LocationProject): PanoReference | undefined {
  return [...project.panoRefs]
    .reverse()
    .find((pano) => pano.type === 'graybox_render');
}

export function getCanonicalPano(project: LocationProject): PanoReference | undefined {
  return project.panoRefs.find((pano) => pano.isCanonical);
}

export function getPanoAsset(project: LocationProject, pano?: PanoReference): ProjectAsset | undefined {
  if (!pano) return undefined;
  return project.assets.assets[pano.imageAssetId];
}

