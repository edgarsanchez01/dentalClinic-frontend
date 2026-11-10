import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { formatDayLong, formatTime, fullName } from '../appointments/appointmentUi';
import { careScope, patientRecordLink, type CareScope } from '../dashboard/careDashboardData';
import { useCareAppointments } from '../dashboard/careDashboardQueries';
import { dashboardPeriod } from '../dashboard/dashboardData';
import { useDashboardClock } from '../dashboard/dashboardQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { DentistEmptyState, DentistPage, DentistPageHeader, DentistQueryState, DentistSection } from './DentistUI';
import { DentistStatusChip, DentistVisitRow } from './DentistVisit';
import './dentist.css';

type Period = NonNullable<ReturnType<typeof dashboardPeriod>>;

/**
 * UX-05A — Inicio del DENTIST con identidad Clinical Editorial.
 *
 * Composición propia y aislada: no se modifica `CareDashboard` (compartido con PATIENT).
 * Reutiliza exactamente los contratos y permisos existentes:
 *  - Zona horaria de la clínica desde `GET /api/availability/policy` (nunca UTC ni navegador).
 *  - Citas propias con `useCareAppointments`, que fuerza `dentistId` en el servidor y verifica
 *    el alcance en cliente. El filtrado por `dentistId` NO se interpreta como autorización.
 *  - Notificaciones propias con `useNotifications` (bandeja del usuario).
 * El número de consultas se mantiene igual que en el Inicio anterior (3 de citas + 1 de avisos).
 */
export function DentistDashboard() {
  const user = useAuthStore(state => state.user);
  const owner = user?.role === 'OWNER';
  const scope = careScope(user);
  const now = useDashboardClock();
  const policy = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy, retry: false });
  const period = policy.isError ? null : dashboardPeriod(now, policy.data?.timezone);
  const timezone = period ? policy.data?.timezone : undefined;
  const agenda = period && scope
    ? `/appointments?view=day&date=${period.date}&dentistId=${scope.id}${owner ? '&scope=mine' : ''}`
    : owner ? '/appointments?scope=mine' : '/appointments';
  const appointmentHref = (id: number) => `/appointments/${id}${owner ? `?clinical=1&returnTo=${encodeURIComponent(agenda)}` : ''}`;
  const Page = DentistPage;
  const Header = DentistPageHeader;
  const Section = DentistSection;

  return <Page>
    <Header
      title="Mi jornada clínica"
      intro="Tus pacientes de hoy y la siguiente atención."
      context={timezone && period
        ? <><span>{formatDayLong(new Date(now).toISOString(), timezone)}</span><span>Zona de la clínica · {timezone}</span></>
        : <span>Fecha clínica no disponible</span>}
      action={<div className="flex flex-wrap gap-3"><Link to={agenda} className="dentist-button">Consultar mi agenda</Link>{owner ? <Link to="/scheduling?scope=mine" className="dentist-link">Mi horario</Link> : null}</div>}
    />

    {!scope ? <section aria-label="Perfil vinculado">
      <div role="alert" className="dentist-empty">
        <p>Tu cuenta no tiene un perfil profesional vinculado. Contacta con el propietario para asociarla.</p>
      </div>
    </section> : null}

    {!period ? <section aria-label="Zona horaria">
      <DentistQueryState query={policy} label="zona horaria">
        <div role="status" className="dentist-empty">
          <p>La zona horaria de la clínica no está disponible o no es válida. No mostraremos fechas con una zona distinta.</p>
          <button type="button" className="dentist-link" onClick={() => void policy.refetch()}>Volver a consultar zona horaria</button>
        </div>
      </DentistQueryState>
    </section> : null}

    {scope ? <div className="dentist-home-grid">
      <section aria-label="Próxima cita propia" className="dentist-highlight">
        {period && timezone
          ? <NextPatient scope={scope} now={now} timezone={timezone} agenda={agenda} appointmentHref={appointmentHref} owner={owner} />
          : <p role="status" className="dentist-readonly-note">Las citas se mostrarán cuando esté disponible la zona horaria de la clínica.</p>}
      </section>
      <Section
        title="Mi agenda de hoy"
        label="Mi agenda de hoy"
        intro="Citas propias del día, en orden cronológico. Incluye programadas, completadas, canceladas y ausencias."
        action={<Link className="dentist-link" to={agenda}>Ver agenda completa del día</Link>}
      >
        {period && timezone
          ? <DayAgenda key={`${scope.id}-${period.date}`} scope={scope} period={period} timezone={timezone} agenda={agenda} appointmentHref={appointmentHref} owner={owner} />
          : <p role="status" className="dentist-readonly-note">La agenda se mostrará cuando esté disponible la zona horaria de la clínica.</p>}
      </Section>
    </div> : null}

    <Section title="Tus notificaciones" label="Tus notificaciones" intro="Avisos resumidos de tu bandeja personal.">
      <Notifications timezone={timezone} />
    </Section>
  </Page>;
}

type ClinicalLinks = { agenda: string; appointmentHref: (id: number) => string };

function NextPatient({ scope, now, timezone, agenda, appointmentHref, owner }: { scope: CareScope; now: number; timezone: string; owner: boolean } & ClinicalLinks) {
  const visits = useCareAppointments(scope, { from: new Date(now).toISOString(), status: 'SCHEDULED', page: 0, size: 1 }, true);
  const first = visits.data?.content[0];
  return <DentistQueryState query={visits} label="próximas citas">
    {visits.data?.totalElements === 0 || !first
      ? <DentistEmptyState
        title="Siguiente paciente"
        action={<Link className="dentist-link" to={agenda}>Consultar mi agenda</Link>}
      >
        No tienes próximas citas programadas. Las citas cuya hora ya pasó siguen en tu agenda del día.
      </DentistEmptyState>
      : <div className="dentist-featured">
        <p className="dentist-featured-eyebrow">Siguiente paciente</p>
        {owner ? <p className="dentist-featured-note">{formatDayLong(first.startAt, timezone)}</p> : null}
        <h2>{fullName(first.patientFirstName, first.patientLastName)}</h2>
        <div className="dentist-featured-body">
          <time className="dentist-featured-time" dateTime={first.startAt}>
            <strong>{formatTime(first.startAt, timezone)}</strong>
            <span>Fin: {formatTime(first.endAt, timezone)}</span>
          </time>
          <div className="dentist-featured-person">
            <p>{first.service?.name ?? 'Cita sin servicio asociado'}</p>
            <div className="dentist-featured-actions">
              <Link className="dentist-link" to={appointmentHref(first.id)}>Abrir cita</Link>
              <Link className="dentist-link" to={patientRecordLink(first)}>Abrir expediente</Link>
            </div>
          </div>
          <DentistStatusChip status={first.status} />
        </div>
        <p className="dentist-featured-note">Notas, tratamientos y odontograma están disponibles dentro de la cita o el expediente autorizado. Dato de salud protegido.</p>
      </div>}
  </DentistQueryState>;
}

function DayAgenda({ scope, period, timezone, agenda, appointmentHref, owner }: { scope: CareScope; period: Period; timezone: string; owner: boolean } & ClinicalLinks) {
  const [page, setPage] = useState(0);
  const scheduled = useCareAppointments(scope, { ...period.day, status: 'SCHEDULED', page: 0, size: 1 }, true);
  const visits = useCareAppointments(scope, { ...period.day, page, size: 5 }, true);
  return <>
    <DentistQueryState query={scheduled} label="citas programadas hoy">
      <p className="dentist-agenda-total">
        <strong>{scheduled.data?.totalElements}</strong><span>citas que siguen programadas hoy</span>
      </p>
    </DentistQueryState>
    <DentistQueryState query={visits} label="agenda de hoy">
      {visits.data?.totalElements === 0
        ? <DentistEmptyState
          title="No tienes citas para hoy"
          action={<Link className="dentist-link" to={agenda}>Consultar mi agenda</Link>}
        >
          No hay citas propias registradas para la fecha clínica de hoy. Puedes consultar otros días en tu agenda.
        </DentistEmptyState>
        : <>
          {visits.data?.content.length === 0
            ? <p className="dentist-caption">Esta página ya no tiene citas. Vuelve a la página anterior o abre tu agenda.</p>
            : <ul className="dentist-agenda-list">{visits.data?.content.map(appointment => <li key={appointment.id}>
              <DentistVisitRow appointment={appointment} appointmentHref={appointmentHref(appointment.id)} time={formatTime(appointment.startAt, timezone)} {...(owner ? { endTime: formatTime(appointment.endAt, timezone) } : {})} recordHref={patientRecordLink(appointment)} />
            </li>)}</ul>}
          {visits.data && visits.data.totalElements > visits.data.content.length
            ? <p className="dentist-caption">Mostrando {visits.data.content.length} de {visits.data.totalElements} citas del día. La lista es parcial; la agenda contiene el resto.</p>
            : null}
        </>}
    </DentistQueryState>
    <nav aria-label="Páginas de mi agenda" className="dentist-pagination">
      <button type="button" className="dentist-button dentist-button-secondary" disabled={page === 0 || visits.isFetching} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span role="status" className="dentist-caption">Página {page + 1}{!visits.isError && visits.data?.totalPages ? ` de ${visits.data.totalPages}` : ''}</span>
      <button type="button" className="dentist-button dentist-button-secondary"
        disabled={visits.isFetching || visits.isError || !visits.data || page + 1 >= visits.data.totalPages}
        onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </nav>
  </>;
}

function Notifications({ timezone }: { timezone: string | undefined }) {
  const notifications = useNotifications({ page: 0, size: 5 });
  return <>
    <DentistQueryState query={notifications} label="notificaciones personales">
      {!Array.isArray(notifications.data?.content)
        ? <p className="dentist-caption">La respuesta está incompleta. Abre la bandeja para volver a consultar.</p>
        : notifications.data.content.length === 0
          ? <p className="dentist-caption">No tienes notificaciones todavía.</p>
          : <ul className="dentist-notifications">{notifications.data.content.map(notification => <li
            key={notification.id} className="dentist-notification" data-unread={notification.read ? 'false' : 'true'}>
            <div className="dentist-notification-labels">
              <span>{notification.read ? 'Leída' : 'No leída'}</span>
              {notification.priority === 'HIGH' ? <span>Prioridad alta</span> : null}
            </div>
            <h3>{notification.title}</h3>
            <p>{notification.body}</p>
            {timezone && Number.isFinite(Date.parse(notification.createdAt))
              ? <time dateTime={notification.createdAt}>{formatDayLong(notification.createdAt, timezone)} · {formatTime(notification.createdAt, timezone)}</time>
              : null}
          </li>)}</ul>}
    </DentistQueryState>
    <Link className="dentist-link" to="/notifications">Abrir mis notificaciones</Link>
  </>;
}
