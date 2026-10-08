import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  schedulingApi,
  type BookingPolicyDto,
  type ScheduleDayInput,
  type TimeOffDto,
} from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { WeekEditor } from './WeekEditor';

function todayLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'No se pudo completar la operación.';
}

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/**
 * Scheduling de Fase 5: horarios/descansos/excepciones de la clínica y de los dentistas, política
 * de reservas y consulta de disponibilidad. NO agenda citas (Fase 6). El backend es autoritativo
 * en permisos; la UI solo oculta acciones que el servidor rechazaría.
 */
export function SchedulingPage() {
  const role = useAuthStore((state) => state.user?.role);

  return (
    <div className="mx-auto w-full max-w-app px-5 py-8 md:px-8">
      <header>
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Horarios</h1>
        <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
          Horario de apertura, descansos, franquicias y disponibilidad calculada.
        </p>
      </header>
      <div className="mt-6 grid gap-6">
        <ClinicHoursSection canEdit={role === 'OWNER'} />
        <BookingPolicySection canEdit={role === 'OWNER'} />
        <DentistHoursSection
          canEdit={role === 'OWNER' || role === 'DENTIST'}
          readOnly={role === 'RECEPTIONIST'}
        />
        <AvailabilitySection />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-paper p-5 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-[length:var(--text-body-sm)] text-ink-secondary">{subtitle}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ClinicHoursSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clinic-schedule'],
    queryFn: schedulingApi.getClinicSchedule,
  });
  const mutation = useMutation({
    mutationFn: (days: ScheduleDayInput[]) => schedulingApi.replaceClinicWeek(days),
    onSuccess: (updated) => {
      queryClient.setQueryData(['clinic-schedule'], updated);
      setNotice('Horario de la clínica guardado.');
      setError(null);
    },
    onError: (cause) => {
      setNotice(null);
      setError(errorMessage(cause));
    },
  });

  return (
    <SectionCard
      title="Horario de la clínica"
      subtitle={canEdit ? 'Solo el propietario puede editarlo.' : 'Consulta de solo lectura.'}
    >
      {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
      {isError ? <FormAlert>No se pudo cargar el horario de la clínica.</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {data ? (
        <WeekEditor
          key={JSON.stringify(data.days)}
          days={data.days}
          disabled={!canEdit}
          pending={mutation.isPending}
          timezone={data.timezone}
          onSave={(days) => mutation.mutate(days)}
        />
      ) : null}
    </SectionCard>
  );
}

function BookingPolicySection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy });

  return (
    <SectionCard
      title="Política de reservas"
      subtitle="Horizonte y antelaciones aplicados a la disponibilidad."
    >
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {data ? (
        <PolicyForm
          key={JSON.stringify(data)}
          policy={data}
          canEdit={canEdit}
          onSaved={(updated) => {
            queryClient.setQueryData(['booking-policy'], updated);
            setNotice('Política guardada.');
            setError(null);
          }}
          onError={(cause) => {
            setNotice(null);
            setError(errorMessage(cause));
          }}
        />
      ) : (
        <p className="text-ink-muted">Cargando…</p>
      )}
    </SectionCard>
  );
}

function PolicyForm({
  policy,
  canEdit,
  onSaved,
  onError,
}: {
  policy: BookingPolicyDto;
  canEdit: boolean;
  onSaved: (updated: BookingPolicyDto) => void;
  onError: (cause: unknown) => void;
}) {
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(policy.maxAdvanceDays));
  const [lead, setLead] = useState(String(policy.minBookingLeadTimeHours));
  const [cancellation, setCancellation] = useState(String(policy.cancellationLeadTimeHours));

  const mutation = useMutation({
    mutationFn: () =>
      schedulingApi.updatePolicy({
        maxAdvanceDays: Number(maxAdvanceDays),
        minBookingLeadTimeHours: Number(lead),
        cancellationLeadTimeHours: Number(cancellation),
      }),
    onSuccess: onSaved,
    onError,
  });

  if (!canEdit) {
    return (
      <dl className="grid gap-2 text-[length:var(--text-body-app)]">
        <PolicyRow label="Días de horizonte" value={policy.maxAdvanceDays} />
        <PolicyRow label="Antelación mínima de reserva (h)" value={policy.minBookingLeadTimeHours} />
        <PolicyRow label="Antelación de cancelación (h)" value={policy.cancellationLeadTimeHours} />
      </dl>
    );
  }

  return (
    <form
      className="grid max-w-[28rem] gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <NumberField
        id="maxAdvanceDays"
        label="Días de horizonte"
        value={maxAdvanceDays}
        onChange={setMaxAdvanceDays}
      />
      <NumberField
        id="lead"
        label="Antelación mínima de reserva (h)"
        value={lead}
        onChange={setLead}
      />
      <NumberField
        id="cancellation"
        label="Antelación de cancelación (h)"
        value={cancellation}
        onChange={setCancellation}
      />
      <div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar política'}
        </button>
      </div>
    </form>
  );
}

function PolicyRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="tabular text-ink">{value}</dd>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="number"
        min={0}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </div>
  );
}

function useDentistOptions() {
  const query = useQuery({
    queryKey: ['public-schedule'],
    queryFn: schedulingApi.getPublicSchedule,
  });
  const dentists = query.data?.dentists ?? [];
  return { dentists, isLoading: query.isLoading };
}

function DentistHoursSection({ canEdit, readOnly }: { canEdit: boolean; readOnly: boolean }) {
  const { dentists, isLoading } = useDentistOptions();
  const [selected, setSelected] = useState<number | null>(null);
  const dentistId = selected ?? dentists[0]?.dentistId ?? null;

  return (
    <SectionCard
      title="Horario de dentistas"
      subtitle={
        readOnly ? 'Consulta de solo lectura.' : 'El personal clínico gestiona su propio horario.'
      }
    >
      {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
      {!isLoading && dentists.length === 0 ? (
        <p className="text-ink-secondary">Todavía no hay dentistas registrados.</p>
      ) : null}
      {dentists.length > 0 && dentistId !== null ? (
        <>
          <label className="block max-w-[20rem] text-[length:var(--text-body-sm)] font-medium text-ink">
            Dentista
            <select
              value={dentistId}
              onChange={(event) => setSelected(Number(event.target.value))}
              className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {dentists.map((dentist) => (
                <option key={dentist.dentistId} value={dentist.dentistId}>
                  {fullName(dentist.firstName, dentist.lastName)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 grid gap-6">
            <DentistWeekPanel dentistId={dentistId} canEdit={canEdit} />
            <TimeOffPanel dentistId={dentistId} canEdit={canEdit} />
          </div>
        </>
      ) : null}
    </SectionCard>
  );
}

function DentistWeekPanel({ dentistId, canEdit }: { dentistId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['dentist-schedule', dentistId],
    queryFn: () => schedulingApi.getDentistSchedule(dentistId),
  });
  const mutation = useMutation({
    mutationFn: (days: ScheduleDayInput[]) => schedulingApi.replaceDentistWeek(dentistId, days),
    onSuccess: (updated) => {
      queryClient.setQueryData(['dentist-schedule', dentistId], updated);
      setNotice('Horario del dentista guardado.');
      setError(null);
    },
    onError: (cause) => {
      setNotice(null);
      setError(errorMessage(cause));
    },
  });

  return (
    <div>
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Semana</h3>
      {notice ? <p className="mt-2 text-[length:var(--text-body-sm)] text-success-ink">{notice}</p> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {data ? (
        <div className="mt-3">
          <WeekEditor
            key={`${dentistId}-${JSON.stringify(data.days)}`}
            days={data.days}
            disabled={!canEdit}
            pending={mutation.isPending}
            timezone={data.timezone}
            onSave={(days) => mutation.mutate(days)}
          />
        </div>
      ) : (
        <p className="mt-2 text-ink-muted">Cargando…</p>
      )}
    </div>
  );
}

function TimeOffPanel({ dentistId, canEdit }: { dentistId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['timeoff', dentistId],
    queryFn: () => schedulingApi.listTimeOff(dentistId),
  });
  const [form, setForm] = useState({
    startDate: todayLocal(),
    endDate: todayLocal(),
    allDay: true,
    startTime: '10:00',
    endTime: '11:00',
    reason: '',
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['timeoff', dentistId] });

  const create = useMutation({
    mutationFn: () =>
      schedulingApi.createTimeOff(dentistId, {
        startDate: form.startDate,
        endDate: form.endDate,
        startTime: form.allDay ? null : form.startTime,
        endTime: form.allDay ? null : form.endTime,
        reason: form.reason.trim() || null,
      }),
    onSuccess: () => {
      setNotice('Franquicia añadida.');
      setError(null);
      void refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setError(errorMessage(cause));
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => schedulingApi.deleteTimeOff(dentistId, id),
    onSuccess: () => {
      setNotice('Franquicia eliminada.');
      setError(null);
      void refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setError(errorMessage(cause));
    },
  });

  return (
    <div>
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Franquicias</h3>
      {notice ? <p className="mt-2 text-[length:var(--text-body-sm)] text-success-ink">{notice}</p> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      <ul className="mt-3 grid gap-2">
        {(data ?? []).length === 0 ? (
          <li className="text-[length:var(--text-body-sm)] text-ink-secondary">Sin franquicias.</li>
        ) : null}
        {(data ?? []).map((timeOff) => (
          <TimeOffItem
            key={timeOff.id}
            timeOff={timeOff}
            canEdit={canEdit}
            onRemove={() => remove.mutate(timeOff.id)}
          />
        ))}
      </ul>
      {canEdit ? (
        <form
          className="mt-4 grid max-w-[28rem] gap-3 rounded-nested bg-sunken p-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              id="timeoff-start"
              label="Desde"
              value={form.startDate}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, startDate: value, endDate: prev.allDay ? value : prev.endDate }))
              }
            />
            <DateField
              id="timeoff-end"
              label="Hasta"
              value={form.endDate}
              onChange={(value) => setForm((prev) => ({ ...prev, endDate: value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  allDay: event.target.checked,
                  endDate: event.target.checked ? prev.startDate : prev.endDate,
                }))
              }
              className="size-4 rounded-xs accent-primary"
            />
            Todo el día (permite varios días)
          </label>
          {form.allDay ? (
            <p className="text-[length:var(--text-caption)] text-ink-muted">
              La franquicia parcial debe ser de un solo día.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <TimeField
                id="timeoff-start-time"
                label="Hora inicio"
                value={form.startTime}
                onChange={(value) => setForm((prev) => ({ ...prev, startTime: value }))}
              />
              <TimeField
                id="timeoff-end-time"
                label="Hora fin"
                value={form.endTime}
                onChange={(value) => setForm((prev) => ({ ...prev, endTime: value }))}
              />
            </div>
          )}
          <div>
            <label htmlFor="timeoff-reason" className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Motivo (opcional)
            </label>
            <input
              id="timeoff-reason"
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {create.isPending ? 'Añadiendo…' : 'Añadir franquicia'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function TimeOffItem({
  timeOff,
  canEdit,
  onRemove,
}: {
  timeOff: TimeOffDto;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const range = timeOff.allDay
    ? `${timeOff.startDate} → ${timeOff.endDate} (todo el día)`
    : `${timeOff.startDate} · ${timeOff.startTime?.slice(0, 5)}–${timeOff.endTime?.slice(0, 5)}`;
  return (
    <li className="flex items-center justify-between gap-3 border-b border-hairline pb-2 text-[length:var(--text-body-sm)]">
      <span className="tabular text-ink">{range}</span>
      {canEdit ? (
        <button type="button" onClick={onRemove} className="text-danger-ink underline">
          Eliminar
        </button>
      ) : null}
    </li>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="date"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </div>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="time"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </div>
  );
}

function AvailabilitySection() {
  const { dentists, isLoading } = useDentistOptions();
  const [dentistId, setDentistId] = useState<number | null>(null);
  const [from, setFrom] = useState(todayLocal());
  const [duration, setDuration] = useState(30);
  const [request, setRequest] = useState<{ dentistId: number; from: string; duration: number } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['availability', request],
    queryFn: () => schedulingApi.availability(request!),
    enabled: request !== null,
  });

  const slotsByDate = useMemo(() => {
    const map = new Map<string, { startTime: string; endTime: string }[]>();
    for (const slot of query.data?.slots ?? []) {
      const list = map.get(slot.startDate) ?? [];
      list.push({ startTime: slot.startTime, endTime: slot.endTime });
      map.set(slot.startDate, list);
    }
    return [...map.entries()];
  }, [query.data]);

  const effectiveDentist = dentistId ?? dentists[0]?.dentistId ?? null;

  return (
    <SectionCard title="Disponibilidad" subtitle="Cálculo en la zona horaria de la clínica.">
      {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
      {dentists.length > 0 && effectiveDentist !== null ? (
        <form
          className="grid max-w-[40rem] gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setRequest({ dentistId: effectiveDentist, from, duration });
          }}
        >
          <div>
            <label htmlFor="availability-dentist" className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Dentista
            </label>
            <select
              id="availability-dentist"
              value={effectiveDentist}
              onChange={(event) => setDentistId(Number(event.target.value))}
              className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {dentists.map((dentist) => (
                <option key={dentist.dentistId} value={dentist.dentistId}>
                  {fullName(dentist.firstName, dentist.lastName)}
                </option>
              ))}
            </select>
          </div>
          <DateField id="availability-from" label="Fecha" value={from} onChange={setFrom} />
          <div>
            <label htmlFor="availability-duration" className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Duración (min)
            </label>
            <input
              id="availability-duration"
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="mt-1.5 w-28 rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-control bg-primary px-5 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
          >
            Buscar
          </button>
        </form>
      ) : null}

      {query.isFetching ? <p className="mt-4 text-ink-muted">Calculando…</p> : null}
      {query.isError ? <FormAlert>No se pudo calcular la disponibilidad.</FormAlert> : null}
      {query.isSuccess && slotsByDate.length === 0 ? (
        <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
          No hay huecos para los criterios indicados.
        </p>
      ) : null}
      {slotsByDate.length > 0 ? (
        <div className="mt-4 grid gap-4">
          {slotsByDate.map(([date, slots]) => (
            <div key={date}>
              <h3 className="tabular text-[length:var(--text-body-sm)] font-medium text-ink">{date}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <li
                    key={`${date}-${slot.startTime}`}
                    className="tabular rounded-xs bg-primary-subtle px-2.5 py-1 text-[length:var(--text-body-sm)] text-primary-ink"
                  >
                    {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}