import { describe, expect, it } from 'vitest';
import { createDefaultProject, createPanoAsset, createPanoReference } from '../src/domain/defaults';
import {
  getRecommendedWorkspace,
  hasGrayboxPano,
  isReferenceReady,
  isShotFramingAccepted,
  isStepComplete,
  resolveProductionPath,
  resolveWorkspaceObjective,
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