import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { safeReturnTo } from '../../app/deepLinks';

import { useAuthStore } from '../../app/authStore';
import { AuthLayout } from './AuthLayout';
import { AuthFeedback, AuthFormField, PasswordField, AuthSubmitButton } from './AuthForm';
import { PASSWORD_HINT, passwordError } from './authValidation';
import { useAuthForm } from './useAuthForm';

/**
 * Registro publico de pacientes (RF-IA-05/06, PRD §6.5.1). El endpoint nunca recibe `role`: la
 * cuenta nace como PATIENT y abre sesión. RequireGuest navega solo tras resolver /me.
 */
export function RegisterPage() {
  const register = useAuthStore(state => state.register);
  const location = useLocation();
  const returnState = { from: safeReturnTo((location.state as { from?: unknown } | null)?.from) };
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmation: '',
    firstName: '',
    lastName: '',
  });
  const { error, errors, pending, submit } = useAuthForm();

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const passwordIssue = passwordError(form.password);
    await submit(event, async () => {
      await register(
        {
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
        },
      );
    }, {
      ...(passwordIssue ? { password: passwordIssue } : {}),
      ...(form.password !== form.confirmation ? { confirmation: 'Las contraseñas no coinciden.' } : {}),
    });
  }

  return (
    <AuthLayout wide
      title="Crear cuenta de paciente"
      intro="Tu primer paso para gestionar tus citas en DentalClinic."
      footer={
        <p>
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" state={returnState}>
            Inicia sesión
          </Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <AuthFeedback errors={errors}>{error}</AuthFeedback>
        {pending ? <p className="auth-status" role="status">Creando tu cuenta e iniciando sesión…</p> : null}
        <AuthFormField
          id="email"
          label="Correo electrónico"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          maxLength={320}
          error={errors.email}
        />
        <PasswordField
          id="password"
          label="Contraseña"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={errors.password}
        />
        <PasswordField
          id="confirmation"
          label="Repite la contraseña"
          value={form.confirmation}
          onChange={set('confirmation')}
          autoComplete="new-password"
          error={errors.confirmation}
        />
        <div className="auth-name-row">
        <AuthFormField
          id="firstName"
          label="Nombre"
          value={form.firstName}
          onChange={set('firstName')}
          autoComplete="given-name"
          maxLength={100}
          error={errors.firstName}
        />
        <AuthFormField
          id="lastName"
          label="Apellidos"
          value={form.lastName}
          onChange={set('lastName')}
          autoComplete="family-name"
          maxLength={100}
          error={errors.lastName}
        />
        </div>
        <p className="auth-next"><strong>Después del registro</strong><br />Entrarás directamente a tu cuenta. Completa tus datos y el cuestionario médico; después podrás reservar desde tu inicio.</p>
        <AuthSubmitButton pending={pending}>Crear cuenta</AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
