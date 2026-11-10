import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';
import { AuthLayout } from './AuthLayout';
import { AuthFeedback, PasswordField, AuthSubmitButton } from './AuthForm';
import { PASSWORD_HINT, passwordError } from './authValidation';
import { useAuthForm } from './useAuthForm';
import { PageContainer } from '../ui/Page';

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
  const { error, errors, pending, submit } = useAuthForm();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const issue = passwordError(next);
    await submit(event, async () => {
      await changePassword(current, next);
      navigate('/login', {
        replace: true,
        state: { notice: 'Contraseña actualizada. Inicia sesión de nuevo.' },
      });
    }, {
      ...(issue ? { 'new-password': issue } : {}),
      ...(next !== confirmation ? { 'confirm-password': 'Las contraseñas no coinciden.' } : {}),
    });
  }

  return (
    <div className="clinical-editorial change-password-page"><PageContainer preset="form"><AuthLayout
      embedded
      title="Cambiar contraseña"
      intro="Se cerrarán todas las sesiones abiertas, incluida esta."
      footer={
        <Link to="/">
          Volver
        </Link>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <AuthFeedback errors={errors}>{error}</AuthFeedback>
        <PasswordField
          id="current-password"
          label="Contraseña actual"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={errors['current-password']}
        />
        <PasswordField
          id="new-password"
          label="Nueva contraseña"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={errors['new-password']}
        />
        <PasswordField
          id="confirm-password"
          label="Repite la nueva contraseña"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          error={errors['confirm-password']}
        />
        <AuthSubmitButton pending={pending}>Cambiar contraseña</AuthSubmitButton>
      </form>
    </AuthLayout></PageContainer></div>
  );
}
