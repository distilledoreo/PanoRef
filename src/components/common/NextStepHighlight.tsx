import React from 'react';

export function NextStepHighlight({
  active,
  hint,
  children,
  className,
}: {
  active?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!active) return <>{children}</>;

  return (
    <div
      className={`rounded-lg border-2 border-emerald-400 bg-emerald-50/80 p-3 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] ${className ?? ''}`}
    >
      <span className="mb-2 inline-flex rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        Next step
      </span>
      {hint && <p className="mb-2 text-sm leading-snug text-emerald-950">{hint}</p>}
      {children}
    </div>
  );
}

export function isPrimaryAction(
  primaryActionId: string | undefined,
  targetId: string,
): boolean {
  return primaryActionId === targetId;
}