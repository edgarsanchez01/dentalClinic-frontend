import { useState } from 'react';
import { Link } from 'react-router-dom';

import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { AuthCard, Field, FormAlert, SubmitButton } from './ui';

/**
 * Recuperacion de contrasena. El endpoint es neutro: responde 202 exista o no la
 * cuenta, y el frontend muestra siempre el mismo mensaje para no revelar correos
 * registrados (§7.7).
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await authApi.requestPasswordReset(email);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo completar la solicitud.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Recuperar contraseña"
      intro="Te enviaremos un enlace para restablecerla. Por seguridad, el mensaje es el mismo exista o no la cuenta."
      footer={
        <Link className="text-ink underline underline-offset-2" to="/login">
          Volver al inicio de sesión
        </Link>
      }
    >
      {sent ? (
        <FormAlert tone="success">
          Si el correo está registrado, recibirás un enlace para restablecer la contraseña.
        </FormAlert>
      ) : (
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Field
            id="email"
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
          />
          <SubmitButton pending={pending}>Enviar enlace</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}