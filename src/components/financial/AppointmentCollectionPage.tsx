import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appointmentsApi, type AppointmentResponse } from '../../api/appointments';
import { collectionApi, type CollectionInput, type CollectionResult } from '../../api/collection';
import { ApiError } from '../../api/http';
import type { PaymentMethod } from '../../api/financial';
import { useAuthStore } from '../../app/authStore';
import { collectionReturn } from '../../app/collectionLinks';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { useVerifiedOperation } from '../../app/useVerifiedOperation';
import { cents, formatMoney } from '../../lib/financialMoney';
import { chargePlan, collectionCommand, paymentAmount, PAYMENT_METHODS, validateResult, type ChargePlan, type PaymentChoice } from './collectionModel';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';
import { schedulingApi } from '../../api/scheduling';
import { CollectionTotals as FinancialTotals } from './CollectionPresentation';
import { ActionGroup } from '../ui/ActionGroup';
import './collection.css';

export function AppointmentCollectionPage() {
  const { id } = useParams();
  const role = useAuthStore(s => s.user?.role);
  const aid = Number(id);
  const allowed = role === 'OWNER' || role === 'RECEPTIONIST';
  const valid = Number.isSafeInteger(aid) && aid > 0;
  const a = useQuery({ queryKey: ['appointment', aid], queryFn: () => appointmentsApi.get(aid), enabled: allowed && valid, retry: false });
  if (!allowed) return <p role="alert">No tienes permiso para gestionar cobros.</p>;
  if (!valid || (a.error instanceof ApiError && [403, 404].includes(a.error.status))) return <p role="alert">No se puede acceder a esta atención.</p>;
  if (a.isPending) return <p role="status">Consultando atención…</p>;
  if (!a.data) return <div className="reception-page"><p role="alert">No se pudo consultar la atención.</p><button type="button" onClick={() => void a.refetch()}>Reintentar atención</button></div>;
  return <CollectionWorkspace key={`${role}-${aid}`} appointment={a.data} appointmentFailed={a.isError} />;
}

function CollectionWorkspace({ appointment: a, appointmentFailed }: { appointment: AppointmentResponse; appointmentFailed: boolean }) {
  const client = useQueryClient();
  const session = useAuthStore(s => s.sessionVersion);
  const [params] = useSearchParams();
  const returnTo = collectionReturn(params.get('returnTo')) ?? '/collections';
  const contextKey = ['appointment-financial-context', a.id];
  const financial = useQuery({ queryKey: contextKey, queryFn: () => collectionApi.context(a.id), retry: false, refetchOnMount: 'always', refetchOnWindowFocus: false });
  const schedule = useQuery({ queryKey: ['public-schedule'], queryFn: () => schedulingApi.getPublicSchedule() });
  const zone = schedule.data?.timezone ?? 'UTC';
  const operation = useVerifiedOperation<CollectionInput, CollectionResult>('collection', a.id);
  const { op } = operation;
  const [choice, setChoice] = useState<PaymentChoice>('none');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [consentedReview, setConsentedReview] = useState<CollectionInput | null>(null);
  const [review, setReview] = useState<CollectionInput | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = !op && Boolean(choice !== 'none' || amount || review);
  useUnsavedChanges(Boolean(dirty));
  useEffect(() => { heading.current?.focus(); }, [review, op?.state]);
  let plan: ChargePlan | undefined, blocked = '';
  if (financial.data && !financial.isError) {
    try { plan = chargePlan(financial.data, a); } catch (cause) { blocked = (cause as Error).message; }
  }
  let payment = '', paymentError = '';
  if (plan) try { payment = paymentAmount(plan, choice, amount); } catch (cause) { paymentError = (cause as Error).message; }
  const stale = Boolean(review && (review.financialContextToken !== financial.data?.financialContextToken || review.expectedOccurrenceVersion !== a.occurrenceVersion));
  // Consent belongs to this exact read-only review, including its payment, not just its charge.
  const consent = Boolean(review && consentedReview === review && !stale);
  const eligible = a.status === 'COMPLETED';
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setChecking(true); setMessage('');
    try {
      const [appointment, context] = await Promise.all([appointmentsApi.get(a.id), collectionApi.context(a.id)]);
      if (useAuthStore.getState().sessionVersion !== session) return;
      client.setQueryData(['appointment', a.id], appointment); client.setQueryData(contextKey, context);
      if (op?.state !== 'uncertain' && op?.state !== 'pending') { operation.clearRejected(); setReview(null); setConsentedReview(null); setChoice('none'); setAmount(''); }
      else setMessage('Estado actual consultado. Esta lectura no prueba el resultado de tu solicitud; conserva la misma clave para recuperarlo.');
    } catch { setMessage('No se pudo verificar la atención y sus finanzas. No registres otra operación. Reintenta la consulta.'); }
    finally { lock.current = false; setChecking(false); }
  }
  async function prepareReview() {
    if (lock.current || !eligible || !plan || paymentError || !financial.data || financial.isError || financial.isFetching || appointmentFailed) return;
    lock.current = true; setChecking(true); setMessage(''); setConsentedReview(null);
    try {
      const [appointment, context] = await Promise.all([appointmentsApi.get(a.id), collectionApi.context(a.id)]);
      if (useAuthStore.getState().sessionVersion !== session) return;
      client.setQueryData(['appointment', a.id], appointment); client.setQueryData(contextKey, context);
      if (appointment.status !== 'COMPLETED' || appointment.occurrenceVersion !== a.occurrenceVersion || context.financialContextToken !== financial.data.financialContextToken) {
        setReview(null); throw new Error('El contexto cambió. Revisa los importes actualizados antes de continuar.');
      }
      // A command-shaped draft only: confirmed:true is never sent without consent on step 2.
      setReview(collectionCommand(context, chargePlan(context, appointment), choice, amount, method));
    } catch (cause) { setMessage(cause instanceof ApiError ? 'No se pudo verificar el contexto. Actualiza antes de confirmar.' : (cause as Error).message); }
    finally { lock.current = false; setChecking(false); }
  }
  function confirm() {
    const role = useAuthStore.getState().user?.role;
    if (role !== 'OWNER' && role !== 'RECEPTIONIST') return;
    if (!op && (!review || !plan || stale || !eligible || appointmentFailed || financial.isError || financial.isFetching || !consent)) return;
    const input = op?.input ?? review!;
    void operation.send(input, (body, key) => collectionApi.confirm(a.id, body, key), (result, body) => validateResult(result, a, body), () => {
      // Collection never patches the clinical appointment or fabricates financial balances.
      for (const key of [['collection-queue'], contextKey, ['financial-charges'], ['financial-report'], ['financial-charge'], ['financial-appointment'], ['appointments']]) void client.invalidateQueries({ queryKey: key });
    });
  }
  const admin = `/finances?appointmentId=${a.id}&patientId=${a.patientId}`;
  return <div className="clinical-editorial reception-page collection-page collection-editorial collection-workspace">
    <Link className="reception-text-button" to={returnTo}>Volver a atenciones por cobrar</Link>
    <ReceptionPageHeader title="Cobro de la atención" intro={`${a.patientFirstName} ${a.patientLastName} · ${a.service?.name ?? 'Sin servicio histórico'} · Cita #${a.id}`} />
    <p className="reception-readonly-note">{formatDayLong(a.startAt, zone)} · {formatTime(a.startAt, zone)} ({zone}) · Profesional: {a.dentistFirstName} {a.dentistLastName}. Estado clínico: {a.status === 'COMPLETED' ? 'Completada' : a.status}. El cobro no lo modifica.</p>
    {!op ? <ol className="collection-progress" aria-label="Progreso del cobro">{['Preparar cobro', 'Revisar y confirmar'].map((label, i) => <li key={label} aria-current={(review ? 1 : 0) === i ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol> : null}
    <div className={`collection-workspace-grid${op ? ' collection-workspace-grid--result' : ''}`}>
    <section className="reception-section collection-operation" aria-busy={checking || op?.state === 'pending'}>
      <h2 ref={heading} tabIndex={-1}>{op?.state === 'success' ? 'Cobro confirmado' : op ? 'Resultado de la solicitud' : review ? 'Revisar y confirmar' : 'Preparar cobro'}</h2>
      {message ? <p role="alert">{message}</p> : null}
      {op?.state === 'success' && op.result ? <>
        <p role="status">Cobro confirmado por el servidor. La cita permanece COMPLETED.</p>
        <FinancialTotals total={op.result.financialAtCollection.totalAmount} applied={op.result.financialAtCollection.appliedAmount} balance={op.result.financialAtCollection.pendingBalance} />
        <p>Cargo #{op.result.financialAtCollection.chargeId} · {op.result.financialAtCollection.status} · {op.result.financialAtCollection.paymentId ? `Nuevo pago #${op.result.financialAtCollection.paymentId}: ${formatMoney(op.result.financialAtCollection.paymentAmount!)}` : 'Sin pago nuevo.'}</p>
        <p className="reception-readonly-note">Snapshot del cobro confirmado, no saldo actual ante movimientos posteriores. Referencia interna, no comprobante fiscal.</p>
        <ActionGroup className="collection-actions"><Link className="reception-button" to={returnTo}>Volver a la bandeja</Link><button type="button" className="reception-button reception-button-secondary" disabled={checking} onClick={() => void refresh()}>Consultar contexto para otro abono</button><Link className="reception-text-button" to={`/finances/${op.result.financialAtCollection.chargeId}`}>Abrir cargo administrativo</Link></ActionGroup>
      </> : op ? <>
        <p role={op.state === 'pending' ? 'status' : 'alert'}>{op.state === 'pending' ? 'Confirmando cobro… No registres otro pago.' : op.message}</p>
        <p>Solicitud conservada: {op.input.charge.action === 'REUSE' ? `reutilizar cargo #${op.input.charge.chargeId}` : 'crear cargo desde el snapshot histórico'} · {op.input.payment.action === 'REGISTER' ? formatMoney(op.input.payment.amount) : 'sin pago nuevo'}.</p>
        {op.state === 'uncertain' ? <p className="reception-readonly-note">Conserva esta sesión. Recargar o cerrar sesión pierde la copia en memoria; no se almacena en el navegador.</p> : null}
        <div className="collection-actions">{op.state === 'uncertain' ? <button type="button" className="reception-button" onClick={confirm}>Recuperar con la misma solicitud</button> : null}{op.state !== 'pending' ? <button type="button" className="reception-button reception-button-secondary" disabled={checking} onClick={() => void refresh()}>{op.state === 'rejected' ? 'Actualizar contexto y revisar de nuevo' : 'Verificar estado del servidor'}</button> : null}<Link className="reception-text-button" to={admin}>Gestión administrativa</Link></div>
      </> : <>
        {!eligible ? <p role="alert">Solo se pueden cobrar atenciones clínicamente completadas.</p> : null}
        {financial.isFetching ? <p role="status">Consultando contexto financiero…</p> : null}
        {financial.isError || appointmentFailed ? <p role="alert">No se pudo verificar el contexto financiero completo o el acceso a la cita. Actualiza para continuar.</p> : null}
        {blocked ? <p role="alert">{blocked}</p> : null}
        {blocked || financial.isError ? <Link className="reception-text-button" to={admin}>Revisar en gestión administrativa</Link> : null}
        {plan && !financial.isError ? <>
          {!review ? <>
            <section className="collection-decision" aria-labelledby="collection-charge-title">
            <h3 id="collection-charge-title">{plan.charge ? `Cargo activo #${plan.charge.id}` : 'Propuesta de cargo'}</h3><p>{plan.description}</p>
            <p>{plan.charge ? 'Único cargo activo verificado, seleccionado para reutilizar. No se creará otro ni se repetirán pagos anteriores.' : 'Sin cargo registrado activo. Solo se propone crear un cargo con el precio histórico verificado.'}</p>
            </section>
            <section className="collection-decision" aria-labelledby="collection-payment-title">
            <h3 id="collection-payment-title">¿Registrar un pago ahora?</h3>
            <fieldset className="collection-options"><legend className="sr-only">Nuevo pago</legend>{([['full', 'Pago completo', 'Liquida el saldo disponible para este cobro.'], ['partial', 'Pago parcial', 'Registra un abono menor que el saldo.'], ['none', 'Sin pago nuevo', 'No registra dinero recibido en esta operación.']] as const).map(([value, label, hint]) => <label key={value} className="collection-choice collection-payment-choice"><input type="radio" name="collection-payment" aria-label={label} checked={choice === value} disabled={value !== 'none' && cents(plan!.balance) === 0n} onChange={() => setChoice(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>
            {cents(plan.balance) === 0n ? <p className="reception-readonly-note">Este cargo está liquidado. No se permiten nuevos pagos con saldo cero.</p> : null}
            <div className="collection-payment-fields">
             {choice !== 'none' ? <label className="collection-field">Método de pago<select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>{Object.entries(PAYMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
             {choice === 'partial' ? <label className="collection-field">Importe abonado (MXN)<input aria-label="Importe abonado (MXN)" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={Boolean(paymentError)} aria-describedby="collection-amount-error" /><span id="collection-amount-error">{paymentError || 'Máximo dos decimales; menor que el saldo pendiente.'}</span></label> : null}
            </div></section>
          </> : <div className="collection-review"><p>Revisión sin efectos: todavía no se ha creado el cargo ni registrado el pago.</p><dl><div><dt>Paciente y atención</dt><dd>{a.patientFirstName} {a.patientLastName} · Cita #{a.id} · {a.service?.name ?? 'Sin servicio histórico'}</dd></div><div><dt>Operación sobre el cargo</dt><dd>{review.charge.action === 'REUSE' ? `Reutilizar cargo #${review.charge.chargeId}` : 'Crear cargo con precio histórico'}</dd></div><div><dt>Total del cargo {plan.charge ? 'existente' : 'propuesto'}</dt><dd>{formatMoney(review.charge.expectedTotal)}</dd></div><div><dt>Nuevo pago</dt><dd>{review.payment.action === 'REGISTER' ? `${formatMoney(review.payment.amount)} · ${PAYMENT_METHODS[review.payment.method]}` : 'Sin pago nuevo'}</dd></div></dl><p>La cita seguirá COMPLETED; no se modifica ningún registro clínico.</p>
            <label className="collection-choice collection-final-consent"><input type="checkbox" checked={consent} disabled={stale || checking || financial.isFetching || financial.isError || appointmentFailed || !eligible} onChange={e => setConsentedReview(e.target.checked ? review : null)} />Confirmo expresamente {review.charge.action === 'REUSE' ? `reutilizar el cargo #${review.charge.chargeId}` : 'crear el cargo desde el snapshot histórico'} por {formatMoney(review.charge.expectedTotal)}{review.payment.action === 'REGISTER' ? ` y registrar un nuevo pago de ${formatMoney(review.payment.amount)} mediante ${PAYMENT_METHODS[review.payment.method]}` : ', sin registrar un pago nuevo'}.</label>
          </div>}
          {!paymentError ? <p>Nuevo pago previsto: {formatMoney(payment)}. El saldo definitivo lo devuelve el servidor.</p> : null}
          {choice === 'none' ? <p className="reception-readonly-note">Sin pago nuevo no cancela el cargo ni elimina abonos anteriores. La creación del cargo sí requiere tu confirmación.</p> : null}
          {stale ? <p role="alert">El contexto cambió. Vuelve al cargo y confirma nuevamente los datos actualizados.</p> : null}
          <ActionGroup className="collection-actions collection-footer">{review ? <button type="button" className="reception-button reception-button-secondary" disabled={checking} onClick={() => { setReview(null); setConsentedReview(null); }}>Anterior</button> : null}<button type="button" className="reception-button" disabled={checking || financial.isFetching || !eligible || appointmentFailed || financial.isError || (Boolean(review) && !consent) || Boolean(paymentError) || stale} onClick={() => void (review ? confirm() : prepareReview())}>{checking ? 'Verificando…' : review ? 'Confirmar cobro' : 'Revisar cobro'}</button></ActionGroup>
        </> : null}
        <button type="button" className="reception-text-button" disabled={checking} onClick={() => void refresh()}>Actualizar contexto financiero</button>
      </>}
    </section>
    {!op && plan && !financial.isError && !appointmentFailed ? <aside className="collection-financial-summary" aria-label="Resumen financiero del cobro">
      <h2>{plan.charge ? 'Saldo del cargo verificado' : 'Propuesta, no deuda registrada'}</h2>
      {plan.charge ? <FinancialTotals total={plan.total} applied={plan.applied} balance={plan.balance} /> : <><p className="collection-proposed-price">Precio histórico propuesto: <strong>{formatMoney(plan.total)}</strong></p><p>No es deuda registrada. No se creará un cargo hasta tu confirmación final.</p></>}
      <p className="reception-readonly-note">{plan.charge ? `Cargo #${plan.charge.id} · Importes de la consulta financiera.` : 'La propuesta no se suma a la cartera pendiente.'} El saldo definitivo lo devuelve el servidor.</p>
      {plan.charge ? <details className="collection-history"><summary>Conceptos y pagos anteriores</summary><ul>{plan.charge.items.map(i => <li key={i.id}>{i.description} · {i.quantity} × {formatMoney(i.unitPrice)} = {formatMoney(i.lineTotal)}</li>)}</ul>{plan.charge.movements.length ? <ul>{plan.charge.movements.map(m => <li key={m.id}>{m.type === 'PAYMENT' ? 'Pago' : 'Reversa'} #{m.id} · {formatMoney(m.amount)}</li>)}</ul> : <p>No hay pagos anteriores.</p>}</details> : null}
    </aside> : null}
    </div>
  </div>;
}
