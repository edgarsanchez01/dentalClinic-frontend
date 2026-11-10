import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { ApiError } from '../../api/http';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { formatDayLong, formatTime, fullName, statusChipClass, statusLabel } from '../appointments/appointmentUi';
import { primary, secondary } from '../financial/financialUi';
import { useNotifications } from '../notifications/notificationQueries';
import { dashboardPeriod, requireDashboardPage } from './dashboardData';
import { useDashboardClock } from './dashboardQueries';
import { careScope, patientRecordLink, type CareScope } from './careDashboardData';
import { useCareAppointments } from './careDashboardQueries';

const card = 'min-w-0 rounded-card border border-hairline bg-paper p-5 shadow-card';
const link = 'inline-flex min-h-11 items-center rounded-xs text-primary-ink underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-primary';
type QueryState = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

function DataBlock({ query, label, children }: { query: QueryState; label: string; children: ReactNode }) {
  if (query.isPending) return <div role="status" aria-label={`Cargando ${label}`} className="space-y-3 py-3">
    <span className="sr-only">Cargando {label}</span>
    <div aria-hidden="true" className="h-8 w-2/3 rounded-xs bg-sunken" />
    <div aria-hidden="true" className="h-4 w-full rounded-xs bg-sunken" />
  </div>;
  if (query.isError) return <div role="alert" className="mt-3 space-y-2">
    <p className="text-danger-ink">{query.error instanceof ApiError && query.error.status === 403
      ? `No tienes acceso a ${label}.` : `No se pudo cargar ${label}. Vuelve a intentarlo.`}</p>
    <button type="button" className={link} onClick={() => void query.refetch()}>Reintentar {label}</button>
  </div>;
  return children;
}

export function DentistDashboard() { return <CareDashboard dentist />; }
export { PatientDashboard } from '../patient/PatientDashboard';

function CareDashboard({ dentist }: { dentist: boolean }) {
  const user = useAuthStore(state => state.user);
  const scope = careScope(user);
  const now = useDashboardClock();
  const policy = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy, retry: false });
  const period = policy.isError ? null : dashboardPeriod(now, policy.data?.timezone);
  const timezone = period ? policy.data?.timezone : undefined;
  const agenda = period ? `/appointments?view=day&date=${period.date}${dentist && scope ? `&dentistId=${scope.id}` : ''}` : '/appointments';

  return <div className="min-w-0 space-y-6 px-4 py-6 text-[length:var(--text-body-app)] md:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[length:var(--text-h3)] font-semibold tracking-[-0.025em]">{dentist ? 'Mi jornada clínica' : 'Tu atención dental'}</h1>
        <p className="mt-2 text-ink-secondary">{dentist ? 'Tus pacientes de hoy y la siguiente atención.' : 'Consulta tus próximas visitas y reserva un horario.'}</p>
        {timezone ? <p className="mt-2 break-words text-ink-secondary">{formatDayLong(new Date(now).toISOString(), timezone)} · {timezone}</p> : null}
      </div>
      <Link to={dentist ? agenda : '/appointments?create=1'} className={`${primary} inline-flex items-center`}>
        {dentist ? 'Consultar mi agenda' : 'Agendar una cita'}
      </Link>
    </header>

    {!scope ? <section aria-label="Perfil vinculado" className={card}>
      <p role="alert">{dentist ? 'Tu cuenta no tiene un perfil profesional vinculado. Contacta con el propietario.'
        : 'Tu cuenta no tiene una ficha de paciente vinculada. Contacta con la clínica antes de reservar.'}</p>
    </section> : null}
    {!period ? <section aria-label="Zona horaria" className={card}>
      <DataBlock query={policy} label="zona horaria">
        <p role="status">La zona horaria de la clínica no está disponible o no es válida. No mostraremos fechas con una zona distinta.</p>
        <button type="button" className={`${link} mt-2`} onClick={() => void policy.refetch()}>Volver a consultar zona horaria</button>
      </DataBlock>
    </section> : null}

    <div className={`grid min-w-0 items-start gap-4 ${dentist ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}`}>
      <NextVisits scope={scope} now={now} timezone={timezone} dentist={dentist} />
      {dentist && scope && period && timezone ? <DayAgenda key={`${scope.id}-${period.date}`} scope={scope} period={period} timezone={timezone} agenda={agenda} /> : null}
    </div>

    {!dentist ? <nav aria-label="Acciones rápidas" className="grid gap-2 sm:grid-cols-3">
      <Link to="/appointments" className={`${secondary} inline-flex items-center`}>Consultar mis citas e historial</Link>
      <Link to={scope ? `/patients/${scope.id}` : '/patients'} className={`${secondary} inline-flex items-center`}>Consultar mis datos</Link>
      <Link to="/notifications" className={`${secondary} inline-flex items-center`}>Consultar mis notificaciones</Link>
    </nav> : null}
    <CareNotifications timezone={timezone} />
  </div>;
}

function AppointmentSummary({ appointment, timezone, dentist, featured = false, day = false }: {
  appointment: AppointmentResponse; timezone: string; dentist: boolean; featured?: boolean; day?: boolean;
}) {
  return <div className="min-w-0 space-y-2">
    {dentist ? <p className={`${featured ? 'text-[length:var(--text-h4)]' : ''} break-words font-medium`}>
      {fullName(appointment.patientFirstName, appointment.patientLastName)}
    </p> : null}
    <time dateTime={appointment.startAt} className={`block font-mono tabular-nums ${featured && !dentist ? 'text-[length:var(--text-h5)]' : ''}`}>
      {!day ? <>{formatDayLong(appointment.startAt, timezone)}<br /></> : null}
      {formatTime(appointment.startAt, timezone)} – {formatTime(appointment.endAt, timezone)}
    </time>
    {appointment.service?.name ? <p className="break-words">Servicio: {appointment.service.name}</p> : null}
    {!dentist && (appointment.dentistFirstName || appointment.dentistLastName) ? <p className="break-words text-ink-secondary">
      Odontólogo: {fullName(appointment.dentistFirstName, appointment.dentistLastName)}
    </p> : null}
    <span className={`inline-flex rounded-control px-2 py-1 text-[length:var(--text-caption)] ${appointment.status === 'CANCELLED' ? 'bg-sunken text-ink-secondary line-through' : statusChipClass(appointment.status)}`}>{statusLabel(appointment.status)}</span>
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <Link className={link} to={`/appointments/${appointment.id}`}>{dentist ? 'Abrir cita' : 'Ver mi cita'}</Link>
      {dentist ? <Link className={link} to={patientRecordLink(appointment)}>Abrir expediente</Link> : null}
    </div>
  </div>;
}

function NextVisits({ scope, now, timezone, dentist }: { scope: CareScope | null; now: number; timezone: string | undefined; dentist: boolean }) {
  const visits = useCareAppointments(scope, { from: new Date(now).toISOString(), status: 'SCHEDULED', page: 0, size: dentist ? 1 : 5 }, !!timezone);
  const first = visits.data?.content[0];
  return <section aria-label={dentist ? 'Próxima cita propia' : 'Tu próxima cita'} className={card}>
    <h2 className="text-[length:var(--text-h5)] font-semibold">{dentist ? 'Siguiente paciente' : 'Tu próxima cita'}</h2>
    {!scope || !timezone ? <p className="mt-3 text-ink-secondary">Las citas se mostrarán cuando estén disponibles tu perfil y la zona de la clínica.</p>
      : <DataBlock query={visits} label="próximas citas">
        {visits.data?.totalElements === 0 ? <div className="mt-3 space-y-3">
          <p>{dentist ? 'No tienes próximas citas programadas.' : 'Aún no tienes próximas citas. Elige un horario disponible para tu siguiente visita.'}</p>
          <Link className={link} to={dentist ? '/appointments' : '/appointments?create=1'}>{dentist ? 'Revisar mi agenda' : 'Reservar un horario'}</Link>
        </div> : first ? <div className="mt-4">
          <AppointmentSummary appointment={first} timezone={timezone} dentist={dentist} featured />
          {visits.data!.content.length > 1 ? <div className="mt-6">
            <h3 className="font-semibold">{dentist ? 'Después en tu agenda' : 'Tus siguientes citas'}</h3>
            <ul className="mt-2 divide-y divide-hairline">{visits.data!.content.slice(1).map(appointment => <li key={appointment.id} className="py-4">
              <AppointmentSummary appointment={appointment} timezone={timezone} dentist={dentist} />
            </li>)}</ul>
          </div> : null}
          <p className="mt-3 text-ink-secondary">Primeras {visits.data!.content.length} de {visits.data!.totalElements} citas futuras programadas · {timezone}.</p>
          {visits.data!.totalElements > visits.data!.content.length ? <p className="mt-2 text-ink-secondary">La lista es parcial. Consulta {dentist ? 'tu agenda' : 'tus citas'} para ver las demás.</p> : null}
        </div> : null}
      </DataBlock>}
    {dentist ? <p className="mt-3 text-ink-secondary">Notas, tratamientos y odontograma están disponibles dentro de la cita o el expediente autorizado. Dato de salud protegido.</p> : null}
  </section>;
}

type Period = NonNullable<ReturnType<typeof dashboardPeriod>>;
function DayAgenda({ scope, period, timezone, agenda }: { scope: CareScope; period: Period; timezone: string; agenda: string }) {
  const [page, setPage] = useState(0);
  const scheduled = useCareAppointments(scope, { ...period.day, status: 'SCHEDULED', page: 0, size: 1 }, true);
  const visits = useCareAppointments(scope, { ...period.day, page, size: 5 }, true);
  return <section aria-label="Mi agenda de hoy" className={card}>
    <h2 className="text-[length:var(--text-h5)] font-semibold">Mi agenda de hoy</h2>
    <DataBlock query={scheduled} label="citas programadas hoy">
      <p className="mt-3"><strong className="font-mono text-[length:var(--text-h4)] tabular-nums">{scheduled.data?.totalElements}</strong> citas que siguen programadas hoy</p>
    </DataBlock>
    <DataBlock query={visits} label="agenda de hoy">
      {visits.data?.totalElements === 0 ? <p className="mt-3">No tienes citas para hoy. Puedes consultar otros días en tu agenda.</p>
        : <>
          <p className="mt-3 text-ink-secondary">{visits.data?.totalElements} citas del día · incluye programadas, completadas, canceladas y ausencias.</p>
          {visits.data?.content.length === 0 ? <p className="mt-3">Esta página ya no tiene citas. Vuelve a la página anterior o abre tu agenda.</p> : null}
          <ul className="mt-2 divide-y divide-hairline">{visits.data?.content.map(appointment => <li key={appointment.id} className="py-3">
            <AppointmentSummary appointment={appointment} timezone={timezone} dentist day />
          </li>)}</ul>
        </>}
    </DataBlock>
    <nav aria-label="Páginas de mi agenda" className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className={secondary} disabled={page === 0 || visits.isFetching} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span role="status">Página {page + 1}{!visits.isError && visits.data?.totalPages ? ` de ${visits.data.totalPages}` : ''}</span>
      <button type="button" className={secondary} disabled={visits.isFetching || visits.isError || !visits.data || page + 1 >= visits.data.totalPages}
        onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </nav>
    <Link className={`${link} mt-3`} to={agenda}>Ver agenda completa del día</Link>
  </section>;
}

function CareNotifications({ timezone }: { timezone: string | undefined }) {
  const notifications = useNotifications({ page: 0, size: 5 });
  let invalid = false;
  if (notifications.data) {
    try { requireDashboardPage(notifications.data); } catch { invalid = true; }
  }
  return <section aria-label="Notificaciones personales" className={card}>
    <h2 className="text-[length:var(--text-h5)] font-semibold">Tus notificaciones</h2>
    <DataBlock query={{ ...notifications, isError: notifications.isError || invalid }} label="notificaciones personales">
      {notifications.data?.totalElements === 0 ? <p className="mt-3">No tienes notificaciones todavía.</p>
        : <>
          <p className="mt-3 text-ink-secondary">Avisos recientes de tu bandeja personal. Abre la bandeja para consultar su contenido.</p>
          <ul className="mt-2 divide-y divide-hairline">{notifications.data?.content.map((notification, index) => <li key={notification.id} className="flex flex-wrap justify-between gap-2 py-3">
            <p>Aviso {index + 1} · {notification.read ? 'Leído' : 'No leído'}</p>
            {timezone && Number.isFinite(Date.parse(notification.createdAt)) ? <time dateTime={notification.createdAt} className="text-ink-secondary">
              {formatDayLong(notification.createdAt, timezone)} · {formatTime(notification.createdAt, timezone)}
            </time> : null}
          </li>)}</ul>
          <p className="mt-2 text-ink-secondary">Mostrando hasta 5 avisos de {notifications.data?.totalElements}.</p>
        </>}
    </DataBlock>
    <Link className={`${link} mt-3`} to="/notifications">Abrir mis notificaciones</Link>
  </section>;
}
