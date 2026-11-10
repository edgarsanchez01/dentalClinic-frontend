import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { authApi } from '../../api/auth';
import { AuthLayout } from './AuthLayout';
import { AuthFeedback, AuthFormField, AuthSubmitButton } from './AuthForm';
import { useAuthForm } from './useAuthForm';
import { safeReturnTo } from '../../app/deepLinks';

/**
 * Recuperacion de contrasena. El endpoint es neutro: responde 202 exista o no la
 * cuenta, y el frontend muestra siempre el mismo mensaje para no revelar correos
 * registrados (§7.7).
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const location = useLocation();
  const returnState = { from: safeReturnTo((location.state as { from?: unknown } | null)?.from) };
  const [sent, setSent] = useState(false);
  const { error, errors, pending, submit } = useAuthForm();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      await authApi.requestPasswordReset(email.trim());
      setSent(true);
    });
  }

  return (
    <AuthLayout
      title={sent ? 'Solicitud recibida' : 'Recuperar contraseña'}
      intro={sent ? 'Consulta las indicaciones para continuar.' : 'Escribe el correo de tu cuenta para solicitar un enlace de recuperación.'}
      footer={
        <Link to="/login" state={returnState}>
          Volver al inicio de sesión
        </Link>
      }
    >
      {sent ? (
        <div className="auth-form">
          <AuthFeedback tone="info">Si existe una cuenta y el envío de correo está habilitado, se tramitará la recuperación. Esta confirmación no acredita el envío de un correo.</AuthFeedback>
          <p className="auth-next">Revisa también el correo no deseado. Si no recibes instrucciones, contacta con la clínica para solicitar ayuda.</p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
          <AuthFeedback errors={errors}>{error}</AuthFeedback>
          <AuthFormField
            id="email"
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            maxLength={320}
            error={errors.email}
          />
          <AuthSubmitButton pending={pending}>Solicitar enlace</AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
