import React from 'react';
import { WorkspaceObjective } from '../../engine/workflow';

export function ObjectiveCard({ objective }: { objective: WorkspaceObjective }) {
  return (
    <section className="rounded-md border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">Current Objective</div>
      <h3 className="mt-2 text-sm font-semibold text-zinc-900">{objective.goal}</h3>
      <p className="mt-2 text-sm text-zinc-600">{objective.why}</p>
      <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        {objective.proceedSignal}
      </p>
      {objective.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-900">
          {objective.blockers.map((blocker) => (
            <li key={blocker} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
              {blocker}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}