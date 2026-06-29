import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { LocationProject } from '../../domain/types';
import { getCanonicalPano, getLatestGrayboxPano } from '../../domain/selectors';

export function DirectorQuest({ project }: { project: LocationProject }) {
  const canonical = Boolean(getCanonicalPano(project));
  const graybox = Boolean(getLatestGrayboxPano(project));
  const framedShot = project.shots[0];
  const aiResult = Boolean(framedShot?.assets.aiResultFrameAssetId ?? framedShot?.assets.finalBaseFrameAssetId);
  const steps = [
    { label: 'Canonical reference', done: canonical },
    { label: 'Graybox 360', done: graybox },
    { label: 'Camera framed', done: project.shots.length > 0 },
    { label: 'AI result imported', done: aiResult },
  ];

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <span className="mr-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-teal-700">Director Quest</span>
      {steps.map((step) => {
        const Icon = step.done ? CheckCircle2 : Circle;
        return (
          <div
            key={step.label}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              step.done
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-zinc-200 bg-zinc-50 text-zinc-500'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {step.label}
          </div>
        );
      })}
    </div>
  );
}
