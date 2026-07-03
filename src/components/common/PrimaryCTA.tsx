import React from 'react';

export function PrimaryCTA({
  icon,
  label,
  hint,
  onClick,
  disabled,
  highlighted,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-3 rounded-[22px] border border-white/30 px-6 py-4 text-base font-semibold text-white shadow-[0_8px_24px_var(--accent-glow)] transition disabled:cursor-not-allowed disabled:opacity-45 ${
          highlighted
            ? 'bg-[var(--accent)] ring-4 ring-[var(--accent-glow)] hover:bg-[var(--accent-hover)]'
            : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
        }`}
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/55">
          {icon}
        </span>
        {label}
      </button>
      {hint && (
        <p className="max-w-xs text-right text-xs text-secondary">{hint}</p>
      )}
    </div>
  );
}
