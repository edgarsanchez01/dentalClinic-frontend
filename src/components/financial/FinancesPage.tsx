import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ChargeFilters, ChargeStatus } from '../../api/financial';
import { useAuthStore } from '../../app/authStore';
import { positiveId } from '../../lib/financialMoney';
import { FormAlert } from '../auth/ui';
import { ReceptionEmptyState, ReceptionPageHeader } from '../reception/ReceptionUI';
import { FinancialPatientPicker, ReceptionPatientPicker } from './FinancialPickers';
import { useCharges } from './financialQueries';
import { canManageCharges, canViewReports, control, financialError, hasFinancialAccess, primary, secondary, STATUS_LABELS } from './financialUi';
import { FINANCIAL_PAGE_CLASS } from './financialPresentation';
import { ChargeTable } from './ChargePresentation';
import { FinancialPagination } from './ReportPresentation';
import { FinancialRecovery } from './FinancialRecovery';

function ChargeResults({ children }: { children: ReactNode }) {
  return <section className="reception-finances-results" aria-label="Resultados de cargos">{children}</section>;
}

function dateBoundary(value: string, afterDay = false): string {
  const date = new Date(`${value}T00:00:00`);
  if (afterDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function FinancesPage() {
  const role = useAuthStore((state) => state.user?.role);
  if (!hasFinancialAccess(role)) return null;
  return <AppliedChargeList />;
}

function AppliedChargeList() {
  const [params] = useSearchParams();
  // El borrador se conserva mientras se edita. Al aplicar/restaurar filtros (tambien PopState)
  // se inicia desde la URL real; cambiar solo pagina no borra un borrador aun no aplicado.
  const filterKey = JSON.stringify(['patientId', 'appointmentId', 'status', 'from', 'to', 'fromDay', 'toDay']
    .map((name) => params.get(name)));
  return <ChargeList key={filterKey} />;
}

function ChargeList() {
  const role = useAuthStore((state) => state.user?.role);
  const [params, setParams] = useSearchParams();
  const initialPatient = positiveId(params.get('patientId'));
  const [patient, setPatient] = useState(initialPatient);
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [from, setFrom] = useState(params.get('fromDay') ?? '');
  const [to, setTo] = useState(params.get('toDay') ?? '');
  const [filterError, setFilterError] = useState<string | null>(null);
  const selectedStatus = params.get('status') as ChargeStatus | null;
  const filters: ChargeFilters = { page: Math.max(0, Number(params.get('page')) || 0), size: 20,
    ...(initialPatient ? { patientId: initialPatient } : {}),
    ...(positiveId(params.get('appointmentId')) ? { appointmentId: positiveId(params.get('appointmentId'))! } : {}),
    ...(selectedStatus && selectedStatus in STATUS_LABELS ? { status: selectedStatus } : {}),
    ...(params.get('from') ? { from: params.get('from')! } : {}), ...(params.get('to') ? { to: params.get('to')! } : {}) };
  const query = useCharges(filters);
  const activeAdvanced = [status, from, to].filter(Boolean).length;
  // La semantica de "Aplicar filtros" se conserva: se avisa cuando el borrador difiere de la
  // URL consultada, sin convertir la busqueda en tiempo real ni multiplicar peticiones.
  const appliedPatient = initialPatient;
  const appliedStatus = params.get('status') ?? '';
  const appliedFrom = params.get('fromDay') ?? '';
  const appliedTo = params.get('toDay') ?? '';
  const pendingChanges = patient !== appliedPatient || status !== appliedStatus || from !== appliedFrom || to !== appliedTo;
  function goTo(page: number) { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }
  return <div className={FINANCIAL_PAGE_CLASS}>
    <ReceptionPageHeader
      title="Finanzas"
      intro={`Cargos confirmados y cobros registrados manualmente en MXN.${role === 'DENTIST' ? ' Solo se muestran los cargos propios que autoriza la API.' : ''}`}
      action={canManageCharges(role) || canViewReports(role) ? <>
        {canManageCharges(role) ? <Link className="reception-button reception-button-secondary" to="/collections">Atenciones por cobrar</Link> : null}
        {canViewReports(role) ? <Link className="reception-button reception-button-secondary" to="/finances/reports">Reportes financieros</Link> : null}
        {canManageCharges(role) ? <Link className="reception-button" to={`/finances/new${initialPatient ? `?patientId=${initialPatient}${filters.appointmentId ? `&appointmentId=${filters.appointmentId}` : ''}` : ''}`}>Crear cargo manual</Link> : null}
      </> : undefined}
    />
    <FinancialRecovery />
    <form aria-label="Filtrar cargos" className="reception-finances-toolbar"
      onSubmit={(event) => {
        event.preventDefault(); setFilterError(null);
        if (from && to && from > to) { setFilterError('La fecha inicial no puede ser posterior a la final.'); return; }
        const next = new URLSearchParams();
        if (patient) next.set('patientId', String(patient));
        if (status) next.set('status', status);
        if (from) { next.set('from', dateBoundary(from)); next.set('fromDay', from); }
        if (to) { next.set('to', dateBoundary(to, true)); next.set('toDay', to); }
        if (filters.appointmentId) next.set('appointmentId', String(filters.appointmentId));
        setParams(next);
      }}>
      <div className="reception-finances-search">
        {role !== 'OWNER'
          ? <ReceptionPatientPicker value={patient} label="Paciente" onChange={(id) => { setPatient(id); setFilterError(null); }} />
          : <FinancialPatientPicker value={patient} onChange={(id) => { setPatient(id); setFilterError(null); }} />}
      </div>
      <div className="reception-finances-toolbar-actions">
        <button type="submit" className={primary}>Aplicar filtros</button>
        <button type="button" className="reception-finances-refresh" onClick={() => { setPatient(null); setStatus(''); setFrom(''); setTo(''); setFilterError(null); setParams({}); }}>Limpiar filtros</button>
        {pendingChanges ? <span className="reception-finances-pending" role="status">Filtros sin aplicar. La tabla aún muestra los filtros vigentes.</span> : null}
      </div>
      <details className="reception-advanced">
        <summary>{activeAdvanced > 0 ? `Filtros avanzados · ${activeAdvanced} activo${activeAdvanced === 1 ? '' : 's'}` : 'Filtros avanzados'}</summary>
        <div className="reception-advanced-body">
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <div><label htmlFor="charge-status">Estado del cargo</label><select id="charge-status" className={control} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos los estados</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
            <div><label htmlFor="charge-from">Desde (fecha de confirmación)</label><input id="charge-from" type="date" className={control} value={from} onChange={(event) => setFrom(event.target.value)} /></div>
            <div><label htmlFor="charge-to">Hasta (incluye ese día)</label><input id="charge-to" type="date" className={control} value={to} onChange={(event) => setTo(event.target.value)} /></div>
          </div>
          <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Fechas en tu hora local. {filters.appointmentId ? `Filtro de cita #${filters.appointmentId}.` : ''}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary}>Aplicar filtros</button>
          </div>
        </div>
      </details>
      {filterError ? <FormAlert>{filterError}</FormAlert> : null}
    </form>
    {query.isPending ? <p role="status" className="reception-readonly-note">Cargando cargos…</p> : query.isError ? <div className="grid justify-items-start gap-3">
      <FormAlert>{financialError(query.error)}</FormAlert><button type="button" className={secondary} onClick={() => void query.refetch()}>Reintentar cargos</button>
    </div> : <ChargeResults>
      <p className="reception-readonly-note reception-finances-summary">{query.data.totalElements} cargos autorizados con estos filtros. No es un reporte de ingresos o saldo global.</p>
      {query.data.content.length === 0 ? <ReceptionEmptyState title="No hay cargos en esta página con los filtros seleccionados.">
        Ajusta el paciente, el estado o el rango de fechas para ver otros cargos.
      </ReceptionEmptyState> :
        <ChargeTable charges={query.data.content} />}
      <FinancialPagination label="Paginación de cargos" page={query.data.page} totalPages={query.data.totalPages} fetching={query.isFetching} onPageChange={goTo} />
    </ChargeResults>}
  </div>;
}
