import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ObjectiveCard } from './ObjectiveCard';
import { WorkspaceObjective } from '../../engine/workflow';

export function GuidedSidebar({
  objective,
  doThisNext,
  checkYourWork,
  adjustAdvanced,
}: {
  objective: WorkspaceObjective;
  doThisNext: React.ReactNode;
  checkYourWork: React.ReactNode;
  adjustAdvanced?: React.ReactNode;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <>
      <section className="border-b border-zinc-200 p-4">
        <ObjectiveCard objective={objective} />
      </section>

      <section className="border-b border-zinc-200 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-700">Do This Next</h2>
        <div className="space-y-2">{doThisNext}</div>
      </section>

      <section className="border-b border-zinc-200 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700">Check Your Work</h2>
        <div className="space-y-2">{checkYourWork}</div>
      </section>

      {adjustAdvanced && (
        <section className="border-b border-zinc-200 p-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            <span>Adjust / Advanced</span>
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {advancedOpen && <div className="mt-3 space-y-3">{adjustAdvanced}</div>}
        </section>
      )}
    </>
  );
}