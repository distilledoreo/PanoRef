import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Compass } from 'lucide-react';
import { getCanonicalPano, getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl } from '../../engine/projectIO';
import {
  hasGrayboxPano,
  hasStyledCanonicalPano,
  isReferenceAlignmentAccepted,
  needsReferenceAlignment,
  resolveWorkflowAdvancePrompt,
  resolveWorkspaceObjective,
} from '../../engine/workflow';
import { Workspace } from '../../domain/types';
import { useContinuityStore } from '../../state/useContinuityStore';
import { AlignmentRetryContent, GrayboxReferencePromptBuilder } from './GrayboxReferenceGuide';
import { Modal } from './Modal';

const WORKSPACE_LABELS: Record<Workspace, string> = {
  build: 'Build',
  reference: 'Reference',
  shots: 'Shots',
  review: 'Review',
  export: 'Export',
};

function ObjectiveBody({
  goal,
  why,
  proceedSignal,
  blockers,
}: {
  goal: string;
  why: string;
  proceedSignal: string;
  blockers: string[];
}) {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-secondary">
      <div className="space-y-2">
        <p className="font-medium text-primary">{goal}</p>
        <p>{why}</p>
      </div>
      <p className="border-l-2 border-[var(--accent)] pl-3 text-secondary">{proceedSignal}</p>
      {blockers.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-secondary">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AlignmentIntroBody() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-secondary">
      <p className="font-medium text-primary">
        Before you move on, check that your styled pano lines up with the 3D scene.
      </p>
      <p>
        Use the pano viewer and the alignment controls in the drawer. Fade the styled pano to see the graybox underneath, then spin yaw until things match.
      </p>
      <ol className="space-y-2">
        <li className="flex gap-3"><span className="font-semibold text-accent">1</span><span>Look around the viewer.</span></li>
        <li className="flex gap-3"><span className="font-semibold text-accent">2</span><span>Lower opacity to compare with the graybox.</span></li>
        <li className="flex gap-3"><span className="font-semibold text-accent">3</span><span>Adjust yaw if things are rotated wrong.</span></li>
        <li className="flex gap-3"><span className="font-semibold text-accent">4</span><span>Click <strong>Looks good enough</strong> when ready.</span></li>
      </ol>
      <p className="text-secondary">
        If yaw cannot fix it, open the retry tips and generate a new image.
      </p>
    </div>
  );
}

export function WorkflowGuidance() {
  const {
    project,
    workspace,
    selectedShotId,
    shotCameraFlying,
    dismissedWorkflowAdvanceKeys,
    seenObjectiveWorkspaces,
    objectiveModalRequest,
    alignmentIntroRequest,
    alignmentRetryModalRequest,
    seenAlignmentIntroForPanoId,
    setWorkspace,
    dismissWorkflowAdvance,
    markObjectiveSeen,
    markAlignmentIntroSeen,
    updateProjectInfo,
  } = useContinuityStore();

  const [isDownloadingGraybox, setIsDownloadingGraybox] = useState(false);
  const [alignmentIntroOpen, setAlignmentIntroOpen] = useState(false);
  const [alignmentRetryOpen, setAlignmentRetryOpen] = useState(false);

  const context = useMemo(() => ({
    project,
    workspace,
    selectedShotId,
    shotCameraFlying,
  }), [project, workspace, selectedShotId, shotCameraFlying]);

  const objective = useMemo(() => resolveWorkspaceObjective(context), [context]);
  const advancePrompt = useMemo(
    () => resolveWorkflowAdvancePrompt(context, dismissedWorkflowAdvanceKeys),
    [context, dismissedWorkflowAdvanceKeys],
  );

  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);
  const canonicalPano = getCanonicalPano(project);
  const alignmentPending = needsReferenceAlignment(project) && !isReferenceAlignmentAccepted(project);
  const showReferencePromptBuilder = workspace === 'reference'
    && hasGrayboxPano(project)
    && !hasStyledCanonicalPano(project)
    && Boolean(grayboxPano);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  useEffect(() => {
    if (advancePrompt) {
      setAdvanceOpen(true);
      setObjectiveOpen(false);
      setAlignmentIntroOpen(false);
    }
  }, [advancePrompt?.promptKey]);

  useEffect(() => {
    if (workspace !== 'reference' || !alignmentPending || !canonicalPano) return;
    if (seenAlignmentIntroForPanoId === canonicalPano.id) return;
    setAlignmentIntroOpen(true);
    setObjectiveOpen(false);
  }, [workspace, alignmentPending, canonicalPano?.id, seenAlignmentIntroForPanoId, alignmentIntroRequest]);

  useEffect(() => {
    if (alignmentRetryModalRequest > 0) {
      setAlignmentRetryOpen(true);
    }
  }, [alignmentRetryModalRequest]);

  useEffect(() => {
    if (objectiveModalRequest > 0) {
      if (alignmentPending) {
        setAlignmentIntroOpen(true);
      } else {
        setObjectiveOpen(true);
      }
    }
  }, [objectiveModalRequest, alignmentPending]);

  useEffect(() => {
    if (workspace !== 'reference' || !showReferencePromptBuilder) return;
    if (seenObjectiveWorkspaces.includes('reference')) return;
    if (advanceOpen && advancePrompt) return;
    setObjectiveOpen(true);
    setAlignmentIntroOpen(false);
  }, [
    workspace,
    showReferencePromptBuilder,
    seenObjectiveWorkspaces,
    advanceOpen,
    advancePrompt?.promptKey,
  ]);

  const closeObjective = () => {
    setObjectiveOpen(false);
    markObjectiveSeen(workspace);
  };

  const closeAlignmentIntro = () => {
    setAlignmentIntroOpen(false);
    if (canonicalPano) {
      markAlignmentIntroSeen(canonicalPano.id);
    }
  };

  const handleAdvanceNext = () => {
    if (!advancePrompt) return;
    const { nextStep, promptKey } = advancePrompt;
    const shouldOpenReferenceObjective = nextStep === 'reference'
      && hasGrayboxPano(project)
      && !hasStyledCanonicalPano(project)
      && !seenObjectiveWorkspaces.includes('reference');
    dismissWorkflowAdvance(promptKey);
    setAdvanceOpen(false);
    setWorkspace(nextStep);
    if (shouldOpenReferenceObjective) {
      setObjectiveOpen(true);
      setAlignmentIntroOpen(false);
    }
  };

  const handleAdvanceDismiss = () => {
    if (!advancePrompt) return;
    dismissWorkflowAdvance(advancePrompt.promptKey);
    setAdvanceOpen(false);
  };

  const downloadGrayboxForAi = async () => {
    if (!grayboxAsset || !grayboxPano) return;
    setIsDownloadingGraybox(true);
    try {
      await downloadPanoImage(
        grayboxAsset.uri,
        grayboxPano.width,
        grayboxPano.height,
        grayboxAsset.name || 'global_graybox.png',
        {
          letterboxEnabled: project.settings.panoLetterboxExports169,
          targetWidth: project.settings.defaultShotWidth,
          targetHeight: project.settings.defaultShotHeight,
        },
        downloadDataUrl,
      );
    } finally {
      setIsDownloadingGraybox(false);
    }
  };

  return (
    <>
      <Modal
        open={alignmentIntroOpen}
        title="Check pano alignment"
        onClose={closeAlignmentIntro}
        size="lg"
        scrollBody
        footer={(
          <button
            type="button"
            onClick={closeAlignmentIntro}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
          >
            Start checking
          </button>
        )}
      >
        <AlignmentIntroBody />
      </Modal>

      <Modal
        open={alignmentRetryOpen}
        title="Try generating again"
        onClose={() => setAlignmentRetryOpen(false)}
        size="xl"
        scrollBody
        footer={(
          <button
            type="button"
            onClick={() => setAlignmentRetryOpen(false)}
            className="rounded-lg border border-subtle bg-surface-raised px-4 py-2 text-sm font-medium text-secondary transition hover:border-strong hover:bg-surface-muted hover:text-primary"
          >
            Close
          </button>
        )}
      >
        <AlignmentRetryContent
          project={project}
          grayboxAsset={grayboxAsset}
          onCreativeBriefChange={(description) => updateProjectInfo({ description })}
          onDownloadGraybox={() => void downloadGrayboxForAi()}
          isDownloading={isDownloadingGraybox}
        />
      </Modal>

      <Modal
        open={objectiveOpen}
        title={showReferencePromptBuilder
          ? 'Style your graybox pano'
          : `${WORKSPACE_LABELS[workspace]} — What to do`}
        onClose={closeObjective}
        size={showReferencePromptBuilder ? 'xl' : 'md'}
        scrollBody={showReferencePromptBuilder}
        footer={(
          <button
            type="button"
            onClick={closeObjective}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
          >
            Got it
          </button>
        )}
      >
        {showReferencePromptBuilder && grayboxPano ? (
          <GrayboxReferencePromptBuilder
            project={project}
            grayboxPano={grayboxPano}
            grayboxAsset={grayboxAsset}
            onCreativeBriefChange={(description) => updateProjectInfo({ description })}
            onDownloadGraybox={() => void downloadGrayboxForAi()}
            isDownloading={isDownloadingGraybox}
          />
        ) : (
          <ObjectiveBody
            goal={objective.goal}
            why={objective.why}
            proceedSignal={objective.proceedSignal}
            blockers={objective.blockers}
          />
        )}
      </Modal>

      <Modal
        open={advanceOpen && Boolean(advancePrompt)}
        title={advancePrompt?.title ?? 'Ready for the next step'}
        onClose={handleAdvanceDismiss}
        footer={(
          <>
            <button
              type="button"
              onClick={handleAdvanceDismiss}
              className="rounded-lg border border-subtle bg-surface-raised px-4 py-2 text-sm font-medium text-secondary transition hover:border-strong hover:bg-surface-muted hover:text-primary"
            >
              Not right now
            </button>
            <button
              type="button"
              onClick={handleAdvanceNext}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
            >
              {advancePrompt?.nextLabel ?? 'Continue'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
      >
        <p className="text-sm text-secondary">{advancePrompt?.body}</p>
      </Modal>
    </>
  );
}

export function ObjectiveHelpButton() {
  const requestObjectiveModal = useContinuityStore((state) => state.requestObjectiveModal);

  return (
    <button
      type="button"
      onClick={() => requestObjectiveModal()}
      className="inline-flex items-center gap-2 rounded-lg border border-subtle bg-surface-raised px-3 py-2 text-sm font-medium text-secondary transition hover:border-[var(--accent)] hover:text-accent"
      title="Show current objective"
    >
      <Compass className="h-4 w-4" />
      Objective
    </button>
  );
}
