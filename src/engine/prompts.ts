import { Landmark, LocationProject, Shot } from '../domain/types';

export function getShotLandmarks(project: LocationProject, shot: Shot): Landmark[] {
  return project.landmarks.filter((landmark) => shot.landmarkIds.includes(landmark.id));
}

export function generateImagePrompt(project: LocationProject, shot: Shot): string {
  const landmarkNames = getShotLandmarks(project, shot)
    .filter((landmark) => landmark.promptCritical)
    .map((landmark) => landmark.displayName || landmark.name);

  const landmarkText = landmarkNames.length > 0
    ? landmarkNames.join(', ')
    : 'No prompt-critical landmarks selected.';

  const canonicalPano = project.panoRefs.find((pano) => pano.isCanonical);
  const grayboxPano = project.panoRefs.find((pano) => pano.type === 'graybox_render');
  const linkedPano = project.panoRefs.find((pano) => pano.id === shot.linkedPanoId);
  const hasGlobalReference = Boolean(shot.exportSettings.includeFullPano && canonicalPano);
  const hasGrayboxPano = Boolean(shot.exportSettings.includeGrayboxPano && grayboxPano);
  const hasPanoCrop = Boolean(shot.exportSettings.includePanoCrop && linkedPano && shot.panoCrop);

  const referenceInstructions = [
    'Use viewport_clay.png as the strict camera, composition, perspective, scale, and layout reference.',
  ];
  if (hasGlobalReference) {
    referenceInstructions.push('Use global_reference.png, when available, as the visual identity, lighting, material, and palette reference.');
  }
  if (hasGrayboxPano) {
    referenceInstructions.push('Use global_graybox.png, when available, as the full-location spatial reference.');
  }
  if (hasPanoCrop) {
    referenceInstructions.push('Use pano_crop.png, when available, only as supporting local context.');
  }

  const continuityLines = hasGlobalReference
    ? [
      'Preserve the same layout, proportions, architecture, lighting direction, material language, and color palette from the global reference.',
      'Do not add new doors, windows, buildings, props, or modern objects unless explicitly requested.',
    ]
    : [
      'Preserve the graybox layout, proportions, architecture, and spatial relationships from viewport_clay.png.',
      'Do not add new doors, windows, buildings, props, or modern objects unless explicitly requested.',
    ];

  return [
    ...referenceInstructions,
    '',
    `Location: ${project.name}`,
    `Shot: ${shot.name}`,
    '',
    `Preserve these landmarks: ${landmarkText}`,
    '',
    ...continuityLines,
    'Do not move, redesign, remove, or replace the named landmarks.',
    '',
    'Render the viewport frame as a polished final base frame suitable for image-to-video generation.',
    '',
    `Shot-specific action/description: ${shot.description || 'Hold the planned composition and environment continuity.'}`,
    shot.promptOverrides.imagePrompt ? `\nAdditional image direction: ${shot.promptOverrides.imagePrompt}` : '',
  ].filter(Boolean).join('\n');
}

export function generateVideoPrompt(shot: Shot): string {
  return [
    'Animate from the provided base frame while preserving the same environment, camera direction, landmarks, materials, lighting, and layout.',
    'Keep the background architecture stable.',
    'Do not redesign the set, move landmarks, or introduce new major objects.',
    '',
    `Shot motion: ${shot.promptOverrides.videoPrompt || shot.description || 'Subtle camera-safe motion only.'}`,
  ].join('\n');
}
