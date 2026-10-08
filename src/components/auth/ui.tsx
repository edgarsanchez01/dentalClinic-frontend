import type { ReactNode } from 'react';

/** Tarjeta centrada de los flujos de identidad (login, activación, recuperación). */
export function AuthCard({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-5 py-10">
      <main className="w-full max-w-[26rem]">
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.02em] text-ink">{title}</h1>
        {intro ? (
          <p className="mt-2 text-[length:var(--text-body-app)] leading-[1.43] text-ink-secondary">
            {intro}
          </p>
        ) : null}

        <div className="mt-6 rounded-card bg-paper p-6 shadow-card ring-1 ring-hairline">
          {children}
        </div>

        {footer ? (
          <div className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">{footer}</div>
        ) : null}
      </main>
    </div>
  );
}

export function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string;
  required?: boolean;
}) {
  const describedBy = error ? `${id}-error` : undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[length:var(--text-body-sm)] font-medium text-ink"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink ring-1 ring-primary outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Enviando…' : children}
    </button>
  );
}

export function FormAlert({ tone = 'danger', children }: { tone?: 'danger' | 'success'; children: ReactNode }) {
  const classes =
    tone === 'danger'
      ? 'bg-danger-subtle text-danger-ink'
      : 'bg-success-subtle text-success-ink';
  return (
    <p role="alert" className={`rounded-xs px-3 py-2 text-[length:var(--text-body-sm)] ${classes}`}>
      {children}
    </p>
  );
}