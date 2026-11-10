import { Link } from 'react-router-dom';
import type { CollectionQueue, CollectionState } from '../../api/collection';
import { formatMoney } from '../../lib/financialMoney';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';
import { FinancialAmounts } from './ChargePresentation';
import { ActionGroup } from '../ui/ActionGroup';

export const COLLECTION_LABELS: Record<CollectionState, string> = {
  NO_CHARGE: 'Sin cargo registrado', PENDING: 'Cargo pendiente', PARTIAL: 'Pago parcial', SETTLED: 'Liquidado', REVIEW_REQUIRED: 'Requiere revisión administrativa',
};
const reasons: Record<string, string> = {
  ECONOMIC_REFERENCE_REQUIRED: 'No hay un precio histórico utilizable. La creación de un cargo requiere gestión administrativa.',
  FINANCIAL_CONTEXT_UNAVAILABLE: 'El conjunto financiero no se puede verificar. No se muestran importes parciales.',
  MULTIPLE_ACTIVE_CHARGES: 'Hay varios cargos activos. Deben revisarse en administración; no se selecciona ni suma ninguno automáticamente.',
};

export function CollectionSummary({ summary, className }: { summary: CollectionQueue['summary']; className?: string | undefined }) {
  return <section className={className} aria-label="Resumen de atenciones completadas"><h2>Resumen operativo</h2>
    <p>{summary.completedCount} atenciones completadas antes del filtro de estado.</p>
    <div className="collection-operating-summary">
      <dl className="collection-verified-balance"><div><dt>Saldo pendiente verificado</dt><dd>{formatMoney(summary.verifiedPendingBalance)}</dd></div></dl>
      <dl className="collection-summary">{(['PENDING', 'PARTIAL', 'NO_CHARGE', 'REVIEW_REQUIRED'] as const).map(key => <div key={key} data-state={key}><dt>{COLLECTION_LABELS[key]}</dt><dd>{summary.counts[key]}</dd></div>)}</dl>
    </div>
    <p>Liquidados: {summary.counts.SETTLED}. El saldo excluye atenciones sin cargo y conjuntos que requieren revisión; no estima su valor.</p>
  </section>;
}

export function CollectionRow({ row, zone, returnTo, className, badgeClassName }: {
  row: CollectionQueue['content'][number]; zone: string | undefined; returnTo: string;
  className?: string | undefined; badgeClassName?: string | undefined;
}) {
  const a = row.appointment;
  const showMoney = row.collectionState !== 'NO_CHARGE' && row.collectionState !== 'REVIEW_REQUIRED' && row.totalAmount != null && row.appliedAmount != null && row.pendingBalance != null && row.currency === 'MXN';
  return <li className={className}><header><div><h3>{a.patientFirstName} {a.patientLastName}</h3><p className="collection-row-reference">Atención #{a.id} · Clínica: Completada</p></div><strong className={badgeClassName} data-state={row.collectionState}>{COLLECTION_LABELS[row.collectionState]}</strong></header>
    <p>{a.service?.name ?? 'Sin servicio histórico'} · {zone ? `${formatDayLong(a.startAt, zone)} · ${formatTime(a.startAt, zone)}` : `Inicio: ${a.startAt}`} · {a.dentistFirstName} {a.dentistLastName}</p>
    {showMoney ? <FinancialAmounts total={row.totalAmount!} applied={row.appliedAmount!} balance={row.pendingBalance!} labels={['Total', 'Aplicado', 'Saldo']} appearance="collection" />
      : <p>{row.collectionState === 'NO_CHARGE' ? 'Sin importe de deuda registrado. El precio de referencia no es un cargo.' : 'Importes no disponibles: requiere revisión.'}</p>}
    {row.reviewReason ? <p>{reasons[row.reviewReason] ?? 'Se requiere revisión administrativa antes de operar.'}</p> : null}
    {row.reviewReason ? <Link className="reception-text-button" to={`/finances?appointmentId=${a.id}&patientId=${a.patientId}`}>Gestión administrativa de esta atención</Link> : null}
    <ActionGroup className="collection-row-actions">
      <Link className="reception-button" to={`/collections/${a.id}?returnTo=${encodeURIComponent(returnTo)}`}>Gestionar cobro</Link>
      <Link className="reception-text-button" to={`/appointments/${a.id}?returnTo=${encodeURIComponent(returnTo)}`}>Ver detalle de la cita</Link>
    </ActionGroup>
  </li>;
}

export function CollectionTotals({ total, applied, balance }: { total: string; applied: string; balance: string }) {
  return <FinancialAmounts total={total} applied={applied} balance={balance} appearance="collection" labels={['Total del cargo', 'Pagos aplicados', 'Saldo real']} />;
}
