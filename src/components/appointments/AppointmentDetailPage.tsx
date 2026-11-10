import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { appointmentsApi, type AppointmentResponse } from '../../api/appointments';
import { AppointmentClinicalSection } from './AppointmentClinicalSection';
import { schedulingApi, type AvailabilityDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { ApiError } from '../../api/http';
import { FormAlert } from '../auth/ui';
import { useInvalidateNotifications } from '../notifications/notificationQueries';
import { FinancialAccessLink } from '../financial/FinancialAccessLink';
import { DentistAppointmentDetail } from '../dentist/DentistAppointmentDetail';
import { useGuardedNavigate } from '../../app/unsavedChanges';
import { safeReturnTo } from '../../app/deepLinks';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import { ActionGroup } from '../ui/ActionGroup';
import { AppointmentFacts } from './AppointmentFacts';
import { ServiceSnapshot } from './ServiceSnapshot';
import { AppointmentEvents } from './AppointmentEvents';
import { AvailableSlots } from './AvailableSlots';
import {
  apiErrorMessage,
  formatDayLong,
  formatTime,
  localDateInput,
  statusChipClass,
  statusLabel,
  useNow,
} from './appointmentUi';
import './appointment-detail.css';
import { collectionReturn } from '../../app/collectionLinks';

export function AppointmentDetailPage() {
  const dentist = useAuthStore(state => state.user?.role === 'DENTIST');
  const owner = useAuthStore(state => state.user?.role === 'OWNER');
  const [params] = useSearchParams();
  return dentist || (owner && params.get('clinical') === '1') ? <DentistAppointmentDetail /> : <ExistingAppointmentDetailPage />;
}

function ExistingAppointmentDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const candidateReturn = safeReturnTo(searchParams.get('returnTo'));
  const agendaReturn = candidateReturn === '/appointments' || candidateReturn.startsWith('/appointments?') ? candidateReturn : '/appointments';
  const selectedVersion = Number(searchParams.get('occurrenceVersion'));
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const queryClient = useQueryClient();
  const invalidateNotifications = useInvalidateNotifications();
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const role = user?.role;
  const collectionBack = role === 'OWNER' || role === 'RECEPTIONIST' ? collectionReturn(searchParams.get('returnTo')) : null;

  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'cancel' | 'no-show' | null>(null);
  const [rsOpen, setRsOpen] = useState(false);
  const [rsChecking, setRsChecking] = useState(false);
  const [rsDay, setRsDay] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const patientOperation = useRef(false);
  const [fallbackTimeZone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  });

  const aid = Number(id);
  const { data: appt, isLoading, error } = useQuery({ queryKey: ['appointment', aid], queryFn: () => appointmentsApi.get(aid), enabled: !Number.isNaN(aid) });
  const { data: events, isLoading: eventsLoading, error: eventsError } = useQuery({ queryKey: ['appointment-events', aid], queryFn: () => appointmentsApi.events(aid), enabled: !Number.isNaN(aid) });
  const { data: publicSchedule, isPending: zonePending, error: zoneError } = useQuery({ queryKey: ['public-schedule'], queryFn: () => schedulingApi.getPublicSchedule(), enabled: !Number.isNaN(aid) });

  const isDentist = role === 'DENTIST';
  const isOwner = role === 'OWNER';
  const isReceptionist = role === 'RECEPTIONIST';
  const isPatient = role === 'PATIENT';
  const now = useNow();

  const { data: rsAvail, isLoading: rsAvailLoading, error: rsAvailError, isFetching: rsFetching, refetch: refreshSlots } = useQuery({
    queryKey: ['availability', 'reschedule', appt?.id, rsDay, appt?.durationMinutes],
    queryFn: () => { if (!appt || rsDay === '') return Promise.resolve(null) as Promise<AvailabilityDto | null>; return schedulingApi.availability({ dentistId: appt.dentistId, from: rsDay, appointmentId: appt.id }); },
    enabled: rsOpen && appt !== undefined && rsDay !== '',
  });
  const { data: policy } = useQuery({ queryKey: ['policy'], queryFn: () => schedulingApi.getPolicy(), enabled: isPatient && appt !== undefined && appt.status === 'SCHEDULED' });

  const refresh = (updated?: AppointmentResponse) => {
    if (updated) queryClient.setQueryData(['appointment', aid], updated);
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
    void queryClient.invalidateQueries({ queryKey: ['appointment', aid] });
    void queryClient.invalidateQueries({ queryKey: ['appointment-events', aid] });
    void invalidateNotifications();
  };

  const cancel = useMutation({
    mutationFn: () => appointmentsApi.cancel(aid),
    onSuccess: (updated) => { setNotice('Cita cancelada.'); setErr(null); setConfirming(null); refresh(updated); },
    onError: (cause) => { setNotice(null); setErr(apiErrorMessage(cause, 'No se pudo cancelar la cita.')); setConfirming(null); },
    onSettled: () => { patientOperation.current = false; },
  });
  const reschedule = useMutation({
    mutationFn: () => { if (!appt) throw new Error('Cita no cargada'); return appointmentsApi.reschedule(aid, { startAt: newStart, endAt: newEnd, expectedOccurrenceVersion: appt.occurrenceVersion }); },
    onSuccess: (updated) => { setNotice('Cita reprogramada.'); setErr(null); setNewStart(''); setNewEnd(''); setRsOpen(false); setRsDay(''); refresh(updated); },
    onError: (cause) => { setNotice(null); setErr(apiErrorMessage(cause, 'No se pudo reprogramar la cita.')); if (isPatient && cause instanceof ApiError && cause.body?.code === 'MEDICAL_ONBOARDING_REQUIRED') { navigate(`/patient-onboarding?returnTo=${encodeURIComponent(`/appointments/${aid}`)}`); } if (isPatient) { setNewStart(''); setNewEnd(''); void refreshSlots(); } },
    onSettled: () => { patientOperation.current = false; setRsChecking(false); },
  });
  const noShow = useMutation({
    mutationFn: () => appointmentsApi.noShow(aid),
    onSuccess: (updated) => { setNotice('No-show registrado.'); setErr(null); setConfirming(null); refresh(updated); },
    onError: (cause) => { setNotice(null); setErr(apiErrorMessage(cause, 'No se pudo registrar la ausencia.')); setConfirming(null); },
  });

  if (Number.isNaN(aid)) return <div className="p-5">ID inválido.</div>;
  if (isLoading) return <div className="p-5">Cargando…</div>;
  if (error) { const status = error instanceof ApiError ? error.status : undefined; return <div className="p-5"><FormAlert>{status === 404 ? 'No encontramos la cita solicitada.' : apiErrorMessage(error, 'No se pudo cargar la cita.')}</FormAlert></div>; }
  if (!appt) return <div className="p-5"><FormAlert>No se pudo cargar la cita.</FormAlert></div>;

  const zoneReady = publicSchedule?.timezone !== undefined && !zoneError;
  const timeZone = publicSchedule?.timezone ?? fallbackTimeZone;
  if (isPatient && (!user?.patientId || appt.patientId !== user.patientId)) return <div className="patient-page"><p role="alert">No encontramos la cita solicitada.</p></div>;
  if (isPatient && !zoneReady) return <div className="patient-page"><p role={zonePending ? 'status' : 'alert'}>{zonePending ? 'Consultando la hora de tu cita…' : 'No se pudo consultar la hora de la clínica. Vuelve a abrir la cita para intentarlo de nuevo.'}</p><Link to="/appointments" className="patient-link">Volver a mis citas</Link></div>;

  const scheduled = appt.status === 'SCHEDULED';
  const terminal = appt.status === 'COMPLETED' || appt.status === 'CANCELLED' || appt.status === 'NO_SHOW';
  const assignedDentist = user?.dentistId !== undefined && user.dentistId === appt.dentistId;
  const canComplete = scheduled && (isOwner || isDentist) && assignedDentist;
  const canControl = scheduled && (isOwner || isReceptionist || (isDentist && assignedDentist) || (isPatient && appt.patientUserId === userId));
  const canNoShow = scheduled && (isOwner || isReceptionist) && new Date(appt.startAt).getTime() <= now;
  const noShowDisabled = scheduled && (isOwner || isReceptionist) && new Date(appt.startAt).getTime() > now;

  function openReschedule() { if (!appt) return; if (isPatient && user?.medicalOnboarding?.pending) { navigate(`/patient-onboarding?returnTo=${encodeURIComponent(`/appointments/${aid}`)}`); return; } setErr(null); setRsDay(localDateInput(new Date(appt.startAt), timeZone)); setNewStart(''); setNewEnd(''); setRsOpen(true); }
  function handleRsSlot(slot: { start: string; end: string }) { setNewStart(slot.start); setNewEnd(slot.end); setErr(null); }

  const ownerDetail = isOwner && !isPatient;
  const collectionDestination = `/collections/${appt.id}${collectionBack ? `?returnTo=${encodeURIComponent(collectionBack)}` : ''}`;
  const clinicalSearch = new URLSearchParams({ ...Object.fromEntries(searchParams), clinical: '1' });
  const pageClass = isPatient
    ? 'patient-page patient-appointment-detail'
    : ownerDetail
      ? 'reception-page appointment-detail-page owner-chrome owner-appointment-detail'
      : isReceptionist
        ? 'reception-page appointment-detail-page'
        : 'mx-auto w-full max-w-app px-5 py-8 md:px-8';
  const ownerActions = ownerDetail ? (
    <>
      <Link to={`/appointments/${appt.id}?${clinicalSearch.toString()}`} className="reception-button">Abrir atención clínica</Link>
      {appt.status === 'COMPLETED' ? <Link to={collectionDestination} className="reception-button reception-button-secondary">Gestionar cobro de la atención</Link> : null}
      {canNoShow && confirming !== 'no-show' ? <button type="button" onClick={() => { setErr(null); setConfirming('no-show'); }} className="reception-button reception-button-secondary">Registrar no asistencia</button> : null}
      {noShowDisabled ? <button type="button" disabled title="Solo disponible una vez comenzada la cita" className="reception-button reception-button-secondary" aria-disabled="true">Registrar no asistencia</button> : null}
    </>
  ) : null;

  return (
    <div className={pageClass}>
      {collectionBack ? <Link to={collectionBack} className="reception-link">Volver a atenciones por cobrar</Link> : null}
      {isPatient ? (
        <>
          <Link to="/appointments" className="patient-link">Volver a mis citas</Link>
          <header>
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Tu cita dental</h1>
              <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] font-medium ${statusChipClass(appt.status)}`}>{statusLabel(appt.status)}</span>
            </div>
            <p className="mt-1 text-ink-secondary">{formatDayLong(appt.startAt, timeZone)} {formatTime(appt.startAt, timeZone)}–{formatTime(appt.endAt, timeZone)} · {appt.durationMinutes} min</p>
            <p className="mt-2 font-medium text-ink">{appt.patientFirstName} {appt.patientLastName} · {appt.dentistFirstName} {appt.dentistLastName}</p>
          </header>
          <FinancialAccessLink patientId={appt.patientId} appointmentId={appt.id} dentistId={appt.dentistId} />
        </>
      ) : ownerDetail ? (
        <ReceptionPageHeader title={`Cita #${appt.id}`} intro={`${formatDayLong(appt.startAt, timeZone)} · ${formatTime(appt.startAt, timeZone)}–${formatTime(appt.endAt, timeZone)} · ${appt.durationMinutes} min · ${appt.patientFirstName} ${appt.patientLastName} · ${appt.dentistFirstName} ${appt.dentistLastName}`} action={<div className="appointment-detail-header-actions"><span className={`reception-chip appointment-detail-status ${statusChipClass(appt.status)}`}>{statusLabel(appt.status)}</span><div className="appointment-detail-actions">{ownerActions}</div></div>} />
      ) : isReceptionist ? (
        <>
          {!collectionBack ? <Link to={agendaReturn} className="mb-4 inline-flex min-h-11 items-center text-primary-ink underline">Volver a Citas</Link> : null}
          <header>
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Cita #{appt.id}</h1>
              <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] font-medium ${statusChipClass(appt.status)}`}>{statusLabel(appt.status)}</span>
            </div>
            <p className="mt-1 text-ink-secondary">{formatDayLong(appt.startAt, timeZone)} {formatTime(appt.startAt, timeZone)}–{formatTime(appt.endAt, timeZone)} · {appt.durationMinutes} min</p>
            <p className="mt-2 font-medium text-ink">{appt.patientFirstName} {appt.patientLastName} · {appt.dentistFirstName} {appt.dentistLastName}</p>
          </header>
          <FinancialAccessLink patientId={appt.patientId} appointmentId={appt.id} dentistId={appt.dentistId} />
          {appt.status === 'COMPLETED' ? <Link to={collectionDestination} className="mt-3 inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-paper">Gestionar cobro de la atención</Link> : null}
        </>
      ) : (
        <>
          <Link to={agendaReturn} className="mb-4 inline-flex min-h-11 items-center text-primary-ink underline">Volver a Citas</Link>
          <header>
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Cita #{appt.id}</h1>
              <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] font-medium ${statusChipClass(appt.status)}`}>{statusLabel(appt.status)}</span>
            </div>
            <p className="mt-1 text-ink-secondary">{formatDayLong(appt.startAt, timeZone)} {formatTime(appt.startAt, timeZone)}–{formatTime(appt.endAt, timeZone)} · {appt.durationMinutes} min</p>
            <p className="mt-2 font-medium text-ink">{appt.patientFirstName} {appt.patientLastName} · {appt.dentistFirstName} {appt.dentistLastName}</p>
          </header>
          {isOwner ? <Link to={`/appointments/${appt.id}?${clinicalSearch.toString()}`} className="mt-4 inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-paper outline-none focus-visible:ring-2 focus-visible:ring-primary">Abrir atención clínica</Link> : null}
          <FinancialAccessLink patientId={appt.patientId} appointmentId={appt.id} dentistId={appt.dentistId} />
          {(isOwner || isReceptionist) && appt.status === 'COMPLETED' ? <Link to={`/collections/${appt.id}`} className="mt-3 inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-paper">Gestionar cobro de la atención</Link> : null}
        </>
      )}
      {ownerDetail ? <div className="appointment-detail-quick"><FinancialAccessLink patientId={appt.patientId} appointmentId={appt.id} dentistId={appt.dentistId} /></div> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {err ? <FormAlert>{err}</FormAlert> : null}
      {!zoneReady ? (zonePending ? <p role="status" className="mt-2 text-[length:var(--text-body-sm)] text-ink-muted">Cargando zona horaria de la clínica…</p> : <div className="mt-2"><FormAlert>{apiErrorMessage(zoneError, `No se pudo cargar la zona horaria de la clínica; las horas se muestran en ${timeZone}. Pueden diferir de la zona de la clínica.`)}</FormAlert></div>) : null}

      {ownerDetail ? (
        <>
          <section className="reception-section">
            <div className="reception-section-heading"><div><h2>Resumen administrativo</h2><p>Información general, servicio, finanzas y agenda.</p></div></div>
            <div className="appointment-detail-grid">
              <ServiceSnapshot service={appt.service} owner />
              <AppointmentFacts appointment={appt} timeZone={timeZone} owner />
            </div>
          </section>
          <section className="reception-section">
            <div className="reception-section-heading"><div><h2>Finanzas y acciones</h2><p>Accesos a cobros y operaciones administrativas permitidas.</p></div></div>
            <div className="appointment-detail-stack">
              <ActionGroup className="appointment-detail-action-row">
                <FinancialAccessLink patientId={appt.patientId} appointmentId={appt.id} dentistId={appt.dentistId} />
                {appt.status === 'COMPLETED' ? <Link to={collectionDestination} className="reception-text-button">Gestionar cobro de la atención</Link> : null}
              </ActionGroup>
              {scheduled ? (
                <div className="appointment-detail-stack">
                  {canControl ? (
                    <ActionGroup className="appointment-detail-action-row">
                      {confirming === 'cancel' ? (
                        <span className="appointment-detail-inline-confirm">
                          <span>¿Cancelar esta cita?</span>
                          <button type="button" disabled={cancel.isPending} onClick={() => { if (isPatient && patientOperation.current) return; patientOperation.current = true; cancel.mutate(); }} className="reception-button reception-button-secondary">Sí, cancelar</button>
                          <button type="button" disabled={cancel.isPending} onClick={() => setConfirming(null)} className="reception-button">No</button>
                        </span>
                      ) : <button type="button" onClick={() => { setErr(null); setConfirming('cancel'); }} className="reception-button reception-button-secondary">Cancelar</button>}
                      {!rsOpen ? <button type="button" onClick={openReschedule} className="reception-button">Reprogramar</button> : null}
                    </ActionGroup>
                  ) : null}
                  {rsOpen ? (
                    <div className="appointment-detail-reschedule">
                      <label htmlFor="reschedule-day" className="appointment-detail-label">Día</label>
                      <input id="reschedule-day" disabled={isPatient && (rsChecking || reschedule.isPending)} type="date" value={rsDay} onChange={(e) => { setRsDay(e.target.value); setNewStart(''); setNewEnd(''); }} className="reception-input" />
                      {rsAvailLoading ? <p role="status" className="appointment-detail-muted">Cargando disponibilidad…</p> : null}
                      {rsAvailError ? <FormAlert>{apiErrorMessage(rsAvailError, 'No se pudo consultar la disponibilidad.')}</FormAlert> : null}
                      {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length > 0 ? <AvailableSlots slots={rsAvail.slots} selected={newStart} onSelect={handleRsSlot} disabled={isPatient && (rsChecking || reschedule.isPending)} className="appointment-detail-slot-grid" label="Huecos para reprogramar" buttonClassName="appointment-detail-slot" editorial={{ timezone: timeZone, durationMinutes: rsAvail.durationMinutes }} /> : null}
                      {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length === 0 ? <p className="appointment-detail-muted">Sin huecos disponibles para ese día.</p> : null}
                      {!rsAvailLoading && !rsAvailError && newStart !== '' && newEnd !== '' ? (
                        <div className="appointment-detail-reschedule-actions">
                          <p>Nuevo horario: {formatTime(newStart, timeZone)}–{formatTime(newEnd, timeZone)} {isPatient ? '' : `(versión ${appt.occurrenceVersion})`}</p>
                          <div className="appointment-detail-action-row">
                            <button type="button" disabled={reschedule.isPending || (isPatient && (rsChecking || rsFetching || !rsAvail?.slots.some(slot => slot.start === newStart && slot.end === newEnd)))} onClick={() => { if (!isPatient) { reschedule.mutate(); return; } if (patientOperation.current) return; patientOperation.current = true; setRsChecking(true); void refreshSlots().then(result => { if (result.isError || !result.data?.slots.some(slot => slot.start === newStart && slot.end === newEnd)) { setErr('Ese horario ya no está disponible. Selecciona otro.'); setNewStart(''); setNewEnd(''); patientOperation.current = false; setRsChecking(false); } else reschedule.mutate(); }); }} className="reception-button">{reschedule.isPending || rsChecking ? 'Reprogramando…' : 'Confirmar reprogramación'}</button>
                            <button type="button" disabled={reschedule.isPending || (isPatient && rsChecking)} onClick={() => { setRsOpen(false); setRsDay(''); setNewStart(''); setNewEnd(''); }} className="reception-button">Cerrar</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {canComplete ? <p className="appointment-detail-muted">Finaliza desde el espacio de atención clínica.</p> : null}
                  {noShowDisabled ? <p className="appointment-detail-muted">Aún no puede declararse ausencia: la cita todavía no comenzó.</p> : null}
                  {confirming === 'no-show' ? <span className="appointment-detail-inline-confirm"><span>¿Registrar la cita como no asistida?</span><button type="button" disabled={noShow.isPending} onClick={() => noShow.mutate()} className="reception-button reception-button-secondary">Sí, no asistió</button><button type="button" disabled={noShow.isPending} onClick={() => setConfirming(null)} className="reception-button">No</button></span> : null}
                </div>
              ) : null}
              {terminal ? <p className="appointment-detail-muted">La cita está cerrada: no se permiten nuevas acciones de agenda. El expediente conserva sus permisos clínicos.</p> : null}
            </div>
          </section>
          <section className="reception-section">
            <div className="reception-section-heading"><div><h2>Atención clínica</h2><p>Expediente, odontograma, notas, tratamientos y evoluciones.</p></div></div>
            {(isOwner || isDentist) ? <AppointmentClinicalSection key={`${userId}-${appt.id}-${appt.patientId}`} appointment={appt} timeZone={timeZone} initialOccurrenceVersion={Number.isSafeInteger(selectedVersion) && selectedVersion > 0 && selectedVersion <= appt.occurrenceVersion ? selectedVersion : undefined} /> : null}
          </section>
          <AppointmentEvents events={events} loading={eventsLoading} error={eventsError} timeZone={timeZone} owner />
        </>
      ) : (
        <>
          <AppointmentFacts appointment={appt} timeZone={timeZone} />
          <ServiceSnapshot service={appt.service} patient={isPatient} />
          {(isOwner || isDentist) ? <AppointmentClinicalSection key={`${userId}-${appt.id}-${appt.patientId}`} appointment={appt} timeZone={timeZone} initialOccurrenceVersion={Number.isSafeInteger(selectedVersion) && selectedVersion > 0 && selectedVersion <= appt.occurrenceVersion ? selectedVersion : undefined} /> : null}
          {scheduled ? (
            <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
              <h2 className="text-[length:var(--text-h5)] text-ink">Acciones</h2>
              {isPatient && policy ? <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">La clínica permite cancelar hasta {policy.cancellationLeadTimeHours} horas antes de la cita.</p> : null}
              {canControl ? <ActionGroup className="mt-3 flex flex-wrap items-center gap-2">{confirming === 'cancel' ? <span className="flex flex-wrap items-center gap-2 rounded-control bg-sunken px-3 py-2 ring-1 ring-hairline"><span className="text-[length:var(--text-body-sm)] text-ink">¿Cancelar esta cita?</span><button type="button" disabled={cancel.isPending} onClick={() => { if (isPatient && patientOperation.current) return; patientOperation.current = true; cancel.mutate(); }} className="rounded-control bg-danger-subtle px-3 py-1 text-[length:var(--text-body-sm)] text-danger-ink">{cancel.isPending ? 'Cancelando…' : 'Sí, cancelar'}</button><button type="button" disabled={cancel.isPending} onClick={() => setConfirming(null)} className="rounded-control bg-input-fill px-3 py-1 text-[length:var(--text-body-sm)] text-ink">No</button></span> : <button type="button" onClick={() => { setErr(null); setConfirming('cancel'); }} className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink">Cancelar</button>}{!rsOpen ? <button type="button" onClick={openReschedule} className="rounded-control bg-primary px-3 py-2 text-[length:var(--text-body-sm)] font-medium text-paper">Reprogramar</button> : null}</ActionGroup> : null}
              {rsOpen ? <div className="mt-3 rounded-control bg-sunken p-4 ring-1 ring-hairline">
                <label htmlFor="reschedule-day" className="text-[length:var(--text-body-sm)] text-ink">Día</label>
                <input id="reschedule-day" disabled={isPatient && (rsChecking || reschedule.isPending)} type="date" value={rsDay} onChange={(e) => { setRsDay(e.target.value); setNewStart(''); setNewEnd(''); }} className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary" />
                {rsAvailLoading ? <p role="status" className="mt-3 text-[length:var(--text-body-sm)] text-ink-muted">Cargando disponibilidad…</p> : null}
                {rsAvailError ? <FormAlert>{apiErrorMessage(rsAvailError, 'No se pudo consultar la disponibilidad.')}</FormAlert> : null}
                {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length > 0 ? <AvailableSlots slots={rsAvail.slots} selected={newStart} onSelect={handleRsSlot} disabled={isPatient && (rsChecking || reschedule.isPending)} className="mt-3 flex flex-wrap gap-2" label="Huecos para reprogramar" buttonClassName="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary" editorial={!isPatient ? { timezone: timeZone, durationMinutes: rsAvail.durationMinutes } : undefined} /> : null}
                {!rsAvailLoading && !rsAvailError && rsAvail && rsAvail.slots.length === 0 ? <p className="mt-3 text-[length:var(--text-body-sm)] text-ink-secondary">Sin huecos disponibles para ese día.</p> : null}
                {!rsAvailLoading && !rsAvailError && newStart !== '' && newEnd !== '' ? <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-[length:var(--text-body-sm)] text-ink">Nuevo horario: {formatTime(newStart, timeZone)}–{formatTime(newEnd, timeZone)} <span className="text-ink-muted">{isPatient ? '' : `(versión ${appt.occurrenceVersion})`}</span></p>
                  <button type="button" disabled={reschedule.isPending || (isPatient && (rsChecking || rsFetching || !rsAvail?.slots.some(slot => slot.start === newStart && slot.end === newEnd)))} onClick={() => { if (!isPatient) { reschedule.mutate(); return; } if (patientOperation.current) return; patientOperation.current = true; setRsChecking(true); void refreshSlots().then(result => { if (result.isError || !result.data?.slots.some(slot => slot.start === newStart && slot.end === newEnd)) { setErr('Ese horario ya no está disponible. Selecciona otro.'); setNewStart(''); setNewEnd(''); patientOperation.current = false; setRsChecking(false); } else reschedule.mutate(); }); }} className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper disabled:opacity-60">{reschedule.isPending || rsChecking ? 'Reprogramando…' : 'Confirmar reprogramación'}</button>
                  <button type="button" disabled={reschedule.isPending || (isPatient && rsChecking)} onClick={() => { setRsOpen(false); setRsDay(''); setNewStart(''); setNewEnd(''); }} className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink">Cerrar</button>
                </div> : null}
              </div> : null}
              {canComplete ? <p className="mt-3 text-ink-secondary">Finaliza desde el espacio de atención clínica.</p> : null}
              {(isOwner || isReceptionist) && noShowDisabled ? <div className="mt-3 max-w-prose"><button type="button" disabled title="Solo disponible una vez comenzada la cita" className="cursor-not-allowed rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink-muted opacity-60">Registrar no asistencia</button><p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">Aún no puede declararse ausencia: la cita todavía no comenzó.</p></div> : null}
              {canNoShow ? <div className="mt-3">{confirming === 'no-show' ? <span className="flex flex-wrap items-center gap-2 rounded-control bg-sunken px-3 py-2 ring-1 ring-hairline"><span className="text-[length:var(--text-body-sm)] text-ink">¿Registrar la cita como no asistida?</span><button type="button" disabled={noShow.isPending} onClick={() => noShow.mutate()} className="rounded-control bg-danger-subtle px-3 py-1 text-[length:var(--text-body-sm)] text-danger-ink">{noShow.isPending ? 'Guardando…' : 'Sí, no asistió'}</button><button type="button" disabled={noShow.isPending} onClick={() => setConfirming(null)} className="rounded-control bg-input-fill px-3 py-1 text-[length:var(--text-body-sm)] text-ink">No</button></span> : <button type="button" onClick={() => { setErr(null); setConfirming('no-show'); }} className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink">Registrar no asistencia</button>}</div> : null}
            </section>
          ) : null}
          {terminal ? <p className="mt-4 text-ink-secondary">La cita está cerrada: no se permiten nuevas acciones de agenda. El expediente conserva sus permisos clínicos.</p> : null}
          <AppointmentEvents events={events} loading={eventsLoading} error={eventsError} timeZone={timeZone} />
        </>
      )}
      <div className={ownerDetail ? 'appointment-detail-footer' : 'mt-4'}>
        <button type="button" onClick={() => guardedNavigate(() => collectionBack ? navigate(collectionBack) : navigate(-1))} className="min-h-11 rounded-control bg-input-fill px-3 py-2 text-ink">Volver</button>
      </div>
    </div>
  );
}
