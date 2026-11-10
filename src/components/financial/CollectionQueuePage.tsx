import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { collectionApi, type CollectionFilters, type CollectionState } from '../../api/collection';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { positiveId } from '../../lib/financialMoney';
import { ReceptionEmptyState, ReceptionPageHeader } from '../reception/ReceptionUI';
import { ReceptionPatientPicker } from './FinancialPickers';
import { rangeForView } from '../appointments/appointmentUi';
import { COLLECTION_LABELS, CollectionSummary, CollectionRow } from './CollectionPresentation';
import { FinancialPagination } from './ReportPresentation';
import './collection.css';

// Solo presentación: no equipara estados de atención con estados de cargo.
const COLLECTION_CHIPS: Record<CollectionState, string> = {
  NO_CHARGE: 'bg-sunken text-ink-secondary', PENDING: 'reception-chip-pendiente',
  PARTIAL: 'reception-chip-parcial', SETTLED: 'reception-chip-pagado', REVIEW_REQUIRED: 'reception-chip-pendiente',
};
export function CollectionQueuePage() {
  const role = useAuthStore(s => s.user?.role);
  const [params] = useSearchParams();
  if (role !== 'OWNER' && role !== 'RECEPTIONIST') return <p role="alert">No tienes permiso para consultar atenciones por cobrar.</p>;
  // Back/Forward restores applied filter controls; paging alone preserves drafts.
  return <Queue key={JSON.stringify([...params].filter(([key]) => key !== 'page'))} />;
}
function Queue() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [patient, setPatient] = useState(positiveId(params.get('patientId')));
  const [dentist, setDentist] = useState(params.get('dentistId') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [settled, setSettled] = useState(params.get('includeSettled') === 'true');
  const [from, setFrom] = useState(params.get('fromDay') ?? '');
  const [to, setTo] = useState(params.get('toDay') ?? '');
  const [error, setError] = useState('');
  const [moreFilters, setMoreFilters] = useState(Boolean(params.get('dentistId') || params.get('from') || params.get('to') || params.get('includeSettled') === 'true'));
  const schedule = useQuery({ queryKey: ['public-schedule'], queryFn: () => schedulingApi.getPublicSchedule() });
  const zone = schedule.data?.timezone;
  const selected = params.get('state');
  const filters: CollectionFilters = { page: Math.max(0, Math.floor(Number(params.get('page')) || 0)), size: 20,
    ...(positiveId(params.get('patientId')) ? { patientId: positiveId(params.get('patientId'))! } : {}),
    ...(positiveId(params.get('dentistId')) ? { dentistId: positiveId(params.get('dentistId'))! } : {}),
    ...(selected && Object.hasOwn(COLLECTION_LABELS, selected) ? { state: selected as CollectionState } : {}),
    includeSettled: params.get('includeSettled') === 'true',
    ...(params.get('from') ? { from: params.get('from')! } : {}), ...(params.get('to') ? { to: params.get('to')! } : {}) };
  const query = useQuery({ queryKey: ['collection-queue', filters], queryFn: ({ signal }) => collectionApi.queue(filters, signal), retry: false });
  const pendingFilters = patient !== positiveId(params.get('patientId')) || dentist !== (params.get('dentistId') ?? '') || state !== (params.get('state') ?? '')
    || settled !== (params.get('includeSettled') === 'true') || from !== (params.get('fromDay') ?? '') || to !== (params.get('toDay') ?? '');
  function page(index: number) { const next = new URLSearchParams(params); next.set('page', String(index)); setParams(next); }
  const applied = [filters.patientId ? `Paciente #${filters.patientId}` : '', filters.state ? COLLECTION_LABELS[filters.state] : filters.includeSettled ? 'Todos los estados' : 'Todos excepto liquidados', filters.dentistId ? `Profesional #${filters.dentistId}` : '', params.get('fromDay') ? `Desde ${params.get('fromDay')}` : '', params.get('toDay') ? `Hasta ${params.get('toDay')}` : '', filters.includeSettled ? 'Incluir liquidados' : ''].filter(Boolean);
  return <div className="clinical-editorial reception-page collection-page collection-editorial">
    <ReceptionPageHeader title="Atenciones por cobrar" intro="Atenciones clínicamente completadas. Sin cargo registrado no significa deuda confirmada." action={<Link className="reception-button reception-button-secondary" to="/finances">Gestión de cargos</Link>} />
    {!query.isPending && !query.isError ? <CollectionSummary summary={query.data.summary} className="collection-overview" /> : null}
    <form className="collection-filters" aria-label="Filtrar atenciones por cobrar" onSubmit={e => {
      e.preventDefault(); setError('');
      if (from && to && from > to) { setError('La fecha inicial no puede ser posterior a la final.'); return; }
      if ((from || to) && !zone) { setError('Espera la zona horaria de la clínica antes de aplicar fechas.'); return; }
      const next = new URLSearchParams();
      if (patient) next.set('patientId', String(patient)); if (dentist) next.set('dentistId', dentist);
      if (state) next.set('state', state); if (settled) next.set('includeSettled', 'true');
      if (from && zone) { next.set('fromDay', from); next.set('from', rangeForView('day', new Date(`${from}T00:00:00Z`), zone).from.toISOString()); }
      if (to && zone) { next.set('toDay', to); next.set('to', rangeForView('day', new Date(`${to}T00:00:00Z`), zone).to.toISOString()); }
      setParams(next);
    }}>
      <div className="collection-filter-primary">
      <ReceptionPatientPicker value={patient} onChange={setPatient} />
      <label>Estado financiero<span className="collection-state-select"><select value={state} onChange={e => setState(e.target.value)}><option value="">Todos excepto liquidados</option>{Object.entries(COLLECTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>
      <button type="button" className="reception-button reception-button-secondary" aria-expanded={moreFilters} aria-controls="collection-secondary-filters" onClick={() => setMoreFilters(value => !value)}>Más filtros</button>
      <button type="submit" className="reception-button">Aplicar filtros</button>
      </div>
      <div id="collection-secondary-filters" className="collection-filter-secondary" hidden={!moreFilters}>
      <label>Profesional<select value={dentist} onChange={e => setDentist(e.target.value)}><option value="">Todos los profesionales</option>{dentist && !schedule.data?.dentists.some(d => String(d.dentistId) === dentist) ? <option value={dentist}>Profesional #{dentist}</option> : null}{schedule.data?.dentists.map(d => <option key={d.dentistId} value={d.dentistId}>{d.firstName} {d.lastName}</option>)}</select></label>
      <label>Desde (fecha de atención)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Hasta (incluye ese día)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <div><label className="collection-choice"><input type="checkbox" checked={settled} onChange={e => setSettled(e.target.checked)} />Incluir liquidados</label><p className="reception-readonly-note">Un estado explícito prevalece sobre esta opción. Fechas en {zone ?? 'zona de la clínica por consultar'}.</p></div>
      </div>
      <div className="collection-filter-status"><p>Filtros aplicados: {applied.join(' · ')}</p><div className="collection-actions"><button type="button" className="reception-text-button" onClick={() => { setPatient(null); setDentist(''); setState(''); setSettled(false); setFrom(''); setTo(''); setError(''); setParams({}); }}>Limpiar filtros</button><button type="button" className="reception-text-button" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualizar bandeja</button></div></div>
    </form>
    {pendingFilters ? <p role="status">Filtros sin aplicar. La lista conserva los filtros de la última consulta.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {query.isPending ? <p role="status">Consultando atenciones…</p> : query.isError ? <div role="alert"><p>No se pudo verificar la bandeja. No se muestran importes o resultados anteriores.</p><button type="button" className="reception-button reception-button-secondary" onClick={() => void query.refetch()}>Reintentar bandeja</button></div> : <>
      <p>{query.data.totalElements} atenciones con los filtros aplicados.</p>
      {!query.data.content.length ? <ReceptionEmptyState title={query.data.totalElements ? 'Esta página no tiene atenciones' : 'No hay atenciones con estos filtros'}>Ajusta los filtros o vuelve a la página anterior.</ReceptionEmptyState> : <ol className="collection-rows" aria-label="Atenciones completadas">{query.data.content.map(row =>
        <CollectionRow key={row.appointment.id} row={row} zone={zone} returnTo={location.pathname + location.search}
          className="collection-row" badgeClassName={`reception-chip ${COLLECTION_CHIPS[row.collectionState]}`} />)}</ol>}
      <FinancialPagination className="collection-actions" label="Paginación de atenciones" page={query.data.page} totalPages={query.data.totalPages} fetching={query.isFetching} onPageChange={page} />
    </>}
  </div>;
}
