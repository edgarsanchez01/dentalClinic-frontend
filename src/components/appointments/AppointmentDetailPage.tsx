import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { appointmentsApi } from '../../api/appointments';
import { schedulingApi, type AvailabilityDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { ApiError } from '../../api/http';
import { FormAlert } from '../auth/ui';
import {
  apiErrorMessage,
  clockLabel,
  EVENT_LABELS,
  formatDayLong,
  formatTime,
  localDateInput,
  parseClock,
  statusChipClass,
  statusLabel,
  useNow,
} from './appointmentUi';

export function AppointmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const role = user?.role;

  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'cancel' | 'complete' | 'no-show' | null>(null);
  const [rsOpen, setRsOpen] = useState(false);
  const [rsDay, setRsDay] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');

  const aid = Number(id);

  const { data: appt, isLoading, error } = useQuery({
    queryKey: ['appointment', aid],
    queryFn: () => appointmentsApi.get(aid),
    enabled: !Number.isNaN(aid),
  });
  const { data: events, isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ['appointment-events', aid],
    queryFn: () => appointmentsApi.events(aid),
    enabled: !Number.isNaN(aid),
  });

  const isDentist = role === 'DENTIST';
  const isOwner = role === 'OWNER';
  const isReceptionist = role === 'RECEPTIONIST';
  const isPatient = role === 'PATIENT';

  const now = useNow();

  const { data: rsAvail, isLoading: rsAvailLoading, error: rsAvailError } = useQuery({
    queryKey: ['availability', 'reschedule', appt?.id, rsDay, appt?.durationMinutes],
    queryFn: () => {
      if (!appt || rsDay === '') {
        return Promise.resolve(null) as Promise<AvailabilityDto | null>;
      }
      return schedulingApi.availability({
        dentistId: appt.dentistId,
        from: rsDay,
        duration: appt.durationMinutes,
      });
    },
    enabled: rsOpen && appt !== undefined && rsDay !== '',
  });

  const { data: policy } = useQuery({
    queryKey: ['policy'],
    queryFn: () => schedulingApi.getPolicy(),
    enabled: isPatient && appt !== undefined && appt.status === 'SCHEDULED',
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointment', aid] });
    void queryClient.invalidateQueries({ queryKey: ['appointment-events', aid] });
  };

  const cancel = useMutation({
    mutationFn: () => appointmentsApi.cancel(aid),
    onSuccess: () => {
      setNotice('Cita cancelada.');
      setErr(null);
      setConfirming(null);
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo cancelar la cita.'));
      setConfirming(null);
    },
  });
  const reschedule = useMutation({
    mutationFn: () => {
      if (!appt) throw new Error('Cita no cargada');
      return appointmentsApi.reschedule(aid, {
        startAt: newStart,
        endAt: newEnd,
        expectedOccurrenceVersion: appt.occurrenceVersion,
      });
    },
    onSuccess: () => {
      setNotice('Cita reprogramada.');
      setErr(null);
      setNewStart('');
      setNewEnd('');
      setRsOpen(false);
      setRsDay('');
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo reprogramar la cita.'));
    },
  });
  const arrive = useMutation({
    mutationFn: () => appointmentsApi.arrive(aid),
    onSuccess: () => {
      setNotice('Llegada registrada.');
      setErr(null);
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo registrar la llegada.'));
    },
  });
  const start = useMutation({
    mutationFn: () => appointmentsApi.start(aid),
    onSuccess: () => {
      setNotice('Cita iniciada.');
      setErr(null);
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo iniciar la cita.'));
    },
  });
  const complete = useMutation({
    mutationFn: () => appointmentsApi.complete(aid),
    onSuccess: () => {
      setNotice('Cita completada.');
      setErr(null);
      setConfirming(null);
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo completar la cita.'));
      setConfirming(null);
    },
  });
  const noShow = useMutation({
    mutationFn: () => appointmentsApi.noShow(aid),
    onSuccess: () => {
      setNotice('No-show registrado.');
      setErr(null);
      setConfirming(null);
      refresh();
    },
    onError: (cause) => {
      setNotice(null);
      setErr(apiErrorMessage(cause, 'No se pudo registrar la ausencia.'));
      setConfirming(null);
    },
  });

  if (Number.isNaN(aid)) {
    return <div className="p-5">ID inválido.</div>;
  }
  if (isLoading) {
    return <div className="p-5">Cargando…</div>;
  }
  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    return (
      <div className="p-5">
        <FormAlert>
          {status === 404
            ? 'No encontramos la cita solicitada.'
            : apiErrorMessage(error, 'No se pudo cargar la cita.')}
        </FormAlert>
      </div>
    );
  }
  if (!appt) {
    return (
      <div className="p-5">
        <FormAlert>No se pudo cargar la cita.</FormAlert>
      </div>
    );
  }

  const scheduled = appt.status === 'SCHEDULED';
  const terminal = appt.status === 'COMPLETED' || appt.status === 'CANCELLED' || appt.status === 'NO_SHOW';

  const assignedDentist = user?.dentistId !== undefined && user.dentistId === appt.dentistId;
  const canTrajectory =
    scheduled && (isOwner || isDentist) && user?.dentistId !== undefined && user.dentistId === appt.dentistId;
  const canControl =
    scheduled &&
    (isOwner ||
      isReceptionist ||
      (isDentist && assignedDentist) ||
      (isPatient && appt.patientUserId === userId));
  const canNoShow = scheduled && (isOwner || isReceptionist) && new Date(appt.startAt).getTime() <= now;
  const noShowDisabled = scheduled && (isOwner || isReceptionist) && new Date(appt.startAt).getTime() > now;

  function openReschedule() {
    if (!appt) return;
    setErr(null);
    setRsDay(localDateInput(new Date(appt.startAt)));
    setNewStart('');
    setNewEnd('');
    setRsOpen(true);
  }

  function handleRsSlot(slot: { start: string; end: string }) {
    setNewStart(slot.start);
    setNewEnd(slot.end);
    setErr(null);
  }

  return (
    <div className="mx-auto w-full max-w-app px-5 py-8 md:px-8">
      <header>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Cita #{appt.id}</h1>
          <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] font-medium ${statusChipClass(appt.status)}`}>
            {statusLabel(appt.status)}
          </span>
        </div>
        <p className="mt-1 text-ink-secondary">
          {formatDayLong(appt.startAt)} {formatTime(appt.startAt)}–{formatTime(appt.endAt)} · {appt.durationMinutes} min
        </p>
      </header>
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {err ? <FormAlert>{err}</FormAlert> : null}

      <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
        <h2 className="text-[length:var(--text-h5)] text-ink">Detalles</h2>
        <dl className="mt-3 grid gap-2 text-[length:var(--text-body-sm)]">
          <div>
            <dt className="text-ink-muted">Paciente</dt>
            <dd className="text-ink">
              {appt.patientFirstName} {appt.patientLastName}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Dentista</dt>
            <dd className="text-ink">
              {appt.dentistFirstName} {appt.dentistLastName}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Motivo</dt>
            <dd className="text-ink">{appt.reason || '-'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Notas</dt>
            <dd className="text-ink">{appt.notes || '-'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Versión</dt>
            <dd className="text-ink">{appt.occurrenceVersion}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Completada</dt>
            <dd className="text-ink">
              {appt.completedAt ? `${formatDayLong(appt.completedAt)} ${formatTime(appt.completedAt)}` : '-'}
            </dd>
          </div>
        </dl>
      </section>

      {scheduled ? (
        <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
          <h2 className="text-[length:var(--text-h5)] text-ink">Acciones</h2>

          {isPatient && policy ? (
            <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">
              La clínica permite cancelar hasta {policy.cancellationLeadTimeHours} horas antes de la cita.
            </p>
          ) : null}

          {canControl ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {confirming === 'cancel' ? (
                <span className="flex flex-wrap items-center gap-2 rounded-control bg-sunken px-3 py-2 ring-1 ring-hairline">
                  <span className="text-[length:var(--text-body-sm)] text-ink">¿Cancelar esta cita?</span>
                  <button
                    type="button"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate()}
                    className="rounded-control bg-danger-subtle px-3 py-1 text-[length:var(--text-body-sm)] text-danger-ink"
                  >
                    {cancel.isPending ? 'Cancelando…' : 'Sí, cancelar'}
                  </button>
                  <button
                    type="button"
                    disabled={cancel.isPending}
                    onClick={() => setConfirming(null)}
                    className="rounded-control bg-input-fill px-3 py-1 text-[length:var(--text-body-sm)] text-ink"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setErr(null);
                    setConfirming('cancel');
                  }}
                  className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
                >
                  Cancelar
                </button>
              )}

              {!rsOpen ? (
                <button
                  type="button"
                  onClick={openReschedule}
                  className="rounded-control bg-primary px-3 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink"
                >
                  Reprogramar
                </button>
              ) : null}
            </div>
          ) : null}

          {rsOpen ? (
            <div className="mt-3 rounded-control bg-sunken p-4 ring-1 ring-hairline">
              <label htmlFor="reschedule-day" className="text-[length:var(--text-body-sm)] text-ink">Día</label>
              <input
                id="reschedule-day"
                type="date"
                value={rsDay}
                onChange={(e) => {
                  setRsDay(e.target.value);
                  setNewStart('');
                  setNewEnd('');
                }}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
              />
              {rsAvailLoading ? (
                <p role="status" className="mt-3 text-[length:var(--text-body-sm)] text-ink-muted">
                  Cargando disponibilidad…
                </p>
              ) : null}
              {rsAvailError ? (
                <FormAlert>{apiErrorMessage(rsAvailError, 'No se pudo consultar la disponibilidad.')}</FormAlert>
              ) : null}
              {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Huecos para reprogramar">
                  {rsAvail.slots.map((slot) => (
                    <button
                      key={`${slot.startDate}-${slot.startTime}`}
                      type="button"
                      aria-pressed={newStart === slot.start}
                      onClick={() => handleRsSlot(slot)}
                      className="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {clockLabel(parseClock(slot.startTime))}–{clockLabel(parseClock(slot.endTime))}
                    </button>
                  ))}
                </div>
              ) : null}
              {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length === 0 ? (
                <p className="mt-3 text-[length:var(--text-body-sm)] text-ink-secondary">
                  Sin huecos disponibles para ese día.
                </p>
              ) : null}
              {!rsAvailLoading && !rsAvailError && newStart !== '' && newEnd !== '' ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-[length:var(--text-body-sm)] text-ink">
                    Nuevo horario: {formatTime(newStart)}–{formatTime(newEnd)}{' '}
                    <span className="text-ink-muted">(versión {appt.occurrenceVersion})</span>
                  </p>
                  <button
                    type="button"
                    disabled={reschedule.isPending}
                    onClick={() => reschedule.mutate()}
                    className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink disabled:opacity-60"
                  >
                    {reschedule.isPending ? 'Reprogramando…' : 'Confirmar reprogramación'}
                  </button>
                  <button
                    type="button"
                    disabled={reschedule.isPending}
                    onClick={() => {
                      setRsOpen(false);
                      setRsDay('');
                      setNewStart('');
                      setNewEnd('');
                    }}
                    className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
                  >
                    Cerrar
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canTrajectory ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={arrive.isPending}
                onClick={() => arrive.mutate()}
                className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
              >
                {arrive.isPending ? 'Guardando…' : 'Registrar llegada'}
              </button>
              <button
                type="button"
                disabled={start.isPending}
                onClick={() => start.mutate()}
                className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
              >
                {start.isPending ? 'Guardando…' : 'Iniciar'}
              </button>
              {confirming === 'complete' ? (
                <span className="flex flex-wrap items-center gap-2 rounded-control bg-sunken px-3 py-2 ring-1 ring-hairline">
                  <span className="text-[length:var(--text-body-sm)] text-ink">¿Completar la cita?</span>
                  <button
                    type="button"
                    disabled={complete.isPending}
                    onClick={() => complete.mutate()}
                    className="rounded-control bg-danger-subtle px-3 py-1 text-[length:var(--text-body-sm)] text-danger-ink"
                  >
                    {complete.isPending ? 'Completando…' : 'Sí, completar'}
                  </button>
                  <button
                    type="button"
                    disabled={complete.isPending}
                    onClick={() => setConfirming(null)}
                    className="rounded-control bg-input-fill px-3 py-1 text-[length:var(--text-body-sm)] text-ink"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={complete.isPending}
                  onClick={() => {
                    setErr(null);
                    setConfirming('complete');
                  }}
                  className="rounded-control bg-primary px-3 py-2 text-[length:var(--text-body-sm)] font-medium text-primary-ink"
                >
                  Completar
                </button>
              )}
            </div>
          ) : null}

          {(isOwner || isReceptionist) && noShowDisabled ? (
            <div className="mt-3 max-w-prose">
              <button
                type="button"
                disabled
                title="Solo disponible una vez comenzada la cita"
                className="cursor-not-allowed rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink-muted opacity-60"
              >
                Registrar no asistencia
              </button>
              <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
                Aún no puede declararse ausencia: la cita todavía no comenzó.
              </p>
            </div>
          ) : null}

          {canNoShow ? (
            <div className="mt-3">
              {confirming === 'no-show' ? (
                <span className="flex flex-wrap items-center gap-2 rounded-control bg-sunken px-3 py-2 ring-1 ring-hairline">
                  <span className="text-[length:var(--text-body-sm)] text-ink">
                    ¿Registrar la cita como no asistida?
                  </span>
                  <button
                    type="button"
                    disabled={noShow.isPending}
                    onClick={() => noShow.mutate()}
                    className="rounded-control bg-danger-subtle px-3 py-1 text-[length:var(--text-body-sm)] text-danger-ink"
                  >
                    {noShow.isPending ? 'Guardando…' : 'Sí, no asistió'}
                  </button>
                  <button
                    type="button"
                    disabled={noShow.isPending}
                    onClick={() => setConfirming(null)}
                    className="rounded-control bg-input-fill px-3 py-1 text-[length:var(--text-body-sm)] text-ink"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setErr(null);
                    setConfirming('no-show');
                  }}
                  className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink"
                >
                  Registrar no asistencia
                </button>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {terminal ? (
        <p className="mt-4 text-ink-secondary">La cita está en estado terminal: no se permiten nuevas acciones.</p>
      ) : null}

      <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
        <h2 className="text-[length:var(--text-h5)] text-ink">Eventos</h2>
        {eventsLoading ? (
          <p role="status" className="mt-2 text-[length:var(--text-body-sm)] text-ink-muted">
            Cargando eventos…
          </p>
        ) : null}
        {eventsError ? (
          <FormAlert>{apiErrorMessage(eventsError, 'No se pudieron cargar los eventos de la cita.')}</FormAlert>
        ) : null}
        {!eventsLoading && !eventsError && events && events.length === 0 ? <p className="mt-2 text-ink-secondary">Sin eventos.</p> : null}
        {events && events.length > 0 ? (
          <ul className="mt-2 grid gap-1">
            {events.map((e) => (
              <li key={e.id} className="text-[length:var(--text-body-sm)] text-ink-secondary">
                {EVENT_LABELS[e.eventType]} · {formatDayLong(e.createdAt)} {formatTime(e.createdAt)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-control bg-input-fill px-3 py-2 text-ink"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
