import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../app/authStore';
import { calendarDate } from '../../app/deepLinks';
import { addDays, fromLocalDateInput, rangeForView, STATUS_OPTIONS } from '../appointments/appointmentUi';
import { careScope } from '../dashboard/careDashboardData';
import { useCareAppointments } from '../dashboard/careDashboardQueries';
import { useDashboardClock } from '../dashboard/dashboardQueries';
import { AppointmentCard, PatientEmptyState, PatientPageHeader, PatientQueryState } from './PatientUI';
import { BookingStepper } from './BookingStepper';
import { usePatientZone } from './patientQueries';
import type { AppointmentStatus } from '../../api/appointments';

export function PatientAppointments() {
  const [params] = useSearchParams();
  const zone = usePatientZone();
  return <PatientQueryState query={zone} label="hora de la clínica">{zone.data ? params.get('create') === '1' ? <BookingStepper timezone={zone.data.timezone} /> : <PatientAppointmentList timezone={zone.data.timezone} /> : null}</PatientQueryState>;
}

function PatientAppointmentList({ timezone }: { timezone: string }) {
  const [params, setParams] = useSearchParams();
  const user = useAuthStore(state => state.user);
  const scope = careScope(user);
  const now = useDashboardClock();
  const [anchor] = useState(now);
  const [page, setPage] = useState(0);
  const mode = params.get('tab') === 'history' ? 'history' : 'upcoming';
  const date = calendarDate(params.get('date'));
  const status = STATUS_OPTIONS.find(s => s.value === params.get('status'))?.value;
  const range = date ? rangeForView(params.get('view') === 'week' || params.get('view') === 'month' ? params.get('view') as 'week' | 'month' : 'day', fromLocalDateInput(date), timezone) : null;
  const filters = range ? { from: range.from.toISOString(), to: range.to.toISOString(), ...(status ? { status } : {}) }
    : mode === 'upcoming' ? { from: new Date(anchor).toISOString(), status: status ?? 'SCHEDULED' as const } : { to: new Date(anchor).toISOString(), ...(status ? { status } : {}) };
  const query = useCareAppointments(scope, { ...filters, page, size: 10 }, true);
  function update(key: string, value: string) {
    setPage(0);
    setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next; });
  }
  return <div className="patient-page">
    <PatientPageHeader title="Mis citas" intro="Revisa tus próximas visitas o consulta tu historial." action={<Link className="patient-button" to="/appointments?create=1">Reservar cita</Link>} />
    {!scope ? <p role="alert" className="patient-error">No encontramos una ficha vinculada a tu cuenta. Contacta con la clínica.</p> : null}
    <div role="group" aria-label="Tipo de citas" className="patient-tabs">{[['upcoming', 'Próximas'], ['history', 'Historial']] .map(([key, label]) => <button key={key} aria-pressed={mode === key && !date} onClick={() => { setPage(0); setParams({ ...(key === 'history' ? { tab: 'history' } : {}) }); }}>{label}</button>)}</div>
    <details className="patient-filters" open={!!date || !!status}><summary>Buscar por fecha o estado</summary><div className="patient-filter-fields"><label>Fecha<input type="date" value={date ?? ''} onChange={e => update('date', e.target.value)} /></label><label>Estado<select value={status ?? ''} onChange={e => update('status', e.target.value as AppointmentStatus)}><option value="">Todos</option>{STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label><button className="patient-link" onClick={() => { setPage(0); setParams({}); }}>Quitar filtros</button></div></details>
    {mode === 'history' && !date ? <p className="patient-muted">Visitas anteriores, de la más antigua a la más reciente. Incluye cancelaciones y ausencias.</p> : null}
    {scope ? <PatientQueryState query={query} label="citas">
      {query.data?.content.length ? <div className="patient-visit-list">{query.data.content.map(a => <AppointmentCard key={a.id} appointment={a} timezone={timezone} />)}</div> : <PatientEmptyState title={date || status ? 'Sin resultados para estos filtros' : mode === 'history' ? 'Tu historial comienza con tu primera visita' : 'No tienes citas próximas'}>{date || status ? 'Prueba otra fecha o quita los filtros.' : mode === 'history' ? 'Cuando tengas citas pasadas, podrás consultarlas aquí.' : 'Cuando reserves, aquí encontrarás la fecha, el servicio y los detalles de tu visita.'}</PatientEmptyState>}
      {query.data && query.data.totalPages > 1 ? <nav aria-label="Páginas de mis citas" className="patient-pagination"><button className="patient-button patient-button-secondary" disabled={page === 0 || query.isFetching} onClick={() => setPage(p => p - 1)}>Anterior</button><span role="status">Página {page + 1} de {query.data.totalPages}</span><button className="patient-button patient-button-secondary" disabled={query.isFetching || page + 1 >= query.data.totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</button></nav> : null}
    </PatientQueryState> : null}
    {date ? <div className="patient-pagination"><button className="patient-link" onClick={() => update('date', addDays(fromLocalDateInput(date), -1).toISOString().slice(0, 10))}>Día anterior</button><button className="patient-link" onClick={() => update('date', addDays(fromLocalDateInput(date), 1).toISOString().slice(0, 10))}>Día siguiente</button></div> : null}
  </div>;
}
