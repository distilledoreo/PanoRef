import React from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { WarningItem } from '../../domain/types';

export function WarningList({ warnings }: { warnings: WarningItem[] }) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200">
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
          ? 'border-red-800 bg-red-950/50 text-red-200'
          : warning.severity === 'warning'
            ? 'border-amber-800 bg-amber-950/50 text-amber-200'
            : 'border-slate-700 bg-slate-900 text-slate-300';
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

