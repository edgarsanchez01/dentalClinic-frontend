import { useContext, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';
import { NotificationBell } from '../notifications/NotificationBell';
import { activeNavigationId, navigationFor, ROLE_LABELS, type NavigationItem } from '../../app/roleNavigation';
import { UnsavedChangesContext, useGuardedNavigate } from '../../app/unsavedChanges';
import '../auth/auth.css';
import '../patient/patient.css';
import './reception.css';
import '../dentist/dentist.css';
import '../owner/owner.css';

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const desktop = useRef<HTMLElement>(null);
  const menuId = useId();
  const location = useLocation();
  const confirmationOpen = useContext(UnsavedChangesContext)?.confirmationOpen ?? false;
  const returnTrigger = useRef<HTMLElement | null>(null);
  const user = useAuthStore((state) => state.user);
  const owner = user?.role === 'OWNER';

  function closeMenu() {
    if (dialog.current?.open) dialog.current.close();
  }

  function openMenu(event: React.MouseEvent<HTMLButtonElement>) {
    returnTrigger.current = event.currentTarget;
    dialog.current?.showModal();
    closeButton.current?.focus();
    setMobileOpen(true);
  }

  useEffect(() => {
    if (confirmationOpen && dialog.current?.open) dialog.current.close();
  }, [confirmationOpen]);

  useEffect(() => {
    if (dialog.current?.open) dialog.current.close();
  }, [location.key]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(min-width: 48rem)');
    const onDesktop = () => {
      if (media.matches) {
        dialog.current?.close();
        const active = desktop.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]')
          ?? desktop.current?.querySelector<HTMLAnchorElement>('a');
        active?.focus();
      }
    };
    media.addEventListener('change', onDesktop);
    onDesktop();
    return () => {
      document.body.style.overflow = previousOverflow;
      media.removeEventListener('change', onDesktop);
    };
  }, [mobileOpen]);

  return (
    <div className={`${user?.role === 'PATIENT' ? 'patient-shell ' : user?.role === 'RECEPTIONIST' ? 'reception-shell ' : user?.role === 'DENTIST' ? 'dentist-shell ' : owner ? 'owner-shell ' : ''}min-h-dvh bg-canvas pb-24 text-ink md:pb-0`}>
      {user?.role === 'PATIENT' ? <a className="patient-skip" href="#patient-main">Ir al contenido</a> : null}
      <header className={`${owner ? 'owner-chrome ' : ''}relative flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-paper px-5 py-3`}>
        <Link to="/" className="rounded-xs text-[length:var(--text-h5)] font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-primary">DentalClinic</Link>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <NotificationBell />
          <AccountMenu />
          <button
            ref={trigger}
            type="button"
            aria-label="Abrir menú de navegación"
            aria-expanded={mobileOpen}
            aria-controls={menuId}
            aria-haspopup="dialog"
            data-navigation-trigger
            className="min-h-11 shrink-0 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary md:hidden"
            onClick={openMenu}
          >
            Menú
          </button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-app">
        <AppSidebar sidebarRef={desktop} />
        <main id={user?.role === 'PATIENT' ? 'patient-main' : undefined} tabIndex={user?.role === 'PATIENT' ? -1 : undefined} className="min-w-0 flex-1">{children}</main>
      </div>
      <dialog
        ref={dialog}
        id={menuId}
        aria-label="Menú de navegación"
        aria-modal="true"
        className={`${owner ? 'owner-chrome ' : ''}fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-sidebar p-5 text-ink backdrop:bg-ink/20 md:hidden`}
        onCancel={(event) => { event.preventDefault(); closeMenu(); }}
        onClose={() => {
          setMobileOpen(false);
          // Native close may restore focus before dispatching this event. Do not
          // steal it back if the user has already focused another page control.
          const focused = document.activeElement;
          if (!window.matchMedia('(min-width: 48rem)').matches
              && !document.querySelector('dialog[data-unsaved-dialog][open]')
              && (focused === document.body || focused === dialog.current || (focused !== null && dialog.current?.contains(focused)))) {
            (returnTrigger.current ?? trigger.current)?.focus();
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const items = dialog.current!.querySelectorAll<HTMLElement>('button, a[href]');
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[length:var(--text-h5)] font-semibold">DentalClinic</span>
          <button
            type="button"
            ref={closeButton}
            onClick={closeMenu}
            className="min-h-11 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
          >Cerrar menú</button>
        </div>
        <Navigation mobile onNavigate={closeMenu} />
      </dialog>
      <nav aria-label="Navegación rápida" className={`${owner ? 'owner-chrome ' : ''}fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 gap-1 border-t border-hairline bg-paper px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden`}>
        {navigationFor(user).filter((entry) => entry.primary).map((entry) =>
          <NavigationLink key={entry.id} item={entry} active={activeNavigationId(location.pathname, navigationFor(user)) === entry.id} compact />)}
        <button type="button" onClick={openMenu} aria-controls={menuId} aria-expanded={mobileOpen} aria-haspopup="dialog"
          className="min-h-11 rounded-control px-2 py-2 text-[length:var(--text-body-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary">Más</button>
      </nav>
    </div>
  );
}

/**
 * Sidebar tonal: un tono por encima del canvas, SIN borde divisor
 * (`Design System.md` 3.2, 10.2). La separacion la produce el tono.
 */
function AppSidebar({ sidebarRef }: { sidebarRef: React.Ref<HTMLElement> }) {
  const role = useAuthStore(state => state.user?.role);
  const patient = role === 'PATIENT';
  const receptionist = role === 'RECEPTIONIST';
  return (
    <aside ref={sidebarRef} className={`${role === 'OWNER' ? 'owner-chrome ' : ''}hidden w-64 shrink-0 bg-sidebar md:block`} aria-label="Navegacion">
      <div className="px-5 py-6">
        <span className="text-[length:var(--text-h5)] font-semibold tracking-[-0.01em]">
          {patient ? 'Tu espacio' : receptionist ? 'Recepción' : 'DentalClinic'}
        </span>
        {receptionist ? <p className="mt-1 text-[length:var(--text-caption)] text-ink-secondary">Panel de trabajo</p> : null}
        <div className="mt-6"><Navigation /></div>
      </div>
    </aside>
  );
}

function Navigation({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const items = navigationFor(user);
  const active = activeNavigationId(location.pathname, items);
  return (
    <nav aria-label={mobile ? 'Navegación móvil' : 'Navegación de escritorio'} className="grid gap-5">
      {(['Operación', 'Administración', 'Configuración', 'Cuenta'] as const).map((group) => {
        const groupItems = items.filter((entry) => entry.group === group);
        return groupItems.length ? <div key={group} className="grid gap-1">
          {user?.role !== 'PATIENT' ? <p className="px-3 pb-1 text-[length:var(--text-caption)] font-medium tracking-[0.04em] text-ink-muted uppercase">{group}</p> : null}
          {groupItems.map((entry) => <NavigationLink key={entry.id} item={entry} active={entry.id === active} mobile={mobile} onNavigate={onNavigate} />)}
        </div> : null;
      })}
    </nav>
  );
}

function NavigationLink({ item, active, mobile = false, compact = false, onNavigate }: {
  item: NavigationItem; active: boolean; mobile?: boolean; compact?: boolean; onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`${mobile || compact ? 'min-h-11 flex items-center ' : ''}${compact ? 'justify-center px-1 text-center text-[length:var(--text-body-sm)]' : 'px-3 text-[length:var(--text-body-app)]'} rounded-control py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active ? 'bg-paper text-ink ring-1 ring-hairline' : 'text-ink-secondary hover:text-ink'}`}
    >
      {item.label}
    </Link>
  );
}

function AccountMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const attempt = useGuardedNavigate();
  const [pending, setPending] = useState(false);
  async function closeSession() {
    setPending(true);
    // Publicar limpieza + destino juntos, después del consentimiento. La navegación
    // síncrona evita que RequireAuth introduzca /login mientras espera el cierre remoto.
    const request = flushSync(() => {
      const pending = logout();
      navigate('/', { replace: true, flushSync: true });
      return pending;
    });
    const version = useAuthStore.getState().sessionVersion;
    let notice: string | undefined;
    try { await request; }
    catch { notice = 'No se pudo confirmar el cierre remoto. Si la sesión reaparece, vuelve a cerrarla.'; }
    const current = useAuthStore.getState();
    if (current.sessionVersion !== version || current.status !== 'anonymous') return;
    navigate('/', { replace: true, ...(notice ? { state: { notice } } : {}) });
  }
  return <>
    <details className="min-w-0" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary className="min-h-11 cursor-pointer rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary">Cuenta</summary>
      <div className="absolute top-full right-4 z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-card bg-paper p-4 shadow-floating ring-1 ring-hairline">
        <p className="break-all text-[length:var(--text-body-sm)]">{user?.email}</p>
        <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">{user ? ROLE_LABELS[user.role] : ''}</p>
        {user?.role === 'PATIENT' ? <Link to={user.patientId ? `/patients/${user.patientId}` : '/patients'} className="patient-link">Mis datos y salud</Link> : null}
        <Link to="/change-password" className="mt-3 flex min-h-11 items-center rounded-control px-2 underline outline-none focus-visible:ring-2 focus-visible:ring-primary">Cambiar contraseña</Link>
      </div>
    </details>
    <button type="button" disabled={pending} onClick={() => attempt(() => { void closeSession(); })}
      className="min-h-11 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
      {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  </>;
}
