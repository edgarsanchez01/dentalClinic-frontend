import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';
import { AuthLayout } from './AuthLayout';
import { AuthFeedback, AuthFormField, PasswordField, AuthSubmitButton } from './AuthForm';
import { useAuthForm } from './useAuthForm';
import { safeReturnTo } from '../../app/deepLinks';
import { patientReturnTo } from '../../app/patientOnboarding';

interface RedirectState {
  from?: string;
  notice?: string;
}

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, errors, pending, submit } = useAuthForm();

  const notice = (location.state as RedirectState | null)?.notice ?? null;
  const returnState = { from: safeReturnTo((location.state as RedirectState | null)?.from) };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      try { await login(email.trim(), password); }
      catch (cause) { setPassword(''); throw cause; }
      const from = (location.state as RedirectState | null)?.from;
      const user = useAuthStore.getState().user;
      navigate(user?.role === 'PATIENT' && user.medicalOnboarding?.pending
        ? `/patient-onboarding?returnTo=${encodeURIComponent(patientReturnTo(from))}` : safeReturnTo(from), { replace: true });
    });
  }

  return (
    <AuthLayout
      title="Iniciar sesión"
      intro="Accede con el correo y la contraseña de tu cuenta."
      footer={
        <>
          <p>
            ¿No tienes cuenta?{' '}
            <Link to="/register" state={returnState}>
              Regístrate como paciente
            </Link>
          </p>
          <p>
            ¿Tienes una invitación? Usa el enlace que recibiste para activar la cuenta.
          </p>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        {notice && !error ? <AuthFeedback tone="info">{notice}</AuthFeedback> : null}
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
        <PasswordField
          id="password"
          label="Contraseña"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={errors.password}
        />
        <Link className="auth-text-link auth-recovery" to="/forgot-password" state={returnState}>He olvidado mi contraseña</Link>
        <AuthSubmitButton pending={pending}>Entrar</AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
