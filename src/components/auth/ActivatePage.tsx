import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

/**
 * Consumo de la invitacion (RF-IA-09, P-03). El token llega en el enlace
 * (`?token=`). Al activar NO se abre sesion: la cuenta queda activa y el usuario
 * entra por /login de forma explicita.
 */
export function ActivatePage() {
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
      await authApi.activate(token, password);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo activar la cuenta.');
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Activar cuenta" intro="Este enlace no incluye un token de invitación.">
        <FormAlert>El enlace es inválido o está incompleto.</FormAlert>
        <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
          <Link className="text-ink underline underline-offset-2" to="/login">
            Volver al inicio de sesión
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Cuenta activada" intro="Tu cuenta ya está lista para usarse.">
        <FormAlert tone="success">Contraseña establecida correctamente.</FormAlert>
        <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
          <Link className="text-ink underline underline-offset-2" to="/login">
            Iniciar sesión
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Activar cuenta" intro="Elige la contraseña con la que accederás.">
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
        <SubmitButton pending={pending}>Activar cuenta</SubmitButton>
      </form>
    </AuthCard>
  );
}