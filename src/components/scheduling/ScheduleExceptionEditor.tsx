import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ScheduleExceptionDto, ScheduleExceptionInput } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { ScheduleManagementHeading } from './ScheduleManagementHeading';
import { TimeField } from './ScheduleManagementFields';
import { sameDraft, useSchedulingDraftGuard } from './useSchedulingDraft';
import { errorMessage, schedulingActorIdentity, shortTime } from './schedulingManagement';

/** Editor existente: conserva las dos recetas y las closures de identidad recibidas. */
export function ExceptionsPanel({ idPrefix, queryKey, list, put, remove, canEdit, requireWrite, emptyLabel, contextual = false }: {
  idPrefix: string; queryKey: unknown[]; list: () => Promise<ScheduleExceptionDto[]>;
  put: (date: string, input: ScheduleExceptionInput) => Promise<ScheduleExceptionDto>;
  remove: (date: string) => Promise<void>; canEdit: boolean; requireWrite: () => void; emptyLabel: string; contextual?: boolean;
}) {
  const dentistRole = useAuthStore((state) => state.user?.role === 'DENTIST');
  const protectDraft = dentistRole || contextual;
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ExceptionForm>(EMPTY_EXCEPTION);
  const [baseline, setBaseline] = useState(form);
  const resetDraft = (next: ExceptionForm) => { setForm(next); setBaseline(next); };
  const [open, setOpen] = useState(false);
  const [actorIdentity] = useState(schedulingActorIdentity);
  const mounted = useRef(false);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLFormElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: 'editor' | 'trigger' | 'validation' | 'error'; version: number } | null>(null);
  const requestFocus = (target: NonNullable<typeof focusRequest>['target']) => setFocusRequest((previous) => ({ target, version: (previous?.version ?? 0) + 1 }));
  const currentActor = () => !contextual || mounted.current && actorIdentity === schedulingActorIdentity();
  const available = () => !contextual || !busy.current && currentActor();
  const dirty = !sameDraft(form, baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { data, isPending, isError, isSuccess } = useQuery({ queryKey, queryFn: list });
  const items = data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const discardAllowed = () => !contextual || !open || !dirty || window.confirm('¿Descartar los cambios sin guardar de esta excepción?');
  const startCreate = (button?: HTMLButtonElement) => {
    if (!available() || contextual && !isSuccess || !discardAllowed()) return;
    if (contextual) { trigger.current = button ?? createButton.current; setOpen(true); requestFocus('editor'); }
    setEditing(null); resetDraft(EMPTY_EXCEPTION); setValidation(null); setError(null); setNotice(null);
  };
  const startEdit = (row: ScheduleExceptionDto, button?: HTMLButtonElement) => {
    if (!available() || contextual && !isSuccess) return;
    if (contextual && open && editing === row.date) return;
    if (!discardAllowed()) return;
    if (contextual) { trigger.current = button ?? null; setOpen(true); requestFocus('editor'); }
    setEditing(row.date);
    resetDraft({ date: row.date, closed: row.closed, startTime: shortTime(row.startTime), endTime: shortTime(row.endTime), reason: row.reason ?? '' });
    setValidation(null); setError(null); setNotice(null);
  };
  const closeEditor = () => { setOpen(false); setEditing(null); resetDraft(EMPTY_EXCEPTION); setValidation(null); };
  const cancel = () => {
    if (!available() || !discardAllowed()) return;
    closeEditor(); setError(null); setNotice(null); requestFocus('trigger');
  };
  const updateForm = (update: (previous: ExceptionForm) => ExceptionForm) => { if (available()) setForm(update); };
  const save = useMutation({
    mutationFn: (snapshot: ExceptionForm | undefined) => {
      requireWrite();
      if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar las excepciones.');
      const draft = snapshot ?? form;
      const payload: ScheduleExceptionInput = draft.closed
        ? { closed: true, startTime: null, endTime: null, reason: draft.reason.trim() || null }
        : { closed: false, startTime: draft.startTime, endTime: draft.endTime, reason: draft.reason.trim() || null };
      return put(draft.date, payload);
    },
    onSuccess: async () => {
      if (!currentActor()) return;
      setNotice(editing ? 'Excepción actualizada.' : 'Excepción guardada.');
      setError(null); setValidation(null); setEditing(null); resetDraft(EMPTY_EXCEPTION);
      if (contextual) { setOpen(false); requestFocus('trigger'); }
      if (contextual) await refresh(); else void refresh();
    },
    onError: (cause) => {
      if (!currentActor()) return;
      setNotice(null); setError(errorMessage(cause));
      if (contextual) requestFocus('error');
    },
    onSettled: () => { busy.current = false; },
  });
  const del = useMutation({
    mutationFn: (date: string) => {
      requireWrite();
      if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar las excepciones.');
      return remove(date);
    },
    onSuccess: async (_result, date) => {
      if (!currentActor()) return;
      setNotice('Excepción eliminada.'); setError(null);
      if (contextual) {
        if (editing === date) closeEditor();
        trigger.current = createButton.current; requestFocus('trigger');
      }
      if (contextual) await refresh(); else void refresh();
    },
    onError: (cause) => {
      if (!currentActor()) return;
      setNotice(null); setError(errorMessage(cause));
      if (contextual) requestFocus('error');
    },
    onSettled: () => { busy.current = false; },
  });
  const pending = save.isPending || del.isPending;
  useSchedulingDraftGuard(protectDraft, (!contextual || open) && dirty, pending);
  useEffect(() => {
    if (!contextual || !focusRequest || pending || root.current?.closest('[hidden]')) return;
    if (focusRequest.target === 'editor') editor.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
    else if (focusRequest.target === 'trigger') {
      const target = trigger.current;
      if (target?.isConnected && !target.disabled) target.focus(); else createButton.current?.focus();
    } else root.current?.querySelector<HTMLElement>(`[data-exception-${focusRequest.target}]`)?.focus();
  }, [contextual, focusRequest, pending]);

  const formFields = <>
    <div className="grid gap-3 sm:grid-cols-2"><div>
      <label htmlFor={`${idPrefix}-date`} className="block text-[length:var(--text-body-sm)] font-medium text-ink">Fecha</label>
      <input id={`${idPrefix}-date`} type="date" required disabled={editing !== null} value={form.date}
        onChange={(event) => updateForm((prev) => ({ ...prev, date: event.target.value }))}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60" />
    </div><label className="flex items-end gap-2 pb-2 text-[length:var(--text-body-sm)] text-ink">
      <input type="checkbox" checked={form.closed} onChange={(event) => updateForm((prev) => ({ ...prev, closed: event.target.checked }))} className="size-4 rounded-xs accent-primary" />Cerrado todo el día
    </label></div>
    {form.closed ? null : <div className="grid gap-3 sm:grid-cols-2">
      <TimeField id={`${idPrefix}-start`} label="Apertura" value={form.startTime} onChange={(value) => updateForm((prev) => ({ ...prev, startTime: value }))} />
      <TimeField id={`${idPrefix}-end`} label="Cierre" value={form.endTime} onChange={(value) => updateForm((prev) => ({ ...prev, endTime: value }))} />
    </div>}
    <div><label htmlFor={`${idPrefix}-reason`} className="block text-[length:var(--text-body-sm)] font-medium text-ink">Motivo (opcional)</label>
      <input id={`${idPrefix}-reason`} value={form.reason} onChange={(event) => updateForm((prev) => ({ ...prev, reason: event.target.value }))} className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
    </div>
    <p className="text-[length:var(--text-caption)] text-ink-muted">Una excepción cerrada anula el día; una abierta reemplaza la franja semanal de esa fecha.</p>
    {validation ? contextual ? <div tabIndex={-1} data-exception-validation><FormAlert>{validation}</FormAlert></div> : <FormAlert>{validation}</FormAlert> : null}
    <div className={contextual ? 'flex flex-wrap gap-3' : 'flex gap-3'}>
      <button type="submit" disabled={contextual ? pending || !isSuccess : save.isPending} className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60">{save.isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Añadir excepción'}</button>
      {contextual ? <button type="button" onClick={cancel} disabled={pending} className="reception-button reception-button-secondary">Cancelar</button> : editing ? <button type="button" onClick={() => startCreate()} className="rounded-control px-4 py-2 text-[length:var(--text-body-app)] text-ink-secondary underline">Cancelar edición</button> : null}
    </div>
  </>;
  return <div ref={root}>
    {contextual ? <ScheduleManagementHeading title="Excepciones por fecha" description="Define cierres o un horario especial para una fecha concreta." action={canEdit ? <button ref={createButton} type="button" aria-expanded={open} aria-controls={open ? `${idPrefix}-form` : undefined} disabled={pending || !isSuccess} onClick={(event) => startCreate(event.currentTarget)} className="reception-button">Nueva excepción</button> : undefined} /> : null}
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    {error ? contextual ? <div tabIndex={-1} data-exception-error><FormAlert>{error}</FormAlert></div> : <FormAlert>{error}</FormAlert> : null}
    {isError ? <FormAlert>No se pudieron cargar las excepciones.</FormAlert> : null}
    <ul className="grid gap-2">
      {isPending ? <li className="text-ink-muted">Cargando…</li> : null}
      {isSuccess && items.length === 0 ? <li className="text-[length:var(--text-body-sm)] text-ink-secondary">{emptyLabel}</li> : null}
      {items.map((row) => <li key={row.date} className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-2 text-[length:var(--text-body-sm)]">
        <span className="tabular text-ink">{row.date} · {row.closed ? 'Cerrado' : `${shortTime(row.startTime)}–${shortTime(row.endTime)}`}{row.reason ? <span className="text-ink-secondary"> · {row.reason}</span> : null}</span>
        {canEdit ? <span className="flex gap-3">
          <button type="button" onClick={(event) => startEdit(row, event.currentTarget)} disabled={contextual && (pending || !isSuccess)} className="text-primary-ink underline">Editar</button>
          <button type="button" disabled={contextual && (pending || !isSuccess)} onClick={() => {
            if (!available() || contextual && !isSuccess) return;
            if (contextual && open && editing === row.date && dirty && !window.confirm('Esta excepción tiene cambios sin guardar. Si se elimina el registro, se descartarán esos cambios. ¿Continuar?')) return;
            if (window.confirm(`¿Eliminar la excepción del ${row.date}?`)) { if (contextual) busy.current = true; del.mutate(row.date); }
          }} className="text-danger-ink underline">Eliminar excepción</button>
        </span> : null}
      </li>)}
    </ul>
    {canEdit && (!contextual || open) ? <form ref={editor} id={contextual ? `${idPrefix}-form` : undefined} aria-label={contextual ? editing ? 'Editar excepción' : 'Nueva excepción' : undefined} aria-busy={contextual ? pending : undefined} className="mt-4 grid max-w-[28rem] gap-3 rounded-nested bg-sunken p-4" onSubmit={(event) => {
      event.preventDefault();
      if (!available() || contextual && (!open || !isSuccess)) return;
      const problem = validateException(form);
      if (problem) { setValidation(problem); if (contextual) requestFocus('validation'); return; }
      setValidation(null); if (contextual) busy.current = true; save.mutate(contextual ? { ...form } : undefined);
    }}>{contextual ? <fieldset disabled={pending} className="m-0 grid min-w-0 gap-3 border-0 p-0" aria-label="Datos de la excepción">{formFields}</fieldset> : formFields}</form> : null}
  </div>;
}

interface ExceptionForm { date: string; closed: boolean; startTime: string; endTime: string; reason: string; }
const EMPTY_EXCEPTION: ExceptionForm = { date: '', closed: true, startTime: '', endTime: '', reason: '' };
function validateException(form: ExceptionForm): string | null {
  if (!form.date) return 'Selecciona la fecha de la excepción.';
  if (!form.closed) {
    if (!form.startTime || !form.endTime) return 'Indica la hora de apertura y la de cierre de la excepción.';
    if (form.startTime >= form.endTime) return 'La apertura de la excepción debe ser anterior al cierre.';
  }
  return null;
}
