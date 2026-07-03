import React from 'react';

export function PrimaryCTA({
  icon,
  label,
  hint,
  onClick,
  disabled,
  highlighted,
  tone = 'accent',
  layout = 'floating',
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  highlighted?: boolean;
  tone?: 'accent' | 'success';
  layout?: 'floating' | 'inline';
}) {
  const toneClasses = tone === 'success'
    ? 'bg-[var(--success)] hover:brightness-110 shadow-[0_8px_24px_rgba(22,163,74,0.32)] ring-[var(--success-soft)]'
    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-[0_8px_24px_var(--accent-glow)] ring-[var(--accent-glow)]';

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-3 rounded-[22px] border border-white/30 px-6 py-3.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${
        layout === 'inline' ? 'px-5 py-3' : 'px-6 py-4 text-base'
      } ${toneClasses} ${
        highlighted ? 'ring-4' : ''
      }`}
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/55">
        {icon}
      </span>
      {label}
    </button>
  );

  if (layout === 'inline') {
    return (
      <div className="pointer-events-auto flex flex-col gap-1">
        {button}
        {hint && <p className="text-xs text-secondary">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      {button}
      {hint && (
        <p className="max-w-xs text-right text-xs text-secondary">{hint}</p>
      )}
    </div>
  );
}