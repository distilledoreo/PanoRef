import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { WarningItem } from '../../domain/types';

type StatusLevel = 'ready' | 'warning' | 'danger' | 'approved' | 'needs_work';

const toneMap: Record<StatusLevel, string> = {
  ready: '',
  warning: 'ring-2 ring-amber-400/70 shadow-[0_0_12px_rgba(251,146,60,0.45)]',
  danger: 'ring-2 ring-red-400/70 shadow-[0_0_12px_rgba(248,113,113,0.45)]',
  approved: 'ring-2 ring-emerald-400/60',
  needs_work: 'ring-2 ring-amber-400/70 shadow-[0_0_12px_rgba(251,146,60,0.45)]',
};

export function StatusGlow({
  level,
  children,
  showIcon = true,
  className,
}: {
  level: StatusLevel;
  children: React.ReactNode;
  showIcon?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative rounded-xl transition ${toneMap[level]} ${className ?? ''}`}>
      {children}
      {showIcon && level !== 'ready' && (
        <StatusIcon level={level} className="absolute -right-1 -top-1" />
      )}
    </div>
  );
}

export function StatusIcon({ level, className }: { level: StatusLevel; className?: string }) {
  if (level === 'ready' || level === 'approved') {
    return (
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white ${className ?? ''}`}>
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (level === 'needs_work' || level === 'warning') {
    return (
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white ${className ?? ''}`}>
        <Clock className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white ${className ?? ''}`}>
      <AlertTriangle className="h-3.5 w-3.5" />
    </span>
  );
}

export function WarningPopover({
  warnings,
  children,
}: {
  warnings: WarningItem[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return <>{children}</>;

  const level: StatusLevel = warnings.some((w) => w.severity === 'danger')
    ? 'danger'
    : warnings.some((w) => w.severity === 'warning')
      ? 'warning'
      : 'ready';

  return (
    <div className="relative">
      <StatusGlow level={level} showIcon={false}>{children}</StatusGlow>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="absolute -right-1 -top-1 z-10"
        aria-label={`${warnings.length} issue${warnings.length === 1 ? '' : 's'}`}
        title={`${warnings.length} issue${warnings.length === 1 ? '' : 's'}`}
      >
        <StatusIcon level={level} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-[var(--radius-card)] border border-subtle bg-surface-raised p-3 shadow-soft">
          <ul className="space-y-2 text-xs text-secondary">
            {warnings.map((warning) => (
              <li key={warning.id} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
