import React from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { WarningItem } from '../../domain/types';

export function WarningList({ warnings }: { warnings: WarningItem[] }) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Continuity checks are clear.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {warnings.map((warning) => {
        const Icon = warning.severity === 'danger'
          ? OctagonAlert
          : warning.severity === 'warning'
            ? AlertTriangle
            : Info;
        const tone = warning.severity === 'danger'
          ? 'border-red-200 bg-red-50 text-red-800'
          : warning.severity === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-zinc-200 bg-zinc-50 text-zinc-700';
        return (
          <div key={warning.id} className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning.message}</span>
          </div>
        );
      })}
    </div>
  );
}
