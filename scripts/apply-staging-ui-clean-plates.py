from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> tuple[str, bool]:
    raw = (ROOT / path).read_bytes()
    crlf = b'\r\n' in raw
    return raw.decode('utf-8').replace('\r\n', '\n'), crlf


def write(path: str, content: str, crlf: bool | None = None) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if crlf is None and target.exists():
        crlf = b'\r\n' in target.read_bytes()
    text = content.replace('\r\n', '\n')
    if crlf:
        text = text.replace('\n', '\r\n')
    target.write_bytes(text.encode('utf-8'))


def replace_once(path: str, old: str, new: str) -> None:
    text, crlf = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one occurrence, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1), crlf)


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    text, crlf = read(path)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f'{path}: expected at least {minimum}, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new), crlf)


# Export mode model and defaults.
replace_once(
    'src/domain/types.ts',
    "export interface ShotExportSettings {\n",
    "export type PeopleExportMode = 'with_people' | 'clean_plate' | 'both';\n\nexport interface ShotExportSettings {\n",
)
replace_once(
    'src/domain/types.ts',
    "  height: number;\n  includeViewport: boolean;\n",
    "  height: number;\n  /** Whether shot renders include staged people, a clean plate, or both. */\n  peopleExportMode?: PeopleExportMode;\n  includeViewport: boolean;\n",
)
replace_once(
    'src/domain/defaults.ts',
    "  height: DEFAULT_SHOT_HEIGHT,\n  includeViewport: true,\n",
    "  height: DEFAULT_SHOT_HEIGHT,\n  peopleExportMode: 'with_people',\n  includeViewport: true,\n",
)
replace_once(
    'src/engine/projectIO.ts',
    "      ...exportSettings,\n      includeAiResultFrame:",
    "      ...exportSettings,\n      peopleExportMode: normalizePeopleExportMode(legacyExportSettings.peopleExportMode),\n      includeAiResultFrame:",
)
replace_once(
    'src/engine/projectIO.ts',
    "function normalizeShot(shot: Shot): Shot {",
    "function normalizePeopleExportMode(value: unknown): Shot['exportSettings']['peopleExportMode'] {\n  if (value === 'clean_plate' || value === 'both') return value;\n  return 'with_people';\n}\n\nfunction normalizeShot(shot: Shot): Shot {",
)

write(
    'src/engine/peopleExport.ts',
    """import type { PeopleExportMode } from '../domain/types';

export type PeopleRenderVariant = 'with_people' | 'clean_plate';

export function normalizePeopleExportMode(mode?: PeopleExportMode): PeopleExportMode {
  return mode === 'clean_plate' || mode === 'both' ? mode : 'with_people';
}

export function getPeopleRenderVariants(mode?: PeopleExportMode): PeopleRenderVariant[] {
  const normalized = normalizePeopleExportMode(mode);
  if (normalized === 'both') return ['with_people', 'clean_plate'];
  return [normalized];
}

export function peopleVariantLabel(variant: PeopleRenderVariant): string {
  return variant === 'clean_plate' ? 'clean plate' : 'with people';
}

export function getPeopleVariantPath(
  path: string,
  variant: PeopleRenderVariant,
  mode?: PeopleExportMode,
): string {
  const normalized = normalizePeopleExportMode(mode);
  if (normalized === 'with_people' && variant === 'with_people') return path;
  const suffix = variant === 'clean_plate' ? '_clean_plate' : '_with_people';
  const extensionIndex = path.lastIndexOf('.');
  if (extensionIndex < 0) return `${path}${suffix}`;
  return `${path.slice(0, extensionIndex)}${suffix}${path.slice(extensionIndex)}`;
}
""",
    False,
)

# Renderers accept the people variant and resolve clean plates before building scenes.
replace_once(
    'src/engine/renderers.ts',
    "import { resolveProjectForShot } from './shotSceneState';",
    "import { resolveProjectForShot } from './shotSceneState';\nimport type { PeopleRenderVariant } from './peopleExport';",
)
replace_once(
    'src/engine/renderers.ts',
    "  includeDataUrl?: boolean;\n}",
    "  includeDataUrl?: boolean;\n  /** Hide all objects classified as people for clean-plate output. */\n  peopleVariant?: PeopleRenderVariant;\n}",
)
replace_once(
    'src/engine/renderers.ts',
    "export async function renderShotFrame(project: LocationProject, shot: Shot): Promise<ImageRenderResult> {\n  return renderViewportClay(\n    resolveProjectForShot(project, shot),",
    "export async function renderShotFrame(\n  project: LocationProject,\n  shot: Shot,\n  options: { peopleVariant?: PeopleRenderVariant } = {},\n): Promise<ImageRenderResult> {\n  return renderViewportClay(\n    resolveProjectForShot(project, shot, { hidePeople: options.peopleVariant === 'clean_plate' }),",
)
replace_once(
    'src/engine/renderers.ts',
    "  const shotProject = resolveProjectForShot(project, shot);\n  const keyframes",
    "  const shotProject = resolveProjectForShot(project, shot, {\n    hidePeople: options.peopleVariant === 'clean_plate',\n  });\n  const keyframes",
)
replace_once(
    'src/engine/renderers.ts',
    "export async function renderShotProjectedFrame(\n  project: LocationProject,\n  shot: Shot,\n): Promise<ImageRenderResult> {\n  return renderViewportProjected(\n    resolveProjectForShot(project, shot),",
    "export async function renderShotProjectedFrame(\n  project: LocationProject,\n  shot: Shot,\n  options: { peopleVariant?: PeopleRenderVariant } = {},\n): Promise<ImageRenderResult> {\n  return renderViewportProjected(\n    resolveProjectForShot(project, shot, { hidePeople: options.peopleVariant === 'clean_plate' }),",
)

# Manifest paths mirror the exact people variants written by package export.
replace_once(
    'src/engine/exportManifest.ts',
    "import { generateImagePrompt, generateVideoPrompt } from './prompts';",
    "import { generateImagePrompt, generateVideoPrompt } from './prompts';\nimport { getPeopleRenderVariants, getPeopleVariantPath } from './peopleExport';",
)
replace_once(
    'src/engine/exportManifest.ts',
    "  const files: ShotPackageManifest['files'] = [];\n",
    "  const files: ShotPackageManifest['files'] = [];\n  const peopleMode = shot.exportSettings.peopleExportMode;\n  const peopleVariants = getPeopleRenderVariants(peopleMode);\n",
)
replace_once(
    'src/engine/exportManifest.ts',
    "  if (shot.exportSettings.includeViewport) {\n    files.push({ path: `${rootFolder}/inputs/viewport_clay.png`, kind: 'image', required: true });\n  }",
    "  if (shot.exportSettings.includeViewport) {\n    for (const variant of peopleVariants) {\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/viewport_clay.png`, variant, peopleMode),\n        kind: 'image',\n        required: true,\n      });\n    }\n  }",
)
replace_once(
    'src/engine/exportManifest.ts',
    "  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(project)) {\n    files.push({ path: `${rootFolder}/inputs/viewport_projected.png`, kind: 'image', required: false });\n  }",
    "  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(project)) {\n    for (const variant of peopleVariants) {\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/viewport_projected.png`, variant, peopleMode),\n        kind: 'image',\n        required: false,\n      });\n    }\n  }",
)
replace_once(
    'src/engine/exportManifest.ts',
    "    files.push({ path: `${rootFolder}/inputs/viewport_clay_motion.mp4`, kind: 'video', required: false });",
    "    for (const variant of peopleVariants) {\n      if (variant === 'clean_plate' && !hasRenderableCameraMove(shot.cameraKeyframes)) continue;\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/viewport_clay_motion.mp4`, variant, peopleMode),\n        kind: 'video',\n        required: false,\n      });\n    }",
)
replace_once(
    'src/engine/exportManifest.ts',
    "    files.push({ path: `${rootFolder}/inputs/viewport_projected_motion.mp4`, kind: 'video', required: false });",
    "    for (const variant of peopleVariants) {\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/viewport_projected_motion.mp4`, variant, peopleMode),\n        kind: 'video',\n        required: false,\n      });\n    }",
)
replace_once(
    'src/engine/exportManifest.ts',
    "  for (const frame of cameraMoveReferenceFrames) {\n    files.push({ path: `${rootFolder}/inputs/camera_move/clay_${frame.id}.png`, kind: 'image', required: false });\n  }",
    "  for (const frame of cameraMoveReferenceFrames) {\n    for (const variant of peopleVariants) {\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/camera_move/clay_${frame.id}.png`, variant, peopleMode),\n        kind: 'image',\n        required: false,\n      });\n    }\n  }",
)
replace_once(
    'src/engine/exportManifest.ts',
    "  for (const frame of projectedMoveFrames) {\n    files.push({ path: `${rootFolder}/inputs/camera_move/projected_${frame.id}.png`, kind: 'image', required: false });\n  }",
    "  for (const frame of projectedMoveFrames) {\n    for (const variant of peopleVariants) {\n      files.push({\n        path: getPeopleVariantPath(`${rootFolder}/inputs/camera_move/projected_${frame.id}.png`, variant, peopleMode),\n        kind: 'image',\n        required: false,\n      });\n    }\n  }",
)

# Package export: count and emit every requested variant.
replace_once(
    'src/engine/packageExport.ts',
    "import { resolveProjectForShot } from './shotSceneState';",
    "import { resolveProjectForShot } from './shotSceneState';\nimport { getPeopleRenderVariants, getPeopleVariantPath, peopleVariantLabel } from './peopleExport';",
)
replace_once(
    'src/engine/packageExport.ts',
    "  const canProject = canUseProjectedAppearance(project);\n",
    "  const canProject = canUseProjectedAppearance(project);\n  const peopleVariants = getPeopleRenderVariants(shot.exportSettings.peopleExportMode);\n",
)
replace_once(
    'src/engine/packageExport.ts',
    "  if (shot.exportSettings.includeViewport) units += 1;\n  if (shot.exportSettings.includeProjectedViewport && canProject) units += 1;",
    "  if (shot.exportSettings.includeViewport) units += peopleVariants.length;\n  if (shot.exportSettings.includeProjectedViewport && canProject) units += peopleVariants.length;",
)
replace_once(
    'src/engine/packageExport.ts',
    "      units += 1;\n    }\n  }\n  if (\n    shot.exportSettings.includeProjectedCameraMoveVideo",
    "      units += hasRenderableCameraMove(shot.cameraKeyframes)\n        ? peopleVariants.length\n        : peopleVariants.filter((variant) => variant === 'with_people').length;\n    }\n  }\n  if (\n    shot.exportSettings.includeProjectedCameraMoveVideo",
)
replace_once(
    'src/engine/packageExport.ts',
    "    units += 1;\n  }\n  units += clayMoveFrames.length;\n  units += projectedMoveFrames.length;",
    "    units += peopleVariants.length;\n  }\n  units += clayMoveFrames.length * peopleVariants.length;\n  units += projectedMoveFrames.length * peopleVariants.length;",
)
replace_once(
    'src/engine/packageExport.ts',
    "  const shotProject = resolveProjectForShot(project, shot);\n",
    "  const shotProject = resolveProjectForShot(project, shot);\n  const peopleMode = shot.exportSettings.peopleExportMode;\n  const peopleVariants = getPeopleRenderVariants(peopleMode);\n  const projectForVariant = (variant: (typeof peopleVariants)[number]) => (\n    variant === 'with_people'\n      ? shotProject\n      : resolveProjectForShot(project, shot, { hidePeople: true })\n  );\n",
)
replace_once(
    'src/engine/packageExport.ts',
    "  if (shot.exportSettings.includeViewport) {\n    throwIfAborted(signal);\n    emit('rendering', 'Rendering clay viewport…', { indeterminate: true });\n    const viewport = await renderShotFrame(shotProject, shot);\n    addDataUrl(zip, `${resolvedRootFolder}/inputs/viewport_clay.png`, viewport.dataUrl);\n    finishUnit('rendering', 'Clay viewport ready');\n  }",
    "  if (shot.exportSettings.includeViewport) {\n    for (const variant of peopleVariants) {\n      throwIfAborted(signal);\n      emit('rendering', `Rendering clay viewport (${peopleVariantLabel(variant)})…`, { indeterminate: true });\n      const viewport = await renderShotFrame(project, shot, { peopleVariant: variant });\n      addDataUrl(\n        zip,\n        getPeopleVariantPath(`${resolvedRootFolder}/inputs/viewport_clay.png`, variant, peopleMode),\n        viewport.dataUrl,\n      );\n      finishUnit('rendering', `Clay viewport (${peopleVariantLabel(variant)}) ready`);\n    }\n  }",
)
replace_once(
    'src/engine/packageExport.ts',
    "  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(shotProject)) {\n    throwIfAborted(signal);\n    emit('rendering', 'Rendering projected viewport…', { indeterminate: true });\n    try {\n      const projected = await renderShotProjectedFrame(shotProject, shot);\n      addDataUrl(zip, `${resolvedRootFolder}/inputs/viewport_projected.png`, projected.dataUrl);\n      finishUnit('rendering', 'Projected viewport ready');\n    } catch (error) {\n      throw new ShotPackageError(\n        error instanceof Error\n          ? error.message\n          : 'Projected viewport export failed. Import a styled panorama or disable projected export.',\n      );\n    }\n  }",
    "  if (shot.exportSettings.includeProjectedViewport && canUseProjectedAppearance(shotProject)) {\n    for (const variant of peopleVariants) {\n      throwIfAborted(signal);\n      emit('rendering', `Rendering projected viewport (${peopleVariantLabel(variant)})…`, { indeterminate: true });\n      try {\n        const projected = await renderShotProjectedFrame(project, shot, { peopleVariant: variant });\n        addDataUrl(\n          zip,\n          getPeopleVariantPath(`${resolvedRootFolder}/inputs/viewport_projected.png`, variant, peopleMode),\n          projected.dataUrl,\n        );\n        finishUnit('rendering', `Projected viewport (${peopleVariantLabel(variant)}) ready`);\n      } catch (error) {\n        throw new ShotPackageError(\n          error instanceof Error\n            ? error.message\n            : 'Projected viewport export failed. Import a styled panorama or disable projected export.',\n        );\n      }\n    }\n  }",
)
# Replace the clay video block by slicing between stable markers.
text, crlf = read('src/engine/packageExport.ts')
start = text.index("  if (shot.exportSettings.includeCameraMoveVideo) {", text.index('async function appendShotPackageToZip'))
end = text.index("\n  if (\n    shot.exportSettings.includeProjectedCameraMoveVideo", start)
clay_block = """  if (shot.exportSettings.includeCameraMoveVideo) {
    const clayMotionSource = resolveClayCameraMovePackageSource(shot, cameraMoveVideoAsset);
    if (clayMotionSource === 'encode') {
      for (const variant of peopleVariants) {
        throwIfAborted(signal);
        emit('encoding', `Encoding clay camera move (${peopleVariantLabel(variant)})…`, { indeterminate: true });
        try {
          const video = await renderShotCameraMoveMp4(project, shot, {
            mode: 'render',
            resolutionPreset: '1080p',
            frameRate: 30,
            appearance: 'clay',
            peopleVariant: variant,
            includeDataUrl: false,
            signal,
            onProgress: (progress) => {
              const info = normalizeCameraMoveProgress(progress);
              emit('encoding', info.message || `Encoding clay camera move (${peopleVariantLabel(variant)})…`, {
                unitFraction: info.progress,
              });
            },
          });
          zip.file(
            getPeopleVariantPath(`${resolvedRootFolder}/inputs/viewport_clay_motion.mp4`, variant, peopleMode),
            await video.blob.arrayBuffer(),
          );
          finishUnit('encoding', `Clay camera move (${peopleVariantLabel(variant)}) ready`);
        } catch (error) {
          if (isPackageExportCancelled(error)) throw error;
          throw new ShotPackageError(
            error instanceof Error
              ? error.message
              : 'Camera move MP4 export failed. Try Chrome or Edge, or disable Camera move MP4.',
          );
        }
      }
    } else if (
      clayMotionSource === 'copy'
      && cameraMoveVideoAsset?.uri
      && peopleVariants.includes('with_people')
    ) {
      throwIfAborted(signal);
      emit('packaging', 'Adding clay camera-move video…');
      addBinaryToZip(
        zip,
        getPeopleVariantPath(`${resolvedRootFolder}/inputs/viewport_clay_motion.mp4`, 'with_people', peopleMode),
        cameraMoveVideoAsset.uri,
      );
      finishUnit('packaging', 'Clay camera-move video added');
    }
  }
"""
text = text[:start] + clay_block + text[end:]
write('src/engine/packageExport.ts', text, crlf)

# Projected video: loop variants.
text, crlf = read('src/engine/packageExport.ts')
start = text.index("  if (\n    shot.exportSettings.includeProjectedCameraMoveVideo", text.index('async function appendShotPackageToZip'))
end = text.index("\n  const cameraMoveReferenceFrames", start)
projected_block = """  if (
    shot.exportSettings.includeProjectedCameraMoveVideo
    && canUseProjectedAppearance(shotProject)
    && hasRenderableCameraMove(shot.cameraKeyframes)
  ) {
    for (const variant of peopleVariants) {
      throwIfAborted(signal);
      emit('encoding', `Encoding projected camera move (${peopleVariantLabel(variant)})…`, { indeterminate: true });
      try {
        const video = await renderShotCameraMoveMp4(project, shot, {
          mode: 'render',
          resolutionPreset: '1080p',
          frameRate: 30,
          appearance: 'projected',
          peopleVariant: variant,
          occlusionFilter: 'fast',
          includeDataUrl: false,
          signal,
          onProgress: (progress) => {
            const info = normalizeCameraMoveProgress(progress);
            emit('encoding', info.message || `Encoding projected camera move (${peopleVariantLabel(variant)})…`, {
              unitFraction: info.progress,
            });
          },
        });
        zip.file(
          getPeopleVariantPath(`${resolvedRootFolder}/inputs/viewport_projected_motion.mp4`, variant, peopleMode),
          await video.blob.arrayBuffer(),
        );
        finishUnit('encoding', `Projected camera move (${peopleVariantLabel(variant)}) ready`);
      } catch (error) {
        if (isPackageExportCancelled(error)) throw error;
        throw new ShotPackageError(
          error instanceof Error
            ? error.message
            : 'Projected camera-move MP4 failed. Import a styled panorama or disable projected motion.',
        );
      }
    }
  }
"""
text = text[:start] + projected_block + text[end:]
write('src/engine/packageExport.ts', text, crlf)

# Reference frame loops gain people variants and variant-specific projects/paths.
replace_once(
    'src/engine/packageExport.ts',
    "    for (let index = 0; index < cameraMoveReferenceFrames.length; index += 1) {\n      throwIfAborted(signal);\n      const frame = cameraMoveReferenceFrames[index];\n      emit(\n        'rendering',\n        `Rendering clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length}…`,\n        { unitFraction: 0, indeterminate: true },\n      );\n      const clay = await renderViewportClay(\n        shotProject,\n        frame.camera,\n        shot.exportSettings.width,\n        shot.exportSettings.height,\n      );\n      addDataUrl(zip, `${resolvedRootFolder}/inputs/camera_move/clay_${frame.id}.png`, clay.dataUrl);\n      finishUnit(\n        'rendering',\n        `Clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length} ready`,\n      );\n    }",
    "    for (let index = 0; index < cameraMoveReferenceFrames.length; index += 1) {\n      const frame = cameraMoveReferenceFrames[index];\n      for (const variant of peopleVariants) {\n        throwIfAborted(signal);\n        emit(\n          'rendering',\n          `Rendering clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length} (${peopleVariantLabel(variant)})…`,\n          { unitFraction: 0, indeterminate: true },\n        );\n        const clay = await renderViewportClay(\n          projectForVariant(variant),\n          frame.camera,\n          shot.exportSettings.width,\n          shot.exportSettings.height,\n        );\n        addDataUrl(\n          zip,\n          getPeopleVariantPath(`${resolvedRootFolder}/inputs/camera_move/clay_${frame.id}.png`, variant, peopleMode),\n          clay.dataUrl,\n        );\n        finishUnit(\n          'rendering',\n          `Clay reference frame ${index + 1} of ${cameraMoveReferenceFrames.length} (${peopleVariantLabel(variant)}) ready`,\n        );\n      }\n    }",
)
replace_once(
    'src/engine/packageExport.ts',
    "    for (let index = 0; index < projectedMoveFrames.length; index += 1) {\n      throwIfAborted(signal);\n      const frame = projectedMoveFrames[index];\n      emit(\n        'rendering',\n        `Rendering projected reference frame ${index + 1} of ${projectedMoveFrames.length}…`,\n        { indeterminate: true },\n      );\n      try {\n        const projected = await renderViewportProjected(\n          shotProject,\n          frame.camera,\n          shot.exportSettings.width,\n          shot.exportSettings.height,\n        );\n        addDataUrl(zip, `${resolvedRootFolder}/inputs/camera_move/projected_${frame.id}.png`, projected.dataUrl);\n        finishUnit(\n          'rendering',\n          `Projected reference frame ${index + 1} of ${projectedMoveFrames.length} ready`,\n        );\n      } catch (error) {\n        throw new ShotPackageError(\n          error instanceof Error\n            ? error.message\n            : 'Projected camera-move frames failed. Disable projected move frames or import a styled panorama.',\n        );\n      }\n    }",
    "    for (let index = 0; index < projectedMoveFrames.length; index += 1) {\n      const frame = projectedMoveFrames[index];\n      for (const variant of peopleVariants) {\n        throwIfAborted(signal);\n        emit(\n          'rendering',\n          `Rendering projected reference frame ${index + 1} of ${projectedMoveFrames.length} (${peopleVariantLabel(variant)})…`,\n          { indeterminate: true },\n        );\n        try {\n          const projected = await renderViewportProjected(\n            projectForVariant(variant),\n            frame.camera,\n            shot.exportSettings.width,\n            shot.exportSettings.height,\n          );\n          addDataUrl(\n            zip,\n            getPeopleVariantPath(`${resolvedRootFolder}/inputs/camera_move/projected_${frame.id}.png`, variant, peopleMode),\n            projected.dataUrl,\n          );\n          finishUnit(\n            'rendering',\n            `Projected reference frame ${index + 1} of ${projectedMoveFrames.length} (${peopleVariantLabel(variant)}) ready`,\n          );\n        } catch (error) {\n          throw new ShotPackageError(\n            error instanceof Error\n              ? error.message\n              : 'Projected camera-move frames failed. Disable projected move frames or import a styled panorama.',\n          );\n        }\n      }\n    }",
)

# SceneViewport can enter object editing while a shot camera is present but landed.
replace_once(
    'src/components/viewers/SceneViewport.tsx',
    "  appearance = 'clay',\n  onFreeCameraActiveChange,",
    "  appearance = 'clay',\n  objectEditingActive = false,\n  onFreeCameraActiveChange,",
)
replace_once(
    'src/components/viewers/SceneViewport.tsx',
    "  appearance?: ViewportAppearanceMode;\n  onFreeCameraActiveChange?:",
    "  appearance?: ViewportAppearanceMode;\n  /** Allow object picking/gizmos while a landed shot camera remains active. */\n  objectEditingActive?: boolean;\n  onFreeCameraActiveChange?:",
)
replace_once(
    'src/components/viewers/SceneViewport.tsx',
    "      if (framing) return;\n",
    "      if (framing && !objectEditingActive) return;\n",
)

# Build object properties classify imported people and movable props.
replace_once(
    'src/components/workspaces/BuildWorkspace.tsx',
    "import { Euler, ObjectSurfaceStyle, SceneObject, SceneObjectType, Vec3 } from '../../domain/types';",
    "import { Euler, ObjectSurfaceStyle, SceneObject, SceneObjectType, StagingRole, Vec3 } from '../../domain/types';",
)
replace_once(
    'src/components/workspaces/BuildWorkspace.tsx',
    "  resolveSurfaceStyle,\n} from '../../engine/sceneObjects';",
    "  resolveSurfaceStyle,\n} from '../../engine/sceneObjects';\nimport { getSceneObjectStagingRole } from '../../engine/shotSceneState';",
)
replace_once(
    'src/components/workspaces/BuildWorkspace.tsx',
    "      <Field label=\"Surface\">",
    "      <Field label=\"Staging role\" hint=\"Props and people can move independently in each shot.\">\n        <Select\n          value={getSceneObjectStagingRole(object)}\n          onChange={(event) => onChange({ stagingRole: event.target.value as StagingRole }, 'step')}\n          data-object-staging-role\n        >\n          <option value=\"set\">Set geometry</option>\n          <option value=\"prop\">Movable prop</option>\n          <option value=\"person\">Person / character</option>\n        </Select>\n      </Field>\n      <Field label=\"Surface\">",
)

# Shots workspace: staging mode, visibility, direct clean-plate still/video exports.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  Settings2,\n  Trash2,",
    "  Settings2,\n  Eye,\n  EyeOff,\n  Move3D,\n  RotateCw,\n  Trash2,",
)
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "import { CameraData, Shot, ShotStatus } from '../../domain/types';",
    "import { CameraData, PeopleExportMode, SceneObject, Shot, ShotStatus, Transform, Vec3 } from '../../domain/types';",
)
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "import { canUseProjectedAppearance } from '../../engine/projectedStyle';",
    "import { canUseProjectedAppearance } from '../../engine/projectedStyle';\nimport {\n  canStageObjectPerShot,\n  clearShotObjectOverride,\n  resolveProjectForShot,\n  updateShotObjectOverrides,\n} from '../../engine/shotSceneState';\nimport { getPeopleRenderVariants, getPeopleVariantPath } from '../../engine/peopleExport';\nimport type { GizmoMode } from '../../engine/transformGizmo';",
)
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  const [cameraReseedGeneration, setCameraReseedGeneration] = useState(0);",
    "  const [cameraReseedGeneration, setCameraReseedGeneration] = useState(0);\n  const [stagingMode, setStagingMode] = useState(false);\n  const [stagingGizmoMode, setStagingGizmoMode] = useState<GizmoMode>('translate');\n  const [stagedObjectId, setStagedObjectId] = useState<string>();\n  const [showPeopleInViewport, setShowPeopleInViewport] = useState(true);",
)
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];\n",
    "  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];\n  const shotSceneProject = useMemo(\n    () => selectedShot\n      ? resolveProjectForShot(project, selectedShot, { hidePeople: !showPeopleInViewport })\n      : project,\n    [project, selectedShot, showPeopleInViewport],\n  );\n  const stagedObject = stagedObjectId\n    ? shotSceneProject.scene.objects.find((object) => object.id === stagedObjectId)\n    : undefined;\n",
)
# Direct still export loops variants.
text, crlf = read('src/components/workspaces/ShotsWorkspace.tsx')
start = text.index('  const exportCameraFrame = useCallback(async () => {')
end = text.index('\n  const updateCameraMoveKeyframes', start)
still_fn = """  const exportCameraFrame = useCallback(async () => {
    const previewShot = getPreviewShot();
    if (!previewShot) return;
    const peopleMode = previewShot.exportSettings.peopleExportMode;
    const variants = getPeopleRenderVariants(peopleMode);
    setIsExportingFrame(true);
    try {
      for (const variant of variants) {
        const frame = await renderShotFrame(project, previewShot, { peopleVariant: variant });
        const clayName = getPeopleVariantPath(exportFrameFileName, variant, peopleMode);
        if (variant === 'with_people' || variants.length === 1) {
          setShotFramePreview(previewShot.id, frame.dataUrl);
          attachViewportRenderToShot(previewShot.id, {
            name: clayName,
            dataUrl: frame.dataUrl,
            width: frame.width,
            height: frame.height,
          });
        }
        downloadDataUrl(frame.dataUrl, clayName);
        if (canUseProjectedAppearance(project)) {
          try {
            const projected = await renderShotProjectedFrame(project, previewShot, { peopleVariant: variant });
            const baseProjectedName = selectedShot
              ? getProjectedStillDownloadName(selectedShot)
              : exportFrameFileName.replace(/\.png$/i, '_projected.png');
            downloadDataUrl(
              projected.dataUrl,
              getPeopleVariantPath(baseProjectedName, variant, peopleMode),
            );
          } catch {
            // Soft-fail projected companion; clay already succeeded.
          }
        }
      }
      if (!shotCameraFlying) updateShot(previewShot.id, { status: 'exported' });
    } finally {
      setIsExportingFrame(false);
    }
  }, [
    attachViewportRenderToShot,
    exportFrameFileName,
    getPreviewShot,
    project,
    selectedShot,
    setShotFramePreview,
    shotCameraFlying,
    updateShot,
  ]);
"""
text = text[:start] + still_fn + text[end:]
write('src/components/workspaces/ShotsWorkspace.tsx', text, crlf)

# Replace camera move export function with variant-aware sequential export.
text, crlf = read('src/components/workspaces/ShotsWorkspace.tsx')
start = text.index('  const exportCameraMoveVideo = useCallback(async () => {')
end = text.index('\n  useEffect(() => {\n    if (!selectedShot)', start)
video_fn = """  const exportCameraMoveVideo = useCallback(async () => {
    if (!selectedShot) return;
    if (!canExportVideo) {
      setCameraMoveError('MP4 export is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (!hasRenderableCameraMove(selectedShot.cameraKeyframes)) {
      setCameraMoveError('Capture start and end camera keyframes before exporting MP4.');
      return;
    }
    if (videoExportMode === 'render' && canRenderMp4 !== true) {
      setCameraMoveError(
        `Render MP4 is unavailable for ${videoResolutionPreset === '4k' ? '4K' : '1080p'} in this browser. Choose Quick Preview, or try Chrome/Edge.`,
      );
      return;
    }
    if (videoExportMode === 'quickPreview' && !supportedMp4MimeType) {
      setCameraMoveError('Quick Preview MP4 is not supported in this browser.');
      return;
    }

    const variants = getPeopleRenderVariants(selectedShot.exportSettings.peopleExportMode);
    const dualProjectedVideo = canUseProjectedAppearance(project);
    const totalPasses = variants.length * (dualProjectedVideo ? 2 : 1);
    const abortController = new AbortController();
    cameraMoveAbortRef.current = { cancelled: false, abort: () => abortController.abort() };
    setIsExportingCameraMove(true);
    setCameraMoveProgress(0);
    setCameraMoveProgressMessage('Preparing scene');
    setCameraMoveError(undefined);

    try {
      let pass = 0;
      for (const variant of variants) {
        const video = await renderShotCameraMoveMp4(project, selectedShot, {
          mode: videoExportMode,
          resolutionPreset: videoResolutionPreset,
          frameRate: 30,
          appearance: 'clay',
          peopleVariant: variant,
          includeDataUrl: true,
          signal: abortController.signal,
          onProgress: (progress) => {
            const value = typeof progress === 'number' ? progress : progress.progress;
            const message = typeof progress === 'number' ? 'Rendering clay motion' : progress.message;
            setCameraMoveProgress((pass + value) / totalPasses);
            setCameraMoveProgressMessage(message);
          },
        });
        if (cameraMoveAbortRef.current.cancelled) return;
        if (!video.dataUrl) throw new Error('Camera move export did not produce a persistable video URI.');
        const clayName = getPeopleVariantPath(
          cameraMoveFileName,
          variant,
          selectedShot.exportSettings.peopleExportMode,
        );
        if (variant === 'with_people' || variants.length === 1) {
          const asset = attachCameraMoveVideoToShot(selectedShot.id, {
            name: clayName,
            dataUrl: video.dataUrl,
            mimeType: video.mimeType,
            width: video.width,
            height: video.height,
            durationSeconds: video.durationSeconds,
            frameRate: video.frameRate,
            encodeMode: video.encodeMode ?? videoExportMode,
            codecString: video.codecString,
            frameCount: video.frameCount,
            resolutionPreset: videoResolutionPreset,
          });
          setCameraMovePreviewUrl(asset.uri);
        }
        downloadBlob(video.blob, clayName);
        pass += 1;

        if (dualProjectedVideo) {
          const projectedVideo = await renderShotCameraMoveMp4(project, selectedShot, {
            mode: videoExportMode,
            resolutionPreset: videoResolutionPreset,
            frameRate: 30,
            appearance: 'projected',
            peopleVariant: variant,
            occlusionFilter: videoExportMode === 'render' ? 'fast' : 'soft',
            includeDataUrl: false,
            signal: abortController.signal,
            onProgress: (progress) => {
              const value = typeof progress === 'number' ? progress : progress.progress;
              const message = typeof progress === 'number' ? 'Rendering projected motion' : progress.message;
              setCameraMoveProgress((pass + value) / totalPasses);
              setCameraMoveProgressMessage(message);
            },
          });
          if (cameraMoveAbortRef.current.cancelled) return;
          downloadBlob(
            projectedVideo.blob,
            getPeopleVariantPath(
              getProjectedCameraMoveDownloadName(selectedShot),
              variant,
              selectedShot.exportSettings.peopleExportMode,
            ),
          );
          pass += 1;
        }
      }
      setCameraMoveProgress(1);
      setCameraMoveProgressMessage('Complete');
    } catch (error) {
      if (!cameraMoveAbortRef.current.cancelled) {
        setCameraMoveError(error instanceof Error ? error.message : 'MP4 export failed.');
      }
    } finally {
      if (!cameraMoveAbortRef.current.cancelled) setIsExportingCameraMove(false);
    }
  }, [
    attachCameraMoveVideoToShot,
    cameraMoveFileName,
    canExportVideo,
    canRenderMp4,
    project,
    selectedShot,
    supportedMp4MimeType,
    videoExportMode,
    videoResolutionPreset,
  ]);
"""
text = text[:start] + video_fn + text[end:]
write('src/components/workspaces/ShotsWorkspace.tsx', text, crlf)

# Staging callbacks and mode lifecycle before shotFraming memo.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "  const panoMatch = selectedShot && linkedPano\n",
    "  const enterStagingMode = useCallback(() => {\n    if (!selectedShot) return;\n    const camera = getEffectiveCamera();\n    landShotFraming(selectedShot.id, camera);\n    setStagingMode(true);\n    setStagedObjectId(undefined);\n  }, [getEffectiveCamera, landShotFraming, selectedShot]);\n\n  const exitStagingMode = useCallback(() => {\n    setStagingMode(false);\n    setStagedObjectId(undefined);\n    startFlyCamera({ clearFramingAcceptance: false });\n  }, [startFlyCamera]);\n\n  const selectStagedObject = useCallback((id?: string) => {\n    if (!id) {\n      setStagedObjectId(undefined);\n      return;\n    }\n    const object = shotSceneProject.scene.objects.find((item) => item.id === id);\n    setStagedObjectId(object && canStageObjectPerShot(object) ? id : undefined);\n  }, [shotSceneProject.scene.objects]);\n\n  const updateStagedTransform = useCallback((objectId: string, transform: Transform) => {\n    if (!selectedShot) return;\n    const baseObject = project.scene.objects.find((object) => object.id === objectId);\n    if (!baseObject || !canStageObjectPerShot(baseObject)) return;\n    updateShot(selectedShot.id, {\n      objectOverrides: updateShotObjectOverrides(selectedShot, baseObject, { transform }),\n    });\n  }, [project.scene.objects, selectedShot, updateShot]);\n\n  const moveStagedObject = useCallback((objectId: string, position: Vec3) => {\n    const object = shotSceneProject.scene.objects.find((item) => item.id === objectId);\n    if (!object) return;\n    updateStagedTransform(objectId, { ...object.transform, position });\n  }, [shotSceneProject.scene.objects, updateStagedTransform]);\n\n  const rotateStagedObject = useCallback((objectId: string, rotation: Vec3) => {\n    const object = shotSceneProject.scene.objects.find((item) => item.id === objectId);\n    if (!object) return;\n    updateStagedTransform(objectId, { ...object.transform, rotation });\n  }, [shotSceneProject.scene.objects, updateStagedTransform]);\n\n  const toggleStagedObjectVisibility = useCallback(() => {\n    if (!selectedShot || !stagedObject) return;\n    const baseObject = project.scene.objects.find((object) => object.id === stagedObject.id);\n    if (!baseObject) return;\n    updateShot(selectedShot.id, {\n      objectOverrides: updateShotObjectOverrides(selectedShot, baseObject, { visible: !stagedObject.visible }),\n    });\n  }, [project.scene.objects, selectedShot, stagedObject, updateShot]);\n\n  const resetStagedObject = useCallback(() => {\n    if (!selectedShot || !stagedObjectId) return;\n    updateShot(selectedShot.id, {\n      objectOverrides: clearShotObjectOverride(selectedShot, stagedObjectId),\n    });\n  }, [selectedShot, stagedObjectId, updateShot]);\n\n  const panoMatch = selectedShot && linkedPano\n",
)
# shot framing fly disabled in staging.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "        flyActive: shotCameraFlying,",
    "        flyActive: stagingMode ? false : shotCameraFlying,",
)
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "    shotCameraFlying,\n    videoPhase,",
    "    shotCameraFlying,\n    stagingMode,\n    videoPhase,",
)
# reset staging on shot switch.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "    setVideoPhase('record');\n    if (selectedShot) {",
    "    setVideoPhase('record');\n    setStagedObjectId(undefined);\n    if (selectedShot) {",
)
# SceneViewport props.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "            project={project}\n            selectedShotId={selectedShot?.id}\n            shotFraming={shotFraming}\n            appearance={appearance}",
    "            project={shotSceneProject}\n            selectedObjectIds={stagedObjectId ? [stagedObjectId] : []}\n            selectedShotId={selectedShot?.id}\n            shotFraming={shotFraming}\n            appearance={appearance}\n            objectEditingActive={stagingMode}\n            showTransformGizmo={stagingMode && Boolean(stagedObjectId)}\n            gizmoMode={stagingGizmoMode}\n            snapToGrid={false}\n            onSelectObject={stagingMode ? selectStagedObject : undefined}\n            onMoveObjectInSpace={stagingMode ? moveStagedObject : undefined}\n            onRotateObject={stagingMode ? rotateStagedObject : undefined}",
)
# Top controls include stage and people visibility.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "              <AppearanceModeToggle\n",
    "              <button\n                type=\"button\"\n                onClick={() => setShowPeopleInViewport((value) => !value)}\n                className=\"inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-card backdrop-blur-sm transition hover:bg-black/60\"\n                aria-label={showPeopleInViewport ? 'Hide people in viewport' : 'Show people in viewport'}\n                title={showPeopleInViewport ? 'Hide people' : 'Show people'}\n                data-shots-people-visibility\n              >\n                {showPeopleInViewport ? <Eye className=\"h-4 w-4\" /> : <EyeOff className=\"h-4 w-4\" />}\n              </button>\n              <button\n                type=\"button\"\n                onClick={stagingMode ? exitStagingMode : enterStagingMode}\n                className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-white shadow-card backdrop-blur-sm transition ${\n                  stagingMode ? 'border-white bg-white/20' : 'border-white/15 bg-black/45 hover:bg-black/60'\n                }`}\n                data-shots-staging-toggle\n              >\n                <Move3D className=\"h-4 w-4\" />\n                {stagingMode ? 'Done' : 'Stage'}\n              </button>\n              <AppearanceModeToggle\n",
)
# Insert staging panel before quiet landed flash.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "        {/* Quiet landed flash */}",
    "        {stagingMode && (\n          <div className=\"pointer-events-auto absolute left-4 top-[calc(var(--stage-header-safe)+3.25rem)] z-20 w-72 rounded-2xl border border-white/15 bg-black/70 p-3 text-white shadow-soft backdrop-blur-md\" data-shots-staging-panel>\n            <div className=\"flex items-center justify-between gap-2\">\n              <div>\n                <div className=\"text-sm font-semibold\">Per-shot staging</div>\n                <div className=\"text-[11px] text-white/60\">Select a prop or person, then move or rotate it.</div>\n              </div>\n              <div className=\"flex gap-1\">\n                <button type=\"button\" onClick={() => setStagingGizmoMode('translate')} className={`rounded-lg p-2 ${stagingGizmoMode === 'translate' ? 'bg-white text-black' : 'bg-white/10 text-white'}`} title=\"Move\"><Move3D className=\"h-4 w-4\" /></button>\n                <button type=\"button\" onClick={() => setStagingGizmoMode('rotate')} className={`rounded-lg p-2 ${stagingGizmoMode === 'rotate' ? 'bg-white text-black' : 'bg-white/10 text-white'}`} title=\"Rotate\"><RotateCw className=\"h-4 w-4\" /></button>\n              </div>\n            </div>\n            {stagedObject ? (\n              <div className=\"mt-3 space-y-2 border-t border-white/10 pt-3\">\n                <div className=\"truncate text-xs font-semibold\">{stagedObject.name}</div>\n                <div className=\"grid grid-cols-2 gap-2\">\n                  <button type=\"button\" onClick={toggleStagedObjectVisibility} className=\"rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/15\">{stagedObject.visible ? 'Hide in shot' : 'Show in shot'}</button>\n                  <button type=\"button\" onClick={resetStagedObject} className=\"rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/15\">Reset to set</button>\n                </div>\n              </div>\n            ) : (\n              <p className=\"mt-3 border-t border-white/10 pt-3 text-xs text-white/60\">No stageable object selected.</p>\n            )}\n          </div>\n        )}\n\n        {/* Quiet landed flash */}",
)
# Camera settings people export mode.
replace_once(
    'src/components/workspaces/ShotsWorkspace.tsx',
    "            <Field label=\"Resolution\">",
    "            <Field label=\"People export\" hint=\"Clean plate keeps the same camera and staging but hides every object classified as a person.\">\n              <Select\n                value={selectedShot.exportSettings.peopleExportMode ?? 'with_people'}\n                onChange={(event) => updateShot(selectedShot.id, {\n                  exportSettings: {\n                    ...selectedShot.exportSettings,\n                    peopleExportMode: event.target.value as PeopleExportMode,\n                  },\n                })}\n                data-shots-people-export-mode\n              >\n                <option value=\"with_people\">With people</option>\n                <option value=\"clean_plate\">Clean plate</option>\n                <option value=\"both\">Both</option>\n              </Select>\n            </Field>\n            <Field label=\"Resolution\">",
)

# Export workspace exposes the same per-shot mode.
replace_once(
    'src/components/workspaces/ExportWorkspace.tsx',
    "import { Shot } from '../../domain/types';",
    "import { PeopleExportMode, Shot } from '../../domain/types';",
)
replace_once(
    'src/components/workspaces/ExportWorkspace.tsx',
    "import { Field, IconButton, TextInput } from '../common/Field';",
    "import { Field, IconButton, Select, TextInput } from '../common/Field';",
)
replace_once(
    'src/components/workspaces/ExportWorkspace.tsx',
    "            {([\n              ['includeViewport'",
    "            <Field label=\"People output\" hint=\"Both adds matched with-people and clean-plate images/videos.\">\n              <Select\n                value={selectedShot.exportSettings.peopleExportMode ?? 'with_people'}\n                onChange={(event) => updateShot(selectedShot.id, {\n                  exportSettings: {\n                    ...selectedShot.exportSettings,\n                    peopleExportMode: event.target.value as PeopleExportMode,\n                  },\n                })}\n                data-export-people-mode\n              >\n                <option value=\"with_people\">With people</option>\n                <option value=\"clean_plate\">Clean plate</option>\n                <option value=\"both\">Both</option>\n              </Select>\n            </Field>\n            {([\n              ['includeViewport'",
)

# Tests for export variants and manifest paths.
write(
    'tests/peopleExport.test.ts',
    """import { describe, expect, it } from 'vitest';
import { createDefaultProject, createSceneObject } from '../src/domain/defaults';
import { createShotPackageManifest } from '../src/engine/exportManifest';
import {
  getPeopleRenderVariants,
  getPeopleVariantPath,
} from '../src/engine/peopleExport';
import { resolveProjectForShot } from '../src/engine/shotSceneState';

describe('people output variants', () => {
  it('preserves legacy names for with-people-only and suffixes dual outputs', () => {
    expect(getPeopleRenderVariants('with_people')).toEqual(['with_people']);
    expect(getPeopleRenderVariants('both')).toEqual(['with_people', 'clean_plate']);
    expect(getPeopleVariantPath('viewport.png', 'with_people', 'with_people')).toBe('viewport.png');
    expect(getPeopleVariantPath('viewport.png', 'with_people', 'both')).toBe('viewport_with_people.png');
    expect(getPeopleVariantPath('viewport.png', 'clean_plate', 'both')).toBe('viewport_clean_plate.png');
  });

  it('hides built-in and imported people without changing props', () => {
    const project = createDefaultProject();
    const mannequin = createSceneObject('human_dummy', 1);
    const importedPerson = createSceneObject('imported_model', 1);
    importedPerson.stagingRole = 'person';
    const prop = createSceneObject('box', 1);
    prop.stagingRole = 'prop';
    project.scene.objects.push(mannequin, importedPerson, prop);

    const clean = resolveProjectForShot(project, project.shots[0], { hidePeople: true });
    const byId = new Map(clean.scene.objects.map((object) => [object.id, object]));
    expect(byId.get(mannequin.id)?.visible).toBe(false);
    expect(byId.get(importedPerson.id)?.visible).toBe(false);
    expect(byId.get(prop.id)?.visible).toBe(true);
  });

  it('lists paired still paths in a both-mode package manifest', () => {
    const project = createDefaultProject();
    const shot = project.shots[0];
    shot.exportSettings.peopleExportMode = 'both';
    shot.exportSettings.includeProjectedViewport = false;
    const paths = createShotPackageManifest(project, shot).files.map((file) => file.path);
    expect(paths.some((path) => path.endsWith('/viewport_clay_with_people.png'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/viewport_clay_clean_plate.png'))).toBe(true);
  });
});
""",
    False,
)

print('Applied staging UI and clean plate implementation.')
