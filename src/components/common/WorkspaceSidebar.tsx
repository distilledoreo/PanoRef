import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function WorkspaceSidebar({
  primary,
  diagnostics,
  advanced,
}: {
  primary: React.ReactNode;
  diagnostics?: React.ReactNode;
  advanced?: React.ReactNode;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <>
      <section className="border-b border-zinc-200 p-4">
        <div className="space-y-2">{primary}</div>
      </section>

      {diagnostics && (
        <section className="border-b border-zinc-200 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</h2>
          <div className="space-y-2">{diagnostics}</div>
        </section>
      )}

      {advanced && (
        <section className="border-b border-zinc-200 p-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
          >
            <span>More options</span>
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {advancedOpen && <div className="mt-3 space-y-3">{advanced}</div>}
        </section>
      )}
    </>
  );
}