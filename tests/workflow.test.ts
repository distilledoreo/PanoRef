import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import {
  getRecommendedWorkspace,
  hasGrayboxPano,
  isReferenceAlignmentAccepted,
  isReferenceReady,
  isShotFramingAccepted,
  needsReferenceAlignment,
  isStepComplete,
  buildAdvancePromptKey,
  resolveProductionPath,
  resolveWorkflowAdvancePrompt,
  resolveWorkspaceObjective,
  resolveWorkspacePrimaryAction,
} from '../src/engine/workflow';

function withGraybox(project = createDefaultProject()) {
  const asset = createPanoAsset({ name: 'graybox.png', uri: 'data:image/png;base64,AAAA', width: 2048, height: 1024 });
  const pano = createPanoReference({
    name: 'Graybox',
    assetId: asset.id,
    type: 'graybox_render',
    origin: project.scene.panoOrigin,
    width: 2048,
    height: 1024,
    isCanonical: true,
  });
  project.assets.assets[asset.id] = asset;
  project.panoRefs.push(pano);
  return project;
}

describe('workflow resolver', () => {
  it('starts a fresh project at Build guidance', () => {
    const project = createDefaultProject();
    expect(getRecommendedWorkspace({ project, workspace: 'build', shotCameraFlying: false })).toBe('build');
    expect(hasGrayboxPano(project)).toBe(false);
    expect(isStepComplete('build', project)).toBe(false);
  });

  it('advances reference guidance after graybox render', () => {
    const project = withGraybox();
    expect(isStepComplete('build', project)).toBe(true);
    expect(isReferenceReady(project)).toBe(false);
    expect(getRecommendedWorkspace({ project, workspace: 'build', shotCameraFlying: false })).toBe('reference');
  });

  it('accepts graybox-as-reference checkpoint', () => {
    const project = withGraybox();
    project.workflow.grayboxApprovedForReferenceAt = new Date().toISOString();
    expect(isReferenceReady(project)).toBe(true);
    expect(isStepComplete('reference', project)).toBe(true);
  });

  it('requires alignment acceptance after importing a styled reference', () => {
    const project = withGraybox();
    const graybox = project.panoRefs[0];
    graybox.isCanonical = false;
    const asset = createPanoAsset({ name: 'styled.png', uri: 'data:image/png;base64,BBBB', width: 4096, height: 2048 });
    const styled = createPanoReference({
      name: 'Styled Reference',
      assetId: asset.id,
      type: 'ai_global_reference',
      origin: project.scene.panoOrigin,
      width: 4096,
      height: 2048,
      isCanonical: true,
      sourcePanoId: graybox.id,
    });
    project.assets.assets[asset.id] = asset;
    project.panoRefs.push(styled);

    expect(needsReferenceAlignment(project)).toBe(true);
    expect(isReferenceAlignmentAccepted(project)).toBe(false);
    expect(isReferenceReady(project)).toBe(false);

    project.workflow.referenceAlignmentAcceptedForPanoId = styled.id;
    expect(isReferenceAlignmentAccepted(project)).toBe(true);
    expect(isReferenceReady(project)).toBe(true);
  });

  it('requires explicit accept framing after camera lock', () => {
    const project = withGraybox();
    project.workflow.grayboxApprovedForReferenceAt = new Date().toISOString();
    const shotId = project.shots[0].id;
    expect(isShotFramingAccepted(project, shotId)).toBe(false);
    expect(isStepComplete('shots', project, shotId)).toBe(false);

    project.workflow.shotFramingAcceptedAtByShotId[shotId] = new Date().toISOString();
    expect(isStepComplete('shots', project, shotId)).toBe(true);
  });

  it('marks review complete after AI brief and result import', () => {
    const project = withGraybox();
    const shot = project.shots[0];
    project.workflow.grayboxApprovedForReferenceAt = new Date().toISOString();
    project.workflow.shotFramingAcceptedAtByShotId[shot.id] = new Date().toISOString();
    project.workflow.aiBriefSentAtByShotId[shot.id] = new Date().toISOString();
    shot.assets.aiResultFrameAssetId = 'asset_ai';
    expect(isStepComplete('review', project, shot.id)).toBe(true);
  });

  it('marks export complete after final package checkpoint', () => {
    const project = withGraybox();
    const shot = project.shots[0];
    project.workflow.finalPackageExportedAtByShotId[shot.id] = new Date().toISOString();
    expect(isStepComplete('export', project, shot.id)).toBe(true);
  });

  it('resolves production path states for the active workspace', () => {
    const project = withGraybox();
    const steps = resolveProductionPath({
      project,
      workspace: 'reference',
      selectedShotId: project.shots[0].id,
      shotCameraFlying: false,
    });
    expect(steps.find((step) => step.id === 'build')?.state).toBe('complete');
    expect(steps.find((step) => step.id === 'reference')?.state).toBe('needs_action');
  });

  it('offers an advance prompt when the active workspace step is complete', () => {
    const project = withGraybox();
    const context = { project, workspace: 'build' as const, shotCameraFlying: false };
    const prompt = resolveWorkflowAdvancePrompt(context);
    expect(prompt?.nextStep).toBe('reference');
    expect(prompt?.promptKey).toBe(buildAdvancePromptKey('build', 'reference'));
    expect(resolveWorkflowAdvancePrompt(context, [prompt!.promptKey])).toBeUndefined();
  });

  it('highlights the next major action for each workspace', () => {
    const project = createDefaultProject();
    expect(resolveWorkspacePrimaryAction({ project, workspace: 'build', shotCameraFlying: false })?.id).toBe('render-graybox');

    const withBox = withGraybox();
    expect(resolveWorkspacePrimaryAction({ project: withBox, workspace: 'reference', shotCameraFlying: false })?.id).toBe('import-styled-pano');

    withBox.workflow.grayboxApprovedForReferenceAt = new Date().toISOString();
    const shotId = withBox.shots[0].id;
    expect(resolveWorkspacePrimaryAction({
      project: withBox,
      workspace: 'shots',
      selectedShotId: shotId,
      shotCameraFlying: true,
    })?.id).toBe('lock-camera');
    expect(resolveWorkspacePrimaryAction({
      project: withBox,
      workspace: 'shots',
      selectedShotId: shotId,
      shotCameraFlying: false,
    })?.id).toBe('accept-framing');
  });

  it('describes workspace objectives with proceed signals', () => {
    const project = withGraybox();
    const objective = resolveWorkspaceObjective({
      project,
      workspace: 'shots',
      selectedShotId: project.shots[0].id,
      shotCameraFlying: true,
    });
    expect(objective.goal).toContain(project.shots[0].name);
    expect(objective.blockers.length).toBeGreaterThan(0);
  });
});