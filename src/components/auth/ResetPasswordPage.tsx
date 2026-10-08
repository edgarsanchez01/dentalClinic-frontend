import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

/** Restablecimiento con el token de un solo uso que llega en el enlace (`?token=`). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setPending(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Restablecer contraseña" intro="Este enlace no incluye un token válido.">
        <FormAlert>El enlace es inválido o está incompleto.</FormAlert>
        <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
          <Link className="text-ink underline underline-offset-2" to="/forgot-password">
            Solicitar un enlace nuevo
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="Contraseña actualizada"
        intro="Por seguridad, se cerraron todas las sesiones abiertas."
      >
        <FormAlert tone="success">Ya puedes entrar con tu nueva contraseña.</FormAlert>
        <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
          <Link className="text-ink underline underline-offset-2" to="/login">
            Iniciar sesión
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Restablecer contraseña" intro="Elige una contraseña nueva.">
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field
          id="new-password"
          label="Nueva contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <Field
          id="confirm-password"
          label="Repite la contraseña"
          type="password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />
        <SubmitButton pending={pending}>Restablecer</SubmitButton>
      </form>
    </AuthCard>
  );
}