import { Link, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';
import { BackendHealthCard } from '../foundation/BackendHealthCard';
import { AppShell } from '../layout/AppShell';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Propietario',
  DENTIST: 'Odontólogo',
  RECEPTIONIST: 'Recepción',
  PATIENT: 'Paciente',
};

/**
 * Pantalla autenticada minima de Fase 2. No adelanta modulos de negocio: solo
 * muestra la sesion (la fuente autoritativa es `/me`) y las acciones de cuenta.
 */
export function HomePage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <AppShell>
      <div className="px-5 py-6 md:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[65ch]">
            <p className="text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-ink-muted">
              Sesión activa
            </p>
            <h1 className="mt-2 text-[length:var(--text-h3)] tracking-[-0.025em]">{user?.email}</h1>
            <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
              Rol: {user ? (ROLE_LABEL[user.role] ?? user.role) : '—'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/patients"
              className="rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
            >
              Pacientes
            </Link>
            {user?.role === 'OWNER' ? (
              <>
                <Link
                  to="/clinic"
                  className="rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Configuración de la clínica
                </Link>
                <Link
                  to="/users"
                  className="rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Equipo
                </Link>
              </>
            ) : null}
            <Link
              to="/change-password"
              className="rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
            >
              Cambiar contraseña
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <div className="mt-8 grid gap-3 md:grid-cols-2">
          <BackendHealthCard />
        </div>
      </div>
    </AppShell>
  );
}