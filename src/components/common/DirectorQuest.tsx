import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { LocationProject } from '../../domain/types';
import { getCanonicalPano, getLatestGrayboxPano } from '../../domain/selectors';

export function DirectorQuest({ project }: { project: LocationProject }) {
  const canonical = Boolean(getCanonicalPano(project));
  const graybox = Boolean(getLatestGrayboxPano(project));
  const heroShot = project.shots.find((shot) => shot.name === 'Main Structure Wide');
  const aiResult = Boolean(heroShot?.assets.aiResultFrameAssetId ?? heroShot?.assets.finalBaseFrameAssetId);
  const steps = [
    { label: 'Canonical reference', done: canonical },
    { label: 'Graybox 360', done: graybox },
    { label: 'Wide shot framed', done: Boolean(heroShot) },
    { label: 'AI result imported', done: aiResult },
  ];

  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-cyan-300">Director Quest</span>
      {steps.map((step) => {
        const Icon = step.done ? CheckCircle2 : Circle;
        return (
          <div
            key={step.label}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
              step.done ? 'bg-emerald-950 text-emerald-200' : 'bg-slate-950 text-slate-500'
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
