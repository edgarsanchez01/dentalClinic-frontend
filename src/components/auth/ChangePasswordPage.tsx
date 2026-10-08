import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

/**
 * Cambio de contraseña autenticado (RF-IA-11). Al completarlo, el backend revoca
 * todas las familias de sesion, asi que el cliente cierra la sesion y vuelve al login.
 */
export function ChangePasswordPage() {
  const changePassword = useAuthStore((state) => state.changePassword);
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (next !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setPending(true);
    try {
      await changePassword(current, next);
      navigate('/login', {
        replace: true,
        state: { notice: 'Contraseña actualizada. Inicia sesión de nuevo.' },
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Cambiar contraseña"
      intro="Se cerrarán todas las sesiones abiertas, incluida esta."
      footer={
        <Link className="text-ink underline underline-offset-2" to="/">
          Volver
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field
          id="current-password"
          label="Contraseña actual"
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <Field
          id="new-password"
          label="Nueva contraseña"
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <Field
          id="confirm-password"
          label="Repite la nueva contraseña"
          type="password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />
        <SubmitButton pending={pending}>Cambiar contraseña</SubmitButton>
      </form>
    </AuthCard>
  );
}