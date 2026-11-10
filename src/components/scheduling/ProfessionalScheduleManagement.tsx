import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { schedulingApi, type ScheduleDayInput, type ScheduleDayDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { WeekEditor, WeekReadOnly } from './WeekEditor';
import { ScheduleManagementHeading, SectionCard } from './ScheduleManagementHeading';
import { DentistScheduleTabs } from './DentistScheduleTabs';
import { ExceptionsPanel } from './ScheduleExceptionEditor';
import { TimeOffPanel } from './TimeOffEditor';
import { useDentistWeekDraft } from './useSchedulingDraft';
import { canEditDentist, errorMessage, fullName, requireDentistWrite, schedulingActorIdentity, useDentistOptions } from './schedulingManagement';

export function DentistHoursSection({ personal = false }: { personal?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const own = user?.role === 'DENTIST' || personal;
  const { dentists: directory, isLoading, isError } = useDentistOptions();
  const dentists = own ? directory.filter((dentist) => dentist.dentistId === user?.dentistId) : directory;
  const [selected, setSelected] = useState<number | null>(null);
  const ownId = user?.dentistId;
  const dentistId = personal ? (ownId !== undefined && Number.isSafeInteger(ownId) && ownId > 0 ? ownId : null)
    : dentists.some((dentist) => dentist.dentistId === selected) ? selected : dentists[0]?.dentistId ?? null;
  const canEdit = dentistId !== null && canEditDentist(dentistId);
  const editingProfile = dentists.find(dentist => dentist.dentistId === dentistId);
  return <SectionCard {...(!own ? { className: 'ce-admin-form' } : {})} title={own ? 'Gestionar mi horario' : 'Horario de dentistas'} subtitle={own ? 'Organiza tu semana habitual, las excepciones y las ausencias de tu perfil.' : canEdit ? 'El propietario gestiona todos los horarios; el odontólogo, solo el propio.' : 'Consulta de solo lectura.'}>
    {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
    {isError ? <FormAlert>No se pudo cargar el directorio de dentistas.</FormAlert> : null}
    {!isLoading && !isError && dentists.length === 0 && dentistId === null ? <p className="text-ink-secondary">{own ? 'No hay un perfil de dentista disponible para tu cuenta.' : 'Todavía no hay dentistas registrados.'}</p> : null}
    {(dentists.length > 0 || personal) && dentistId !== null ? <>
      {!own ? <><label className="block max-w-[20rem] text-[length:var(--text-body-sm)] font-medium text-ink">Dentista
        <select value={dentistId} onChange={(event) => { const next = Number(event.target.value); if (dentists.some((dentist) => dentist.dentistId === next)) setSelected(next); }} className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary">
          {dentists.map((dentist) => <option key={dentist.dentistId} value={dentist.dentistId}>{fullName(dentist.firstName, dentist.lastName)}</option>)}
        </select>
      </label><p className="mt-3 text-[length:var(--text-body-sm)] text-ink-secondary">Profesional en edición: {editingProfile ? fullName(editingProfile.firstName, editingProfile.lastName) : `Dentista #${dentistId}`}. Esta selección gestiona su calendario privado; no cambia la consulta pública de disponibilidad.</p></> : null}
      <DentistHoursPanels dentistId={dentistId} canEdit={canEdit} dentist={own} />
    </> : null}
  </SectionCard>;
}

function DentistHoursPanels({ dentistId, canEdit, dentist }: { dentistId: number; canEdit: boolean; dentist: boolean }) {
  const panels: [ReactNode, ReactNode, ReactNode] = [
    <DentistWeekPanel key={`week-${dentistId}`} dentistId={dentistId} canEdit={canEdit} protectDraft={dentist} />,
    <DentistExceptionsPanel key={`exceptions-${dentistId}`} dentistId={dentistId} canEdit={canEdit} personal={dentist} />,
    <TimeOffPanel key={`timeoff-${dentistId}`} dentistId={dentistId} canEdit={canEdit} personal={dentist} />,
  ];
  return dentist ? <DentistScheduleTabs>{panels}</DentistScheduleTabs> : <div className="schedule-professional-panels mt-4 grid gap-6">{panels}</div>;
}

function DentistWeekPanel({ dentistId, canEdit, protectDraft = false }: { dentistId: number; canEdit: boolean; protectDraft?: boolean }) {
  const queryClient = useQueryClient();
  const [actorIdentity] = useState(schedulingActorIdentity);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentActor = () => !protectDraft || mounted.current && actorIdentity === schedulingActorIdentity();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isError, isSuccess } = useQuery({ queryKey: ['dentist-schedule', dentistId], queryFn: () => schedulingApi.getDentistSchedule(dentistId) });
  const mutation = useMutation({
    mutationFn: async (days: ScheduleDayInput[]) => {
      requireDentistWrite(dentistId);
      if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar el horario.');
      if (queryClient.getQueryState(['dentist-schedule', dentistId])?.status !== 'success') throw new Error('Carga el horario antes de modificarlo.');
      if (protectDraft) {
        await queryClient.cancelQueries({ queryKey: ['dentist-schedule', dentistId], exact: true });
        requireDentistWrite(dentistId);
        if (!currentActor()) throw new Error('Tu sesión ha cambiado. Vuelve a cargar el horario.');
      }
      return schedulingApi.replaceDentistWeek(dentistId, days);
    },
    onSuccess: async (updated) => {
      if (!currentActor()) return;
      if (protectDraft) {
        await queryClient.cancelQueries({ queryKey: ['dentist-schedule', dentistId], exact: true });
        if (!currentActor()) return;
      }
      queryClient.setQueryData(['dentist-schedule', dentistId], updated);
      setNotice('Horario del dentista guardado.'); setError(null);
    },
    onError: (cause) => { if (!currentActor()) return; setNotice(null); setError(errorMessage(cause)); },
  });
  return <div className={!protectDraft ? 'schedule-week-primary reception-card' : undefined}>
    {!protectDraft ? <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Semana</h3> : null}
    {notice ? <p className="mt-2 text-[length:var(--text-body-sm)] text-success-ink">{notice}</p> : null}
    {error ? <FormAlert>{error}</FormAlert> : null}
    {isError ? <FormAlert>No se pudo cargar el horario del dentista.</FormAlert> : null}
    {data ? <div className={protectDraft ? undefined : 'mt-3'}>
      {protectDraft ? <ProtectedWeekEditor days={data.days} disabled={!canEdit || !isSuccess || data.dentistId !== dentistId} readOnly={!canEdit} pending={mutation.isPending} timezone={data.timezone} onSave={async (days) => {
        if (!canEdit || !isSuccess || data.dentistId !== dentistId) throw new Error('Carga el horario antes de modificarlo.');
        return (await mutation.mutateAsync(days)).days;
      }} /> : <WeekEditor key={`${dentistId}-${JSON.stringify(data.days)}`} days={data.days} disabled={!canEdit || !isSuccess || data.dentistId !== dentistId} readOnly={!canEdit} pending={mutation.isPending} timezone={data.timezone} onSave={(days) => { if (canEdit && isSuccess && data.dentistId === dentistId) mutation.mutate(days); }} />}
    </div> : !isError ? <p className="mt-2 text-ink-muted">Cargando…</p> : null}
  </div>;
}

function ProtectedWeekEditor({ onSave, pending = false, ...props }:
  Omit<ComponentProps<typeof WeekEditor>, 'onSave' | 'controller'> & { onSave: (days: ScheduleDayInput[]) => Promise<ScheduleDayDto[]> }) {
  const managed = useDentistWeekDraft(props.days, onSave, pending);
  const [editing, setEditing] = useState(false);
  const [lastConfirmation, setLastConfirmation] = useState(managed.confirmation);
  const root = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  if (managed.confirmation !== lastConfirmation) { setLastConfirmation(managed.confirmation); if (!managed.dirty) setEditing(false); }
  useEffect(() => {
    if (managed.pending) return;
    if (editing !== wasEditing.current && !root.current?.closest('[hidden]')) {
      if (editing) root.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
      else if (wasEditing.current) editButton.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing, managed.pending]);
  return <div ref={root}>
    <ScheduleManagementHeading title="Mi semana" description="Tu horario habitual de atención y los descansos configurados." action={!editing && !props.readOnly ? <button ref={editButton} type="button" disabled={props.disabled || managed.pending} className="reception-button" onClick={() => setEditing(true)}>Editar horario</button> : undefined} />
    {editing ? <div className="schedule-week-editor"><WeekEditor {...props} controller={managed.controller} onSave={managed.save} pending={managed.pending} secondaryAction={<button type="button" className="reception-button reception-button-secondary" disabled={managed.pending} onClick={() => {
      if (managed.pending || managed.dirty && !window.confirm('¿Descartar los cambios sin guardar de tu horario?')) return;
      managed.discard(); setEditing(false);
    }}>Cancelar</button>} /></div> : <WeekReadOnly days={props.days} timezone={props.timezone} complete />}
  </div>;
}

function DentistExceptionsPanel({ dentistId, canEdit, personal = false }: { dentistId: number; canEdit: boolean; personal?: boolean }) {
  const dentistRole = useAuthStore((state) => state.user?.role === 'DENTIST');
  const contextual = dentistRole || personal;
  return <div>
    {!contextual ? <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Excepciones por fecha</h3> : null}
    <div className={contextual ? undefined : 'mt-3'}>
      <ExceptionsPanel idPrefix={`dentist-exception-${dentistId}`} queryKey={['dentist-exceptions', dentistId]}
        list={() => schedulingApi.listDentistExceptions(dentistId)} put={(date, input) => schedulingApi.putDentistException(dentistId, date, input)}
        remove={(date) => schedulingApi.deleteDentistException(dentistId, date)} canEdit={canEdit}
        requireWrite={() => requireDentistWrite(dentistId)} emptyLabel="Sin excepciones registradas." contextual={contextual} />
    </div>
  </div>;
}
