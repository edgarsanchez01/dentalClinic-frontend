import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  appointmentsApi,
  type AppointmentListParams,
  type AppointmentResponse,
  type CreateAppointmentRequest,
} from '../../api/appointments';
import { patientsApi } from '../../api/patients';
import { schedulingApi, type AvailabilityDto, type AvailabilitySlotDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import {
  addDays,
  apiErrorMessage,
  clockLabel,
  dayKey,
  formatDayLong,
  formatDayShort,
  formatTime,
  fromLocalDateInput,
  fullName,
  isoWeekDay,
  localDateInput,
  minutesOfDay,
  parseClock,
  rangeForView,
  sortAppointments,
  startOfLocalDay,
  startOfWeek,
  statusChipClass,
  statusLabel,
  STATUS_OPTIONS,
  type ViewMode,
} from './appointmentUi';

const PX_PER_MIN = 2;
const DURATIONS = [15, 30, 45, 60];

function AppointmentChip({
  appointment,
  onOpen,
}: {
  appointment: AppointmentResponse;
  onOpen: (id: number) => void;
}) {
  const start = formatTime(appointment.startAt);
  const name = `${appointment.patientFirstName} ${appointment.patientLastName}`.trim();
  return (
    <button
      type="button"
      title={statusLabel(appointment.status)}
      aria-label={`Cita con ${name} a las ${start} ${statusLabel(appointment.status)}`}
      onClick={() => onOpen(appointment.id)}
      className={`block w-full rounded-xs px-2 py-1 text-left text-[length:var(--text-body-sm)] ${statusChipClass(
        appointment.status,
      )} focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span className="block truncate">
        {start} · {appointment.patientFirstName} {appointment.patientLastName}
      </span>
    </button>
  );
}

function MonthCell({
  date,
  appointments,
  onOpen,
  onSelectDay,
}: {
  date: Date;
  appointments: AppointmentResponse[];
  onOpen: (id: number) => void;
  onSelectDay: () => void;
}) {
  const dayAppts = appointments.filter((a) => dayKey(new Date(a.startAt)) === dayKey(date));
  const extra = dayAppts.length - 3;
  return (
    <div className="min-h-[88px] rounded-xs bg-paper p-1.5 ring-1 ring-hairline">
      <button
        type="button"
        onClick={onSelectDay}
        aria-label={`Ver día ${formatDayShort(date)}`}
        className="text-[length:var(--text-caption)] font-medium text-ink hover:underline"
      >
        {date.getDate()}
      </button>
      <div className="mt-1 grid gap-0.5">
        {dayAppts.slice(0, 3).map((a) => (
          <AppointmentChip key={a.id} appointment={a} onOpen={onOpen} />
        ))}
        {extra > 0 ? (
          <p className="text-[length:var(--text-caption)] text-ink-muted">+{extra} más</p>
        ) : null}
      </div>
    </div>
  );
}

export function AppointmentsPage() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isPatient = role === 'PATIENT';
  const isStaff = !isPatient;

  const myDentistId = isPatient ? undefined : (user?.dentistId ?? undefined);

  const [view, setView] = useState<ViewMode>('week');
  const [cursor, setCursor] = useState<Date>(() => startOfLocalDay(new Date()));
  const [dentistFilter, setDentistFilter] = useState<number | ''>(myDentistId ?? '');
  const [statusFilter, setStatusFilter] = useState<'' | AppointmentResponse['status']>('');
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  const range = useMemo(() => rangeForView(view, cursor), [view, cursor]);

  const { data: publicSchedule } = useQuery({
    queryKey: ['public-schedule'],
    queryFn: () => schedulingApi.getPublicSchedule(),
  });
  const { data: clinicSchedule } = useQuery({
    queryKey: ['clinic-schedule'],
    queryFn: () => schedulingApi.getClinicSchedule(),
    enabled: isStaff,
  });
  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => patientsApi.list({ size: 200 }),
    enabled: isStaff,
  });

  const dentists = useMemo(() => publicSchedule?.dentists ?? [], [publicSchedule]);

  const listParams = useMemo<AppointmentListParams>(() => {
    const params: AppointmentListParams = {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      size: 100,
    };
    if (isStaff && dentistFilter !== '') {
      params.dentistId = Number(dentistFilter);
    }
    if (isStaff && statusFilter !== '') {
      params.status = statusFilter;
    }
    return params;
  }, [range, isStaff, dentistFilter, statusFilter]);

  const {
    data: page,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['appointments', listParams],
    queryFn: () => appointmentsApi.list(listParams),
  });

  const appointments = useMemo(() => sortAppointments(page?.content ?? []), [page]);

  const [createPatient, setCreatePatient] = useState<number | ''>('');
  const [createDentist, setCreateDentist] = useState<number | ''>(myDentistId ?? '');
  const [createDay, setCreateDay] = useState<string>(() => localDateInput(new Date()));
  const [createDuration, setCreateDuration] = useState<number>(30);
  const [createReason, setCreateReason] = useState('');
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');

  const createDentistId = createDentist === '' ? undefined : Number(createDentist);

  const columns = useMemo(() => {
    if (isPatient) return [];
    const list = dentistFilter === '' ? dentists : dentists.filter((d) => d.dentistId === dentistFilter);
    return list;
  }, [isPatient, dentists, dentistFilter]);

  const availQueries = useMemo(() => {
    if (!(view === 'day' && isStaff)) return [];
    return columns.map((d) => ({
      queryKey: ['availability', 'agenda', d.dentistId, dayKey(range.from), createDuration],
      queryFn: () =>
        schedulingApi.availability({ dentistId: d.dentistId, from: dayKey(range.from), duration: createDuration }),
    }));
  }, [view, isStaff, columns, range, createDuration]);

  const dayAvail = useQueries({ queries: availQueries });

  const {
    data: formAvail,
    isLoading: formAvailLoading,
    isError: formAvailError,
  } = useQuery({
    queryKey: ['availability', 'form', createDentistId, createDay, createDuration],
    queryFn: () => {
      if (createDentistId === undefined) return Promise.resolve(null) as Promise<AvailabilityDto | null>;
      return schedulingApi.availability({ dentistId: createDentistId, from: createDay, duration: createDuration });
    },
    enabled: createDentistId !== undefined && createDay !== '',
  });

  const idemRef = useRef({ key: crypto.randomUUID(), payload: null as string | null });

  const create = useMutation({
    mutationFn: (input: CreateAppointmentRequest) => {
      const payload = JSON.stringify(input);
      if (idemRef.current.payload !== null && idemRef.current.payload !== payload) {
        idemRef.current.key = crypto.randomUUID();
      }
      idemRef.current.payload = payload;
      return appointmentsApi.create(input, idemRef.current.key);
    },
    onSuccess: () => {
      idemRef.current = { key: crypto.randomUUID(), payload: null };
      setFormNotice(isPatient ? 'Solicitud registrada correctamente.' : 'Cita creada correctamente.');
      setFormErr(null);
      setCreateStart('');
      setCreateEnd('');
      setCreateReason('');
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (cause) => {
      setFormNotice(null);
      setFormErr(apiErrorMessage(cause, 'No se pudo crear la cita.'));
    },
  });

  if (!user) {
    return null;
  }

  function handleSlotPick(slot: AvailabilitySlotDto) {
    setCreateStart(slot.start);
    setCreateEnd(slot.end);
    setFormErr(null);
  }

  function handleCreate() {
    if (createDentistId === undefined || createStart === '' || createEnd === '') return;
    const patientId = isPatient ? (user?.patientId ?? 0) : createPatient === '' ? 0 : Number(createPatient);
    if (patientId <= 0) return;
    const reason = createReason.trim();
    create.mutate({
      patientId,
      dentistId: createDentistId,
      startAt: createStart,
      endAt: createEnd,
      reason: reason === '' ? undefined : reason,
    });
  }

  function shift(delta: number) {
    if (view === 'day') {
      setCursor(addDays(cursor, delta));
    } else if (view === 'week') {
      setCursor(addDays(startOfWeek(cursor), delta * 7));
    } else {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    }
  }

  const createDisabled =
    createDentistId === undefined ||
    createStart === '' ||
    createEnd === '' ||
    create.isPending ||
    (!isPatient && createPatient === '');

  const day = range.days[0];
  const clinicDay = clinicSchedule?.days.find((d) => d.dayOfWeek === isoWeekDay(day));
  const clinicOpen = Boolean(clinicDay?.open);
  const windowStart = clinicDay?.startTime ? parseClock(clinicDay.startTime) : null;
  const windowEnd = clinicDay?.endTime ? parseClock(clinicDay.endTime) : null;
  const hasWindow = windowStart !== null && windowEnd !== null && windowEnd > windowStart;
  const windowHeight = hasWindow ? (windowEnd - windowStart) * PX_PER_MIN : 0;
  const hourStops: number[] = [];
  if (hasWindow) {
    for (let h = Math.ceil(windowStart / 60); h <= Math.floor((windowEnd - 1) / 60); h += 1) {
      hourStops.push(h);
    }
  }

  const monthDays = range.days;
  const leadCells = isoWeekDay(monthDays[0]) - 1;
  const monthCells: (Date | null)[] = Array.from({ length: leadCells }, () => null);
  for (const d of monthDays) {
    monthCells.push(d);
  }
  while (monthCells.length % 7 !== 0) {
    monthCells.push(null);
  }

  return (
    <div className="mx-auto w-full max-w-app px-5 py-8 md:px-8">
      <header>
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Citas</h1>
        <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
          {isPatient ? 'Tus próximos tratamientos y solicitudes.' : 'Agenda de citas de la clínica.'}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {isStaff ? (
          <div role="group" aria-label="Vista" className="flex overflow-hidden rounded-control ring-1 ring-hairline">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-[length:var(--text-body-sm)] focus-visible:ring-2 focus-visible:ring-primary ${
                  view === v ? 'bg-primary text-primary-ink' : 'bg-input-fill text-ink-secondary'
                }`}
              >
                {v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1" role="group" aria-label="Navegación">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfLocalDay(new Date()))}
            className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            Siguiente
          </button>
        </div>

        <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
          <span className="sr-only">Fecha</span>
          <input
            type="date"
            aria-label="Fecha"
            value={localDateInput(cursor)}
            onChange={(e) => setCursor(fromLocalDateInput(e.target.value))}
            className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>

        {isStaff ? (
          <>
            <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
              <span>Filtrar por dentista</span>
              <select
                value={dentistFilter}
                disabled={!isPatient && myDentistId !== undefined}
                onChange={(e) => setDentistFilter(e.target.value === '' ? '' : Number(e.target.value))}
                className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink disabled:opacity-60"
              >
                <option value="">Todos</option>
                {dentists.map((d) => (
                  <option key={d.dentistId} value={d.dentistId}>
                    {fullName(d.firstName, d.lastName)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
              <span>Filtrar por estado</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value === '' ? '' : (e.target.value as AppointmentResponse['status']))}
                className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink"
              >
                <option value="">Todos</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {isPatient ? (
          <button
            type="button"
            onClick={() => setBookingOpen((open) => !open)}
            className="ml-auto rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            {bookingOpen ? 'Cerrar' : 'Solicitar cita'}
          </button>
        ) : null}
      </div>

      {isStaff ? (
        <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
          <h2 className="text-[length:var(--text-h5)] text-ink">Nueva cita</h2>
          {formNotice ? <FormAlert tone="success">{formNotice}</FormAlert> : null}
          {formErr ? <FormAlert>{formErr}</FormAlert> : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Paciente
              <select
                value={createPatient}
                onChange={(e) => setCreatePatient(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">Seleccionar</option>
                {patients?.content.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Dentista
              <select
                value={createDentist}
                disabled={myDentistId !== undefined}
                onChange={(e) => setCreateDentist(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                <option value="">Seleccionar</option>
                {dentists.map((d) => (
                  <option key={d.dentistId} value={d.dentistId}>
                    {fullName(d.firstName, d.lastName)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Día
              <input
                type="date"
                value={createDay}
                onChange={(e) => setCreateDay(e.target.value)}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
              Duración
              <select
                value={createDuration}
                onChange={(e) => setCreateDuration(Number(e.target.value))}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-4 block text-[length:var(--text-body-sm)] font-medium text-ink">
            Motivo
            <input
              value={createReason}
              onChange={(e) => setCreateReason(e.target.value)}
              className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>

          <div className="mt-4">
            {createDentistId === undefined ? (
              <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                Elige un dentista para ver los huecos disponibles.
              </p>
            ) : (
              <>
                {formAvailLoading ? (
                  <p role="status" className="text-[length:var(--text-body-sm)] text-ink-muted">
                    Cargando disponibilidad…
                  </p>
                ) : null}
                {formAvailError ? (
                  <FormAlert>{apiErrorMessage(formAvailError, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                ) : null}
                {formAvail && formAvail.slots.length > 0 ? (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Huecos disponibles">
                    {formAvail.slots.map((slot) => (
                      <button
                        key={`${slot.startDate}-${slot.startTime}`}
                        type="button"
                        aria-pressed={createStart === slot.start}
                        onClick={() => handleSlotPick(slot)}
                        className="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {clockLabel(parseClock(slot.startTime))}–{clockLabel(parseClock(slot.endTime))}
                      </button>
                    ))}
                  </div>
                ) : null}
                {formAvail && !formAvailLoading && formAvail.slots.length === 0 ? (
                  <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                    Sin huecos disponibles para esa combinación.
                  </p>
                ) : null}
                {createStart !== '' && createEnd !== '' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-[length:var(--text-body-sm)] text-ink">
                      Seleccionado: {formatTime(createStart)}–{formatTime(createEnd)}
                    </p>
                    <button
                      type="button"
                      disabled={createDisabled}
                      onClick={handleCreate}
                      className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {create.isPending ? 'Reservando…' : 'Reservar cita'}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}

      {isPatient && bookingOpen ? (
        <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
          <h2 className="text-[length:var(--text-h5)] text-ink">Solicitar cita</h2>
          {!user.patientId ? (
            <FormAlert>Completa tu perfil de paciente antes de reservar una cita.</FormAlert>
          ) : (
            <>
              {formNotice ? <FormAlert tone="success">{formNotice}</FormAlert> : null}
              {formErr ? <FormAlert>{formErr}</FormAlert> : null}
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
                  Dentista
                  <select
                    value={createDentist}
                    onChange={(e) => setCreateDentist(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="">Seleccionar</option>
                    {dentists.map((d) => (
                      <option key={d.dentistId} value={d.dentistId}>
                        {fullName(d.firstName, d.lastName)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
                  Día
                  <input
                    type="date"
                    value={createDay}
                    onChange={(e) => setCreateDay(e.target.value)}
                    className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
                  Duración
                  <select
                    value={createDuration}
                    onChange={(e) => setCreateDuration(Number(e.target.value))}
                    className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {DURATIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-4 block text-[length:var(--text-body-sm)] font-medium text-ink">
                Motivo
                <input
                  value={createReason}
                  onChange={(e) => setCreateReason(e.target.value)}
                  className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              <div className="mt-4">
                {createDentistId === undefined ? (
                  <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                    Elige un dentista para ver los huecos disponibles.
                  </p>
                ) : (
                  <>
                    {formAvailLoading ? (
                      <p role="status" className="text-[length:var(--text-body-sm)] text-ink-muted">
                        Cargando disponibilidad…
                      </p>
                    ) : null}
                    {formAvailError ? (
                      <FormAlert>{apiErrorMessage(formAvailError, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                    ) : null}
                    {formAvail && formAvail.slots.length > 0 ? (
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Huecos disponibles">
                        {formAvail.slots.map((slot) => (
                          <button
                            key={`${slot.startDate}-${slot.startTime}`}
                            type="button"
                            aria-pressed={createStart === slot.start}
                            onClick={() => handleSlotPick(slot)}
                            className="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {clockLabel(parseClock(slot.startTime))}–{clockLabel(parseClock(slot.endTime))}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {formAvail && !formAvailLoading && formAvail.slots.length === 0 ? (
                      <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                        Sin huecos disponibles para esa combinación.
                      </p>
                    ) : null}
                    {createStart !== '' && createEnd !== '' ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <p className="text-[length:var(--text-body-sm)] text-ink">
                          Seleccionado: {formatTime(createStart)}–{formatTime(createEnd)}
                        </p>
                        <button
                          type="button"
                          disabled={createDisabled || !user.patientId}
                          onClick={handleCreate}
                          className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {create.isPending ? 'Enviando…' : 'Confirmar solicitud'}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="mt-6" aria-live="polite">
        {isLoading ? (
          <div role="status" className="rounded-card bg-paper p-5 ring-1 ring-hairline">
            <p className="text-[length:var(--text-body-sm)] text-ink-muted">Cargando citas…</p>
          </div>
        ) : null}

        {isError && error ? (
          <div className="rounded-card bg-paper p-5 ring-1 ring-hairline">
            <FormAlert>{apiErrorMessage(error, 'No se pudieron cargar las citas.')}</FormAlert>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!isLoading && !isError ? (
          <div className="grid gap-6">
            {page && page.totalElements > 100 ? (
              <p className="text-[length:var(--text-caption)] text-ink-muted">
                Hay más de 100 en el período; se muestran las más próximas.
              </p>
            ) : null}

            {!isError && appointments.length === 0 ? (
              <div className="rounded-card bg-paper p-5 text-center ring-1 ring-hairline">
                <p className="text-[length:var(--text-body-app)] text-ink">
                  {view === 'day' ? 'No hay citas para este día.' : 'No hay citas en este período.'}
                </p>
                <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
                  {isStaff ? 'Usa "Nueva cita" para agendar la primera.' : 'Puedes solicitar una cita cuando lo necesites.'}
                </p>
              </div>
            ) : null}

            {appointments.length > 0 && isPatient ? (
              <div className="grid gap-4">
                {range.days.map((d) => {
                  const dayAppts = appointments.filter((a) => dayKey(new Date(a.startAt)) === dayKey(d));
                  if (dayAppts.length === 0) return null;
                  return (
                    <section key={dayKey(d)} className="rounded-card bg-paper p-4 ring-1 ring-hairline">
                      <h2 className="text-[length:var(--text-h5)] capitalize text-ink">{formatDayLong(d.toISOString())}</h2>
                      <ul className="mt-2 grid gap-1">
                        {dayAppts.map((a) => (
                          <li key={a.id}>
                            <AppointmentChip appointment={a} onOpen={(id) => navigate(`/appointments/${id}`)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : null}

            {isStaff && view === 'day' ? (
              !clinicSchedule || !clinicDay || (clinicOpen && !hasWindow) ? (
                <div className="rounded-card bg-paper p-5 ring-1 ring-hairline">
                  <p className="text-[length:var(--text-body-app)] text-ink">
                    Configura el horario de la clínica para ver la disponibilidad del día.
                  </p>
                </div>
              ) : !clinicOpen || !hasWindow ? (
                <div className="rounded-card bg-paper p-5 ring-1 ring-hairline">
                  <p className="text-[length:var(--text-body-app)] text-ink">La clínica no atiende este día.</p>
                </div>
              ) : columns.length === 0 ? (
                <div className="rounded-card bg-paper p-5 ring-1 ring-hairline">
                  <p className="text-[length:var(--text-body-app)] text-ink">
                    Añade dentistas desde el horario público para ver su agenda.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex min-w-[680px] gap-2">
                    <div className="relative w-11 shrink-0" style={{ height: windowHeight }}>
                      {hourStops.map((hour) => (
                        <div
                          key={hour}
                          className="absolute right-0 text-[length:var(--text-caption)] text-ink-muted"
                          style={{ top: (hour * 60 - windowStart) * PX_PER_MIN - 8 }}
                        >
                          {clockLabel(hour * 60)}
                        </div>
                      ))}
                    </div>
                    {columns.map((dentist, index) => {
                      const colAppts = appointments.filter((a) => a.dentistId === dentist.dentistId);
                      const availability = dayAvail[index];
                      const loading = !availability || availability.isPending || availability.isFetching;
                      const slots = availability?.isSuccess && !loading ? availability.data.slots : [];
                      return (
                        <div
                          key={dentist.dentistId}
                          role="region"
                          aria-label={`Agenda de ${fullName(dentist.firstName, dentist.lastName)}`}
                          className="min-w-0 flex-1"
                        >
                          <h3 className="truncate text-[length:var(--text-body-sm)] font-medium text-ink">
                            {fullName(dentist.firstName, dentist.lastName)}
                          </h3>
                          <div className="relative mt-1 ring-1 ring-hairline" style={{ height: windowHeight }}>
                            {colAppts.map((a) => (
                              <div
                                key={a.id}
                                className="absolute left-1 right-1"
                                style={{
                                  top: (minutesOfDay(new Date(a.startAt)) - windowStart) * PX_PER_MIN,
                                  height: Math.max(a.durationMinutes * PX_PER_MIN, 24),
                                }}
                              >
                                <AppointmentChip appointment={a} onOpen={(id) => navigate(`/appointments/${id}`)} />
                              </div>
                            ))}
                            {slots.map((slot) => (
                              <button
                                key={`${slot.startDate}-${slot.startTime}`}
                                type="button"
                                aria-label={`Reservar ${clockLabel(parseClock(slot.startTime))}-${clockLabel(parseClock(slot.endTime))}`}
                                onClick={() => {
                                  setCreateDentist(dentist.dentistId);
                                  setCreateDay(dayKey(day));
                                  handleSlotPick(slot);
                                }}
                                className="absolute left-1 right-1 rounded-xs border border-dashed border-hairline text-[length:var(--text-caption)] text-primary-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-primary"
                                style={{
                                  top: (parseClock(slot.startTime) - windowStart) * PX_PER_MIN,
                                  height: Math.max((parseClock(slot.endTime) - parseClock(slot.startTime)) * PX_PER_MIN, 24),
                                }}
                              >
                                +
                              </button>
                            ))}
                          </div>
                          <div className="mt-2" aria-live="polite">
                            {loading ? (
                              <p role="status" className="text-[length:var(--text-body-sm)] text-ink-muted">
                                Cargando disponibilidad…
                              </p>
                            ) : availability?.isError ? (
                              <FormAlert>{apiErrorMessage(availability.error, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                            ) : availability?.isSuccess && slots.length === 0 ? (
                              <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                                Sin huecos disponibles para este día.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : null}

            {isStaff && view === 'week' ? (
              <div className="overflow-x-auto">
                <div className="grid min-w-[700px] grid-cols-7 gap-2">
                  {range.days.map((d) => {
                    const dayAppts = appointments.filter((a) => dayKey(new Date(a.startAt)) === dayKey(d));
                    return (
                      <div key={dayKey(d)} className="rounded-card bg-paper p-2 ring-1 ring-hairline">
                        <button
                          type="button"
                          onClick={() => {
                            setCursor(d);
                            setView('day');
                          }}
                          aria-label={`Ver día ${formatDayShort(d)}`}
                          className="text-[length:var(--text-body-sm)] font-medium text-ink hover:underline"
                        >
                          {formatDayShort(d)}
                        </button>
                        <ul className="mt-2 grid gap-1">
                          {dayAppts.map((a) => (
                            <li key={a.id}>
                              <AppointmentChip appointment={a} onOpen={(id) => navigate(`/appointments/${id}`)} />
                            </li>
                          ))}
                        </ul>
                        {dayAppts.length === 0 ? (
                          <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">Sin citas</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {isStaff && view === 'month' ? (
              <div className="overflow-x-auto">
                <div className="grid min-w-[700px] grid-cols-7 gap-1">
                  {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label) => (
                    <div key={label} className="px-1 text-[length:var(--text-caption)] font-medium text-ink-muted">
                      {label}
                    </div>
                  ))}
                  {monthCells.map((cell, index) =>
                    cell ? (
                      <div key={dayKey(cell)}>
                        <MonthCell
                          date={cell}
                          appointments={appointments}
                          onOpen={(id) => navigate(`/appointments/${id}`)}
                          onSelectDay={() => {
                            setCursor(cell);
                            setView('day');
                          }}
                        />
                      </div>
                    ) : (
                      <div key={`blank-${index}`} />
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
