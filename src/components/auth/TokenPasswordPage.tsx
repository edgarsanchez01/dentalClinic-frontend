import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { AuthLayout } from './AuthLayout';
import { AuthFeedback, PasswordField, AuthSubmitButton } from './AuthForm';
import { PASSWORD_HINT, passwordError } from './authValidation';
import { useAuthForm } from './useAuthForm';

/** Consumo explícito, nunca al abrir la URL. Invitación y reset conservan sus contratos. */
export function TokenPasswordPage({ activation = false }: { activation?: boolean }) {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const { error, errors, pending, submit } = useAuthForm();
  const title = activation ? 'Activar cuenta' : 'Restablecer contraseña';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const issue = passwordError(password);
    await submit(event, async () => {
      try {
        if (activation) await authApi.activate(token, password);
        else await authApi.resetPassword(token, password);
        setPassword('');
        setConfirmation('');
        setDone(true);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          setPassword(''); setConfirmation(''); setInvalid(true);
        } else throw cause;
      }
    }, {
      ...(issue ? { 'new-password': issue } : {}),
      ...(password !== confirmation ? { 'confirm-password': 'Las contraseñas no coinciden.' } : {}),
    });
  }

  if (!token || invalid) return <AuthLayout title={title} intro="Necesitas un enlace válido para continuar."
    footer={<Link to="/login">Volver al inicio de sesión</Link>}>
    <div className="auth-form">
      <AuthFeedback>El enlace es inválido, está incompleto, ha caducado o ya se utilizó.</AuthFeedback>
      {activation
        ? <p className="auth-next">Solicita una nueva invitación a la persona que administra la clínica.</p>
        : <Link className="auth-action" to="/forgot-password">Solicitar un enlace nuevo</Link>}
    </div>
  </AuthLayout>;

  if (done) return <AuthLayout title={activation ? 'Cuenta activada' : 'Contraseña actualizada'}
    intro={activation ? 'Tu cuenta ya está lista para usarse.' : 'Por seguridad, se cerraron todas las sesiones abiertas.'}>
    <div className="auth-form">
      <AuthFeedback tone="success">{activation ? 'Contraseña establecida correctamente.' : 'Ya puedes entrar con tu nueva contraseña.'}</AuthFeedback>
      <Link className="auth-action" to="/login">Iniciar sesión</Link>
    </div>
  </AuthLayout>;

  return <AuthLayout title={title}
    intro={activation ? 'Elige una contraseña para acceder con tu invitación. Después podrás iniciar sesión.' : 'Elige una contraseña nueva para tu cuenta.'}
    footer={<Link to="/login">Volver al inicio de sesión</Link>}>
    <form className="auth-form" noValidate onSubmit={handleSubmit} aria-busy={pending}>
      <AuthFeedback errors={errors}>{error}</AuthFeedback>
      <PasswordField id="new-password" label="Nueva contraseña" value={password} onChange={setPassword}
        autoComplete="new-password" hint={PASSWORD_HINT} error={errors['new-password']} />
      <PasswordField id="confirm-password" label="Repite la contraseña" value={confirmation} onChange={setConfirmation}
        autoComplete="new-password" error={errors['confirm-password']} />
      <AuthSubmitButton pending={pending}>{activation ? 'Activar cuenta' : 'Restablecer'}</AuthSubmitButton>
    </form>
  </AuthLayout>;
}
