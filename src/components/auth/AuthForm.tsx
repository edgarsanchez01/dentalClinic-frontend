import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthErrors } from './authValidation';

export function AuthFeedback({ tone = 'danger', children, errors = {} }: {
  tone?: 'danger' | 'success' | 'info'; children?: ReactNode; errors?: AuthErrors;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasErrors = Object.keys(errors).length > 0;
  const visible = Boolean(children) || hasErrors;
  const errorSignature = JSON.stringify(errors);
  useEffect(() => { if (visible) ref.current?.focus(); }, [visible, children, errorSignature]);
  if (!visible) return null;
  return <div ref={ref} tabIndex={-1} role={tone === 'danger' ? 'alert' : 'status'} className={`auth-feedback auth-feedback-${tone}`}>
    {children ? <p>{children}</p> : hasErrors ? <p>Revisa los campos indicados.</p> : null}
    {hasErrors ? <ul>{Object.entries(errors).map(([id, message]) => <li key={id}>
      <a href={`#${id}`} onClick={event => { event.preventDefault(); document.getElementById(id)?.focus(); }}>{message}</a>
    </li>)}</ul> : null}
  </div>;
}

export function AuthFormField({ id, label, type = 'text', value, onChange, autoComplete, error, hint, maxLength, required = true }: {
  id: string; label: string; type?: string; value: string; onChange: (value: string) => void;
  autoComplete?: string; error?: string; hint?: ReactNode; maxLength?: number; required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  const descriptions = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    <div className="auth-input-wrap">
      <input id={id} name={id} type={password && visible ? 'text' : type} value={value}
        onChange={event => onChange(event.target.value)} required={required} autoComplete={autoComplete}
        maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={descriptions}
        className={password ? 'auth-input auth-password-input' : 'auth-input'} />
      {password ? <button type="button" className="auth-password-toggle" aria-controls={id}
        aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} aria-pressed={visible}
        onClick={() => setVisible(previous => !previous)}>{visible ? 'Ocultar' : 'Mostrar'}</button> : null}
    </div>
    {hint ? <p id={`${id}-hint`} className="auth-hint">{hint}</p> : null}
    {error ? <p id={`${id}-error`} className="auth-field-error">{error}</p> : null}
  </div>;
}

export function PasswordField(props: Omit<Parameters<typeof AuthFormField>[0], 'type'>) {
  return <AuthFormField {...props} type="password" />;
}

export function AuthSubmitButton({ pending, children, pendingLabel = 'Enviando…' }: {
  pending: boolean; children: ReactNode; pendingLabel?: string;
}) {
  return <button className="auth-submit" type="submit" disabled={pending} aria-busy={pending}>
    {pending ? pendingLabel : children}
  </button>;
}
