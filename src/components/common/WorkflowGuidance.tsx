import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Compass } from 'lucide-react';
import {
  resolveWorkflowAdvancePrompt,
  resolveWorkspaceObjective,
} from '../../engine/workflow';
import { Workspace } from '../../domain/types';
import { useContinuityStore } from '../../state/useContinuityStore';
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
    <div className="space-y-3 text-sm text-zinc-700">
      <p className="font-medium text-zinc-900">{goal}</p>
      <p>{why}</p>
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        {proceedSignal}
      </p>
      {blockers.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-900">
          {blockers.map((blocker) => (
            <li key={blocker} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
              {blocker}
            </li>
          ))}
        </ul>
      )}
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
    setWorkspace,
    dismissWorkflowAdvance,
    markObjectiveSeen,
  } = useContinuityStore();

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

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  useEffect(() => {
    if (advancePrompt) {
      setAdvanceOpen(true);
      setObjectiveOpen(false);
    }
  }, [advancePrompt?.promptKey]);

  useEffect(() => {
    if (advancePrompt) return;
    if (!seenObjectiveWorkspaces.includes(workspace)) {
      setObjectiveOpen(true);
    }
  }, [workspace, advancePrompt, seenObjectiveWorkspaces]);

  useEffect(() => {
    if (objectiveModalRequest > 0) {
      setObjectiveOpen(true);
    }
  }, [objectiveModalRequest]);

  const closeObjective = () => {
    setObjectiveOpen(false);
    markObjectiveSeen(workspace);
  };

  const handleAdvanceNext = () => {
    if (!advancePrompt) return;
    dismissWorkflowAdvance(advancePrompt.promptKey);
    setAdvanceOpen(false);
    setWorkspace(advancePrompt.nextStep);
  };

  const handleAdvanceDismiss = () => {
    if (!advancePrompt) return;
    dismissWorkflowAdvance(advancePrompt.promptKey);
    setAdvanceOpen(false);
  };

  return (
    <>
      <Modal
        open={objectiveOpen}
        title={`${WORKSPACE_LABELS[workspace]} — Current Objective`}
        onClose={closeObjective}
        footer={(
          <button
            type="button"
            onClick={closeObjective}
            className="rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600"
          >
            Got it
          </button>
        )}
      >
        <ObjectiveBody
          goal={objective.goal}
          why={objective.why}
          proceedSignal={objective.proceedSignal}
          blockers={objective.blockers}
        />
      </Modal>

      <Modal
        open={advanceOpen && Boolean(advancePrompt)}
        title={advancePrompt?.title ?? 'Ready for the next step'}
        footer={(
          <>
            <button
              type="button"
              onClick={handleAdvanceDismiss}
              className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              Not right now
            </button>
            <button
              type="button"
              onClick={handleAdvanceNext}
              className="inline-flex items-center gap-2 rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600"
            >
              {advancePrompt?.nextLabel ?? 'Continue'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
      >
        <p className="text-sm text-zinc-700">{advancePrompt?.body}</p>
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
      className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-teal-300 hover:text-teal-700"
      title="Show current objective"
    >
      <Compass className="h-4 w-4" />
      Objective
    </button>
  );
}