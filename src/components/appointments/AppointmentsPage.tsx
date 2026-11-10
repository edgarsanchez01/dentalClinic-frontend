import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  appointmentsApi,
  type AppointmentListParams,
  type AppointmentResponse,
  type CreateAppointmentRequest,
} from '../../api/appointments';
import { schedulingApi, type AvailabilityDto, type AvailabilitySlotDto, type PublicScheduleDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { useMediaQuery } from '../../app/useMediaQuery';
import { catalogApi } from '../../api/catalog';
import { ApiError } from '../../api/http';
import { PatientPicker } from '../patients/PatientPicker';
import { BookingServicePicker } from './BookingServicePicker';
import { FormAlert } from '../auth/ui';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import { ReceptionWeekAgenda } from '../reception/ReceptionWeekAgenda';
import { ReceptionDayAgenda } from '../reception/ReceptionDayAgenda';
import { useInvalidateNotifications } from '../notifications/notificationQueries';
import { useAgendaAppointments } from './agendaQueries';
import { StaffDayAgenda } from './StaffDayAgenda';
import { PatientAppointments } from '../patient/PatientAppointments';
import { OwnerViewSwitch } from '../app/OwnerViewSwitch';
import { DentistCalendar, DentistDayAgenda } from '../dentist/DentistAgenda';
import '../dentist/dentist-appointments.css';
import { OwnerColumnComparison, OwnerDayAgenda, OwnerMonthCalendar, OwnerStartGroups, OwnerWeekAgenda } from '../owner/OwnerAppointmentViews';
import '../owner/owner-appointments.css';
import { calendarDate, routeId } from '../../app/deepLinks';
import { AgendaFilters, StaffAgendaToolbar } from './AgendaToolbar';
import { StaffAgendaHeader } from './AgendaPresentation';
import {
  DayColumns,
  ExistingAppointmentsPanel,
  PatientDayGroups,
  StaffMonthBoard,
  StaffWeekBoard,
} from './AppointmentSummary';
import { AvailableSlots } from './AvailableSlots';
import { BookingContext, BookingReview, BookingStep, BookingStepRail } from './BookingPresentation';
import {
  addDays,
  agendaPeriodLabel,
  apiErrorMessage,
  dayKey,
  formatDayLong,
  formatTime,
  fromLocalDateInput,
  fullName,
  isoWeekDay,
  localDateInput,
  minutesOfDay,
  parseClock,
  rangeForView,
  sortAppointments,
  startOfWeek,
  statusLabel,
  STATUS_OPTIONS,
  type ViewMode,
} from './appointmentUi';

const PX_PER_MIN = 2;

export function AppointmentsPage() {
  const patient = useAuthStore(state => state.user?.role === 'PATIENT');
  const owner = useAuthStore(state => state.user?.role === 'OWNER');
  const [params] = useSearchParams();
  const personal = owner && params.get('scope') === 'mine';
  return patient ? <PatientAppointments /> : <div className={owner ? 'owner-workspace reception-shell' : 'reception-shell'}><div className={personal ? 'dentist-shell' : undefined}><StaffAppointmentsPage key={personal ? 'personal' : 'clinic'} personal={personal} /></div></div>;
}

function StaffAppointmentsPage({ personal }: { personal: boolean }) {
  const user = useAuthStore((state) => state.user);
  const [entryParams] = useSearchParams();
  const { data: publicSchedule, isPending, error, refetch } = useQuery({
    queryKey: ['public-schedule'],
    queryFn: () => schedulingApi.getPublicSchedule(),
  });
  if (isPending) return <>{entryParams.get('create') !== '1' ? <OwnerViewSwitch area="appointments" /> : null}<p role="status" className="p-5">Cargando zona horaria de la clínica…</p></>;
  if (error || !publicSchedule?.timezone) {
    return <>{entryParams.get('create') !== '1' ? <OwnerViewSwitch area="appointments" /> : null}<div className="p-5"><FormAlert>{apiErrorMessage(error, 'No se pudo cargar la zona horaria de la clínica.')}</FormAlert><button type="button" className="min-h-11 underline" onClick={() => void refetch()}>Reintentar zona horaria</button></div></>;
  }
  if ((user?.role === 'DENTIST' || personal) && (!Number.isSafeInteger(user?.dentistId) || !user?.dentistId || user.dentistId < 1)) {
    return <>{entryParams.get('create') !== '1' ? <OwnerViewSwitch area="appointments" /> : null}<div className="p-5"><FormAlert>Tu cuenta no tiene un perfil profesional vinculado. Contacta con el propietario.</FormAlert></div></>;
  }
  try { new Intl.DateTimeFormat('es', { timeZone: publicSchedule.timezone }); }
  catch { return <>{entryParams.get('create') !== '1' ? <OwnerViewSwitch area="appointments" /> : null}<div className="p-5"><p role="alert">La zona horaria de la clínica no es válida. Solicita revisar la configuración.</p><button type="button" className="min-h-11 underline" onClick={() => void refetch()}>Reintentar zona horaria</button></div></>; }
  // Initialize calendar dates only after the authoritative zone is known.
  return <ClinicAppointments key={publicSchedule.timezone} publicSchedule={publicSchedule} />;
}

function ClinicAppointments({ publicSchedule }: { publicSchedule: PublicScheduleDto }) {
  const timeZone = publicSchedule.timezone;
  const user = useAuthStore((state) => state.user);
  const role = user?.role;
  const DayFrame = role === 'OWNER' ? OwnerColumnComparison : Fragment;
  const [params, setParams] = useSearchParams();
  const personal = role === 'OWNER' && params.get('scope') === 'mine';
  const isReception = role === 'RECEPTIONIST';
  const isDentist = role === 'DENTIST' || personal;
  // Shared visual grammar, never a role or an authorization gate.
  const isOperational = isReception || (role === 'OWNER' && !personal);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidateNotifications = useInvalidateNotifications();
  function agendaReturnTo() {
    const context = new URLSearchParams(params);
    // Freeze implicit defaults too: returning tomorrow must not move the original agenda.
    context.set('date', String(date));
    context.set('view', String(view));
    return `/appointments?${context.toString()}`;
  }
  const openAppointment = (id: number) => navigate(`/appointments/${id}?${personal ? 'clinical=1&' : ''}returnTo=${encodeURIComponent(agendaReturnTo())}`);

  const isPatient = role === 'PATIENT';
  const isStaff = !isPatient;
  const isMobile = useMediaQuery('(max-width: 47.99rem)');

  // Personal scope always uses /me, never a URL-supplied identity. OWNER's clinic view stays global.
  const myDentistId = isDentist ? (user?.dentistId ?? undefined) : undefined;

  const [today] = useState(() => localDateInput(new Date(), timeZone));
  const requestedView = params.get('view');
  const view: ViewMode = requestedView === 'day' || requestedView === 'month' || requestedView === 'week' ? requestedView : isDentist ? 'day' : 'week';
  const date = calendarDate(params.get('date')) ?? today;
  const cursor = useMemo(() => fromLocalDateInput(date), [date]);
  const requestedDentist = routeId(params.get('dentistId'));
  const dentistFilter: number | '' = myDentistId ?? (publicSchedule.dentists.some((item) => item.dentistId === requestedDentist) ? requestedDentist! : '');
  const requestedStatus = params.get('status');
  const statusFilter = STATUS_OPTIONS.find((option) => option.value === requestedStatus)?.value ?? '';
  const patientFilter = isPatient ? null : routeId(params.get('patientId'));
  function updateParameter(name: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value); else next.delete(name);
      return next;
    });
  }
  const setView = (next: ViewMode) => updateParameter('view', next);
  const setCursor = (next: Date) => updateParameter('date', localDateInput(next));
  const setDentistFilter = (next: number | '') => updateParameter('dentistId', String(next));
  const setStatusFilter = (next: '' | AppointmentResponse['status']) => updateParameter('status', next);
  function selectMonthDate(next: Date) {
    setParams(previous => {
      const updated = new URLSearchParams(previous), value = localDateInput(next);
      updated.set('date', value); updated.delete('preview');
      return updated;
    }, { replace: true });
  }
  function openDay(next: Date) {
    // setSearchParams no encola actualizadores como setState: fecha y vista deben ser atómicas.
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('date', localDateInput(next));
      updated.set('view', 'day');
      if (role === 'OWNER') updated.delete('preview');
      return updated;
    });
  }
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const bookingOpen = params.get('create') === '1';
  const setBookingOpen = (next: (open: boolean) => boolean) => updateParameter('create', next(bookingOpen) ? '1' : '');
  const bookingHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!bookingOpen) return;
    bookingHeading.current?.focus();
    bookingHeading.current?.scrollIntoView?.({ block: 'start' });
  }, [bookingOpen]);

  // En móvil, la lista diaria es la vista obligatoria para el personal (§13.7); el escritorio
  // conserva el selector Día/Semana/Mes.
  // Explicit DC-OWNER-APPOINTMENTS-UX-01 authorization: OWNER keeps the selected
  // period on mobile. Endpoints, filters and clinical range helpers are unchanged.
  const effectiveView: ViewMode = isStaff && isMobile && role !== 'OWNER' ? 'day' : view;

  const range = useMemo(() => rangeForView(effectiveView, cursor, timeZone), [effectiveView, cursor, timeZone]);
  const { data: clinicSchedule } = useQuery({
    queryKey: ['clinic-schedule'],
    queryFn: () => schedulingApi.getClinicSchedule(),
    enabled: isStaff,
  });

  const dentists = useMemo(() => publicSchedule?.dentists ?? [], [publicSchedule]);

  const listParams = useMemo<AppointmentListParams>(() => {
    const params: AppointmentListParams = {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      size: 100,
    };
    if (dentistFilter !== '') {
      params.dentistId = Number(dentistFilter);
    }
    if (statusFilter !== '') {
      params.status = statusFilter;
    }
    if (patientFilter !== null) params.patientId = patientFilter;
    return params;
  }, [range, dentistFilter, statusFilter, patientFilter]);

  const {
    data: page,
    isLoading,
    isError,
    error,
    refetch,
  } = useAgendaAppointments(listParams);

  const appointments = useMemo(() => sortAppointments(page?.content ?? []), [page]);

  const [createPatient, setCreatePatient] = useState<number | ''>(patientFilter ?? '');
  const [createDentist, setCreateDentist] = useState<number | ''>(dentistFilter);
  const [createDay, setCreateDay] = useState<string>(date);
  const prefill = JSON.stringify([bookingOpen, date, dentistFilter, patientFilter]);
  const [lastPrefill, setLastPrefill] = useState(prefill);
  // Ajustar solo los criterios solicitados al cambiar el deep link, sin remount ni borrar el motivo.
  if (lastPrefill !== prefill) {
    setLastPrefill(prefill);
    if (bookingOpen) {
      setCreateDay(date);
      if (dentistFilter !== '') setCreateDentist(dentistFilter);
      if (patientFilter !== null) setCreatePatient(patientFilter);
    }
  }
  const [createService, setCreateService] = useState<number | ''>('');
  const serviceQueryKey = ['services', 'booking', isPatient ? 'public' : 'staff'];
  const servicesQuery = useQuery({
    queryKey: serviceQueryKey,
    queryFn: () => isPatient ? catalogApi.publicList() : catalogApi.list(true).then((items) => items.filter((item) => item.active)),
  });
  const activeServices = servicesQuery.data ?? [];
  const selectedService = activeServices.find((service) => service.id === createService);
  const createDuration = selectedService?.durationMinutes;
  const serviceReady = Boolean(selectedService) && servicesQuery.isSuccess && !servicesQuery.isFetching;
  const [createReason, setCreateReason] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<{
    slot: AvailabilitySlotDto;
    criteria: string;
  } | null>(null);

  const createDentistId = createDentist === '' ? undefined : Number(createDentist);
  const availabilityCriteria = JSON.stringify([createDentistId, createDay, createDuration, createService]);
  const createStart = selectedSlot?.criteria === availabilityCriteria ? selectedSlot.slot.start : '';
  const createEnd = selectedSlot?.criteria === availabilityCriteria ? selectedSlot.slot.end : '';

  const columns = useMemo(() => {
    if (isPatient) return [];
    const list = dentistFilter === '' ? dentists : dentists.filter((d) => d.dentistId === dentistFilter);
    return list;
  }, [isPatient, dentists, dentistFilter]);

  const availQueries = effectiveView === 'day' && isStaff && serviceReady ? columns.map((d) => ({
      queryKey: ['availability', 'agenda', d.dentistId, dayKey(range.days[0]), createDuration, createService],
      queryFn: () =>
        schedulingApi.availability({ dentistId: d.dentistId, from: dayKey(range.days[0]), serviceId: Number(createService) }),
    })) : [];

  const dayAvail = useQueries({ queries: availQueries });

  const {
    data: formAvail,
    isLoading: formAvailLoading,
    isError: formAvailError,
    error: formAvailCause,
    isSuccess: formAvailSuccess,
    isFetching: formAvailFetching,
  } = useQuery({
    queryKey: ['availability', 'form', createDentistId, createDay, createDuration, createService],
    queryFn: () => {
      if (createDentistId === undefined) return Promise.resolve(null) as Promise<AvailabilityDto | null>;
      return schedulingApi.availability({ dentistId: createDentistId, from: createDay, serviceId: Number(createService) });
    },
    enabled: serviceReady && createDentistId !== undefined && createDay !== '',
  });

  const formAvailReady = serviceReady && createDentistId !== undefined && createDay !== '' &&
    formAvailSuccess && !formAvailFetching && formAvail?.durationMinutes === createDuration;
  const selectionAvailable = formAvailReady && createStart !== '' && createEnd !== '' &&
    Boolean(formAvail?.slots.some((slot) => slot.start === createStart && slot.end === createEnd));

  // UX-04: asistente de tres pasos para el personal. El paso activo es el único que ocupa el
  // área principal; el envío sigue dependiendo de las mismas validaciones y del hueco real.
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3>(1);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState<string | null>(null);
  const reportPatientLabel = useCallback((name: string | null) => setPatientLabel(name), []);
  const stepHeadingRefs = useRef<Array<HTMLHeadingElement | null>>([]);
  const lastFocusedStep = useRef<1 | 2 | 3>(1);
  // El foco sigue al paso activo para que la navegación por teclado no quede atrás.
  useEffect(() => {
    if (lastFocusedStep.current === bookingStep) return;
    lastFocusedStep.current = bookingStep;
    stepHeadingRefs.current[bookingStep]?.focus();
  }, [bookingStep]);
  const stepOneReady = serviceReady && createPatient !== '';
  const stepTwoReady = selectionAvailable;
  const createDentistName = dentists.find((entry) => entry.dentistId === createDentistId);

  const idemRef = useRef({ key: crypto.randomUUID(), payload: null as string | null });
  const bookingSubmitting = useRef(false);
  useUnsavedChanges((isDentist || role === 'OWNER') && bookingOpen && createdId === null && (createPatient !== '' || createService !== '' || createReason.trim() !== ''));

  const create = useMutation({
    mutationFn: (input: CreateAppointmentRequest) => {
      const payload = JSON.stringify(input);
      if (idemRef.current.payload !== null && idemRef.current.payload !== payload) {
        idemRef.current.key = crypto.randomUUID();
      }
      idemRef.current.payload = payload;
      return appointmentsApi.create(input, idemRef.current.key);
    },
    onSuccess: (data) => {
      idemRef.current = { key: crypto.randomUUID(), payload: null };
      setCreatedId(data.id);
      setFormNotice(isPatient ? 'Solicitud registrada correctamente.' : 'Cita creada correctamente.');
      setFormErr(null);
      setSelectedSlot(null);
      setCreateReason('');
      // La cita ya existe: el asistente vuelve al principio para poder agendar otra.
      setBookingStep(1);
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
      void invalidateNotifications();
    },
    onError: (cause) => {
      setFormNotice(null);
      if (isPatient && cause instanceof ApiError && cause.body?.code === 'MEDICAL_ONBOARDING_REQUIRED') {
        navigate('/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1');
        return;
      }
      setFormErr(apiErrorMessage(cause, 'No se pudo crear la cita.'));
      if (cause instanceof ApiError && (/servicio/i.test(cause.message) || cause.fieldErrors.serviceId)) {
        setSelectedSlot(null);
        void servicesQuery.refetch();
      }
    },
    onSettled: () => { bookingSubmitting.current = false; },
  });

  if (!user) {
    return null;
  }

  function handleSlotPick(slot: AvailabilitySlotDto) {
    if (!formAvailReady) return;
    setSelectedSlot({ slot, criteria: availabilityCriteria });
    setFormErr(null);
  }

  /** Acción útil tras crear: limpia el borrador y devuelve el asistente al paso 1. */
  function resetBooking() {
    setFormNotice(null);
    setFormErr(null);
    setSelectedSlot(null);
    setCreateReason('');
    setCreatedId(null);
    create.reset();
    setBookingStep(1);
  }

  function changeAvailabilityCriteria(next: { dentist?: number | ''; day?: string; service?: number | '' }) {
    setSelectedSlot(null);
    if (next.dentist !== undefined) setCreateDentist(next.dentist);
    if (next.day !== undefined) setCreateDay(next.day);
    if (next.service !== undefined) setCreateService(next.service);
  }

  function handleCreate() {
    if (isDentist && bookingSubmitting.current) return;
    if (createService === '' || createDentistId === undefined || !selectionAvailable || create.isPending) return;
    const catalog = queryClient.getQueryState<typeof activeServices>(serviceQueryKey);
    if (catalog?.status !== 'success' || catalog.fetchStatus !== 'idle' ||
      !catalog.data?.some((item) => item.id === createService && item.durationMinutes === createDuration)) return;
    // Recheck the live query too: a refetch may start before React renders its loading state.
    const availability = queryClient.getQueryState<AvailabilityDto | null>([
      'availability', 'form', createDentistId, createDay, createDuration, createService,
    ]);
    if (availability?.status !== 'success' || availability.fetchStatus !== 'idle' ||
      availability.data?.durationMinutes !== createDuration ||
      !availability.data?.slots.some((slot) => slot.start === createStart && slot.end === createEnd)) return;
    const patientId = isPatient ? (user?.patientId ?? 0) : createPatient === '' ? 0 : Number(createPatient);
    if (patientId <= 0) return;
    const reason = createReason.trim();
    if (isDentist) bookingSubmitting.current = true;
    create.mutate({
      serviceId: createService,
      patientId,
      dentistId: createDentistId,
      startAt: createStart,
      endAt: createEnd,
      reason: reason === '' ? undefined : reason,
    });
  }

  function shift(delta: number) {
    if (effectiveView === 'day') {
      setCursor(addDays(cursor, delta));
    } else if (effectiveView === 'week') {
      setCursor(addDays(startOfWeek(cursor), delta * 7));
    } else {
      setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + delta, 1)));
    }
  }

  const createDisabled =
    createDentistId === undefined ||
    !selectionAvailable ||
    create.isPending ||
    (!isPatient && createPatient === '');

  const day = range.days[0];
  const weeklyClinicDay = clinicSchedule?.days.find((d) => d.dayOfWeek === isoWeekDay(day));
  const clinicException = publicSchedule.exceptions.find((entry) => entry.date === dayKey(day));
  const clinicDay = clinicException ? {
    dayOfWeek: isoWeekDay(day), open: !clinicException.closed,
    startTime: clinicException.startTime, endTime: clinicException.endTime,
    breaks: weeklyClinicDay?.breaks ?? [],
  } : weeklyClinicDay;
  const clinicOpen = Boolean(clinicDay?.open);
  const dailyAppointments = appointments.filter((appointment) => dayKey(new Date(appointment.startAt), timeZone) === dayKey(day));
  const starts = dailyAppointments.map((appointment) => minutesOfDay(new Date(appointment.startAt), timeZone));
  const ends = dailyAppointments.map((appointment, index) => starts[index] + appointment.durationMinutes);
  const windowStart = clinicDay?.startTime ? Math.min(parseClock(clinicDay.startTime), ...starts) : null;
  const windowEnd = clinicDay?.endTime ? Math.max(parseClock(clinicDay.endTime), ...ends) : null;
  const hasWindow = windowStart !== null && windowEnd !== null && windowEnd > windowStart;
  const windowHeight = hasWindow ? (windowEnd - windowStart) * PX_PER_MIN : 0;
  const hourStops: number[] = [];
  if (hasWindow) {
    for (let h = Math.ceil(windowStart / 60); h <= Math.floor((windowEnd - 1) / 60); h += 1) {
      hourStops.push(h);
    }
  }

  const servicePicker = <>
    <BookingServicePicker services={activeServices} selectedId={createService}
      onChange={(service) => changeAvailabilityCriteria({ service })}
      pending={servicesQuery.isPending || servicesQuery.isFetching} error={servicesQuery.isError}
      owner={role === 'OWNER'} reload={() => { setSelectedSlot(null); void servicesQuery.refetch(); }} />
    {serviceReady && formAvailSuccess && formAvail && formAvail.durationMinutes !== createDuration ? (
      <FormAlert>La duración del servicio cambió. Actualiza los servicios para volver a elegir un horario.</FormAlert>
    ) : null}
  </>;

  const agendaFilters = (
    <AgendaFilters
      dentists={dentists}
      dentistFilter={dentistFilter}
      myDentistId={myDentistId}
      isDentist={isDentist}
      statusFilter={statusFilter}
      onDentistChange={setDentistFilter}
      onStatusChange={setStatusFilter}
    />
  );

  const periodLabel = agendaPeriodLabel(effectiveView, range.days, cursor);

  return (
    <div className={isStaff ? 'reception-page reception-operations reception-agenda-page' : isPatient ? 'mx-auto w-full max-w-app px-5 py-8 md:px-8' : 'reception-page'}>
      {isStaff ? <StaffAgendaHeader period={periodLabel} timezone={timeZone} personal={isDentist} action={
        <button type="button" className={`reception-button${bookingOpen ? ' reception-button-secondary' : ''}`} disabled={isDentist && create.isPending} onClick={() => setBookingOpen(open => !open)}>{bookingOpen ? 'Volver a la agenda' : 'Crear cita'}</button>
      } /> : isPatient ? (
        <header>
          <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Citas</h1>
          <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
            Tus próximos tratamientos y solicitudes.
          </p>
        </header>
      ) : (
        <ReceptionPageHeader
          title="Citas"
          intro="Agenda de la clínica. Abre la creación guiada solo cuando necesites reservar."
          action={bookingOpen ? (
            <button type="button" className="reception-button reception-button-secondary" onClick={() => setBookingOpen(() => false)}>
              Volver a la agenda
            </button>
          ) : (
            <button type="button" className="reception-button" onClick={() => setBookingOpen(() => true)}>
              Crear cita
            </button>
          )}
        />
      )}
      {patientFilter !== null ? <p className="mt-3 text-ink-secondary">Filtro de paciente #{patientFilter}. <button type="button" className="min-h-11 underline" onClick={() => updateParameter('patientId', '')}>Quitar filtro de paciente</button></p> : null}
      {isPatient && statusFilter ? <p className="mt-3 text-ink-secondary">Estado: {statusLabel(statusFilter)}. <button type="button" className="min-h-11 underline" onClick={() => setStatusFilter('')}>Quitar filtro de estado</button></p> : null}

      <div className="agenda-navigation">
        {role === 'OWNER' ? <OwnerViewSwitch area="appointments" embedded /> : null}
        <StaffAgendaToolbar
          isDentist={isDentist}
          isOperational={isOperational}
          isStaff={isStaff}
          isPatient={isPatient}
          isMobile={isMobile}
          role={role}
          view={view}
          onView={setView}
          onShift={shift}
          onToday={() => setCursor(fromLocalDateInput(localDateInput(new Date(), timeZone)))}
          dateValue={localDateInput(cursor)}
          onDateChange={(value) => setCursor(fromLocalDateInput(value))}
          dentistFilter={dentistFilter}
          statusFilter={statusFilter}
          filters={agendaFilters}
          bookingOpen={bookingOpen}
          onToggleBooking={() => setBookingOpen((open) => !open)}
        />
      </div>

      {isStaff ? (
        <section
          className="reception-booking reception-card reception-booking--flat mt-6"
          data-open={bookingOpen ? 'true' : 'false'}
        >
          <h2 ref={bookingHeading} tabIndex={-1} className="text-[length:var(--text-h5)] text-ink outline-none">Nueva cita</h2>
          <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
            Agenda en tres pasos: primero el paciente y el servicio, después el horario y al final la revisión.
          </p>
          <BookingContext>{periodLabel} · Hora de la clínica · {timeZone}</BookingContext>
          {formNotice ? (
            <div className="mt-4 grid gap-3">
              <FormAlert tone="success">{formNotice}</FormAlert>
              <div className="reception-booking-actions">
                <button
                  type="button"
                  onClick={resetBooking}
                  className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Crear otra cita
                </button>
                {createdId !== null ? (
                  <Link
                    to={`/appointments/${createdId}${personal ? '?clinical=1&returnTo=%2Fappointments%3Fscope%3Dmine' : ''}`}
                    className="rounded-control bg-input-fill px-4 py-2 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Ver detalle de la cita
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
          {formErr ? <FormAlert>{formErr}</FormAlert> : null}

          <BookingStepRail current={bookingStep} hidden={isDentist && createdId !== null} />

          <BookingStep
            step={1}
            title="Paciente y servicio"
            active={bookingStep === 1}
            done={bookingStep > 1}
            hidden={isDentist && createdId !== null}
            headingRef={(node) => { stepHeadingRefs.current[1] = node; }}
            nav={(
              <button
                type="button"
                disabled={!stepOneReady}
                onClick={() => setBookingStep(2)}
                className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continuar
              </button>
            )}
          >
            <div className="mt-2">{servicePicker}</div>
            <div className="mt-4">
              <PatientPicker
                value={createPatient === '' ? null : createPatient}
                onChange={(id) => setCreatePatient(id === null ? '' : id)}
                onSelectedLabel={reportPatientLabel}
              />
            </div>
          </BookingStep>

          <BookingStep
            step={2}
            title="Fecha y horario"
            active={bookingStep === 2}
            done={bookingStep > 2}
            hidden={isDentist && createdId !== null}
            headingRef={(node) => { stepHeadingRefs.current[2] = node; }}
            onBack={() => setBookingStep(1)}
            nav={(
              <button
                type="button"
                disabled={!stepTwoReady}
                onClick={() => setBookingStep(3)}
                className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continuar
              </button>
            )}
          >
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
                Dentista
                <select
                  value={createDentist}
                  disabled={myDentistId !== undefined}
                  onChange={(e) => changeAvailabilityCriteria({ dentist: e.target.value === '' ? '' : Number(e.target.value) })}
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
                  onChange={(e) => changeAvailabilityCriteria({ day: e.target.value })}
                  className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              <div className="block">
                <span className="text-[length:var(--text-body-sm)] font-medium text-ink">Duración del servicio</span>
                <p aria-live="polite" className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
                  {createDuration === undefined ? 'Sin servicio seleccionado' : `${createDuration} minutos`}
                </p>
              </div>
            </div>

            <div className="mt-4">
              {!serviceReady || createDentistId === undefined ? (
                <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                  Selecciona un servicio activo y un dentista para ver los huecos disponibles.
                </p>
              ) : (
                <>
                  {formAvailLoading || formAvailFetching ? (
                    <p role="status" className="text-[length:var(--text-body-sm)] text-ink-muted">
                      Cargando disponibilidad…
                    </p>
                  ) : null}
                  {formAvailError ? (
                    <FormAlert>{apiErrorMessage(formAvailCause, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                  ) : null}
                  {formAvailReady && formAvail && formAvail.slots.length > 0 ? (
                      <AvailableSlots
                        slots={formAvail.slots}
                        selected={createStart}
                        onSelect={handleSlotPick}
                        label="Huecos disponibles"
                        editorial={{ timezone: timeZone, durationMinutes: formAvail.durationMinutes }}
                        className="flex flex-wrap gap-2"
                        buttonClassName="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    ) : null}
                  {formAvailReady && formAvail && formAvail.slots.length === 0 ? (
                    <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                      Sin huecos disponibles para esa combinación.
                    </p>
                  ) : null}
                </>
              )}
            </div>
            {createStart !== '' && createEnd !== '' ? (
              <p className="mt-3 text-[length:var(--text-body-sm)] text-ink">
                Seleccionado: {formatTime(createStart, timeZone)}–{formatTime(createEnd, timeZone)}
              </p>
            ) : null}
          </BookingStep>

          <BookingStep
            step={3}
            title="Motivo y confirmación"
            active={bookingStep === 3}
            done={bookingStep > 3}
            hidden={isDentist && createdId !== null}
            headingRef={(node) => { stepHeadingRefs.current[3] = node; }}
            onBack={() => setBookingStep(2)}
          >
            <BookingReview
              rows={[
                { label: 'Paciente', value: patientLabel ?? (createPatient === '' ? 'Sin seleccionar' : `Paciente #${createPatient}`) },
                { label: 'Servicio', value: selectedService ? `${selectedService.name} · ${createDuration ?? selectedService.durationMinutes} min` : 'Sin seleccionar' },
                { label: 'Dentista', value: createDentistName ? fullName(createDentistName.firstName, createDentistName.lastName) : 'Sin seleccionar' },
                { label: 'Fecha', value: createDay === '' ? 'Sin seleccionar' : formatDayLong(`${createDay}T12:00:00Z`, 'UTC') },
                { label: 'Horario', value: createStart !== '' && createEnd !== ''
                  ? `${formatTime(createStart, timeZone)}–${formatTime(createEnd, timeZone)}`
                  : 'Sin horario seleccionado' },
              ]}
            />
            <label className="mt-3 block text-[length:var(--text-body-sm)] font-medium text-ink">
              Motivo
              <input
                value={createReason}
                onChange={(e) => setCreateReason(e.target.value)}
                className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>

            <div className="reception-confirm">
              {createStart !== '' && createEnd !== '' ? (
                <button
                  type="button"
                  disabled={createDisabled}
                  onClick={handleCreate}
                  className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {create.isPending ? 'Reservando…' : 'Reservar cita'}
                </button>
              ) : (
                <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                  Elige un hueco disponible en el paso 2 para confirmar la cita.
                </p>
              )}
            </div>
          </BookingStep>
        </section>
      ) : null}

      {isPatient && bookingOpen ? (
        <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
          <h2 ref={bookingHeading} tabIndex={-1} className="text-[length:var(--text-h5)] text-ink outline-none">Solicitar cita</h2>
          {!user.patientId ? (
            <FormAlert>Completa tu perfil de paciente antes de reservar una cita.</FormAlert>
          ) : (
            <>
              {formNotice ? <FormAlert tone="success">{formNotice}</FormAlert> : null}
              {formErr ? <FormAlert>{formErr}</FormAlert> : null}
              <div className="mt-4">{servicePicker}</div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <label className="block text-[length:var(--text-body-sm)] font-medium text-ink">
                  Dentista
                  <select
                    value={createDentist}
                    onChange={(e) => changeAvailabilityCriteria({ dentist: e.target.value === '' ? '' : Number(e.target.value) })}
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
                    onChange={(e) => changeAvailabilityCriteria({ day: e.target.value })}
                    className="mt-1 w-full rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <div className="block">
                  <span className="text-[length:var(--text-body-sm)] font-medium text-ink">Duración del servicio</span>
                  <p aria-live="polite" className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
                    {createDuration === undefined ? 'Sin servicio seleccionado' : `${createDuration} minutos`}
                  </p>
                </div>
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
                {!serviceReady || createDentistId === undefined ? (
                  <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                    Selecciona un servicio activo y un dentista para ver los huecos disponibles.
                  </p>
                ) : (
                  <>
                    {formAvailLoading || formAvailFetching ? (
                      <p role="status" className="text-[length:var(--text-body-sm)] text-ink-muted">
                        Cargando disponibilidad…
                      </p>
                    ) : null}
                    {formAvailError ? (
                      <FormAlert>{apiErrorMessage(formAvailCause, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                    ) : null}
                    {formAvailReady && formAvail && formAvail.slots.length > 0 ? (
                      <AvailableSlots slots={formAvail.slots} selected={createStart} onSelect={handleSlotPick}
                        label="Huecos disponibles" className="flex flex-wrap gap-2"
                        buttonClassName="rounded-control bg-input-fill px-3 py-1.5 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary" />
                    ) : null}
                    {formAvailReady && formAvail && formAvail.slots.length === 0 ? (
                      <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                        Sin huecos disponibles para esa combinación.
                      </p>
                    ) : null}
                    {createStart !== '' && createEnd !== '' ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <p className="text-[length:var(--text-body-sm)] text-ink">
                          Seleccionado: {formatTime(createStart, timeZone)}–{formatTime(createEnd, timeZone)}
                        </p>
                        <button
                          type="button"
                          disabled={createDisabled || !user.patientId}
                          onClick={handleCreate}
                          className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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

      <section hidden={isDentist && bookingOpen} className={isStaff ? 'reception-agenda-results' : 'mt-6'} aria-live="polite">
        {isStaff && isMobile && role !== 'OWNER' ? <p className="mb-4 text-[length:var(--text-body-sm)] text-ink-secondary">Vista Día en móvil. Semana y Mes se conservan para pantallas amplias.</p> : null}
        {page && page.totalElements > appointments.length ? <p role="status">La agenda muestra {appointments.length} de {page.totalElements} citas. Acota las fechas o los filtros para consultar el resto.</p> : null}
        {isLoading ? (
          <div role="status" className={isOperational ? 'reception-agenda-loading' : 'rounded-card bg-paper p-5 ring-1 ring-hairline'}>
            <p className="text-[length:var(--text-body-sm)] text-ink-muted">Cargando citas…</p>
            {isOperational ? <div aria-hidden="true"><span /><span /><span /></div> : null}
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
            {!isDentist && !isError && appointments.length === 0 && !(isOperational && effectiveView === 'week') && !(isStaff && (isMobile || role === 'OWNER') && effectiveView === 'day') ? (
              <div className="rounded-card bg-paper p-5 text-center ring-1 ring-hairline">
                <p className="text-[length:var(--text-body-app)] text-ink">
                  {effectiveView === 'day' ? 'No hay citas para este día.' : 'No hay citas en este período.'}
                </p>
                <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
                  {isStaff ? 'Usa «Crear cita» para agendar la primera.' : 'Puedes solicitar una cita cuando lo necesites.'}
                </p>
              </div>
            ) : null}

            {appointments.length > 0 && isPatient ? (
              <PatientDayGroups days={range.days} appointments={appointments} onOpen={openAppointment} timeZone={timeZone} />
            ) : null}

            {role === 'OWNER' && !personal && effectiveView === 'day' ? <OwnerDayAgenda appointments={dailyAppointments} zone={timeZone} onOpen={openAppointment}
              scheduleLabel={!clinicSchedule || !clinicDay || (clinicOpen && !hasWindow) ? 'Configura el horario de la clínica para ver la disponibilidad del día.' : !clinicOpen ? 'La clínica no atiende este día; se conservan las citas existentes.' : `${clinicException ? 'Apertura especial de clínica' : 'Horario de clínica'}: ${clinicDay.startTime?.slice(0, 5)}–${clinicDay.endTime?.slice(0, 5)}.`} /> : null}
            {isDentist ? effectiveView === 'day' ? <DentistDayAgenda appointments={dailyAppointments} zone={timeZone} onOpen={openAppointment} dentistId={myDentistId!} date={day} breaks={clinicDay?.breaks ?? []}
              scheduleLabel={!clinicSchedule || !clinicDay ? 'No se pudo consultar el horario de la clínica.' : !clinicOpen ? 'La clínica está cerrada este día; se conservan las citas existentes.' : `Horario de clínica: ${clinicDay.startTime?.slice(0, 5)}–${clinicDay.endTime?.slice(0, 5)}.`} >
              {role === 'OWNER' ? <OwnerStartGroups appointments={dailyAppointments} zone={timeZone} onOpen={openAppointment} initialCount={dailyAppointments.length} /> : null}
            </DentistDayAgenda> :
              role === 'OWNER' ? effectiveView === 'month'
                ? <OwnerMonthCalendar days={range.days} appointments={appointments} zone={timeZone} today={today} date={date} exceptions={publicSchedule.exceptions} onOpen={openAppointment} onDay={openDay} personal onSelectDate={selectMonthDate} />
                : <OwnerWeekAgenda days={range.days} appointments={appointments} zone={timeZone} today={today} date={date} exceptions={publicSchedule.exceptions} onOpen={openAppointment} onDay={openDay} onSelectDate={setCursor} personal returnTo={agendaReturnTo()} />
                : <DentistCalendar mode={effectiveView} days={range.days} appointments={appointments} zone={timeZone} today={today} exceptions={publicSchedule.exceptions} onOpen={openAppointment} onDay={openDay} /> : null}
            {role !== 'OWNER' && !isDentist && isStaff && !isMobile && effectiveView === 'day' && (!clinicOpen || !hasWindow) && dailyAppointments.length > 0 ? (
              <ExistingAppointmentsPanel appointments={dailyAppointments} onOpen={openAppointment} timeZone={timeZone} operational={isOperational} />
            ) : null}
            {role !== 'OWNER' && !isDentist && isStaff && !isMobile && effectiveView === 'day' && clinicException && !clinicException.closed ? (
              <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                Apertura especial de clínica: {clinicException.startTime?.slice(0, 5)}–{clinicException.endTime?.slice(0, 5)}
              </p>
            ) : null}
            {isOperational && role !== 'OWNER' && isMobile && effectiveView === 'day' ? <ReceptionDayAgenda appointments={dailyAppointments} timezone={timeZone} onOpen={openAppointment} clinicConfigured={Boolean(clinicSchedule && clinicDay)} clinicOpen={clinicOpen} hasWindow={hasWindow} /> : role !== 'OWNER' && !isDentist && isStaff && isMobile && effectiveView === 'day' ? (
              <StaffDayAgenda
                appointments={dailyAppointments}
                timeZone={timeZone}
                onOpen={openAppointment}
                clinicConfigured={Boolean(clinicSchedule && clinicDay)}
                clinicOpen={clinicOpen}
                hasWindow={hasWindow}
              />
            ) : null}
            {!isDentist && isStaff && (!isMobile || role === 'OWNER') && effectiveView === 'day' ? (
              <DayFrame>{!clinicSchedule || !clinicDay || (clinicOpen && !hasWindow) ? (
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
                <DayColumns columns={columns} appointments={appointments} day={day} timeZone={timeZone}
                  role={role} isOperational={isOperational} createDuration={createDuration}
                  serviceReady={serviceReady} dayAvail={dayAvail} clinicDay={clinicDay}
                  windowStart={windowStart!} windowEnd={windowEnd!} windowHeight={windowHeight}
                  hourStops={hourStops} pxPerMinute={PX_PER_MIN} onOpen={openAppointment}
                  onBookSlot={(dentistId, slot) => {
                    setCreateDentist(dentistId);
                    setCreateDay(dayKey(day));
                    setSelectedSlot({ slot, criteria: JSON.stringify([dentistId, dayKey(day), createDuration, createService]) });
                    setBookingStep(2);
                    setFormErr(null);
                  }} />
              )}</DayFrame>
            ) : null}

            {isOperational && effectiveView === 'week' ? role === 'OWNER'
              ? <OwnerWeekAgenda days={range.days} appointments={appointments} zone={timeZone} today={today} date={date} exceptions={publicSchedule.exceptions} onOpen={openAppointment} onDay={openDay} onSelectDate={setCursor} personal={false} returnTo={agendaReturnTo()} />
              : <ReceptionWeekAgenda days={range.days} appointments={appointments} timezone={timeZone} today={today} exceptions={publicSchedule.exceptions} onSelectDay={openDay} returnTo={agendaReturnTo()} /> : !isDentist && isStaff && effectiveView === 'week' ? (
              <StaffWeekBoard days={range.days} appointments={appointments} timeZone={timeZone}
                exceptions={publicSchedule.exceptions} onOpen={openAppointment} onOpenDay={openDay} />
            ) : null}

            {role === 'OWNER' && !personal && effectiveView === 'month' ? <OwnerMonthCalendar days={range.days} appointments={appointments} zone={timeZone} today={today} date={date} exceptions={publicSchedule.exceptions} onOpen={openAppointment} onDay={openDay} personal={false} onSelectDate={selectMonthDate} /> : null}
            {role !== 'OWNER' && !isDentist && isStaff && effectiveView === 'month' ? (
              <StaffMonthBoard days={range.days} appointments={appointments} timeZone={timeZone}
                exceptions={publicSchedule.exceptions} onOpen={openAppointment} onOpenDay={openDay} isReception={isReception} />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
