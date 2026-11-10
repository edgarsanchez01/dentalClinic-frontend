import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { ChargeStatus, ReportFilters } from '../../api/financial';
import { useAuthStore } from '../../app/authStore';
import { formatMoney, formatSignedMoney } from '../../lib/financialMoney';
import { FormAlert } from '../auth/ui';
import { ReceptionEmptyState, ReceptionPageHeader } from '../reception/ReceptionUI';
import { ReceptionPatientPicker, FinancialPatientPicker } from './FinancialPickers';
import { useCashFlowReport, useChargesReport, usePortfolioReport } from './financialQueries';
import { localDayBoundary, localDayOf } from '../../app/deepLinks';
import { readReportLink, reportSearch, reportTab, type ReportTab } from '../../app/reportLinks';
import {
  canViewReports, control, financialDate, financialError, METHOD_LABELS, primary, secondary, STATUS_LABELS, useIsReception,
} from './financialUi';
import { ChargeStatusChip } from './ReceptionFinances';
import { ReportFigure as MoneyCard, ReportFigures, FinancialTable } from './ReportPresentation';
import { FINANCIAL_PAGE_CLASS } from './financialPresentation';

const TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'cartera', label: 'Resumen de cartera' },
  { id: 'cobros', label: 'Cobros por período' },
  { id: 'cargos', label: 'Cargos y saldos' },
];

/** Formato civil local; reutiliza el límite inclusivo existente sin conversiones UTC. */
function reportDay(value: string, inclusiveEnd = false): string {
  const [year, month, day] = localDayOf(value, inclusiveEnd).split('-');
  return `${day}/${month}/${year}`;
}

export function ReportsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const reception = useIsReception();
  const [params, setParams] = useSearchParams();
  const tab = reportTab(params.get('tab'));
  const link = readReportLink(params);
  if (!canViewReports(role)) return null;
  return (
    <div className={FINANCIAL_PAGE_CLASS}>
      <ReceptionPageHeader
        title="Reportes financieros"
        intro={reception ? 'Cartera, cobros y saldos del consultorio. Importes en MXN calculados por el servidor.' : 'Cartera, cobros y saldos de todo el consultorio. Todos los importes y estados los calcula el servidor en MXN; no se suman movimientos en el navegador.'}
        action={<Link className="reception-button reception-button-secondary" to="/finances">Volver a finanzas</Link>}
      />
      <div role="tablist" aria-label="Reportes financieros" className="reception-tabs">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" id={`report-tab-${entry.id}`}
            aria-selected={tab === entry.id} aria-controls={`report-panel-${entry.id}`}
            className={`reception-button ${tab === entry.id ? '' : 'reception-button-secondary'}`}
            onClick={() => setParams(reportSearch(entry.id, link.filters))}>
            {entry.label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`} className="reception-section">
        {link.error ? <div className="grid justify-items-start gap-3"><FormAlert>{link.error}</FormAlert>
          <button type="button" className={secondary} onClick={() => setParams({ tab })}>Restablecer enlace</button></div>
          : tab === 'cartera' ? <PortfolioPanel /> : tab === 'cobros'
            ? <CashFlowPanel key={params.toString()} filters={link.filters} onApply={(filters) => setParams(reportSearch(tab, filters))} />
            : <ChargesPanel key={params.toString()} filters={link.filters} onApply={(filters) => setParams(reportSearch(tab, filters))} />}
      </section>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <p role="status" className="text-ink-muted">{label}</p>;
}

const reportMoneyClass = 'reception-finances-amount reception-finances-amount--right whitespace-nowrap px-4 py-3';

function ReportError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <div className="grid justify-items-start gap-3">
    <FormAlert>{financialError(error)}</FormAlert>
    <button type="button" className={secondary} onClick={onRetry}>Reintentar reporte</button>
  </div>;
}

function PortfolioPanel() {
  const query = usePortfolioReport(true);
  if (query.isPending) return <Loading label="Cargando resumen de cartera…" />;
  if (query.isError) return <ReportError error={query.error} onRetry={() => void query.refetch()} />;
  const report = query.data;
  return <>
    <p className="text-ink-secondary">
      Estado <strong>actual</strong> de la cartera al {financialDate(report.asOf)}; no es un corte histórico.
    </p>
    <ReportFigures>
      <MoneyCard label="Facturado vigente (no anulado)" value={formatMoney(report.billedAmount)} />
      <MoneyCard label="Cobrado aplicado vigente" value={formatMoney(report.appliedAmount)} hint="Pagos no revertidos" />
      <MoneyCard label="Saldo pendiente" value={formatMoney(report.pendingBalance)} />
      <MoneyCard label="Cargos confirmados" value={String(report.confirmedCharges)} hint="Incluye anulados" />
    </ReportFigures>
    <FinancialTable label="Conteo de cargos por estado" caption="Cantidad de cargos confirmados por estado derivado" columns={['Estado', 'Cargos']} className="min-w-[24rem]">
        {(['PENDIENTE', 'PARCIAL', 'PAGADO', 'ANULADO'] as ChargeStatus[]).map((status) => (
          <tr key={status}>
            <td className={`px-4 py-3 font-medium reception-status-${status.toLowerCase()}`}><ChargeStatusChip status={status} /></td>
            <td className="px-4 py-3 tabular-nums">{report.statusCounts[status.toLowerCase() as keyof typeof report.statusCounts]}</td>
          </tr>))}
    </FinancialTable>
  </>;
}

function CashFlowPanel({ filters, onApply }: { filters: ReportFilters; onApply: (filters: ReportFilters) => void }) {
  const reception = useIsReception();
  const [from, setFrom] = useState(filters.from ? localDayOf(filters.from) : '');
  const [to, setTo] = useState(filters.to ? localDayOf(filters.to, true) : '');
  const [filterError, setFilterError] = useState<string | null>(null);
  const applied: ReportFilters = { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
  const query = useCashFlowReport(applied, true);
  const periodActive = Boolean(filters.from || filters.to);
  return <>
    <form aria-label="Filtrar cobros por período" className="reception-card reception-report-filters"
      onSubmit={(event) => {
        event.preventDefault(); setFilterError(null);
        if (from && to && from > to) { setFilterError('La fecha inicial no puede ser posterior a la final.'); return; }
        onApply({ ...(from ? { from: localDayBoundary(from) } : {}), ...(to ? { to: localDayBoundary(to, true) } : {}) });
      }}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div><label htmlFor="cash-from">Desde (fecha de movimiento)</label>
          <input id="cash-from" type="date" className={control} value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div><label htmlFor="cash-to">Hasta (incluye ese día)</label>
          <input id="cash-to" type="date" className={control} value={to} onChange={(event) => setTo(event.target.value)} /></div>
      </div>
      <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Fechas en tu hora local. Las reversas se atribuyen al método del pago original.</p>
      {filterError ? <FormAlert>{filterError}</FormAlert> : null}
      <div className="flex flex-wrap gap-2"><button type="submit" className={primary}>Aplicar período</button>
        <button type="button" className={secondary} onClick={() => onApply({})}>Limpiar período</button></div>
    </form>
    {periodActive ? <p className="reception-finances-period">
      <span className="reception-finances-period-label">Período aplicado:</span>
      {reception ? <span>{filters.from ? reportDay(filters.from) : 'sin inicio'} — {filters.to ? reportDay(filters.to, true) : 'sin fin'} (incluye el último día).</span>
        : <span>{filters.from ? financialDate(filters.from) : 'sin inicio'} — {filters.to ? financialDate(filters.to) : 'sin fin'} (fin exclusivo).</span>}
    </p> : null}
    {query.isPending ? <Loading label="Cargando cobros…" />
      : query.isError ? <ReportError error={query.error} onRetry={() => void query.refetch()} />
      : <>
        <ReportFigures columns={3}>
          <MoneyCard label="Cobros brutos del período" value={formatMoney(query.data.grossAmount)} />
          <MoneyCard label="Reversas del período" value={formatSignedMoney(query.data.reversalAmount)} />
          <MoneyCard label="Cobro neto" value={formatSignedMoney(query.data.netAmount)} hint="Bruto menos reversas" />
        </ReportFigures>
        {query.data.methods.length === 0 ? <ReceptionEmptyState title="No hay cobros registrados en el período seleccionado.">
          Ajusta el rango de fechas para consultar otro período.
        </ReceptionEmptyState> : <FinancialTable label="Cobros por método" caption="Cobros brutos, reversas y neto por método de pago en el período" columns={['Método', 'Bruto', 'Reversas', 'Neto']} numeric={['Bruto', 'Reversas', 'Neto']} className="min-w-[32rem]">
            {query.data.methods.map((flow) => <tr key={flow.method}>
              <td className="px-4 py-3">{METHOD_LABELS[flow.method]}</td>
              <td className={reportMoneyClass}>{formatMoney(flow.grossAmount)}</td>
              <td className={reportMoneyClass}>{formatSignedMoney(flow.reversalAmount)}</td>
              <td className={reportMoneyClass}>{formatSignedMoney(flow.netAmount)}</td>
            </tr>)}
        </FinancialTable>}
      </>}
  </>;
}

function ChargesPanel({ filters, onApply }: { filters: ReportFilters; onApply: (filters: ReportFilters) => void }) {
  const reception = useIsReception();
  const [patient, setPatient] = useState<number | null>(filters.patientId ?? null);
  const [status, setStatus] = useState(filters.status ?? '');
  const [from, setFrom] = useState(filters.from ? localDayOf(filters.from) : '');
  const [to, setTo] = useState(filters.to ? localDayOf(filters.to, true) : '');
  const [filterError, setFilterError] = useState<string | null>(null);
  const query = useChargesReport(filters, true);
  return <>
    <form aria-label="Filtrar cargos y saldos" className="reception-card reception-report-filters"
      onSubmit={(event) => {
        event.preventDefault(); setFilterError(null);
        if (from && to && from > to) { setFilterError('La fecha inicial no puede ser posterior a la final.'); return; }
        onApply({
          ...(patient ? { patientId: patient } : {}),
          ...(status ? { status: status as ChargeStatus } : {}),
          ...(from ? { from: localDayBoundary(from) } : {}), ...(to ? { to: localDayBoundary(to, true) } : {}),
        });
      }}>
      {reception ? <div className="reception-finances-search">
        <ReceptionPatientPicker value={patient} label="Paciente" onChange={setPatient} />
      </div> : <FinancialPatientPicker value={patient} onChange={setPatient} />}
      <div className="reception-report-charge-fields">
        <div><label htmlFor="report-charge-status">Estado del cargo</label><select id="report-charge-status" className={control}
          value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>{Object.entries(STATUS_LABELS).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select></div>
        <div><label htmlFor="report-charge-from">Desde (fecha de confirmación)</label>
          <input id="report-charge-from" type="date" className={control} value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div><label htmlFor="report-charge-to">Hasta (incluye ese día)</label>
          <input id="report-charge-to" type="date" className={control} value={to} onChange={(event) => setTo(event.target.value)} /></div>
      </div>
      {filterError ? <FormAlert>{filterError}</FormAlert> : null}
      <div className="flex flex-wrap gap-2"><button type="submit" className={primary}>Aplicar filtros</button>
        <button type="button" className={secondary} onClick={() => onApply({})}>Limpiar filtros</button></div>
    </form>
    {reception && (filters.patientId || filters.status) ? <p className="reception-finances-report-hint">
      Filtros aplicados: {filters.patientId ? `Paciente #${filters.patientId}` : 'Todos los pacientes'} · {filters.status ? STATUS_LABELS[filters.status] : 'Todos los estados'}
    </p> : null}
    {filters.from || filters.to ? <p className="reception-finances-period">
      <span className="reception-finances-period-label">Período aplicado:</span>
      {reception ? <span>{filters.from ? reportDay(filters.from) : 'sin inicio'} — {filters.to ? reportDay(filters.to, true) : 'sin fin'} (incluye el último día).</span>
        : <span>{filters.from ? financialDate(filters.from) : 'sin inicio'} — {filters.to ? financialDate(filters.to) : 'sin fin'} (fin exclusivo).</span>}
    </p> : null}
    {query.isPending ? <Loading label="Cargando cargos y saldos…" />
      : query.isError ? <ReportError error={query.error} onRetry={() => void query.refetch()} />
      : <>
        <ReportFigures>
          <MoneyCard label="Facturado vigente (no anulado)" value={formatMoney(query.data.billedAmount)} />
          <MoneyCard label="Cobrado aplicado vigente" value={formatMoney(query.data.appliedAmount)} />
          <MoneyCard label="Saldo pendiente" value={formatMoney(query.data.pendingBalance)} />
          <MoneyCard label="Cargos confirmados" value={String(query.data.confirmedCharges)} />
        </ReportFigures>
        {query.data.byPatient.length === 0 ? <ReceptionEmptyState title="No hay cargos que coincidan con los filtros aplicados.">
          Cambia el paciente, el estado o el rango de fechas para consultar otras cuentas.
        </ReceptionEmptyState> : <FinancialTable label="Saldos por paciente" caption="Cargos, facturado, aplicado y saldo pendiente por paciente" columns={['Paciente', 'Cargos', 'Facturado', 'Aplicado', 'Saldo']} numeric={['Facturado', 'Aplicado', 'Saldo']} className="min-w-[36rem]">
            {query.data.byPatient.map((row) => <tr key={row.patientId}>
              <td className="px-4 py-3">Paciente #{row.patientId}</td>
              <td className="px-4 py-3 tabular-nums">{row.chargeCount}</td>
              <td className={reportMoneyClass}>{formatMoney(row.billedAmount)}</td>
              <td className={reportMoneyClass}>{formatMoney(row.appliedAmount)}</td>
              <td className={reportMoneyClass}>{formatMoney(row.pendingBalance)}</td>
            </tr>)}
        </FinancialTable>}
      </>}
  </>;
}
