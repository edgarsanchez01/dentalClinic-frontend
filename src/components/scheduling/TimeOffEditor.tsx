import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { schedulingApi, type TimeOffDto, type TimeOffInput } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { ScheduleManagementHeading } from './ScheduleManagementHeading';
import { DateField, TimeField } from './ScheduleManagementFields';
import { sameDraft, useSchedulingDraftGuard } from './useSchedulingDraft';
import { errorMessage, requireDentistWrite, schedulingActorIdentity, shortTime, todayLocal } from './schedulingManagement';

interface TimeOffForm { startDate: string; endDate: string; allDay: boolean; startTime: string; endTime: string; reason: string; }
function emptyTimeOff(): TimeOffForm {
  const today = todayLocal();
  return { startDate: today, endDate: today, allDay: true, startTime: '', endTime: '', reason: '' };
}
function validateTimeOff(form: TimeOffForm): string | null {
  if (!form.startDate || !form.endDate) return 'Indica las fechas de inicio y fin.';
  if (form.startDate > form.endDate) return 'La fecha de inicio no puede ser posterior a la de fin.';
  if (!form.allDay) {
    if (!form.startTime || !form.endTime) return 'Indica la hora de inicio y la de fin de la franquicia parcial.';
    if (form.startTime >= form.endTime) return 'La hora de inicio debe ser anterior a la de fin.';
    if (form.startDate !== form.endDate) return 'Una franquicia con horas cubre un único día; para varios días usa días completos.';
  }
  return null;
}

/** Estado, guardas, validación y payload del editor original, sin unificar políticas por rol. */
export function TimeOffPanel({ dentistId, canEdit, personal = false }: { dentistId: number; canEdit: boolean; personal?: boolean }) {
  const dentistRole = useAuthStore((state) => state.user?.role === 'DENTIST');
  const dentist = dentistRole || personal;
  const visibleText = (text: string) => text === 'Añadir franquicia' ? 'Registrar ausencia'
      : text === 'Sin franquicias.' ? 'Sin ausencias registradas.'
        : text === 'Franquicia añadida.' ? 'Ausencia registrada.'
          : text.replace(/Franquicia/g, 'Ausencia').replace(/franquicia/g, 'ausencia');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TimeOffForm>(emptyTimeOff);
  const [baseline, setBaseline] = useState(form);
  const resetDraft = (next: TimeOffForm) => { setForm(next); setBaseline(next); };
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
  const currentActor = () => !dentist || mounted.current && actorIdentity === schedulingActorIdentity();
  const available = () => !dentist || !busy.current && currentActor();
  const dirty = !sameDraft(form, baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { data, isPending, isError, isSuccess, isFetching } = useQuery({ queryKey: ['timeoff', dentistId], queryFn: () => schedulingApi.listTimeOff(dentistId) });
  const items = data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['timeoff', dentistId] });
  const editable = canEdit && isSuccess && (dentist || !isFetching);
  function requireWrite() {
    requireDentistWrite(dentistId);
    if (queryClient.getQueryState(['timeoff', dentistId])?.status !== 'success') throw new Error('Carga las ausencias antes de modificarlas.');
  }
  const discardAllowed = () => !dentist || !open || !dirty || window.confirm('¿Descartar los cambios sin guardar de esta ausencia?');
  const startCreate = (button?: HTMLButtonElement) => {
    if (!available() || dentist && !editable || !discardAllowed()) return;
    if (dentist) { trigger.current = button ?? createButton.current; setOpen(true); requestFocus('editor'); }
    setEditingId(null); resetDraft(emptyTimeOff()); setValidation(null); setError(null); setNotice(null);
  };
  const startEdit = (timeOff: TimeOffDto, button?: HTMLButtonElement) => {
    if (!available() || dentist && !editable) return;
    if (dentist && open && editingId === timeOff.id) return;
    if (!discardAllowed()) return;
    if (dentist) { trigger.current = button ?? null; setOpen(true); requestFocus('editor'); }
    setEditingId(timeOff.id);
    resetDraft({ startDate: timeOff.startDate, endDate: timeOff.endDate, allDay: timeOff.allDay, startTime: shortTime(timeOff.startTime), endTime: shortTime(timeOff.endTime), reason: timeOff.reason ?? '' });
    setValidation(null); setError(null); setNotice(null);
  };
  const closeEditor = () => { setOpen(false); setEditingId(null); resetDraft(emptyTimeOff()); setValidation(null); };
  const cancel = () => {
    if (!available() || !discardAllowed()) return;
    closeEditor(); setError(null); setNotice(null); requestFocus('trigger');
  };
  const updateForm = (update: (previous: TimeOffForm) => TimeOffForm) => { if (available()) setForm(update); };
  const save = useMutation({
    mutationFn: () => {
      requireWrite();
      if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar las ausencias.');
      const payload: TimeOffInput = { startDate: form.startDate, endDate: form.endDate, startTime: form.allDay ? null : form.startTime, endTime: form.allDay ? null : form.endTime, reason: form.reason.trim() || null };
      return editingId === null ? schedulingApi.createTimeOff(dentistId, payload) : schedulingApi.updateTimeOff(dentistId, editingId, payload);
    },
    onSuccess: async () => {
      if (!currentActor()) return;
      setNotice(editingId === null ? 'Franquicia añadida.' : 'Franquicia actualizada.');
      setError(null); setValidation(null); setEditingId(null); resetDraft(emptyTimeOff());
      if (dentist) { setOpen(false); requestFocus('trigger'); await refresh(); } else void refresh();
    },
    onError: (cause) => {
      if (!currentActor()) return;
      setNotice(null); setError(errorMessage(cause)); if (dentist) requestFocus('error');
    },
    onSettled: () => { busy.current = false; },
  });
  const remove = useMutation({
    mutationFn: (id: number) => {
      requireWrite();
      if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar las ausencias.');
      return schedulingApi.deleteTimeOff(dentistId, id);
    },
    onSuccess: async (_result, id) => {
      if (!currentActor()) return;
      setNotice('Franquicia eliminada.'); setError(null);
      if (dentist) {
        if (editingId === id) closeEditor();
        trigger.current = createButton.current; requestFocus('trigger'); await refresh();
      } else void refresh();
    },
    onError: (cause) => {
      if (!currentActor()) return;
      setNotice(null); setError(errorMessage(cause)); if (dentist) requestFocus('error');
    },
    onSettled: () => { busy.current = false; },
  });
  const pending = save.isPending || remove.isPending;
  useSchedulingDraftGuard(dentist, open && dirty, pending);
  useEffect(() => {
    if (!dentist || !focusRequest || pending || root.current?.closest('[hidden]')) return;
    if (focusRequest.target === 'editor') editor.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
    else if (focusRequest.target === 'trigger') {
      if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); else createButton.current?.focus();
    } else root.current?.querySelector<HTMLElement>(`[data-timeoff-${focusRequest.target}]`)?.focus();
  }, [dentist, focusRequest, pending]);
  const formFields = <>
    <div className="grid gap-3 sm:grid-cols-2">
      <DateField id="timeoff-start" label="Desde" value={form.startDate} onChange={(value) => updateForm((prev) => ({ ...prev, startDate: value, endDate: prev.allDay ? value : prev.endDate }))} />
      <DateField id="timeoff-end" label="Hasta" value={form.endDate} onChange={(value) => updateForm((prev) => ({ ...prev, endDate: value }))} />
    </div>
    <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink"><input type="checkbox" checked={form.allDay} onChange={(event) => updateForm((prev) => ({ ...prev, allDay: event.target.checked, endDate: event.target.checked ? prev.startDate : prev.endDate }))} className="size-4 rounded-xs accent-primary" />Todo el día (permite varios días)</label>
    {form.allDay ? <p className="text-[length:var(--text-caption)] text-ink-muted">{visibleText('La franquicia parcial debe ser de un solo día.')}</p> : <div className="grid gap-3 sm:grid-cols-2">
      <TimeField id="timeoff-start-time" label="Hora inicio" value={form.startTime} onChange={(value) => updateForm((prev) => ({ ...prev, startTime: value }))} />
      <TimeField id="timeoff-end-time" label="Hora fin" value={form.endTime} onChange={(value) => updateForm((prev) => ({ ...prev, endTime: value }))} />
    </div>}
    <div><label htmlFor="timeoff-reason" className="block text-[length:var(--text-body-sm)] font-medium text-ink">Motivo (opcional)</label>
      <input id="timeoff-reason" value={form.reason} onChange={(event) => updateForm((prev) => ({ ...prev, reason: event.target.value }))} className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
    </div>
    {validation ? dentist ? <div tabIndex={-1} data-timeoff-validation><FormAlert>{visibleText(validation)}</FormAlert></div> : <FormAlert>{visibleText(validation)}</FormAlert> : null}
    <div className={dentist ? 'flex flex-wrap gap-3' : 'flex gap-3'}>
      <button type="submit" disabled={dentist ? pending || !editable : save.isPending} className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60">{save.isPending ? 'Guardando…' : editingId === null ? visibleText('Añadir franquicia') : 'Guardar cambios'}</button>
      {dentist ? <button type="button" disabled={pending} onClick={cancel} className="reception-button reception-button-secondary">Cancelar</button> : editingId !== null ? <button type="button" onClick={() => startCreate()} className="rounded-control px-4 py-2 text-[length:var(--text-body-app)] text-ink-secondary underline">Cancelar edición</button> : null}
    </div>
  </>;
  return <div ref={root}>
    {dentist ? <ScheduleManagementHeading title="Ausencias programadas" description="Registra los días o intervalos en los que no estarás disponible." action={canEdit ? <button ref={createButton} type="button" className="reception-button" disabled={!editable || pending} aria-expanded={open} aria-controls={open ? 'dentist-timeoff-form' : undefined} onClick={(event) => startCreate(event.currentTarget)}>Nueva ausencia</button> : undefined} /> : <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">{visibleText('Franquicias')}</h3>}
    {notice ? <p className="mt-2 text-[length:var(--text-body-sm)] text-success-ink">{visibleText(notice)}</p> : null}
    {error ? dentist ? <div tabIndex={-1} data-timeoff-error><FormAlert>{visibleText(error)}</FormAlert></div> : <FormAlert>{error}</FormAlert> : null}
    {isPending ? <p className="mt-2 text-ink-muted">Cargando…</p> : null}
    {isError ? <FormAlert>No se pudieron cargar las ausencias del dentista.</FormAlert> : null}
    <ul className="mt-3 grid gap-2">
      {isSuccess && items.length === 0 ? <li className="text-[length:var(--text-body-sm)] text-ink-secondary">{visibleText('Sin franquicias.')}</li> : null}
      {items.map((timeOff) => <TimeOffItem key={timeOff.id} timeOff={timeOff} canEdit={editable} contextual={dentist} disabled={dentist && pending} onEdit={(button) => { if (editable) startEdit(timeOff, button); }} onRemove={() => {
        if (!available()) return;
        if (dentist && open && editingId === timeOff.id && dirty && !window.confirm('Esta ausencia tiene cambios sin guardar. Si se elimina el registro, se descartarán esos cambios. ¿Continuar?')) return;
        if (editable && window.confirm(visibleText(`¿Eliminar la franquicia del ${timeOff.startDate}?`))) { if (dentist) busy.current = true; remove.mutate(timeOff.id); }
      }} />)}
    </ul>
    {(dentist ? canEdit && open : editable) ? <form ref={editor} id={dentist ? 'dentist-timeoff-form' : undefined} aria-label={dentist ? editingId === null ? 'Nueva ausencia' : 'Editar ausencia' : undefined} aria-busy={dentist ? pending : undefined} className="mt-4 grid max-w-[28rem] gap-3 rounded-nested bg-sunken p-4" onSubmit={(event) => {
      event.preventDefault();
      if (!available() || dentist && (!open || !editable)) return;
      const problem = validateTimeOff(form);
      if (problem) { setValidation(problem); if (dentist) requestFocus('validation'); return; }
      setValidation(null); if (dentist) busy.current = true; save.mutate();
    }}>{dentist ? <fieldset disabled={pending} className="m-0 grid min-w-0 gap-3 border-0 p-0" aria-label="Datos de la ausencia">{formFields}</fieldset> : formFields}</form> : null}
  </div>;
}

function TimeOffItem({ timeOff, canEdit, onEdit, onRemove, contextual = false, disabled = false }: {
  timeOff: TimeOffDto; canEdit: boolean; onEdit: (button?: HTMLButtonElement) => void; onRemove: () => void; contextual?: boolean; disabled?: boolean;
}) {
  const range = timeOff.allDay ? `${timeOff.startDate} → ${timeOff.endDate} (todo el día)` : `${timeOff.startDate} · ${shortTime(timeOff.startTime)}–${shortTime(timeOff.endTime)}`;
  return <li className={`flex items-center justify-between gap-3 border-b border-hairline pb-2 text-[length:var(--text-body-sm)]${contextual ? ' schedule-timeoff-row' : ''}`}>
    <span className="tabular text-ink">{range}{timeOff.reason ? <span className="text-ink-secondary"> · {timeOff.reason}</span> : null}</span>
    {canEdit ? <span className="flex gap-3"><button type="button" disabled={disabled} onClick={(event) => onEdit(event.currentTarget)} className="text-primary-ink underline">Editar</button><button type="button" disabled={disabled} onClick={onRemove} className="text-danger-ink underline">Eliminar</button></span> : null}
  </li>;
}
