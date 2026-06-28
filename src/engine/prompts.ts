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
  const controlInstructions = shot.exportSettings.includeContinuityControlView
    ? [
      'Use continuity_control_view.png as the primary camera/layout control: exact composition, perspective, object placement, scale, local lighting, and reliable projected style placement.',
      'Gray areas in continuity_control_view.png are untextured structure placeholders, not final material design.',
      'Use viewport_clay.png as the secondary exact clay fallback for camera composition if the projection view has gray unknown regions.',
    ]
    : [
      'Use viewport_clay.png as the exact camera composition, perspective, scale, and spatial layout.',
    ];

  return [
    ...controlInstructions,
    'Use global_reference.png as the final material richness, architectural detail, lighting style, color palette, and environment identity authority.',
    'Use pano_crop.png only as secondary local context when it agrees with the camera-locked control view.',
    '',
    `Location: ${project.name}`,
    `Shot: ${shot.name}`,
    '',
    `Preserve these landmarks: ${landmarkText}`,
    '',
    'Preserve the same layout, proportions, architecture, lighting direction, material language, and color palette from the global reference.',
    'Do not add new doors, windows, buildings, props, or modern objects unless explicitly requested.',
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
