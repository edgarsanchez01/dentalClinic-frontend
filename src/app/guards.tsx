import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from './authStore';
import type { Role } from '../api/auth';
import { PatientOnboardingGate, patientReturnTo } from './patientOnboarding';
import { AuthLayout } from '../components/auth/AuthLayout';
import { AuthFeedback } from '../components/auth/AuthForm';

/** Pantalla neutra mientras se restaura la sesion; evita el parpadeo a /login. */
export function RestoringScreen() {
  const error = useAuthStore(state => state.restorationError);
  const hydrate = useAuthStore(state => state.hydrate);
  const location = useLocation();
  if (location.pathname === '/login' || location.pathname === '/register') return (
    <AuthLayout title={error ? 'Recuperar acceso' : 'Preparando tu acceso'}
      intro={error ? 'Comprueba tu conexión antes de continuar.' : 'Estamos comprobando si tienes una sesión disponible.'}>
      <div className="auth-form">
        {error ? <>
          <AuthFeedback>No se pudo restaurar la sesión. Si acabas de registrarte, no repitas el alta: recupera primero tu sesión.</AuthFeedback>
          <button type="button" className="auth-action" onClick={() => void hydrate()}>Reintentar sesión</button>
        </> : <p className="auth-status" role="status">Restaurando sesión…</p>}
      </div>
    </AuthLayout>
  );
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas text-ink" role="status">
      <div><p className="text-[length:var(--text-body-app)] text-ink-muted">{error ? 'No se pudo restaurar la sesión. Comprueba tu conexión.' : 'Restaurando sesión…'}</p>
        {error ? <button className="min-h-11 underline" onClick={() => void hydrate()}>Reintentar sesión</button> : null}</div>
    </div>
  );
}

/** Solo usuarios autenticados. Recuerda el destino para volver tras el login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringScreen />;
  }
  if (status === 'anonymous') {
    const from = location.pathname === '/patient-onboarding' ? patientReturnTo(new URLSearchParams(location.search).get('returnTo')) : location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  const restricted = location.pathname === '/' || (location.pathname === '/appointments' && new URLSearchParams(location.search).get('create') === '1');
  return restricted ? <PatientOnboardingGate>{children}</PatientOnboardingGate> : <>{children}</>;
}

/** Solo invitados: un usuario con sesion no debe ver /login ni /forgot-password. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringScreen />;
  }
  if (status === 'authenticated') {
    if (user?.role === 'PATIENT') {
      // El alta nueva termina el cuestionario en el dashboard; el login existente
      // sí conserva su destino de reserva/lectura autorizado.
      const destination = location.pathname === '/register' ? '/' : patientReturnTo((location.state as { from?: unknown } | null)?.from);
      return <Navigate to={user.medicalOnboarding?.pending ? `/patient-onboarding?returnTo=${encodeURIComponent(destination)}` : destination} replace />;
    }
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const currentRole = useAuthStore((state) => state.user?.role);

  if (status === 'restoring') {
    return <RestoringScreen />;
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }
  const allowed = Array.isArray(role) ? role : [role];
  if (currentRole === undefined || !allowed.includes(currentRole)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-5 text-center">
        <div className="max-w-[40ch]">
          <h1 className="text-[length:var(--text-h4)] text-ink">Sin acceso</h1>
          <p className="mt-2 text-[length:var(--text-body-app)] text-ink-secondary">
            Tu cuenta no tiene permisos para esta sección.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
