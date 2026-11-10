import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, useNavigate, type Blocker } from 'react-router-dom';

import { useAuthStore } from './authStore';
import { UnsavedChangesContext, type Proceed, type UnsavedChangesValue } from './unsavedChanges';

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <RouterDraftGuard>{children}</RouterDraftGuard> : <DraftGuard>{children}</DraftGuard>;
}

function RouterDraftGuard({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<symbol>());
  const bypass = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Una sesión revocada nunca queda atrapada en una pantalla autenticada con datos antiguos.
    return useAuthStore.getState().status === 'authenticated' && !bypass.current && dirty.current.size > 0
      && `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`
        !== `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`;
  });
  return <DraftGuard dirtyRef={dirty} bypassRef={bypass} blocker={blocker}>{children}</DraftGuard>;
}

function DraftGuard({ children, dirtyRef, bypassRef, blocker }: {
  children: ReactNode;
  dirtyRef?: React.RefObject<Set<symbol>>;
  bypassRef?: React.RefObject<boolean>;
  blocker?: Blocker;
}) {
  const ownDirty = useRef(new Set<symbol>());
  const ownBypass = useRef(false);
  const dirty = dirtyRef ?? ownDirty;
  const bypass = bypassRef ?? ownBypass;
  const [pending, setPending] = useState<Proceed | null>(null);
  const navigate = useNavigate();
  const hasDirty = useCallback(() => dirty.current.size > 0, [dirty]);
  const operations = useRef(new Set<symbol>());
  const durableOperations = useRef(new Set<symbol>());
  const schedulingOperations = useRef(new Set<symbol>());
  const [financialPending, setFinancialPending] = useState(false);
  const [durableFinancialPending, setDurableFinancialPending] = useState(false);
  const [schedulingPending, setSchedulingPending] = useState(false);
  const [guardCount, setGuardCount] = useState(0);
  const setDirty = useCallback((key: symbol, value: boolean, reason?: 'operation') => {
    if (value) dirty.current.add(key);
    else dirty.current.delete(key);
    if (value && reason === 'operation') operations.current.add(key);
    else operations.current.delete(key);
    setFinancialPending(operations.current.size > 0);
    setGuardCount(dirty.current.size);
  }, [dirty]);
  const setFinancialIntent = useCallback((key: symbol, value: boolean) => {
    setDirty(key, value);
    if (value) durableOperations.current.add(key);
    else durableOperations.current.delete(key);
    setDurableFinancialPending(durableOperations.current.size > 0);
  }, [setDirty]);
  const setSchedulingOperation = useCallback((key: symbol, value: boolean) => {
    setDirty(key, value);
    if (value) schedulingOperations.current.add(key);
    else schedulingOperations.current.delete(key);
    setSchedulingPending(schedulingOperations.current.size > 0);
  }, [setDirty]);
  const release = useCallback((key: symbol) => {
    dirty.current.delete(key);
    operations.current.delete(key);
    durableOperations.current.delete(key);
    schedulingOperations.current.delete(key);
    setFinancialPending(operations.current.size > 0);
    setDurableFinancialPending(durableOperations.current.size > 0);
    setSchedulingPending(schedulingOperations.current.size > 0);
    setGuardCount(dirty.current.size);
  }, [dirty]);
  const attempt = useCallback((proceed: Proceed) => {
    if (!hasDirty()) proceed();
    else setPending(() => proceed);
  }, [hasDirty]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDirty]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!hasDirty() || event.defaultPrevented || event.button !== 0
          || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target === '_blank') return;
      const raw = anchor.getAttribute('href') ?? '';
      if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}${url.hash}`;
      if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      event.stopPropagation();
      if (blocker) navigate(to); // useBlocker es la única confirmación de esta transición.
      else attempt(() => navigate(to)); // Compatibilidad con MemoryRouter declarativo de tests.
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [attempt, blocker, hasDirty, navigate]);

  const confirmationOpen = pending !== null || blocker?.state === 'blocked';
  const value = useMemo<UnsavedChangesValue>(
    () => ({ setDirty, setFinancialIntent, setSchedulingOperation, release, attempt, confirmationOpen }), [setDirty, setFinancialIntent, setSchedulingOperation, release, attempt, confirmationOpen],
  );
  function stay() {
    setPending(null);
    if (blocker?.state === 'blocked') blocker.reset();
  }
  function leave() {
    setPending(null);
    if (blocker?.state === 'blocked') {
      blocker.proceed();
    } else if (pending) {
      // El callback ya fue autorizado. Si llama a navigate no debe confirmar una segunda vez.
      bypass.current = true;
      try { pending(); } finally { bypass.current = false; }
    }
  }
  return <UnsavedChangesContext.Provider value={value}>
    {children}
    {confirmationOpen ? <UnsavedChangesDialog financialPending={financialPending} durableFinancialPending={durableFinancialPending} schedulingPending={schedulingPending} hasDirty={guardCount > 0} onStay={stay} onLeave={leave} /> : null}
  </UnsavedChangesContext.Provider>;
}

function UnsavedChangesDialog({ onStay, onLeave, financialPending, durableFinancialPending, schedulingPending, hasDirty }: {
  onStay: () => void; onLeave: () => void; financialPending: boolean; durableFinancialPending: boolean; schedulingPending: boolean; hasDirty: boolean;
}) {
  const [openedDuringScheduling] = useState(schedulingPending);
  const schedulingFinished = openedDuringScheduling && !schedulingPending && !hasDirty;
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    stay.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected && !previous.closest('dialog:not([open])')) previous.focus();
      else document.querySelector<HTMLElement>('[data-navigation-trigger]')?.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-modal="true" aria-labelledby="unsaved-changes-title"
    aria-describedby="unsaved-changes-description" data-unsaved-dialog
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-card border-0 bg-paper p-5 text-ink shadow-floating ring-1 ring-hairline backdrop:bg-ink/40"
    onCancel={(event) => { event.preventDefault(); onStay(); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onStay(); }
    }}>
    <h2 id="unsaved-changes-title" className="text-[length:var(--text-h5)]">{financialPending || durableFinancialPending ? 'Operación pendiente de verificar' : schedulingPending ? 'Guardado en curso' : schedulingFinished ? 'Operación finalizada' : 'Tienes cambios sin guardar'}</h2>
    <p id="unsaved-changes-description" className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">
      {durableFinancialPending ? 'Salir o cerrar sesión no cancela las operaciones admitidas. Recupera la solicitud en Finanzas tras recargar o iniciar sesión y consulta su estado antes de reanudar. No repitas la operación con otra identidad. Los datos aún no registrados solo viven en memoria.' : financialPending ? 'Salir no cancela ni revierte la finalización o el cobro. Conserva esta sesión para recuperar la misma solicitud; recargar o cerrar sesión pierde su copia en memoria. No repitas la operación con otra clave. Los borradores sin guardar, si existen, se perderán al salir.' : schedulingPending ? 'Hay un guardado en curso. Salir no garantiza que la operación se cancele' : schedulingFinished ? 'La operación ya no está en curso. Revisa su resultado antes de salir.' : 'Si sales ahora, los cambios que no guardaste se perderán. Guárdalos antes de continuar o elige seguir aquí.'}
    </p>
    {schedulingPending && !financialPending ? <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">Los cambios que no hayas enviado se perderán al salir.</p> : null}
    <div className="mt-4 flex flex-wrap justify-end gap-3">
      <button ref={stay} type="button" onClick={onStay}
        className="min-h-11 rounded-control bg-input-fill px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">Seguir aquí</button>
      <button type="button" onClick={onLeave}
        className="min-h-11 rounded-control bg-danger-subtle px-4 py-2 font-medium text-danger-ink outline-none focus-visible:ring-2 focus-visible:ring-primary">{financialPending || durableFinancialPending || schedulingPending || schedulingFinished ? 'Salir de esta vista' : 'Salir sin guardar'}</button>
    </div>
  </dialog>;
}
