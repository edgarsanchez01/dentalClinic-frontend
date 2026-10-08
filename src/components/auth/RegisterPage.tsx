import { useState } from 'react';
import { Link } from 'react-router-dom';

import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { compact } from '../../api/onboarding';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

/**
 * Registro publico de pacientes (RF-IA-05/06, PRD §6.5.1). El endpoint nunca recibe `role`: la
 * cuenta nace como `PATIENT`. No abre sesion; al crearse, el paciente entra por /login.
 */
export function RegisterPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmation: '',
    firstName: '',
    lastName: '',
    phone: '',
    birthDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (form.password !== form.confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setPending(true);
    try {
      await authApi.register(
        compact({
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          birthDate: form.birthDate,
        }),
      );
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo crear la cuenta.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <AuthCard
        title="Cuenta creada"
        intro="Tu cuenta de paciente ya está lista."
        footer={
          <Link className="text-ink underline underline-offset-2" to="/login">
            Iniciar sesión
          </Link>
        }
      >
        <FormAlert tone="success">
          Ya puedes acceder con tu correo y contraseña.
        </FormAlert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Crear cuenta de paciente"
      intro="Regístrate para gestionar tus datos y tus citas."
      footer={
        <span className="text-ink-muted">
          ¿Ya tienes cuenta?{' '}
          <Link className="text-ink underline underline-offset-2" to="/login">
            Inicia sesión
          </Link>
        </span>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field
          id="email"
          label="Correo electrónico"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
        />
        <Field
          id="password"
          label="Contraseña"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
        />
        <Field
          id="confirmation"
          label="Repite la contraseña"
          type="password"
          value={form.confirmation}
          onChange={set('confirmation')}
          autoComplete="new-password"
        />
        <Field
          id="firstName"
          label="Nombre"
          value={form.firstName}
          onChange={set('firstName')}
          autoComplete="given-name"
        />
        <Field
          id="lastName"
          label="Apellidos"
          value={form.lastName}
          onChange={set('lastName')}
          autoComplete="family-name"
        />
        <Field
          id="phone"
          label="Teléfono (opcional)"
          required={false}
          value={form.phone}
          onChange={set('phone')}
          autoComplete="tel"
        />
        <Field
          id="birthDate"
          label="Fecha de nacimiento (opcional)"
          type="date"
          required={false}
          value={form.birthDate}
          onChange={set('birthDate')}
        />
        <SubmitButton pending={pending}>Crear cuenta</SubmitButton>
      </form>
    </AuthCard>
  );
}