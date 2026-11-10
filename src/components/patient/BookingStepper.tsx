import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { appointmentsApi, type AppointmentResponse, type CreateAppointmentRequest } from '../../api/appointments';
import { catalogApi } from '../../api/catalog';
import { ApiError } from '../../api/http';
import { schedulingApi, type AvailabilitySlotDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { calendarDate, routeId } from '../../app/deepLinks';
import { addDays, apiErrorMessage, formatDayLong, formatTime, fromLocalDateInput, fullName, localDateInput } from '../appointments/appointmentUi';
import { useInvalidateNotifications } from '../notifications/notificationQueries';
import { AppointmentCard, PatientPageHeader, PatientQueryState } from './PatientUI';
import { birthDateInput, birthDateValue } from '../medical-intake/intakeFlow';
import { AvailableSlots } from '../appointments/AvailableSlots';

const stages = ['Servicio', 'Fecha y horario', 'Revisión'];

export function BookingStepper({ timezone }: { timezone: string }) {
  const [params] = useSearchParams();
  const user = useAuthStore(state => state.user);
  const navigate = useNavigate();
  const client = useQueryClient();
  const invalidateNotifications = useInvalidateNotifications();
  const [stage, setStage] = useState(0);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [dentistId, setDentistId] = useState<number | null>(() => routeId(params.get('dentistId')));
  const [initialDay] = useState(() => calendarDate(params.get('date')) ?? localDateInput(new Date(), timezone));
  const [day, setDay] = useState(initialDay);
  const [reason, setReason] = useState('');
  const [selection, setSelection] = useState<{ slot: AvailabilitySlotDto; criteria: string; revision: number } | null>(null);
  const [created, setCreated] = useState<AppointmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const operation = useRef<{ key: string; input: CreateAppointmentRequest } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const services = useQuery({ queryKey: ['services', 'booking', 'public'], queryFn: catalogApi.publicList, staleTime: 0, retry: false });
  const schedule = useQuery({ queryKey: ['public-schedule'], queryFn: schedulingApi.getPublicSchedule, retry: false });
  const service = services.data?.find(s => s.id === serviceId);
  const professional = schedule.data?.dentists.find(d => d.dentistId === dentistId);
  const criteria = JSON.stringify([serviceId, service?.durationMinutes, dentistId, day]);
  const availability = useQuery({
    queryKey: ['availability', 'patient-booking', serviceId, service?.durationMinutes, dentistId, day],
    queryFn: () => schedulingApi.availability({ dentistId: dentistId!, from: day, serviceId: serviceId! }),
    enabled: !!service && !!professional && !!day && stage > 0 && !created,
    staleTime: 0, gcTime: 0, retry: false, refetchInterval: 60_000, refetchOnMount: 'always',
  });
  const validAvailability = !!day && availability.isSuccess && !availability.isFetching && !availability.isError && availability.data.timezone === timezone
    && availability.data.dentistId === dentistId && availability.data.durationMinutes === service?.durationMinutes;
  const selected = validAvailability && selection?.criteria === criteria && selection.revision === availability.dataUpdatedAt
    && availability.data.slots.some(s => s.start === selection.slot.start && s.end === selection.slot.end) ? selection.slot : null;
  const editingBlocked = busy || uncertain;
  useUnsavedChanges(!created && (serviceId !== null || reason !== '' || uncertain));

  useEffect(() => { heading.current?.focus(); }, [stage, created]);

  function clearSelection() { setSelection(null); setError(null); setFieldErrors({}); }
  async function confirm(replay = false) {
    if (lock.current || !user?.patientId || created || (!replay && (!selected || !service || !professional))) return;
    if (user.medicalOnboarding?.pending) { navigate('/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1'); return; }
    lock.current = true; setBusy(true); setError(null); setFieldErrors({});
    try {
      if (!replay) {
        // Never submit a cached slot as authority. Re-read catalog and availability, then
        // let POST perform the final transactional check. Advancing a step never reserves.
        const freshServices = await services.refetch();
        const freshService = freshServices.data?.find(s => s.id === serviceId);
        if (freshServices.isError || !freshService || freshService.durationMinutes !== service!.durationMinutes) {
          clearSelection(); setStage(0); throw new Error('El servicio cambió o no se pudo comprobar. Selecciónalo de nuevo.');
        }
        const fresh = await availability.refetch();
        if (fresh.isError || fresh.data?.timezone !== timezone || fresh.data?.dentistId !== dentistId
          || fresh.data?.durationMinutes !== freshService.durationMinutes || !fresh.data.slots.some(s => s.start === selected!.start && s.end === selected!.end)) {
          clearSelection(); setStage(1); throw new Error('Ese horario ya no está disponible o no se pudo comprobar. Elige otro horario.');
        }
        operation.current = { key: crypto.randomUUID(), input: { patientId: user.patientId, dentistId: dentistId!, serviceId: serviceId!, startAt: selected!.start, endAt: selected!.end, ...(reason.trim() ? { reason: reason.trim() } : {}) } };
      }
      if (!operation.current) return;
      let response: AppointmentResponse;
      try { response = await appointmentsApi.create(operation.current.input, operation.current.key); }
      catch (cause) {
        if (!(cause instanceof ApiError) || cause.status >= 500) { setUncertain(true); throw cause; }
        operation.current = null; setUncertain(false);
        if (cause.body?.code === 'MEDICAL_ONBOARDING_REQUIRED') { navigate('/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1'); return; }
        setFieldErrors(cause.fieldErrors);
        if (cause.status === 409 || cause.status === 404) {
          setSelection(null); setStage(1); void availability.refetch(); void services.refetch();
        }
        throw cause;
      }
      setUncertain(false); operation.current = null; setCreated(response);
      client.setQueryData(['appointment', response.id], response);
      void client.invalidateQueries({ queryKey: ['appointments'] });
      void client.invalidateQueries({ queryKey: ['availability'] });
      void invalidateNotifications();
    } catch (cause) { setError(apiErrorMessage(cause, 'No se pudo reservar la cita. Vuelve a intentarlo.')); }
    finally { lock.current = false; setBusy(false); }
  }

  if (!user?.patientId) return <div className="patient-page"><p role="alert" className="patient-error">Completa tu perfil de paciente antes de reservar una cita. Contacta con la clínica si no aparece tu ficha.</p><Link className="patient-link" to="/appointments">Volver a mis citas</Link></div>;
  if (created) return <div className="patient-page patient-booking-success"><h1 ref={heading} tabIndex={-1}>Tu cita está reservada</h1><p role="status">La reserva se registró correctamente. Puedes consultar los detalles en Mis citas.</p><AppointmentCard appointment={created} timezone={timezone} featured /><div className="patient-booking-actions"><Link className="patient-button" to="/appointments">Volver a mis citas</Link><Link className="patient-link" to="/">Ir al inicio</Link></div></div>;

  return <div className="patient-page patient-booking">
    <PatientPageHeader title="Solicitar cita" intro="Encuentra el servicio y el horario adecuados para tu próxima visita." />
    <ol aria-label="Etapas de la reserva" className="patient-stepper">{stages.map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined}><button disabled={index >= stage || editingBlocked} onClick={() => setStage(index)}><span aria-hidden="true">{index + 1}</span><span>{label}<small>{index === stage ? 'Paso actual' : index < stage ? 'Completado' : 'Pendiente'}</small></span></button></li>)}</ol>
    <section className="patient-booking-panel" aria-busy={busy}>
      <h2 ref={heading} tabIndex={-1}>{['¿Qué servicio necesitas?', 'Elige fecha y horario', 'Revisa y confirma'][stage]}</h2>
      {error ? <div className="patient-error" role="alert">{error}{Object.entries(fieldErrors).filter(([key]) => key !== 'reason').map(([key, text]) => <p key={key}>{text}</p>)}</div> : null}
      {uncertain ? <div className="patient-error"><p>No sabemos si la reserva llegó a registrarse. No cambies los datos ni inicies otra reserva. Reintenta la misma operación para recuperar el resultado sin duplicarla.</p><button className="patient-button" disabled={busy} onClick={() => void confirm(true)}>{busy ? 'Comprobando reserva…' : 'Comprobar mi reserva'}</button></div> : null}
      <fieldset disabled={editingBlocked}>
      {stage === 0 ? <PatientQueryState query={services} label="servicios">
        <p className="patient-muted">Selecciona uno de los servicios disponibles de la clínica.</p>
        {services.data?.length ? <fieldset className="patient-services"><legend className="sr-only">Servicio</legend>{services.data.map(s => <label key={s.id} className={`patient-service${serviceId === s.id ? ' is-selected' : ''}`}><input type="radio" name="booking-service" aria-label={s.name} aria-describedby={`service-description-${s.id}`} checked={serviceId === s.id} onChange={() => { setServiceId(s.id); clearSelection(); }} /><span><strong>{s.name}</strong><span id={`service-description-${s.id}`}>{s.description ? <span>{s.description}</span> : null}<small>{s.durationMinutes} minutos</small></span></span></label>)}</fieldset> : <p className="patient-empty">No hay servicios activos para reservar. Contacta con la clínica o vuelve a consultarlos más tarde.</p>}
      </PatientQueryState> : null}
      {stage === 1 ? <>
        <p className="patient-muted">{service?.name} {service ? `· ${service.durationMinutes} minutos` : ''}. Los horarios se muestran en la hora de la clínica.</p>
        <PatientQueryState query={schedule} label="profesionales"><label className="patient-field">Dentista<select aria-label="Dentista" value={professional ? dentistId! : ''} onChange={e => { setDentistId(e.target.value ? Number(e.target.value) : null); clearSelection(); }}><option value="">Selecciona un profesional</option>{schedule.data?.dentists.map(d => <option key={d.dentistId} value={d.dentistId}>{fullName(d.firstName, d.lastName)}{d.specialty ? ` · ${d.specialty}` : ''}</option>)}</select></label>{schedule.data?.dentists.length === 0 ? <p>No hay profesionales disponibles para reservar. Contacta con la clínica.</p> : null}</PatientQueryState>
        <div className="patient-availability-grid"><CalendarPicker day={day} initialDay={initialDay} onChange={value => { setDay(value); clearSelection(); }} /><div className="patient-time-picker"><h3>Horarios disponibles</h3>{!professional ? <p>Selecciona un profesional para consultar sus horarios.</p> : !day ? <p>Completa una fecha válida para consultar horarios.</p> : <PatientQueryState query={availability} label="disponibilidad">
          {availability.isFetching ? <p role="status">Actualizando horarios…</p> : validAvailability ? availability.data.slots.length ? <AvailableSlots
            slots={availability.data.slots} selected={selected?.start ?? ''}
            onSelect={slot => { setSelection({ slot, criteria, revision: availability.dataUpdatedAt }); setError(null); }}
            label="Huecos disponibles" className="patient-slots"
            periods={{ timezone, periodClassName: 'patient-slot-group', gridClassName: 'patient-slot-grid' }}
            renderLabel={slot => `${formatTime(slot.start, timezone)}–${formatTime(slot.end, timezone)}`} />
            : <p role="status">Sin horarios disponibles para ese día. Prueba otra fecha o un profesional distinto.</p> : <p role="status">No se pudo comprobar la duración o la hora de estos horarios. Actualiza los servicios y vuelve a elegir.</p>}
          <button className="patient-link" onClick={() => { clearSelection(); void availability.refetch(); }} disabled={availability.isFetching}>Actualizar horarios</button>
        </PatientQueryState>}</div></div>
      </> : null}
      {stage === 2 ? <>
        <dl className="patient-review"><div><dt>Servicio</dt><dd>{service?.name}</dd></div><div><dt>Profesional</dt><dd>{professional ? fullName(professional.firstName, professional.lastName) : 'Selecciona un profesional'}</dd></div><div><dt>Fecha</dt><dd>{selection ? formatDayLong(selection.slot.start, timezone) : 'Sin horario seleccionado'}</dd></div><div><dt>Horario</dt><dd>{selection ? `${formatTime(selection.slot.start, timezone)} – ${formatTime(selection.slot.end, timezone)}` : ''}</dd></div><div><dt>Duración</dt><dd>{service?.durationMinutes} minutos</dd></div></dl>
        <label className="patient-field">Motivo (opcional)<textarea aria-label="Motivo (opcional)" value={reason} rows={3} aria-invalid={!!fieldErrors.reason} aria-describedby="booking-reason-help" onChange={e => setReason(e.target.value)} /><span id="booking-reason-help">{fieldErrors.reason ?? 'Si quieres, cuéntanos el motivo de tu visita.'}</span></label>
        {!selected && !uncertain ? <p className="patient-error" role="status">Los horarios se actualizaron. Vuelve al paso anterior para seleccionar uno vigente.</p> : <p className="patient-muted">Al confirmar comprobaremos de nuevo que tu horario siga disponible.</p>}
      </> : null}
      </fieldset>
      <div className="patient-booking-actions">
        {stage > 0 ? <button className="patient-button patient-button-secondary" disabled={editingBlocked} onClick={() => setStage(s => s - 1)}>Anterior</button> : <Link className="patient-link" to="/appointments">Volver a mis citas</Link>}
        {stage < 2 ? <button className="patient-button" disabled={editingBlocked || (stage === 0 ? !service || services.isFetching || services.isError : !selected)} onClick={() => setStage(s => s + 1)}>Continuar</button> : <button className="patient-button" disabled={editingBlocked || !selected} onClick={() => void confirm()}>{busy ? 'Confirmando reserva…' : 'Confirmar solicitud'}</button>}
      </div>
    </section>
  </div>;
}

function CalendarPicker({ day, initialDay, onChange }: { day: string; initialDay: string; onChange: (day: string) => void }) {
  const [month, setMonth] = useState((day || initialDay).slice(0, 7));
  const [text, setText] = useState(() => birthDateInput(day));
  const first = fromLocalDateInput(`${month}-01`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  function shift(delta: number) { setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + delta, 1)).toISOString().slice(0, 7)); }
  return <div className="patient-calendar"><div className="patient-calendar-heading"><button type="button" aria-label="Mes anterior" onClick={() => shift(-1)}>Anterior</button><h3>{new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first)}</h3><button type="button" aria-label="Mes siguiente" onClick={() => shift(1)}>Siguiente</button></div>
    <div className="patient-calendar-grid" role="group" aria-label="Calendario de fechas"><div aria-hidden="true" className="patient-weekdays">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => <span key={i}>{label}</span>)}</div>{Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}{Array.from({ length: count }, (_, i) => { const value = localDateInput(addDays(first, i)); return <button type="button" key={value} aria-label={formatDayLong(`${value}T12:00:00Z`, 'UTC')} aria-pressed={value === day} onClick={() => { setText(birthDateInput(value)); onChange(value); }}>{i + 1}</button>; })}</div>
    <label className="patient-field">Día (DD/MM/AAAA)<input aria-label="Día" type="text" inputMode="numeric" maxLength={10} value={text} aria-invalid={!!text && !day} aria-describedby="booking-day-help" onChange={e => {
      const value = birthDateValue(e.target.value);
      const valid = calendarDate(value);
      setText(birthDateInput(value));
      onChange(valid ?? '');
      if (valid) setMonth(valid.slice(0, 7));
    }} /></label><p id="booking-day-help" className="patient-muted">{text && !day ? 'Completa una fecha válida en formato DD/MM/AAAA.' : 'Elegir una fecha no garantiza disponibilidad.'}</p>
  </div>;
}
