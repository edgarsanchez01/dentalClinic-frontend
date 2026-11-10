import type { AppointmentResponse } from '../../api/appointments';
import type { AppointmentFinancialContext, CollectionInput, CollectionResult, ContextCharge } from '../../api/collection';
import type { PaymentMethod } from '../../api/financial';
import { cents, moneyFromCents, normalizeMoney } from '../../lib/financialMoney';

export const PAYMENT_METHODS: Record<PaymentMethod, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro' };
export type PaymentChoice = 'full' | 'partial' | 'none';
export const collectionOperationKey = (actor: number | undefined, appointment: number) => ['collection-operation', actor, appointment] as const;
export interface ChargePlan { action: 'CREATE_FROM_APPOINTMENT' | 'REUSE'; total: string; applied: string; balance: string; description: string; charge?: ContextCharge }
const invalidContext = 'El contexto financiero está incompleto o no es compatible. Actualízalo; si persiste, solicita resolución administrativa.';
const id = (value: number) => Number.isSafeInteger(value) && value > 0;

/** Defensive presentation checks, never an alternative ledger or source of final balances. */
export function chargePlan(context: AppointmentFinancialContext, a: AppointmentResponse): ChargePlan {
  try {
    if (context.appointmentId !== a.id || context.patientId !== a.patientId || context.dentistId !== a.dentistId ||
      context.appointmentOccurrenceVersion !== a.occurrenceVersion) throw new Error('La cita o su programación cambió. Actualiza la cita y el contexto antes de revisar.');
    if (!/^v1:[0-9a-f]{64}$/.test(context.financialContextToken) || !Number.isFinite(Date.parse(context.observedAt)) ||
      !Array.isArray(context.charges) || context.chargeCount !== context.charges.length || new Set(context.charges.map(c => c.id)).size !== context.chargeCount) throw new Error(invalidContext);
    for (const c of context.charges) {
      if (!id(c.id) || c.patientId !== a.patientId || c.appointmentId !== a.id || c.currency !== 'MXN' ||
        !['PENDIENTE', 'PARCIAL', 'PAGADO', 'ANULADO'].includes(c.status) || !Array.isArray(c.items) || !c.items.length || !Array.isArray(c.movements)) throw new Error(invalidContext);
      const total = cents(c.totalAmount), applied = cents(c.appliedAmount), balance = cents(c.pendingBalance);
      if (c.status !== 'ANULADO' && (total !== applied + balance || (c.status === 'PAGADO') !== (balance === 0n) ||
        (c.status === 'PARCIAL' && (applied === 0n || balance === 0n)) || (c.status === 'PENDIENTE' && applied !== 0n))) throw new Error(invalidContext);
      if (c.items.reduce((sum, item) => sum + cents(item.lineTotal), 0n) !== total) throw new Error(invalidContext);
      for (const item of c.items) if (!item.description || item.chargeId !== c.id || !id(item.quantity) || cents(item.unitPrice) * BigInt(item.quantity) !== cents(item.lineTotal)) throw new Error(invalidContext);
      for (const m of c.movements) if (!id(m.id) || m.chargeId !== c.id || m.patientId !== a.patientId || cents(m.amount) <= 0n || !['PAYMENT', 'REVERSAL'].includes(m.type)) throw new Error(invalidContext);
    }
    const active = context.charges.filter(c => c.status !== 'ANULADO');
    const association = !context.chargeCount ? 'NO_ASSOCIATED_CHARGE' : !active.length ? 'ONLY_CANCELLED' : active.length === 1 ? 'SINGLE_ACTIVE' : 'MULTIPLE_ACTIVE';
    if (context.associationState !== association) throw new Error(invalidContext);
    if (active.length > 1) throw new Error('Hay varios cargos activos asociados a esta cita. El cobro está bloqueado hasta su resolución administrativa; no se sumarán ni se creará otro cargo.');
    const charge = active[0];
    if (charge) return { action: 'REUSE', total: charge.totalAmount, applied: charge.appliedAmount, balance: charge.pendingBalance, description: charge.items.map(i => i.description).join(' · '), charge };
    const s = context.service;
    if (!s || !id(s.id) || !s.name?.trim() || !id(s.durationMinutes) || cents(s.referencePrice) <= 0n) throw new Error('No hay un precio histórico positivo y verificable para crear el cargo. Se requiere resolución administrativa; no se puede fijar un precio aquí.');
    return { action: 'CREATE_FROM_APPOINTMENT', total: s.referencePrice, applied: '0', balance: s.referencePrice, description: s.name };
  } catch (cause) {
    if (cause instanceof Error && (cause.message === invalidContext || /administrativa|programación/.test(cause.message))) throw cause;
    throw new Error(invalidContext, { cause });
  }
}

export function paymentAmount(plan: ChargePlan, choice: PaymentChoice, input: string): string {
  if (choice === 'none') return '0.00';
  const amount = choice === 'full' ? moneyFromCents(cents(plan.balance)) : normalizeMoney(input);
  if (amount === null || cents(amount) <= 0n) throw new Error('Introduce un importe positivo con un máximo de dos decimales.');
  if (cents(amount) > cents(plan.balance)) throw new Error('El pago no puede exceder el saldo pendiente.');
  if (choice === 'partial' && cents(amount) === cents(plan.balance)) throw new Error('Para liquidar el saldo, elige Pago completo.');
  return amount;
}
export function collectionCommand(context: AppointmentFinancialContext, plan: ChargePlan, choice: PaymentChoice, amount: string, method: PaymentMethod): CollectionInput {
  const paid = paymentAmount(plan, choice, amount);
  return { expectedOccurrenceVersion: context.appointmentOccurrenceVersion, financialContextToken: context.financialContextToken,
    charge: plan.action === 'REUSE' ? { action: 'REUSE', chargeId: plan.charge!.id, expectedTotal: moneyFromCents(cents(plan.total)), confirmed: true } :
      { action: 'CREATE_FROM_APPOINTMENT', expectedTotal: moneyFromCents(cents(plan.total)), confirmed: true },
    payment: choice === 'none' ? { action: 'NO_NEW_PAYMENT' } : { action: 'REGISTER', method, amount: paid } };
}

export function validateResult(result: CollectionResult, a: AppointmentResponse, input: CollectionInput): void {
  const f = result?.financialAtCollection;
  if (result?.appointmentId !== a.id || result.appointmentStatus !== 'COMPLETED' ||
    result.occurrenceVersion !== input.expectedOccurrenceVersion || !Number.isFinite(Date.parse(result.collectedAt)) ||
    !f || !id(f.chargeId) || f.chargeDisposition !== (input.charge.action === 'REUSE' ? 'REUSED' : 'CREATED') ||
    f.patientId !== a.patientId || f.appointmentId !== a.id ||
    (input.charge.action === 'REUSE' && f.chargeId !== input.charge.chargeId) || f.currency !== 'MXN' ||
    !['PENDIENTE', 'PARCIAL', 'PAGADO'].includes(f.status) || cents(f.totalAmount) !== cents(input.charge.expectedTotal) ||
    cents(f.totalAmount) !== cents(f.appliedAmount) + cents(f.pendingBalance) || (f.status === 'PAGADO') !== (cents(f.pendingBalance) === 0n) ||
    (f.status === 'PARCIAL' && (cents(f.appliedAmount) === 0n || cents(f.pendingBalance) === 0n)) ||
    (f.status === 'PENDIENTE' && cents(f.appliedAmount) !== 0n) ||
    (input.payment.action === 'NO_NEW_PAYMENT' ? f.paymentId != null || f.paymentAmount != null || f.paymentMethod != null : !f.paymentId || !id(f.paymentId) ||
      f.paymentMethod !== input.payment.method || !f.paymentAmount || cents(f.paymentAmount) !== cents(input.payment.amount))) throw new Error('Respuesta de cobro no verificable.');
}
