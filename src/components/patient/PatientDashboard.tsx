import { Link } from 'react-router-dom';
import { useAuthStore } from '../../app/authStore';
import { useDashboardClock } from '../dashboard/dashboardQueries';
import { careScope } from '../dashboard/careDashboardData';
import { useCareAppointments } from '../dashboard/careDashboardQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { formatDayLong } from '../appointments/appointmentUi';
import { AppointmentCard, PatientEmptyState, PatientPageHeader, PatientQueryState } from './PatientUI';
import { PatientMiniAgenda } from './PatientMiniAgenda';
import { usePatientZone } from './patientQueries';
import { PatientNotificationContent } from './PatientNotifications';

export function PatientDashboard() {
  const user = useAuthStore(state => state.user);
  const scope = careScope(user);
  const now = useDashboardClock();
  const zone = usePatientZone();
  const timezone = zone.isError ? undefined : zone.data?.timezone;
  const visits = useCareAppointments(scope, { from: new Date(now).toISOString(), status: 'SCHEDULED', page: 0, size: 5 }, !!timezone);
  const notifications = useNotifications({ page: 0, size: 5 });
  const first = visits.data?.content[0];
  const greeting = first?.patientFirstName?.trim();
  return <div className="patient-page">
    <PatientPageHeader title="Tu atención dental" intro="Tus citas, tu información y el siguiente paso para cuidarte." />
    {!scope ? <section aria-label="Perfil vinculado" className="patient-error"><p role="alert">Tu cuenta no tiene una ficha de paciente vinculada. Contacta con la clínica antes de reservar.</p></section> : null}
    <section aria-label="Bienvenida" className="patient-hero">
      <div className="patient-hero-copy">
        <p className="patient-hero-eyebrow">{timezone ? formatDayLong(new Date(now).toISOString(), timezone) : 'Tu espacio dental'}</p>
        <h2>{greeting ? `Hola, ${greeting}` : 'Hola de nuevo'}</h2>
        <p>Aquí tienes tus citas, tu agenda y el siguiente paso para cuidar tu sonrisa.</p>
      </div>
      <Link className="patient-button" to="/appointments?create=1">Agendar una cita</Link>
    </section>
    <div className="patient-home-grid">
      <section aria-label="Tu próxima cita" className="patient-next">
        <h2>Tu próxima cita</h2>
        <div role="region" aria-label="Zona horaria"><PatientQueryState query={zone} label="hora de la clínica">
          {scope && timezone ? <PatientQueryState query={visits} label="próximas citas">
            {first ? <AppointmentCard appointment={first} timezone={timezone} featured /> : <PatientEmptyState title="Tu próxima visita empieza aquí" action={<Link className="patient-button" to="/appointments?create=1">Reservar un horario</Link>}>Aún no tienes próximas citas. Elige el servicio y un horario que te convenga.</PatientEmptyState>}
          </PatientQueryState> : null}
        </PatientQueryState></div>
      </section>
      <aside className="patient-care-aside" aria-label="A tu ritmo">
        <h2>A tu ritmo</h2><p>Elige un servicio, encuentra un horario y revisa los detalles antes de reservar.</p>
        <nav aria-label="Acciones rápidas" className="patient-actions">
          <Link to="/appointments" className="patient-action-card"><span className="patient-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></span><span>Consultar mis citas e historial</span></Link>
          <Link to={scope ? `/patients/${scope.id}` : '/patients'} className="patient-action-card"><span className="patient-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" /></svg></span><span>Consultar mis datos</span></Link>
          <Link to="/notifications" className="patient-action-card"><span className="patient-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg></span><span>Ver mis avisos</span></Link>
        </nav>
      </aside>
    </div>
    {timezone && scope ? <PatientMiniAgenda timezone={timezone} now={now} /> : null}
    {visits.isSuccess && timezone && visits.data.content.length > 1 ? <section className="patient-section"><h2>Después en tu agenda</h2><div className="patient-visit-list">{visits.data.content.slice(1).map(a => <AppointmentCard key={a.id} appointment={a} timezone={timezone} />)}</div></section> : null}
    <section aria-label="Notificaciones personales" className="patient-section patient-recent">
      <div className="patient-section-heading"><h2>Notificaciones recientes</h2><Link className="patient-link" to="/notifications">Consultar mis notificaciones</Link></div>
      <PatientQueryState query={notifications} label="notificaciones personales">
        {notifications.data?.content.length ? <ul className="patient-notifications">{notifications.data.content.slice(0, 3).map(n => <li key={n.id}><PatientNotificationContent notification={n} timezone={timezone} preview /></li>)}</ul> : <PatientEmptyState title="Todo al día">No tienes notificaciones todavía. Aquí encontrarás los avisos de tu atención.</PatientEmptyState>}
      </PatientQueryState>
    </section>
  </div>;
}
