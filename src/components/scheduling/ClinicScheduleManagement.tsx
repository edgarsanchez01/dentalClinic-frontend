import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { schedulingApi, type BookingPolicyDto, type ScheduleDayInput } from '../../api/scheduling';
import { FormAlert } from '../auth/ui';
import { WeekEditor } from './WeekEditor';
import { SectionCard } from './ScheduleManagementHeading';
import { ExceptionsPanel } from './ScheduleExceptionEditor';
import { errorMessage, requireOwner } from './schedulingManagement';

/** Los tres editores se montan siempre; agruparlos no reinicializa sus borradores. */
export function ClinicScheduleManagement({ canEdit }: { canEdit: boolean }) {
  return <><ClinicHoursSection canEdit={canEdit} /><ClinicExceptionsSection canEdit={canEdit} /><BookingPolicySection canEdit={canEdit} /></>;
}

function ClinicHoursSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['clinic-schedule'], queryFn: schedulingApi.getClinicSchedule });
  const mutation = useMutation({
    mutationFn: (days: ScheduleDayInput[]) => {
      requireOwner();
      return schedulingApi.replaceClinicWeek(days);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['clinic-schedule'], updated);
      setNotice('Horario de la clínica guardado.');
      setError(null);
    },
    onError: (cause) => { setNotice(null); setError(errorMessage(cause)); },
  });
  return <SectionCard className="schedule-week-primary ce-admin-form" title="Horario de la clínica" subtitle={canEdit ? 'Solo el propietario puede editarlo.' : 'Consulta de solo lectura.'}>
    {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
    {isError ? <FormAlert>No se pudo cargar el horario de la clínica.</FormAlert> : null}
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    {error ? <FormAlert>{error}</FormAlert> : null}
    {data ? <WeekEditor key={JSON.stringify(data.days)} days={data.days} disabled={!canEdit} readOnly={!canEdit}
      pending={mutation.isPending} timezone={data.timezone} onSave={(days) => { if (canEdit) mutation.mutate(days); }} /> : null}
  </SectionCard>;
}

function ClinicExceptionsSection({ canEdit }: { canEdit: boolean }) {
  return <SectionCard className="ce-admin-form" title="Excepciones de la clínica" subtitle={canEdit ? 'Cierres y horarios especiales por fecha, con prioridad sobre el horario semanal.' : 'Consulta de solo lectura.'}>
    <ExceptionsPanel idPrefix="clinic-exception" queryKey={['clinic-exceptions']}
      list={schedulingApi.listClinicExceptions} put={schedulingApi.putClinicException} remove={schedulingApi.deleteClinicException}
      canEdit={canEdit} requireWrite={requireOwner} emptyLabel="Sin excepciones registradas." />
  </SectionCard>;
}

function BookingPolicySection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy });
  return <SectionCard className="ce-admin-form" title="Política de reservas" subtitle="Horizonte y antelaciones aplicados a la disponibilidad.">
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    {error ? <FormAlert>{error}</FormAlert> : null}
    {data ? <PolicyForm key={JSON.stringify(data)} policy={data} canEdit={canEdit}
      onSaved={(updated) => { queryClient.setQueryData(['booking-policy'], updated); setNotice('Política guardada.'); setError(null); }}
      onError={(cause) => { setNotice(null); setError(errorMessage(cause)); }} /> : <p className="text-ink-muted">Cargando…</p>}
  </SectionCard>;
}

function PolicyForm({ policy, canEdit, onSaved, onError }: {
  policy: BookingPolicyDto; canEdit: boolean; onSaved: (updated: BookingPolicyDto) => void; onError: (cause: unknown) => void;
}) {
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(policy.maxAdvanceDays));
  const [lead, setLead] = useState(String(policy.minBookingLeadTimeHours));
  const [cancellation, setCancellation] = useState(String(policy.cancellationLeadTimeHours));
  const mutation = useMutation({
    mutationFn: () => {
      requireOwner();
      return schedulingApi.updatePolicy({ maxAdvanceDays: Number(maxAdvanceDays), minBookingLeadTimeHours: Number(lead), cancellationLeadTimeHours: Number(cancellation) });
    },
    onSuccess: onSaved, onError,
  });
  if (!canEdit) return <dl className="grid gap-2 text-[length:var(--text-body-app)]">
    <PolicyRow label="Días de horizonte" value={policy.maxAdvanceDays} />
    <PolicyRow label="Antelación mínima de reserva (h)" value={policy.minBookingLeadTimeHours} />
    <PolicyRow label="Antelación de cancelación (h)" value={policy.cancellationLeadTimeHours} />
  </dl>;
  return <form className="grid max-w-[28rem] gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <NumberField id="maxAdvanceDays" label="Días de horizonte" value={maxAdvanceDays} onChange={setMaxAdvanceDays} />
    <NumberField id="lead" label="Antelación mínima de reserva (h)" value={lead} onChange={setLead} />
    <NumberField id="cancellation" label="Antelación de cancelación (h)" value={cancellation} onChange={setCancellation} />
    <div><button type="submit" disabled={mutation.isPending} className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60">{mutation.isPending ? 'Guardando…' : 'Guardar política'}</button></div>
  </form>;
}
function PolicyRow({ label, value }: { label: string; value: number }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2"><dt className="text-ink-secondary">{label}</dt><dd className="tabular text-ink">{value}</dd></div>;
}
function NumberField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div><label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">{label}</label>
    <input id={id} name={id} type="number" min={0} required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
  </div>;
}
