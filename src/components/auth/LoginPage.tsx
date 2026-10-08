import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const notice = (location.state as RedirectState | null)?.notice ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      const from = (location.state as RedirectState | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (cause) {
      // Mensaje generico del backend (§8.1): no distingue email inexistente de
      // contrasena erronea, y el frontend no lo enriquece para no crear un oraculo.
      setError(cause instanceof ApiError ? cause.message : 'No se pudo iniciar sesión.');
      setPassword('');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Iniciar sesión"
      intro="Accede con el correo y la contraseña de tu cuenta."
      footer={
        <div className="flex flex-col gap-1">
          <Link className="text-ink underline underline-offset-2" to="/forgot-password">
            He olvidado mi contraseña
          </Link>
          <span className="text-ink-muted">
            ¿No tienes cuenta?{' '}
            <Link className="text-ink underline underline-offset-2" to="/register">
              Regístrate como paciente
            </Link>
          </span>
          <span className="text-ink-muted">
            ¿Tienes una invitación? Usa el enlace que recibiste para activar la cuenta.
          </span>
        </div>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {notice && !error ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <Field
          id="email"
          label="Correo electrónico"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
        />
        <Field
          id="password"
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <SubmitButton pending={pending}>Entrar</SubmitButton>
      </form>
    </AuthCard>
  );
}