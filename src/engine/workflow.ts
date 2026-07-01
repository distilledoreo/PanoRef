import { getCanonicalPano, getLatestGrayboxPano } from '../domain/selectors';
import { LocationProject, ProjectWorkflow, Shot, Workspace } from '../domain/types';

export type ProductionStepId = Workspace;
export type ProductionStepState = 'complete' | 'current' | 'ready' | 'needs_action' | 'optional';

export interface ProductionStepStatus {
  id: ProductionStepId;
  label: string;
  state: ProductionStepState;
}

export interface WorkspaceObjective {
  goal: string;
  why: string;
  proceedSignal: string;
  blockers: string[];
}

export interface ShotWorkflowProgress {
  framingAccepted: boolean;
  aiBriefSent: boolean;
  aiResultImported: boolean;
  finalPackageExported: boolean;
}

export interface ProductionPathContext {
  project: LocationProject;
  workspace: Workspace;
  selectedShotId?: string;
  shotCameraFlying: boolean;
}

const STEP_LABELS: Record<ProductionStepId, string> = {
  build: 'Build',
  reference: 'Reference',
  shots: 'Shots',
  review: 'Review',
  export: 'Export',
};

const STEP_ORDER: ProductionStepId[] = ['build', 'reference', 'shots', 'review', 'export'];

export function normalizeProjectWorkflow(workflow?: Partial<ProjectWorkflow>): ProjectWorkflow {
  return {
    grayboxApprovedForReferenceAt: workflow?.grayboxApprovedForReferenceAt,
    shotFramingAcceptedAtByShotId: { ...workflow?.shotFramingAcceptedAtByShotId },
    aiBriefSentAtByShotId: { ...workflow?.aiBriefSentAtByShotId },
    finalPackageExportedAtByShotId: { ...workflow?.finalPackageExportedAtByShotId },
  };
}

export function getSelectedShot(project: LocationProject, selectedShotId?: string): Shot | undefined {
  return project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];
}

export function hasGrayboxPano(project: LocationProject): boolean {
  return Boolean(getLatestGrayboxPano(project));
}

export function hasStyledCanonicalPano(project: LocationProject): boolean {
  const canonical = getCanonicalPano(project);
  return Boolean(canonical && canonical.type !== 'graybox_render');
}

export function isReferenceReady(project: LocationProject): boolean {
  return Boolean(
    project.workflow.grayboxApprovedForReferenceAt
    || hasStyledCanonicalPano(project),
  );
}

export function isShotFramingAccepted(project: LocationProject, shotId?: string): boolean {
  if (!shotId) return false;
  return Boolean(project.workflow.shotFramingAcceptedAtByShotId[shotId]);
}

export function isAiBriefSent(project: LocationProject, shotId?: string): boolean {
  if (!shotId) return false;
  return Boolean(project.workflow.aiBriefSentAtByShotId[shotId]);
}

export function hasAiResultFrame(shot?: Shot): boolean {
  if (!shot) return false;
  return Boolean(shot.assets.aiResultFrameAssetId ?? shot.assets.finalBaseFrameAssetId);
}

export function isFinalPackageExported(project: LocationProject, shotId?: string): boolean {
  if (!shotId) return false;
  return Boolean(project.workflow.finalPackageExportedAtByShotId[shotId]);
}

export function isStepComplete(step: ProductionStepId, project: LocationProject, shotId?: string): boolean {
  switch (step) {
    case 'build':
      return hasGrayboxPano(project);
    case 'reference':
      return isReferenceReady(project);
    case 'shots':
      return isShotFramingAccepted(project, shotId);
    case 'review':
      return isAiBriefSent(project, shotId) && hasAiResultFrame(getSelectedShot(project, shotId));
    case 'export':
      return isFinalPackageExported(project, shotId);
    default:
      return false;
  }
}

function stepBlockers(step: ProductionStepId, context: ProductionPathContext): string[] {
  const { project, selectedShotId, shotCameraFlying } = context;
  const shot = getSelectedShot(project, selectedShotId);

  switch (step) {
    case 'build':
      return hasGrayboxPano(project) ? [] : ['Render a graybox 360 from the set.'];
    case 'reference':
      if (isReferenceReady(project)) return [];
      if (!hasGrayboxPano(project)) return ['Render the graybox 360 in Build first.'];
      return ['Import a styled reference or approve the graybox as your working reference.'];
    case 'shots':
      if (!shot) return ['Add a camera shot.'];
      if (shotCameraFlying) return ['Lock the camera to finish framing.'];
      if (!isShotFramingAccepted(project, shot.id)) return ['Accept framing after the camera is locked.'];
      return [];
    case 'review':
      if (!shot) return ['Select a shot.'];
      if (!isShotFramingAccepted(project, shot.id)) return ['Accept shot framing in Shots first.'];
      if (!isAiBriefSent(project, shot.id)) return ['Export the AI Brief ZIP and mark it sent.'];
      if (!hasAiResultFrame(shot)) return ['Import the generated AI result frame.'];
      return [];
    case 'export':
      if (!shot) return ['Select a shot.'];
      if (!hasAiResultFrame(shot)) return ['Import an AI result frame in Review first.'];
      if (!isFinalPackageExported(project, shot.id)) return ['Export the final ZIP package for this shot.'];
      return [];
    default:
      return [];
  }
}

function canAccessStep(step: ProductionStepId, project: LocationProject, shotId?: string): boolean {
  const index = STEP_ORDER.indexOf(step);
  if (index <= 0) return true;
  for (let i = 0; i < index; i += 1) {
    if (!isStepComplete(STEP_ORDER[i], project, shotId)) return false;
  }
  return true;
}

export function resolveProductionStepState(
  step: ProductionStepId,
  context: ProductionPathContext,
): ProductionStepState {
  const { project, workspace, selectedShotId } = context;
  if (isStepComplete(step, project, selectedShotId)) return 'complete';
  if (step === workspace) {
    return stepBlockers(step, context).length > 0 ? 'needs_action' : 'current';
  }
  if (canAccessStep(step, project, selectedShotId)) return 'ready';
  const firstIncomplete = STEP_ORDER.find((item) => !isStepComplete(item, project, selectedShotId));
  if (firstIncomplete === step) return 'needs_action';
  return 'optional';
}

export function resolveProductionPath(context: ProductionPathContext): ProductionStepStatus[] {
  return STEP_ORDER.map((id) => ({
    id,
    label: STEP_LABELS[id],
    state: resolveProductionStepState(id, context),
  }));
}

export function getShotWorkflowProgress(project: LocationProject, shot: Shot): ShotWorkflowProgress {
  return {
    framingAccepted: isShotFramingAccepted(project, shot.id),
    aiBriefSent: isAiBriefSent(project, shot.id),
    aiResultImported: hasAiResultFrame(shot),
    finalPackageExported: isFinalPackageExported(project, shot.id),
  };
}

export function resolveWorkspaceObjective(context: ProductionPathContext): WorkspaceObjective {
  const { project, workspace, selectedShotId, shotCameraFlying } = context;
  const shot = getSelectedShot(project, selectedShotId);
  const blockers = stepBlockers(workspace, context);

  switch (workspace) {
    case 'build':
      return {
        goal: 'Shape the graybox set and capture a 360 reference point.',
        why: 'The graybox pano anchors every later shot to the same physical space.',
        proceedSignal: hasGrayboxPano(project)
          ? 'Graybox captured — move to Reference when the set feels right.'
          : 'Render the graybox 360 once the origin and blocking look correct.',
        blockers,
      };
    case 'reference':
      return {
        goal: 'Choose the global environment reference for shot crops and prompts.',
        why: 'Shots borrow style and context from the reference you establish here.',
        proceedSignal: isReferenceReady(project)
          ? 'Reference is ready — open Shots to frame cameras.'
          : 'Import a styled pano or approve the graybox as the working reference.',
        blockers,
      };
    case 'shots':
      return {
        goal: shot ? `Frame ${shot.name} and accept the locked camera.` : 'Frame the active camera shot.',
        why: 'Accepted framing becomes the camera truth for AI briefs and exports.',
        proceedSignal: shot && isShotFramingAccepted(project, shot.id)
          ? 'Framing accepted — continue to Review for the AI handoff.'
          : shotCameraFlying
            ? 'Lock the camera, then accept framing.'
            : 'Fly the camera, lock it, then accept framing.',
        blockers,
      };
    case 'review':
      return {
        goal: shot ? `Hand ${shot.name} to your image generator and bring the result back.` : 'Export the AI brief and import a result frame.',
        why: 'Review is where external generation meets the continuity package.',
        proceedSignal: shot && hasAiResultFrame(shot) && isAiBriefSent(project, shot.id)
          ? 'AI result imported — export the final package in Export.'
          : 'Export the AI Brief ZIP, mark it sent, then import the result frame.',
        blockers,
      };
    case 'export':
      return {
        goal: shot ? `Publish the final continuity package for ${shot.name}.` : 'Export the final shot package.',
        why: 'This ZIP is the deliverable for downstream video and continuity tooling.',
        proceedSignal: shot && isFinalPackageExported(project, shot.id)
          ? 'Final package exported for this shot.'
          : 'Export the final ZIP when the manifest looks complete.',
        blockers,
      };
    default:
      return {
        goal: 'Follow the production path.',
        why: 'Each step builds on the last without locking you in.',
        proceedSignal: 'Pick the next workspace when you are ready.',
        blockers,
      };
  }
}

export function getRecommendedWorkspace(context: ProductionPathContext): Workspace {
  const firstIncomplete = STEP_ORDER.find((step) => !isStepComplete(step, context.project, context.selectedShotId));
  return firstIncomplete ?? 'export';
}

export function getNextProductionStep(step: ProductionStepId): ProductionStepId | undefined {
  const index = STEP_ORDER.indexOf(step);
  if (index < 0 || index >= STEP_ORDER.length - 1) return undefined;
  return STEP_ORDER[index + 1];
}

export function buildAdvancePromptKey(
  completedStep: ProductionStepId,
  nextStep: ProductionStepId,
  shotId?: string,
): string {
  return `${completedStep}->${nextStep}:${shotId ?? 'global'}`;
}

export interface WorkflowAdvancePrompt {
  promptKey: string;
  completedStep: ProductionStepId;
  nextStep: ProductionStepId;
  title: string;
  body: string;
  nextLabel: string;
}

export function resolveWorkflowAdvancePrompt(
  context: ProductionPathContext,
  dismissedKeys: readonly string[] = [],
): WorkflowAdvancePrompt | undefined {
  const { workspace, project, selectedShotId } = context;

  if (!isStepComplete(workspace, project, selectedShotId)) return undefined;

  const nextStep = getNextProductionStep(workspace);
  if (!nextStep) return undefined;

  const promptKey = buildAdvancePromptKey(workspace, nextStep, selectedShotId);
  if (dismissedKeys.includes(promptKey)) return undefined;

  const objective = resolveWorkspaceObjective(context);

  return {
    promptKey,
    completedStep: workspace,
    nextStep,
    title: `${STEP_LABELS[workspace]} is ready`,
    body: objective.proceedSignal,
    nextLabel: `Continue to ${STEP_LABELS[nextStep]}`,
  };
}