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
        className={`inline-flex items-center gap-2.5 rounded-[var(--radius-card)] px-5 py-3 text-sm font-semibold text-white shadow-soft transition disabled:cursor-not-allowed disabled:opacity-45 ${
          highlighted
            ? 'bg-emerald-500 ring-2 ring-emerald-300 hover:bg-emerald-600'
            : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
        }`}
      >
        {icon}
        {label}
      </button>
      {hint && (
        <p className="max-w-xs text-right text-xs text-secondary">{hint}</p>
      )}
    </div>
  );
}