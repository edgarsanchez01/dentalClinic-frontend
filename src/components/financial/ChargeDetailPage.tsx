import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { type Charge, type FinancialMovement, type PaymentInput, type PaymentMethod, type ReasonInput } from '../../api/financial';
import type { FinancialIntentView } from '../../api/financialIntents';
import { useAuthStore } from '../../app/authStore';
import { cents, formatMoney, normalizeMoney, positiveId } from '../../lib/financialMoney';
import { Field, FormAlert } from '../auth/ui';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import { FinancialOperationFeedback } from './FinancialOperationFeedback';
import { useCharge, useFinancialPatient } from './financialQueries';
import { control, danger, financialError, canManageCharges, hasFinancialAccess, METHOD_LABELS, patientLabel, primary, secondary, STATUS_LABELS, useIsReception } from './financialUi';
import { useFinancialOperation } from './useFinancialOperation';
import { FINANCIAL_PAGE_CLASS } from './financialPresentation';
import { ChargeSummary, ChargeConcepts, ChargeMovements } from './ChargePresentation';

export function ChargeDetailPage() {
  const { id } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  if (!hasFinancialAccess(role)) return null;
  const chargeId = positiveId(id ?? null);
  if (chargeId === null) return <FormAlert>El identificador del cargo no es válido.</FormAlert>;
  return <CurrentCharge key={chargeId} id={chargeId} />;
}

function CurrentCharge({ id }: { id: number }) {
  const user = useAuthStore((state) => state.user);
  const query = useCharge(id);
  const patient = useFinancialPatient(query.data?.patientId ?? null);
  const client = useQueryClient();
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(() => (location.state as { financialNotice?: string } | null)?.financialNotice ?? null);
  const [correction, setCorrection] = useState<FinancialMovement | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  async function reload(message: string, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    await client.invalidateQueries({ queryKey: ['financial-charges'], refetchType: 'none' });
    if (!isCurrent()) return;
    const current = await query.refetch();
    if (!isCurrent()) return;
    if (current.isError) throw new Error('No se pudo consultar el estado vigente.');
    setNotice(message); setCorrection(null);
  }
  if (query.isPending) return <p role="status" className="p-5 text-ink-muted">Cargando cargo…</p>;
  if (query.isError) return <div className="grid justify-items-start gap-3 p-5">
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    {client.getQueriesData<{ phase: string }>({ queryKey: ['financial-intents'] }).some(([key, intent]) =>
      (key[1] === `payment:${id}` || String(key[1]).startsWith(`correction:${id}:`)) && intent?.phase === 'confirmed')
      ? <FormAlert tone="success">La última operación fue registrada. Reintenta consultar el detalle; no repitas la escritura.</FormAlert> : null}
    <FormAlert>{financialError(query.error)}</FormAlert>
    <button className={secondary} onClick={() => void query.refetch()}>Reintentar detalle</button><Link className="underline" to="/finances">Volver a finanzas</Link></div>;
  const charge = query.data;
  const movements = charge.movements ?? [];
  const reversed = new Set(movements.filter((movement) => movement.type === 'REVERSAL').map((movement) => movement.reversesMovementId));
  return <div className={FINANCIAL_PAGE_CLASS}>
    <ReceptionPageHeader
      title={`Cargo #${charge.id}`}
      intro={`${patientLabel(patient.data, charge.patientId)}${charge.appointmentId ? ` · Cita #${charge.appointmentId}` : ' · Sin cita vinculada'} · ${STATUS_LABELS[charge.status]}`}
      action={<>
        <Link className="reception-button reception-button-secondary" to="/finances">Volver a finanzas</Link>
        <Link className="reception-button reception-button-secondary" to={`/patients/${charge.patientId}`}>Ver paciente</Link>
        {charge.appointmentId ? <Link className="reception-button reception-button-secondary" to={`/appointments/${charge.appointmentId}`}>Ver cita</Link> : null}
      </>}
    />
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    <ChargeSummary charge={charge}
      note={user?.role === 'OWNER' ? 'Calculado por el servidor a partir de pagos válidos. Los recibos de escritura no sustituyen esta consulta.' : 'Calculado por el servidor a partir de pagos válidos.'}
      refresh={<button type="button" className="reception-finances-refresh" disabled={busy || query.isFetching}
        title="Consulta de solo lectura; no registra operaciones" onClick={() => void query.refetch()}>Consultar estado vigente</button>} />
    <ChargeConcepts charge={charge} />
    {canManageCharges(user?.role) ? <PaymentForm charge={charge} blocked={busy} onBusy={setBusy} onSaved={(_, isCurrent) => reload('Pago registrado. El saldo mostrado procede de una nueva consulta.', isCurrent)} /> : null}
    <ChargeMovements movements={movements} reversed={reversed} renderAction={movement =>
      user?.role === 'OWNER' && movement.type === 'PAYMENT' && !reversed.has(movement.id) ? <button className={`${secondary} justify-self-start`} disabled={busy || correction !== null}
        onClick={() => { setNotice(null); setCorrection(movement); }}>Reversar pago #{movement.id}</button> : null} />
    {user?.role === 'OWNER' && charge.status !== 'ANULADO' ? <section className="grid justify-items-start gap-3">
      <button className={danger} disabled={busy || correction !== null || cents(charge.appliedAmount) !== 0n} onClick={() => { setNotice(null); setCorrection('cancel'); }}>Anular cargo</button>
      {cents(charge.appliedAmount) !== 0n ? <p className="text-ink-secondary">Para anular el cargo, primero deben reversarse sus pagos válidos.</p> : null}
    </section> : null}
    {user?.role === 'OWNER' && correction ? <CorrectionForm key={correction === 'cancel' ? 'cancel' : correction.id}
      chargeId={charge.id} target={correction} onBusy={setBusy} onClose={() => setCorrection(null)}
      onSaved={(_, isCurrent) => reload(correction === 'cancel' ? 'Cargo anulado. Estado vigente consultado.' : 'Pago reversado completamente. Saldo vigente consultado.', isCurrent)} /> : null}
  </div>;
}

function PaymentForm({ charge, blocked, onBusy, onSaved }: {
  charge: Charge; blocked: boolean; onBusy: (pending: boolean) => void; onSaved: (view: FinancialIntentView, isCurrent: () => boolean) => Promise<void>;
}) {
  const reception = useIsReception();
  const operation = useFinancialOperation<PaymentInput>(`payment:${charge.id}`, 'FIN_REGISTER_PAYMENT',
    input => ({ ...input, chargeId: charge.id }), onSaved, 'write');
  const [amount, setAmount] = useState(operation.intent?.payload?.amount ?? '');
  const [method, setMethod] = useState<PaymentMethod>(operation.intent?.payload?.method ?? 'CASH');
  const [reason, setReason] = useState(operation.intent?.payload?.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const allowNew = charge.status === 'PENDIENTE' || charge.status === 'PARCIAL';
  if (!allowNew && (!operation.intent || (operation.intent.phase === 'confirmed' && !operation.intent.message))) return null;
  async function submit() {
    setError(null);
    const normalized = normalizeMoney(amount);
    if (!normalized || cents(normalized) <= 0n) { setError('Escribe un importe positivo con hasta dos decimales.'); return; }
    if (cents(normalized) > cents(charge.pendingBalance)) { setError('El importe supera el saldo vigente. Consulta el saldo antes de registrar.'); return; }
    onBusy(true);
    try { await operation.submit({ amount: normalized, method, reason: reason.trim() || null }); }
    finally { onBusy(false); }
  }
  return <section aria-label="Registro manual de pago" className="reception-card reception-finances-payment">
    <h2 className="text-[length:var(--text-h5)]">Registrar pago manual</h2>
    <p className="reception-finances-payment-lead">{reception ? 'Registra un ' : 'Registra aquí un '}<strong>cobro real ya recibido fuera del sistema</strong> (efectivo, terminal externa o transferencia). El sistema no procesa pagos: solo anota el importe contra el cargo.</p>
    <div className="reception-finances-payment-balance">
      <span className="reception-finances-payment-balance-label">Saldo disponible del servidor</span>
      <span className="reception-finances-payment-balance-value reception-finances-amount">{formatMoney(charge.pendingBalance)}</span>
    </div>
    {!reception ? <p className="reception-finances-cell-meta">Consultar el saldo de arriba es solo lectura; registrar el pago es una operación que queda en el historial.</p> : null}
    <FinancialOperationFeedback {...operation} />
    {operation.intent?.phase === 'confirmed' ? <button className={`${secondary} mt-3`} disabled={blocked || operation.pending || !allowNew || Boolean(operation.intent.message)}
      onClick={() => { operation.startNew(); setAmount(''); setReason(''); }}>Registrar otro pago</button> : <form className="mt-4 grid gap-3" aria-label="Registrar pago manual" noValidate
      onSubmit={(event) => { event.preventDefault(); if (!blocked && !operation.locked && allowNew) void submit(); }}>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <fieldset disabled={blocked || operation.locked || !allowNew} className={reception ? 'reception-finances-payment-fields' : 'grid min-w-0 gap-4 sm:grid-cols-2'}>
        <Field id="payment-amount" label="Importe del pago (MXN)" inputMode="decimal" value={amount} onChange={setAmount}
          {...(operation.intent?.fieldErrors?.amount ? { error: operation.intent.fieldErrors.amount } : {})} />
        <div><label htmlFor="payment-method">Método de pago</label><select id="payment-method" className={control} value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
          {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <div className={reception ? undefined : 'sm:col-span-2'}><Field id="payment-reason" label="Nota del pago (opcional)" required={false} value={reason} onChange={setReason} /></div>
      </fieldset>
      <button type="submit" className={`${primary} justify-self-start`} disabled={blocked || operation.locked || !allowNew}>{operation.pending ? 'Registrando pago…' : 'Registrar pago'}</button>
    </form>}
  </section>;
}

function CorrectionForm({ chargeId, target, onBusy, onClose, onSaved }: {
  chargeId: number; target: FinancialMovement | 'cancel'; onBusy: (pending: boolean) => void;
  onClose: () => void; onSaved: (view: FinancialIntentView, isCurrent: () => boolean) => Promise<void>;
}) {
  const operation = useFinancialOperation<ReasonInput>(`correction:${chargeId}:${target === 'cancel' ? 'cancel' : target.id}`,
    target === 'cancel' ? 'FIN_CANCEL_CHARGE' : 'FIN_REVERSE_PAYMENT',
    input => ({ ...input, chargeId, ...(target === 'cancel' ? {} : { movementId: target.id }) }), onSaved, 'owner');
  const [reason, setReason] = useState(operation.intent?.payload?.reason ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.getElementById('correction-reason')?.focus(); }, []);
  return <section aria-label="Confirmación de operación financiera" className="reception-card">
    <h2 className="text-[length:var(--text-h5)]">{target === 'cancel' ? 'Confirmar anulación del cargo' : `Reversar completamente el pago #${target.id}`}</h2>
    <p className="mt-2 max-w-prose text-ink-secondary">{target === 'cancel' ? 'El cargo quedará anulado. Sus conceptos e historial se conservan.'
      : `Se compensará todo el pago de ${formatMoney(target.amount)} y dejará de contar como importe aplicado. El original no se elimina.`}</p>
    <FinancialOperationFeedback {...operation} />
    <form className="mt-4 grid gap-3" noValidate aria-label="Confirmar corrección financiera" onSubmit={async (event) => {
      event.preventDefault(); if (operation.locked) return;
      if (!reason.trim() || !confirmed) { setError('Escribe el motivo y confirma explícitamente la operación.'); return; }
      setError(null); onBusy(true);
      try { await operation.submit({ reason: reason.trim() }); } finally { onBusy(false); }
    }}>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <fieldset disabled={operation.locked} className="grid gap-3">
        <Field id="correction-reason" label="Motivo obligatorio" value={reason} onChange={setReason} />
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4" />Confirmo esta operación y sus consecuencias</label>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="submit" className={danger} disabled={operation.locked}>{operation.pending ? 'Guardando…' : target === 'cancel' ? 'Confirmar anulación' : 'Confirmar reversa completa'}</button>
        <button type="button" className={secondary} disabled={operation.locked} onClick={onClose}>Volver sin operar</button></div>
    </form>
  </section>;
}
