import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { clinicApi } from '../../api/clinic';
import { feedbackApi } from '../../api/feedback';
import { usersApi } from '../../api/users';
import { ApiError } from '../../api/http';
import { formatSignedMoney } from '../../lib/financialMoney';
import { dayKey, formatDayLong, formatTime, fullName, sortAppointments } from '../appointments/appointmentUi';
import { patientRecordLink } from './careDashboardData';
import { useCashFlowReport, usePortfolioReport } from '../financial/financialQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { dashboardPeriod, pendingStaff } from './dashboardData';
import { useDashboardAppointments, useDashboardClock } from './dashboardQueries';
import { ReceptionPageHeader, ReceptionQueryState } from '../reception/ReceptionUI';
import { ReceptionVisit } from '../reception/ReceptionVisit';
import { DentistStatusChip } from '../dentist/DentistVisit';
import '../reception/reception-operations.css';

export { ReceptionistDashboard } from '../reception/ReceptionDashboard';
type QueryState = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
type VisitsQuery = ReturnType<typeof useDashboardAppointments>;
type Period = ReturnType<typeof dashboardPeriod>;

function DataBlock({ query, label, children }: { query: QueryState; label: string; children: ReactNode }) {
  if (query.isError) return <div role="alert" className="reception-empty">
    <p>{query.error instanceof ApiError && query.error.status === 403
      ? `No tienes acceso a ${label}.` : `No se pudo cargar ${label}. No hay datos confirmados para mostrar.`}</p>
    <button type="button" className="reception-link" onClick={() => void query.refetch()}>Reintentar {label}</button>
  </div>;
  return <ReceptionQueryState query={query} label={label}>{children}</ReceptionQueryState>;
}

function money(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  try { return formatSignedMoney(value); } catch { return null; }
}

function Metric({ title, query, value, hint, to, unavailable = false }: {
  title: string; query: QueryState; value: ReactNode; hint: ReactNode; to: string;
  unavailable?: boolean;
}) {
  return <section aria-label={title} className="reception-today-sheet">
      <h3>{title}</h3>
      {unavailable ? <p className="font-mono text-2xl py-3">No disponible</p> : <DataBlock query={query} label={title.toLocaleLowerCase('es')}>
        <p className="font-mono text-2xl py-3">{value == null ? 'No disponible' : value}</p>
      </DataBlock>}
    {!query.isError && !query.isPending ? <p className="reception-operation-caption">{hint}</p> : null}
    <Link to={to} className="reception-link">Consultar {title.toLocaleLowerCase('es')}</Link>
  </section>;
}

/** OWNER / Clínica only. Personal activity and all other role surfaces are unchanged. */
export function OwnerDashboard() {
  const now = useDashboardClock();
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: clinicApi.get, retry: false });
  const period = dashboardPeriod(now, clinic.isError ? undefined : clinic.data?.timezone);
  const timezone = period ? clinic.data?.timezone : undefined;
  const today = useDashboardAppointments({ ...period?.day, page: 0, size: 6 }, !!period);
  const next = useDashboardAppointments({ from: new Date(now).toISOString(), status: 'SCHEDULED', page: 0, size: 5 }, !!period);
  // A separate bounded page after today's clinical boundary avoids repeating today's visits.
  const later = useDashboardAppointments({ ...(period ? { from: period.day.to } : {}), status: 'SCHEDULED', page: 0, size: 3 }, !!period);
  const portfolio = usePortfolioReport(true);
  const agenda = period ? `/appointments?view=day&date=${period.date}` : '/appointments';
  const todayTo = period ? `${agenda}&status=SCHEDULED` : '/appointments';
  const fullDay = today.data && today.data.page === 0 && today.data.content.length === today.data.totalElements
    && today.data.content.every(a => ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status));
  const summary = fullDay && today.data!.totalElements > 0 ? todayStatusSummary(today.data!.content) : null;

  return <div className="reception-operations reception-desk">
    <ReceptionPageHeader title="Resumen de la clínica" intro="La actividad de hoy y el estado general de la clínica." />
    <section className="reception-journal-cover" aria-label="Contexto de la clínica">
      <div><h2 className="reception-cover-message">{clinic.data?.name ?? 'Tu clínica'}</h2><p>Agenda, equipo y seguimiento administrativo.</p></div>
      <div className="reception-cover-day">
        <p>{period && timezone ? <time dateTime={period.date}>{formatDayLong(new Date(now).toISOString(), timezone)}</time> : 'Fecha clínica no disponible'}</p>
        {timezone ? <span>Hora de la clínica · {timezone}</span> : null}
        <Link to="/appointments?create=1" className="reception-button">Crear cita</Link>
      </div>
    </section>

    {!period ? <section aria-label="Zona horaria" className="reception-operation-notice">
      <DataBlock query={clinic} label="zona horaria">
        <p role="status">La zona horaria no está disponible o no es válida. Las citas de hoy y los cobros del mes no se calcularán con otra zona.</p>
        <button type="button" className="reception-link" onClick={() => void clinic.refetch()}>Volver a consultar zona horaria</button>
      </DataBlock>
    </section> : null}

    <div className="grid min-w-0 gap-6 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Citas de hoy" query={today} value={today.data?.totalElements} unavailable={!period}
        hint={summary ?? (today.data?.totalElements === 0 ? 'Sin citas registradas hoy.' : 'Todas las citas del día, en sus cuatro estados.')} to={agenda} />
      <Metric title="Cartera pendiente" query={portfolio} value={money(portfolio.data?.pendingBalance)}
        hint="Saldo vigente de los cargos confirmados, no facturación mensual." to="/finances/reports?tab=cartera" />
      <OwnerMetrics period={period} />
    </div>

    <div className="reception-journal-grid">
      <TodayAgenda query={today} timezone={timezone} agenda={agenda} />
      <NextPatient query={next} now={now} timezone={timezone} agenda={agenda} />
    </div>
    <OwnerFinance period={period} />
    <div className="grid min-w-0 gap-8 lg:grid-cols-2">
      <UpcomingAppointments query={later} timezone={timezone} period={period} />
      <PersonalNotifications timezone={timezone} />
      <OwnerTeam />
    </div>
    <nav aria-label="Acciones rápidas" className="flex flex-wrap gap-x-6 gap-y-2">
      <Link className="reception-link" to="/patients?create=1">Registrar paciente</Link><Link className="reception-link" to={todayTo}>Consultar agenda</Link>
      <Link className="reception-link" to="/patients">Consultar pacientes</Link><Link className="reception-link" to="/users">Consultar equipo</Link>
      <Link className="reception-link" to="/finances">Consultar finanzas</Link><Link className="reception-link" to="/finances/reports">Consultar reportes</Link>
    </nav>
  </div>;
}

function todayStatusSummary(visits: AppointmentResponse[]) {
  return ([['COMPLETED', 'completada', 'completadas'], ['SCHEDULED', 'programada', 'programadas'],
    ['CANCELLED', 'cancelada', 'canceladas'], ['NO_SHOW', 'ausencia', 'ausencias']] as const)
    .map(([status, singular, plural]) => { const count = visits.filter(a => a.status === status).length; return `${count} ${count === 1 ? singular : plural}`; }).join(' · ');
}

function OwnerMetrics({ period }: { period: Period }) {
  const cash = useCashFlowReport(period?.month ?? {}, !!period);
  const reviews = useQuery({ queryKey: ['feedback-reviews', 0], queryFn: () => feedbackApi.reviews(0), retry: false });
  const count = reviews.data?.count, average = reviews.data?.average;
  return <>
    <Metric title="Cobrado este mes" query={cash} value={money(cash.data?.grossAmount)} unavailable={!period}
      hint="Cobros brutos por fecha de movimiento; reversas por separado." to={cashLink(period)} />
    <Metric title="Evaluación global" query={reviews} to="/reviews"
      value={count && typeof average === 'number' && Number.isFinite(average) ? `${average.toLocaleString('es-MX', { maximumFractionDigits: 2 })} / 5` : null}
      hint={count === 0 ? 'Aún no hay evaluaciones respondidas.' : typeof count === 'number' ? `Promedio del servidor sobre ${count} evaluaciones respondidas.` : 'Sin datos suficientes para mostrar el promedio.'} />
  </>;
}

function cashLink(period: Period) {
  return period ? `/finances/reports?tab=cobros&${new URLSearchParams(period.month)}` : '/finances/reports?tab=cobros';
}

function SectionHeading({ title, to, action }: { title: string; to?: string; action?: string }) {
  return <div className="reception-sheet-heading"><h2>{title}</h2>{to ? <Link className="reception-link" to={to}>{action ?? 'Ver todas'}</Link> : null}</div>;
}

function Status({ appointment }: { appointment: AppointmentResponse }) {
  return <DentistStatusChip status={appointment.status} />;
}

function TodayAgenda({ query, timezone, agenda }: { query: VisitsQuery; timezone: string | undefined; agenda: string }) {
  return <section aria-label="Agenda de hoy" className="reception-today-sheet">
    <SectionHeading title="Agenda de hoy" to={agenda} action="Ver agenda completa" />
    <p className="reception-operation-caption">Tus citas del día, en orden cronológico.</p>
    {timezone ? <DataBlock query={query} label="agenda de hoy">
      {query.data?.totalElements === 0 ? <div className="reception-quiet-day"><h3>No hay citas para hoy</h3><p>Consulta otra fecha o crea una cita para revisar los horarios reales.</p></div>
        : !query.data?.content.length ? <p className="reception-operation-notice">Hay citas registradas, pero no se recibió el detalle de esta página. Abre la agenda para consultarlas.</p>
          : <ol className="reception-day-visits">{sortAppointments(query.data.content).map(a => <li key={a.id}>
            <ReceptionVisit appointment={a} timezone={timezone} />
          </li>)}</ol>}
      {query.data && query.data.totalElements > query.data.content.length ? <p className="reception-operation-caption">Mostrando {query.data.content.length} de {query.data.totalElements} citas del día. <Link className="reception-link" to={agenda}>Consultar el resto de citas de hoy</Link></p> : null}
    </DataBlock> : <p className="reception-operation-caption">La agenda se mostrará cuando esté disponible la zona horaria de la clínica.</p>}
  </section>;
}

function NextPatient({ query, now, timezone, agenda }: { query: VisitsQuery; now: number; timezone: string | undefined; agenda: string }) {
  const data = query.data;
  // Page zero is chronologically ordered by the existing endpoint. Do not name a
  // next patient if the received page contradicts that contract or omits its detail.
  const valid = data?.page === 0 && data.content.every((a, i, list) => a.status === 'SCHEDULED' && Number.isFinite(Date.parse(a.startAt))
    && Date.parse(a.startAt) >= now && (i === 0 || a.startAt >= list[i - 1].startAt));
  const first = valid ? data.content[0] : undefined;
  const record = first && Number.isSafeInteger(first.patientId) && first.patientId > 0 && Number.isSafeInteger(first.occurrenceVersion) && first.occurrenceVersion > 0;
  return <section aria-label="Siguiente paciente" className="reception-next-sheet">
    <SectionHeading title="Siguiente paciente" />
    {timezone ? <DataBlock query={query} label="siguiente paciente">
      {first ? <>
        <p className="reception-operation-caption">{dayKey(new Date(first.startAt), timezone) === dayKey(new Date(now), timezone) ? 'Hoy' : formatDayLong(first.startAt, timezone)}</p>
        <div className="reception-next-visit"><time dateTime={first.startAt}><strong>{formatTime(first.startAt, timezone)}</strong><span>Fin: {formatTime(first.endAt, timezone)}</span></time>
          <div><h3>{fullName(first.patientFirstName, first.patientLastName)}</h3><p>{first.service?.name ?? 'Sin servicio asociado'}</p><Status appointment={first} /></div></div>
        <p className="reception-operation-caption">{fullName(first.dentistFirstName, first.dentistLastName)}</p>
        <div className="flex flex-wrap gap-4"><Link className="reception-link" to={`/appointments/${first.id}`}>Abrir cita</Link>{record ? <Link className="reception-link" to={patientRecordLink(first)}>Abrir expediente</Link> : null}</div>
      </> : <div className="reception-quiet-day"><p>{data?.totalElements === 0 ? 'No hay próximas citas programadas. Puedes crear una desde la agenda.' : 'No se pudo identificar la siguiente cita con la información recibida.'}</p><Link className="reception-link" to={agenda}>Consultar agenda completa</Link></div>}
    </DataBlock> : <p className="reception-operation-caption">Se necesita la zona horaria de la clínica para identificar la siguiente cita.</p>}
  </section>;
}

function OwnerFinance({ period }: { period: Period }) {
  const cash = useCashFlowReport(period?.month ?? {}, !!period);
  return <section aria-label="Resumen financiero" className="reception-portfolio-strip">
    <SectionHeading title="Resumen financiero del mes" to={cashLink(period)} action="Ver reporte" />
    {period ? <DataBlock query={cash} label="resumen financiero"><dl className="grid gap-6 py-5 sm:grid-cols-3">
      {([['Cobros brutos', cash.data?.grossAmount], ['Reversas del período', cash.data?.reversalAmount], ['Cobro neto', cash.data?.netAmount]] as const)
         .map(([label, value]) => <div key={label}><dt className="reception-operation-caption">{label}</dt><dd className="font-mono text-2xl mt-2">{money(value) ?? 'No disponible'}</dd></div>)}
    </dl><details><summary className="reception-link">Cómo se calcula</summary><p>Del inicio al fin del mes en la zona de la clínica. El neto descuenta las reversas registradas en ese período y puede ser negativo. No representa cargos facturados.</p></details>
    </DataBlock> : <p className="reception-operation-caption">Sin zona horaria válida no se puede delimitar el mes.</p>}
  </section>;
}

function UpcomingAppointments({ query, timezone, period }: { query: VisitsQuery; timezone: string | undefined; period: Period }) {
  const data = query.data;
  return <section aria-label="Próximas citas" className="reception-patient-access">
    <SectionHeading title="Próximas citas" to="/appointments?status=SCHEDULED" />
    {timezone && period ? <DataBlock query={query} label="próximas citas">
      <p className="reception-operation-caption">Desde {formatDayLong(period.day.to, timezone)}. Las de hoy están en la agenda superior.</p>
      {data?.totalElements === 0 ? <p className="reception-operation-caption">No hay citas programadas después de hoy.</p> : !data?.content.length ? <p className="reception-operation-caption">Hay {data?.totalElements} citas futuras programadas, pero no se recibió el detalle de esta página. Abre la agenda para consultarlas.</p> : <>
        <ul className="reception-day-visits">{data.content.map(a => <li key={a.id}>
          <p className="reception-operation-caption pt-4">{formatDayLong(a.startAt, timezone)}</p><ReceptionVisit appointment={a} timezone={timezone} />
        </li>)}</ul>
        <p className="reception-operation-caption">Primeras {data.content.length} de {data.totalElements} citas futuras programadas.{data.totalElements > data.content.length ? ' La lista es parcial. Consulta la agenda para ver las demás citas.' : ''}</p>
      </>}
    </DataBlock> : <p className="reception-operation-caption">Se necesita la zona horaria de la clínica para mostrar las citas.</p>}
  </section>;
}

function PersonalNotifications({ timezone }: { timezone: string | undefined }) {
  const notifications = useNotifications({ page: 0, size: 5 });
  return <section aria-label="Notificaciones personales" className="reception-desk-notifications">
    <SectionHeading title="Notificaciones recientes" to="/notifications" />
    <DataBlock query={notifications} label="notificaciones personales">
      {!Array.isArray(notifications.data?.content) ? <p className="reception-operation-caption">La respuesta de notificaciones está incompleta. Abre la bandeja para volver a consultar.</p>
        : notifications.data.content.length === 0 ? <p className="reception-operation-caption">No tienes notificaciones todavía.</p> : <ul>
          {notifications.data.content.slice(0, 3).map(n => <li key={n.id} data-unread={!n.read}>
            <h3>{n.title}</h3><p>{n.body}</p><p className="reception-operation-caption">{n.read ? 'Leída' : 'No leída'}{timezone ? <> · <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString('es-ES', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' })}</time></> : null}</p>
          </li>)}
        </ul>}
    </DataBlock>
  </section>;
}

function OwnerTeam() {
  const users = useQuery({ queryKey: ['users'], queryFn: usersApi.list, retry: false });
  const pending = users.data ? pendingStaff(users.data) : null;
  return <section aria-label="Personal pendiente de activación" className="reception-patient-access">
    <SectionHeading title="Pendientes del equipo" to="/users" action="Revisar equipo" />
    <DataBlock query={users} label="personal pendiente de activación">
      <p>{pending === null ? 'El contrato recibido no permite distinguir invitaciones pendientes de cuentas desactivadas.'
         : pending === 0 ? 'No hay personal pendiente de activación.' : pending === 1 ? '1 cuenta de personal pendiente de activar su invitación.' : `${pending} cuentas de personal pendientes de activar su invitación.`}</p>
    </DataBlock>
  </section>;
}
