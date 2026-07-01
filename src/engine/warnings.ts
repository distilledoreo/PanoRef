import { STYLED_PANO } from '../domain/copy';
import { LocationProject, Shot, WarningItem } from '../domain/types';
import { getPanoMatchQuality } from './sync';

export function getProjectWarnings(project: LocationProject): WarningItem[] {
  const warnings: WarningItem[] = [];
  const grayboxPano = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const canonicalPano = project.panoRefs.find((pano) => pano.isCanonical);

  if (!grayboxPano) {
    warnings.push({
      id: 'missing-graybox-pano',
      severity: 'warning',
      message: 'No graybox 360 panorama has been rendered from the Build workspace.',
    });
  }

  if (!canonicalPano) {
    warnings.push({
      id: 'missing-canonical-pano',
      severity: 'warning',
      message: STYLED_PANO.missing,
    });
  }

  if (project.shots.length === 0) {
    warnings.push({
      id: 'no-shots',
      severity: 'info',
      message: 'No shots have been created yet.',
    });
  }

  return warnings;
}

export function getShotWarnings(project: LocationProject, shot: Shot): WarningItem[] {
  const warnings: WarningItem[] = [];
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const criticalLandmarks = project.landmarks.filter((landmark) => landmark.promptCritical);
  const selectedCritical = criticalLandmarks.filter((landmark) => shot.landmarkIds.includes(landmark.id));

  if (!linkedPano) {
    warnings.push({
      id: `${shot.id}-missing-pano`,
      severity: 'danger',
      message: 'This shot is not linked to a panorama reference.',
    });
  } else {
    const match = getPanoMatchQuality(shot.camera, linkedPano, project.settings);
    if (match.quality !== 'good') {
      warnings.push({
        id: `${shot.id}-pano-match`,
        severity: match.quality === 'moderate' ? 'warning' : 'danger',
        message: `Shot camera is ${match.distanceMeters.toFixed(1)}m from the linked pano origin.`,
      });
    }
  }

  if (criticalLandmarks.length > 0 && selectedCritical.length === 0) {
    warnings.push({
      id: `${shot.id}-missing-landmarks`,
      severity: 'warning',
      message: 'No prompt-critical landmarks are selected for this shot.',
    });
  }

  const exportAspect = shot.exportSettings.width / shot.exportSettings.height;
  if (Math.abs(exportAspect - shot.camera.aspectRatio) > 0.02) {
    warnings.push({
      id: `${shot.id}-aspect-mismatch`,
      severity: 'warning',
      message: 'Shot export aspect ratio differs from the camera preview aspect ratio.',
    });
  }

  return warnings;
}

