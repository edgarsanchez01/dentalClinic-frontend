import { describe, expect, it } from 'vitest';
import { chargePlan, collectionCommand as checkoutCommand, paymentAmount, validateResult } from './collectionModel';
import { checkoutAppointment as a, checkoutContext, contextCharge, collectionResult as checkoutResult } from '../../test/checkoutFixtures';

describe('Collection: contexto, dinero y comando aprobado', () => {
  it('propone crear desde el snapshot, no desde un precio del cliente', () => {
    const c = checkoutContext(); const p = chargePlan(c, a);
    expect(checkoutCommand(c, p, 'none', '', 'CASH')).toEqual({ expectedOccurrenceVersion: 1, financialContextToken: c.financialContextToken,
      charge: { action: 'CREATE_FROM_APPOINTMENT', expectedTotal: '500.00', confirmed: true }, payment: { action: 'NO_NEW_PAYMENT' } });
  });
  it('reutiliza el único activo aun con anulados, sin recalcular desde el snapshot', () => {
    const active = contextCharge(); const cancelled = contextCharge({ id: 22, status: 'ANULADO', items: [{ ...active.items[0]!, chargeId: 22 }], movements: [] });
    const c = checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 2, charges: [cancelled, active], service: null });
    const p = chargePlan(c, a);
    expect(p.action).toBe('REUSE'); expect(p.balance).toBe('400.0000');
    expect(checkoutCommand(c, p, 'full', '', 'CARD').payment).toEqual({ action: 'REGISTER', amount: '400.00', method: 'CARD' });
  });
  it('bloquea múltiples activos sin seleccionar ni sumar', () => {
    expect(() => chargePlan(checkoutContext({ associationState: 'MULTIPLE_ACTIVE', chargeCount: 2, charges: [contextCharge(), contextCharge({ id: 22, items: [{ ...contextCharge().items[0]!, chargeId: 22 }], movements: [] })] }), a)).toThrow(/varios cargos activos/);
  });
  it.each([
    { financialContextToken: '' }, { chargeCount: 1 }, { patientId: 99 }, { appointmentId: 99 }, { dentistId: 99 }, { appointmentOccurrenceVersion: 2 }, { observedAt: 'bad' }, { associationState: 'SINGLE_ACTIVE' as const },
  ])('bloquea contexto incompleto o ajeno %j', overrides => expect(() => chargePlan(checkoutContext(overrides), a)).toThrow());
  it.each(['0.0000', '500.0010', '1000000000000000', '-1', 'NaN'])('no modifica el precio histórico incompatible %s', referencePrice => {
    expect(() => chargePlan(checkoutContext({ service: { ...a.service!, referencePrice } }), a)).toThrow();
  });
  it.each([
    { currency: 'USD' }, { items: [] }, { movements: null as never }, { pendingBalance: '401' }, { totalAmount: '500.001' }, { status: 'PAGADO' as const }, { patientId: 9 },
  ])('bloquea datos financieros inconsistentes %j', overrides => {
    expect(() => chargePlan(checkoutContext({ chargeCount: 1, associationState: 'SINGLE_ACTIVE', charges: [contextCharge(overrides)] }), a)).toThrow();
  });
  it.each(['-1', '0', '0.00', '500.01', '1.001', 'abc', '1e2', '1,2,3', '500'])('rechaza abono parcial inválido %s', amount => {
    expect(() => paymentAmount(chargePlan(checkoutContext(), a), 'partial', amount)).toThrow();
  });
  it('preserva dos decimales exactos incluso en importes máximos', () => {
    const c = checkoutContext({ service: { ...a.service!, referencePrice: '999999999999999.9900' } });
    const p = chargePlan(c, a); expect(checkoutCommand(c, p, 'full', '', 'TRANSFER').payment).toEqual({ action: 'REGISTER', method: 'TRANSFER', amount: '999999999999999.99' });
    expect(paymentAmount(p, 'partial', '0000,01')).toBe('0.01');
  });
  it('admite cargo pagado sin nuevo pago y sin snapshot', () => {
    const c = checkoutContext({ service: null, chargeCount: 1, associationState: 'SINGLE_ACTIVE', charges: [contextCharge({ status: 'PAGADO', appliedAmount: '500', pendingBalance: '0' })] });
    expect(checkoutCommand(c, chargePlan(c, a), 'none', '', 'CASH').payment).toEqual({ action: 'NO_NEW_PAYMENT' });
  });
  it('valida evidencia del servidor antes de anunciar éxito', () => {
    const c = checkoutContext(), command = checkoutCommand(c, chargePlan(c, a), 'none', '', 'CASH');
    expect(() => validateResult(checkoutResult(), a, command)).not.toThrow();
    expect(() => validateResult(checkoutResult({ appointmentId: 0 }), a, command)).toThrow();
    const result = checkoutResult(); result.financialAtCollection.paymentId = 1;
    expect(() => validateResult(result, a, command)).toThrow();
  });
});
