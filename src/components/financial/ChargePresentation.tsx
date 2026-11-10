import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Charge, FinancialMovement } from '../../api/financial';
import { formatMoney } from '../../lib/financialMoney';
import { financialDate, METHOD_LABELS, STATUS_LABELS } from './financialUi';
import { ChargeStatusChip, ChargeStatusMark } from './ReceptionFinances';
import { FinancialTable } from './ReportPresentation';

export function FinancialAmounts({ total, applied, balance, labels = ['Total del cargo', 'Pagos aplicados', 'Saldo pendiente'], appearance = 'charge' }: {
  total: string; applied: string; balance: string; labels?: readonly [string, string, string]; appearance?: 'charge' | 'collection';
}) {
  return <dl className={appearance === 'collection' ? 'collection-totals' : 'reception-finances-figures mt-4'}>
    {[total, applied, balance].map((value, index) => <div key={labels[index]}
      className={appearance === 'collection' ? undefined : `reception-finances-figure${index === 2 ? '' : ' reception-finances-figure--secondary'}`}>
      <dt className={appearance === 'collection' ? undefined : 'reception-finances-figure-label'}>{labels[index]}</dt>
      <dd className={appearance === 'collection' ? undefined : 'reception-finances-figure-value reception-finances-amount'}><span className={appearance === 'collection' ? 'collection-money-value' : 'financial-money-value'} tabIndex={appearance === 'collection' ? undefined : 0}>{formatMoney(value)}</span></dd>
    </div>)}
  </dl>;
}

export function ChargeSummary({ charge, refresh, note }: { charge: Charge; refresh: ReactNode; note: string }) {
  return <section aria-label="Estado financiero vigente" className="reception-card">
    <div className="reception-finances-status-line"><h2 className="text-[length:var(--text-h5)]">Estado vigente: {STATUS_LABELS[charge.status]}</h2>
      <ChargeStatusChip status={charge.status} />{refresh}</div>
    <FinancialAmounts total={charge.totalAmount} applied={charge.appliedAmount} balance={charge.pendingBalance} />
    <p className="mt-4 text-[length:var(--text-body-sm)] text-ink-secondary">{note}</p>
  </section>;
}

export function ChargeConcepts({ charge }: { charge: Charge }) {
  return <section className="reception-card" aria-label="Conceptos históricos">
    <h2 className="text-[length:var(--text-h5)]">Conceptos históricos</h2>
    <ul className="reception-finances-items">{(charge.items ?? []).map(item => <li key={item.id}>
      <p className="reception-finances-items-description">{item.description}</p>
      <p className="reception-finances-items-quantity reception-finances-amount">{item.quantity} × {formatMoney(item.unitPrice)} · {formatMoney(item.lineTotal)}</p>
    </li>)}</ul>
    {charge.notes ? <p className="mt-3 whitespace-pre-wrap break-words">Notas administrativas: {charge.notes}</p> : null}
    <p className="mt-3 text-[length:var(--text-body-sm)] text-ink-secondary">Confirmado: {financialDate(charge.confirmedAt)} · Usuario #{charge.confirmedByUserId}</p>
    {charge.cancelledAt ? <p className="mt-3 whitespace-pre-wrap break-words text-ink-secondary">Anulado: {financialDate(charge.cancelledAt)} · Usuario #{charge.cancelledByUserId}. Motivo: {charge.cancellationReason}</p> : null}
  </section>;
}

export function ChargeMovements({ movements, reversed, renderAction }: {
  movements: readonly FinancialMovement[]; reversed: ReadonlySet<number | null | undefined>; renderAction: (movement: FinancialMovement) => ReactNode;
}) {
  return <section aria-label="Historial financiero" className="reception-card">
    <h2 className="text-[length:var(--text-h5)]">Historial de movimientos</h2>
    {movements.length === 0 ? <p className="mt-3 text-ink-secondary">Todavía no hay movimientos.</p> : <ol className="reception-finances-movements">
      {movements.map(movement => <li key={movement.id} className="reception-finances-movement grid min-w-0 gap-2">
        <p className="font-medium tabular-nums">Movimiento #{movement.id} · {movement.type === 'REVERSAL' ? 'Reversa completa' : reversed.has(movement.id) ? 'Pago revertido' : 'Pago aplicado'} · {formatMoney(movement.amount)}</p>
        <p className="reception-finances-movement-meta">{movement.paymentMethod ? `${METHOD_LABELS[movement.paymentMethod]} · ` : ''}{financialDate(movement.performedAt)} · Usuario #{movement.performedByUserId}{movement.reversesMovementId ? ` · Revierte movimiento #${movement.reversesMovementId}` : ''}</p>
        {movement.reason ? <p className="reception-finances-movement-reason">Motivo: {movement.reason}</p> : null}
        {renderAction(movement)}
      </li>)}
    </ol>}
  </section>;
}

export function ChargeTable({ charges }: { charges: readonly Charge[] }) {
  return <FinancialTable label="Tabla de cargos autorizados" caption="Cargos confirmados, importes y estado calculado por el servidor"
    columns={['Cargo / paciente', 'Confirmación', 'Total', 'Aplicado', 'Saldo', 'Estado']} numeric={['Total', 'Aplicado', 'Saldo']}>
    {charges.map(charge => <tr key={charge.id}>
      <td className="px-4 py-3"><Link className="reception-finances-cell-link" to={`/finances/${charge.id}`}>Cargo #{charge.id}</Link><p className="reception-finances-cell-meta">Paciente #{charge.patientId}{charge.appointmentId ? ` · Cita #${charge.appointmentId}` : ''}</p></td>
      <td className="px-4 py-3"><span className="reception-finances-date">{financialDate(charge.confirmedAt)}</span></td>
      <td className="reception-finances-amount reception-finances-amount--right whitespace-nowrap px-4 py-3">{formatMoney(charge.totalAmount)}</td>
      <td className="reception-finances-amount reception-finances-amount--right whitespace-nowrap px-4 py-3">{formatMoney(charge.appliedAmount)}</td>
      <td className={`reception-finances-amount reception-finances-amount--right reception-finances-balance whitespace-nowrap px-4 py-3${charge.status === 'PAGADO' ? ' reception-finances-balance--settled' : ''}`}>{formatMoney(charge.pendingBalance)}</td>
      <td className={`px-4 py-3 font-medium reception-status-${charge.status.toLowerCase()}`}><ChargeStatusMark status={charge.status} />{STATUS_LABELS[charge.status]}</td>
    </tr>)}
  </FinancialTable>;
}
