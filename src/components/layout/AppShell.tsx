import { NavLink } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';

/**
 * Shell de la aplicacion de gestion (contexto App).
 *
 * Compone el contexto documentado en `Design System.md` 2.5 y 8.3:
 * sidebar tonal sin borde divisor, canvas un tono por debajo, max-width 1280px.
 *
 * Fase 4: la navegacion lista solo los modulos implementados. No se ofrecen entradas a fases
 * futuras. La matriz de permisos la aplica el backend; aqui se refleja para no prometer acciones
 * que el servidor rechazaria.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <div className="mx-auto flex w-full max-w-app">
        <AppSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/**
 * Sidebar tonal: un tono por encima del canvas, SIN borde divisor
 * (`Design System.md` 3.2, 10.2). La separacion la produce el tono.
 */
function AppSidebar() {
  const role = useAuthStore((state) => state.user?.role);

  return (
    <aside className="hidden w-64 shrink-0 bg-sidebar md:block" aria-label="Navegacion">
      <div className="px-5 py-6">
        <span className="text-[length:var(--text-h5)] font-semibold tracking-[-0.01em]">
          DentalClinic
        </span>
        <nav className="mt-6 grid gap-1">
          <NavItem to="/" label="Inicio" end />
          <NavItem to="/patients" label="Pacientes" />
          <NavItem to="/appointments" label="Citas" />
          {role === 'OWNER' || role === 'DENTIST' || role === 'RECEPTIONIST' ? (
            <NavItem to="/scheduling" label="Horarios" />
          ) : null}
          {role === 'OWNER' ? (
            <>
              <NavItem to="/clinic" label="Clínica" />
              <NavItem to="/users" label="Equipo" />
            </>
          ) : null}
          <NavItem to="/change-password" label="Contraseña" />
        </nav>
      </div>
    </aside>
  );
}

function NavItem({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-control px-3 py-2 text-[length:var(--text-body-app)] outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isActive ? 'bg-paper text-ink ring-1 ring-hairline' : 'text-ink-secondary hover:text-ink'
        }`
      }
    >
      {label}
    </NavLink>
  );
}