import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { schedulingApi } from '../../api/scheduling';
import { formatSignedMoney } from '../../lib/financialMoney';
import { dayKey, formatDayLong, formatTime, fullName } from '../appointments/appointmentUi';
import { dashboardPeriod } from '../dashboard/dashboardData';
import { useDashboardAppointments, useDashboardClock } from '../dashboard/dashboardQueries';
import { usePortfolioReport } from '../financial/financialQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { ReceptionPageHeader, ReceptionQueryState } from './ReceptionUI';
import { ReceptionVisit } from './ReceptionVisit';
import './reception-operations.css';

function money(value: string | undefined) {
  try { return value === undefined ? 'No disponible' : formatSignedMoney(value); }
  catch { return 'No disponible'; }
}

/** Operations-only composition. All periods, totals and statuses retain their existing source. */
export function ReceptionistDashboard() {
  const now = useDashboardClock();
  const policy = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy, retry: false });
  const timezone = policy.isError ? undefined : policy.data?.timezone;
  const period = dashboardPeriod(now, timezone);
  const count = useDashboardAppointments({ ...period?.day, status: 'SCHEDULED', page: 0, size: 1 }, !!period);
  const today = useDashboardAppointments({ ...period?.day, status: 'SCHEDULED', page: 0, size: 6 }, !!period);
  const upcoming = useDashboardAppointments({ from: new Date(now).toISOString(), status: 'SCHEDULED', page: 0, size: 5 }, !!period);
  const portfolio = usePortfolioReport(true);
  const notifications = useNotifications({ page: 0, size: 5 });
  const todayTo = period ? `/appointments?view=day&date=${period.date}&status=SCHEDULED` : '/appointments';
  const first = upcoming.data?.content[0];

  return <div className="reception-operations reception-desk">
    <ReceptionPageHeader title="Recepción" intro="Agenda, pacientes y seguimiento de cobros de la clínica." />
    <section className="reception-journal-cover" aria-labelledby="reception-day-context">
      <div>
        <h2 id="reception-day-context" className="reception-cover-message">La jornada, en orden.</h2>
        <p>Coordina las atenciones de hoy y prepara las que vienen.</p>
      </div>
      <div className="reception-cover-day">
        <p>{period && timezone ? formatDayLong(new Date(now).toISOString(), timezone) : 'Fecha clínica no disponible'}</p>
        {period && timezone ? <span>Hora de la clínica · {timezone}</span> : null}
        <Link to="/appointments?create=1" className="reception-button">Crear cita</Link>
      </div>
    </section>

    {!period ? <section aria-label="Zona horaria" className="reception-operation-notice">
      <ReceptionQueryState query={policy} label="zona horaria">
        <p role="status">La zona horaria no está disponible o no es válida. Las citas de hoy no se calcularán con otra zona.</p>
        <button className="reception-link" onClick={() => void policy.refetch()}>Volver a consultar zona horaria</button>
      </ReceptionQueryState>
    </section> : null}

    <div className="reception-journal-grid">
      <section aria-label="Agenda de hoy" className="reception-today-sheet">
        <div className="reception-sheet-heading">
          <h2>Agenda de hoy</h2>
          <section aria-label="Citas programadas hoy" className="reception-day-total">
            {period ? <ReceptionQueryState query={count} label="citas programadas hoy">
              <strong>{count.data?.totalElements ?? 'No disponible'}</strong><span>programadas</span>
            </ReceptionQueryState> : <span>Sin fecha clínica</span>}
          </section>
        </div>
        <p className="reception-operation-caption">Citas en estado Programada de todo el día, incluidas las horas que ya pasaron.</p>
        {period && timezone ? <ReceptionQueryState query={today} label="agenda de hoy">
          {today.data?.totalElements === 0 ? <div className="reception-quiet-day">
            <h3>Una jornada por organizar</h3>
            <p>No hay citas programadas hoy. Puedes crear una cita o consultar otra fecha en la agenda.</p>
          </div> : today.data?.content.length ? <>
            <ul className="reception-day-visits">{today.data.content.map(appointment => <li key={appointment.id}>
              <ReceptionVisit appointment={appointment} timezone={timezone} />
            </li>)}</ul>
            {today.data.totalElements > today.data.content.length ? <p className="reception-operation-caption">Mostrando {today.data.content.length} de {today.data.totalElements} citas de hoy. La agenda contiene el resto.</p> : null}
          </> : <p className="reception-operation-notice">Hay citas programadas, pero no se recibió el detalle de esta página. Consulta la agenda.</p>}
        </ReceptionQueryState> : null}
        <Link to={todayTo} className="reception-link reception-sheet-footer">Consultar agenda</Link>
      </section>

      <section aria-label="Próximas citas" className="reception-next-sheet">
        <h2>A partir de ahora</h2>
        <p className="reception-operation-caption">Próximas atenciones, desde este momento.</p>
        {period && timezone ? <ReceptionQueryState query={upcoming} label="próximas citas">
          {first ? <>
            <div className="reception-next-visit">
              <time dateTime={first.startAt}>
                <span>{dayKey(new Date(first.startAt), timezone) === period.date ? 'Hoy' : new Date(first.startAt).toLocaleDateString('es-MX', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <strong>{formatTime(first.startAt, timezone)}</strong>
                <span>Fin: {formatTime(first.endAt, timezone)}</span>
              </time>
              <div><span className="reception-visit-status">Programada</span>
                <h3><Link to={`/appointments/${first.id}`}>{fullName(first.patientFirstName, first.patientLastName)}</Link></h3>
                {first.service ? <p>{first.service.name}</p> : null}
                <p>{fullName(first.dentistFirstName, first.dentistLastName)}</p>
              </div>
            </div>
            <p className="reception-operation-caption">Primeras {upcoming.data?.content.length} de {upcoming.data?.totalElements} citas futuras programadas.</p>
            {upcoming.data!.content.length > 1 ? <ul className="reception-following-visits">{upcoming.data!.content.slice(1).map(appointment => <li key={appointment.id}>
              <Link to={`/appointments/${appointment.id}`}><time dateTime={appointment.startAt}>{new Date(appointment.startAt).toLocaleDateString('es-MX', { timeZone: timezone, day: 'numeric', month: 'short' })} · {formatTime(appointment.startAt, timezone)}</time><span>{fullName(appointment.patientFirstName, appointment.patientLastName)}</span></Link>
            </li>)}</ul> : null}
            {upcoming.data!.totalElements > upcoming.data!.content.length ? <p className="reception-operation-caption">La lista es parcial. Consulta la agenda para ver las demás citas.</p> : null}
          </> : upcoming.data?.totalElements === 0 ? <div className="reception-quiet-day">
            <h3>Sin próximas atenciones</h3><p>No hay próximas citas programadas desde este momento. Las de hoy cuya hora ya pasó siguen en la agenda del día.</p>
          </div> : <p className="reception-operation-notice">Hay citas futuras programadas, pero no se recibió el detalle de esta página. Consulta la agenda.</p>}
        </ReceptionQueryState> : <p className="reception-operation-caption">Se necesita la zona horaria de la clínica para mostrar las citas.</p>}
      </section>
    </div>

    <section aria-label="Seguimiento de cobros" className="reception-portfolio-strip">
      <div className="reception-sheet-heading"><h2>Seguimiento de cobros</h2><Link className="reception-link" to="/finances">Consultar cobros</Link></div>
        <div className="reception-portfolio-values">
          <section aria-label="Cartera pendiente"><h3>Cartera pendiente</h3><ReceptionQueryState query={portfolio} label="cartera pendiente"><p>{money(portfolio.data?.pendingBalance)}</p></ReceptionQueryState><Link className="reception-link" to="/finances/reports?tab=cartera">Consultar cartera pendiente</Link></section>
          <section aria-label="Cargos pendientes"><h3>Cargos pendientes</h3><ReceptionQueryState query={portfolio} label="cargos pendientes"><p>{portfolio.data?.statusCounts?.pendiente ?? 'No disponible'}</p></ReceptionQueryState><Link className="reception-link" to="/finances?status=PENDIENTE">Ver pendientes</Link></section>
          <section aria-label="Cargos parciales"><h3>Cargos parciales</h3><ReceptionQueryState query={portfolio} label="cargos parciales"><p>{portfolio.data?.statusCounts?.parcial ?? 'No disponible'}</p></ReceptionQueryState><Link className="reception-link" to="/finances?status=PARCIAL">Ver parciales</Link></section>
        </div>
      <p className="reception-operation-caption">Saldo vigente de cargos confirmados, no facturación del mes. Pendientes: sin abonos; parciales: con abonos aplicados.</p>
    </section>

    <div className="reception-journal-bottom">
      <nav aria-label="Acciones rápidas" className="reception-patient-access">
        <h2>Pacientes</h2>
        <Link to="/patients" className="reception-directory-link"><strong>Consultar pacientes</strong><span>Datos de contacto y ficha administrativa</span></Link>
        <Link to="/patients?create=1" className="reception-link">Registrar paciente</Link>
      </nav>
      <section aria-label="Notificaciones personales" className="reception-desk-notifications">
        <div className="reception-sheet-heading"><h2>Notificaciones personales</h2><Link className="reception-link" to="/notifications">Abrir mis notificaciones</Link></div>
        <ReceptionQueryState query={notifications} label="notificaciones personales">
          {!Array.isArray(notifications.data?.content) ? <p>La respuesta está incompleta. Abre la bandeja para volver a consultar.</p>
            : notifications.data.content.length ? <ul>{notifications.data.content.map(notification => <li key={notification.id}>
              <span className="reception-operation-caption">{notification.read ? 'Leída' : 'No leída'}</span><h3>{notification.title}</h3><p>{notification.body}</p>
              {period && timezone ? <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleDateString('es-MX', { timeZone: timezone, dateStyle: 'medium' })} · {formatTime(notification.createdAt, timezone)}</time> : null}
            </li>)}</ul> : <p>No tienes notificaciones todavía. Aquí aparecerán los avisos de tu cuenta.</p>}
        </ReceptionQueryState>
      </section>
    </div>
  </div>;
}
