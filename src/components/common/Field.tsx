import React from 'react';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-subtle bg-surface-raised px-3 py-2 text-sm text-primary outline-none transition placeholder:text-muted focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)] ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full rounded-lg border border-subtle bg-surface-raised px-3 py-2 text-sm text-primary outline-none transition placeholder:text-muted focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)] ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-subtle bg-surface-raised px-3 py-2 text-sm text-primary outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)] ${props.className ?? ''}`}
    />
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="border-b border-subtle p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function IconButton({
  children,
  active,
  highlighted,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; highlighted?: boolean }) {
  const tone = active
    ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm'
    : highlighted
      ? 'border-emerald-500 bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300 hover:bg-emerald-600'
      : 'border-subtle bg-surface-raised text-secondary hover:border-[var(--accent)] hover:text-accent';

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${tone} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}
