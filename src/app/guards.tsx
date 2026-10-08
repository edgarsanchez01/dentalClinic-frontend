import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from './authStore';
import type { Role } from '../api/auth';

/** Pantalla neutra mientras se restaura la sesion; evita el parpadeo a /login. */
export function RestoringScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas text-ink" role="status">
      <p className="text-[length:var(--text-body-app)] text-ink-muted">Restaurando sesión…</p>
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
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** Solo invitados: un usuario con sesion no debe ver /login ni /forgot-password. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);

  if (status === 'restoring') {
    return <RestoringScreen />;
  }
  if (status === 'authenticated') {
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