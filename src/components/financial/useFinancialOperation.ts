import { useQuery } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import { financialIntentsApi, type FinancialIntentCommand, type FinancialIntentOperation, type FinancialIntentView } from '../../api/financialIntents';
import { financialError, requireFinancialAccess, type FinancialPermission } from './financialUi';
import { isFinancialSessionCurrent, useFinancialSession } from './financialSession';
import { UnsavedChangesContext } from '../../app/unsavedChanges';

type Phase = 'sending' | 'uncertain' | 'registered' | 'rejected' | 'confirmed' | 'abandoned';
export interface FinancialIntent<T> {
  key: string; operation: FinancialIntentOperation; payload?: T; phase: Phase; view?: FinancialIntentView;
  message?: string; fieldErrors?: Record<string, string>; registrationMissing?: boolean;
}
const terminal = (phase: Phase) => ['confirmed', 'rejected', 'abandoned'].includes(phase);

/** Una lectura puede actualizar presentacion existente, nunca disparar callbacks financieros. */
export function cacheFinancialIntentView(session: ReturnType<typeof useFinancialSession>, result: FinancialIntentView) {
  if (!isFinancialSessionCurrent(session)) return;
  session.client.setQueriesData<FinancialIntent<unknown> | null>({ queryKey: ['financial-intents'], predicate: query =>
    query.queryKey[2] === session.userId && query.queryKey[3] === session.version && query.queryKey[4] === session.role }, previous => {
    if (!previous || previous.operation !== result.operation || previous.key !== result.intentId) return previous;
    const phase = result.state.toLowerCase() as Phase;
    if (terminal(previous.phase) && previous.phase !== phase) return previous;
    const updated = { ...previous, phase, view: result, registrationMissing: false };
    delete updated.message; delete updated.fieldErrors;
    if (terminal(phase)) delete updated.payload;
    return updated;
  });
}

/** Solo memoria de la sesion. Montar/restaurar nunca hace POST ni reanuda una intencion. */
export function useFinancialOperation<T>(scope: string, operation: FinancialIntentOperation,
    command: (payload: T) => FinancialIntentCommand, onSaved: (view: FinancialIntentView, isCurrent: () => boolean) => Promise<void>,
    required: FinancialPermission = 'write', recovered?: FinancialIntentView) {
  const session = useFinancialSession();
  const { client } = session;
  const cacheKey = ['financial-intents', scope, session.userId, session.version, session.role];
  const query = useQuery<FinancialIntent<T> | null>({ queryKey: cacheKey, queryFn: () => null, enabled: false, gcTime: Infinity,
    initialData: () => {
      if (!recovered) return null;
      const known = client.getQueriesData<FinancialIntent<unknown>>({ queryKey: ['financial-intents'] })
        .find(([key, previous]) => key[2] === session.userId && key[3] === session.version && key[4] === session.role
          && previous?.key === recovered.intentId && previous.operation === operation && terminal(previous.phase))?.[1]?.view ?? recovered;
      return { key: known.intentId, operation, phase: known.state.toLowerCase() as Phase, view: known };
    } });
  const current = isFinancialSessionCurrent(session);
  const cached = current ? query.data ?? null : null;
  const intent = cached?.phase === 'sending' ? { ...cached, phase: 'uncertain' as const } : cached;
  const [pendingSession, setPending] = useState<typeof session | null>(null);
  const sameSession = (other: typeof session) => other.userId === session.userId && other.role === session.role
    && other.version === session.version && other.client === session.client;
  const pending = pendingSession !== null && sameSession(pendingSession);
  const running = useRef<{ session: typeof session } | null>(null);
  const mounted = useRef(true);
  const warning = useContext(UnsavedChangesContext);
  const warningKey = useRef(Symbol('financial-intent'));
  const setDirty = warning?.setFinancialIntent, release = warning?.release;
  const unresolved = current && intent !== null && !terminal(intent.phase);
  useEffect(() => {
    const key = warningKey.current;
    setDirty?.(key, unresolved);
    return () => release?.(key);
  }, [setDirty, release, unresolved]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = () => isFinancialSessionCurrent(session);

  function remember(next: FinancialIntent<T> | null) {
    if (!valid()) return;
    const previous = client.getQueryData<FinancialIntent<T>>(cacheKey);
    if (next && previous?.key === next.key && terminal(previous.phase) && !terminal(next.phase)) return;
    client.setQueryData(cacheKey, next);
  }
  async function accept(result: FinancialIntentView, previous: FinancialIntent<T>) {
    if (!valid()) return;
    const latest = client.getQueryData<FinancialIntent<T>>(cacheKey);
    if (latest?.key === result.intentId && terminal(latest.phase) && result.state === 'REGISTERED') return;
    const next: FinancialIntent<T> = { ...previous, phase: result.state.toLowerCase() as Phase, view: result, registrationMissing: false };
    delete next.message; delete next.fieldErrors;
    if (terminal(next.phase)) delete next.payload;
    if (terminal(next.phase)) release?.(warningKey.current); // Antes de la navegacion de onSaved.
    remember(next);
    cacheFinancialIntentView(session, result);
    // GET de descubrimiento solo se invalida, nunca POST; no expone comandos en otras superficies.
    void client.invalidateQueries({ queryKey: ['financial-recovery'], refetchType: terminal(next.phase) ? 'active' : 'none' });
    if (result.state !== 'CONFIRMED') return;
    void client.invalidateQueries({ queryKey: ['financial-report'] });
    if (!mounted.current || !valid()) return;
    try {
      await onSaved(result, valid);
      if (!valid()) return;
    } catch {
      if (valid()) remember({ ...next, message: 'Operación confirmada, pero no se pudo consultar el estado vigente. Reintenta la lectura; no vuelvas a enviar la operación.' });
    }
  }
  async function verify(previous: FinancialIntent<T>, failure?: unknown) {
    try {
      const result = await financialIntentsApi.get(operation, previous.key);
      if (!valid()) return;
      await accept(result, previous);
      if (failure && result.state === 'REGISTERED') remember({ ...previous, view: result, phase: 'registered', message: financialError(failure),
        fieldErrors: failure instanceof ApiError ? failure.fieldErrors : {} });
    } catch (cause) {
      if (!valid()) return;
      const known = client.getQueryData<FinancialIntent<T>>(cacheKey) ?? previous;
      const missing = cause instanceof ApiError && cause.status === 404 && previous.payload !== undefined && !previous.view;
      remember({ ...known, phase: terminal(known.phase) ? known.phase : 'uncertain', registrationMissing: missing,
        message: missing ? 'No se encontró el registro. Puedes volver a registrar la misma solicitud; no se ejecutará hasta que lo confirmes.'
          : financialError(failure ?? cause) });
    }
  }
  async function run(action: () => Promise<void>) {
    if (!mounted.current || !valid() || (running.current && sameSession(running.current.session))) return;
    try { requireFinancialAccess(required); } catch { return; }
    const attempt = { session };
    running.current = attempt; setPending(session);
    try { await action(); }
    finally {
      if (running.current === attempt) running.current = null;
      if (mounted.current && valid()) setPending(null);
    }
  }
  async function submit(payload: T) {
    if (intent) return; // Otra identidad exige una accion explicita tras cierre/confirmacion.
    await run(async () => {
      if (client.getQueryData(cacheKey)) return; // Tambien bloquea callbacks de un render anterior.
      const previous: FinancialIntent<T> = { operation, key: crypto.randomUUID(), payload: structuredClone(payload), phase: 'sending' };
      remember(previous);
      try {
        const registered = await financialIntentsApi.register(operation, previous.key, command(previous.payload!));
        if (!valid()) return;
        // Solo el envio inicial, admitido por este click, encadena registro + ejecucion.
        remember({ ...previous, view: registered, phase: registered.state.toLowerCase() as Phase });
        const result = registered.state === 'REGISTERED' ? await financialIntentsApi.execute(operation, previous.key) : registered;
        if (valid()) await accept(result, { ...previous, view: registered });
      } catch (cause) { if (valid()) await verify(client.getQueryData<FinancialIntent<T>>(cacheKey) ?? previous, cause); }
    });
  }
  async function consult() {
    if (!intent) return;
    await run(() => verify(intent));
  }
  async function resume() {
    if (!intent || intent.phase !== 'registered') return;
    await run(async () => {
      try {
        // La accion es explicita; una lectura concurrente nunca autoriza por si sola un POST.
        const latest = await financialIntentsApi.get(operation, intent.key);
        if (!valid()) return;
        if (latest.state !== 'REGISTERED') { await accept(latest, intent); return; }
        const result = await financialIntentsApi.execute(operation, intent.key);
        if (valid()) await accept(result, intent);
      } catch (cause) { if (valid()) await verify(intent, cause); }
    });
  }
  async function retryRegistration() {
    if (!intent?.registrationMissing || intent.payload === undefined) return;
    await run(async () => {
      try {
        const result = await financialIntentsApi.register(operation, intent.key, command(intent.payload!));
        if (valid()) await accept(result, intent); // Nunca ejecutar al recuperar un registro.
      } catch (cause) { if (valid()) await verify(intent, cause); }
    });
  }
  async function abandon() {
    if (!intent || intent.phase !== 'registered') return;
    await run(async () => {
      try { const result = await financialIntentsApi.abandon(operation, intent.key); if (valid()) await accept(result, intent); }
      catch (cause) { if (valid()) await verify(intent, cause); }
    });
  }
  async function retryRead() {
    if (!intent?.view || intent.phase !== 'confirmed') return;
    await run(() => accept(intent.view!, intent));
  }
  return { intent, pending: current && pending, locked: Boolean(intent) || pending || !current,
    submit, consult, resume, abandon, retryRegistration, retryRead,
    startNew: () => {
      const latest = client.getQueryData<FinancialIntent<T>>(cacheKey);
      if (mounted.current && valid() && !running.current && latest?.key === intent?.key
          && latest && terminal(latest.phase) && !latest.message) remember(null);
    } };
}
