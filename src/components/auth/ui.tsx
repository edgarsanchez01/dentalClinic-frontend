import type { ReactNode } from 'react';
export { Field } from '../ui/FormControls';

/** Tarjeta centrada de los flujos de identidad (login, activación, recuperación). */
export function AuthCard({
  title,
  intro,
  children,
  footer,
  embedded = false,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  embedded?: boolean;
}) {
  const Container = embedded ? 'section' : 'main';
  return (
    <div className={`grid ${embedded ? '' : 'min-h-dvh'} place-items-center bg-canvas px-5 py-10`}>
      <Container className="w-full max-w-[26rem]">
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
      </Container>
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
      className="w-full rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-paper ring-1 ring-primary outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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
    <p role="alert" className={`min-w-0 max-w-full rounded-xs px-3 py-2 text-[length:var(--text-body-sm)] [overflow-wrap:anywhere] ${classes}`}>
      {children}
    </p>
  );
}
