import React from 'react';
import { CheckCircle2, Circle, CircleDot, CircleEllipsis, MinusCircle } from 'lucide-react';
import { ProductionStepState, ProductionStepStatus, resolveProductionPath, type ProductionPathContext } from '../../engine/workflow';
import { useContinuityStore } from '../../state/useContinuityStore';

const stateStyles: Record<ProductionStepState, string> = {
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  current: 'border-teal-500 bg-teal-500 text-white shadow-sm',
  ready: 'border-sky-200 bg-sky-50 text-sky-800',
  needs_action: 'border-amber-300 bg-amber-50 text-amber-900',
  optional: 'border-zinc-200 bg-zinc-50 text-zinc-500',
};

function StepIcon({ state }: { state: ProductionStepState }) {
  switch (state) {
    case 'complete':
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case 'current':
      return <CircleDot className="h-3.5 w-3.5" />;
    case 'ready':
      return <CircleEllipsis className="h-3.5 w-3.5" />;
    case 'needs_action':
      return <MinusCircle className="h-3.5 w-3.5" />;
    default:
      return <Circle className="h-3.5 w-3.5" />;
  }
}

export function ProductionPath({
  project,
  selectedShotId,
  shotCameraFlying,
}: {
  project: ProductionPathContext['project'];
  selectedShotId?: string;
  shotCameraFlying: boolean;
}) {
  const workspace = useContinuityStore((state) => state.workspace);
  const setWorkspace = useContinuityStore((state) => state.setWorkspace);
  const steps = resolveProductionPath({ project, workspace, selectedShotId, shotCameraFlying });
  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) ?? project.shots[0];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-sm lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-teal-700">Production Path</span>
        {selectedShot && (
          <span className="truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600">
            {selectedShot.name}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <ProductionPathStep step={step} onNavigate={() => setWorkspace(step.id)} />
            {index < steps.length - 1 && <span className="hidden h-px w-4 shrink-0 bg-zinc-200 lg:block" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ProductionPathStep({
  step,
  onNavigate,
}: {
  step: ProductionStepStatus;
  onNavigate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:opacity-90 ${stateStyles[step.state]}`}
      title={`${step.label}: ${step.state.replace('_', ' ')}`}
    >
      <StepIcon state={step.state} />
      {step.label}
    </button>
  );
}