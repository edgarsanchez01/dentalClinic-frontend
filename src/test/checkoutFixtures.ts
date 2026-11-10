import type { AppointmentResponse } from '../api/appointments';
import type { AppointmentFinancialContext, CollectionResult, ContextCharge } from '../api/collection';

export const checkoutAppointment: AppointmentResponse = {
  id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba', dentistId: 3,
  dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba', startAt: '2026-10-22T16:00:00Z', endAt: '2026-10-22T17:00:00Z',
  durationMinutes: 60, occurrenceVersion: 1, status: 'SCHEDULED', reason: 'Revisión sintética', createdAt: '2026-10-21T12:00:00Z', createdByUserId: 2,
  service: { id: 1, name: 'Consulta de valoración', description: 'Servicio sintético', durationMinutes: 60, referencePrice: '500.0000' },
};
export function checkoutContext(overrides: Partial<AppointmentFinancialContext> = {}): AppointmentFinancialContext {
  return { appointmentId: 7, patientId: 1, dentistId: 3, appointmentOccurrenceVersion: 1, observedAt: '2026-10-22T17:00:00Z',
    financialContextToken: `v1:${'a'.repeat(64)}`, associationState: 'NO_ASSOCIATED_CHARGE', chargeCount: 0, service: checkoutAppointment.service, charges: [], ...overrides };
}
export function contextCharge(overrides: Partial<ContextCharge> = {}): ContextCharge {
  return { id: 20, patientId: 1, appointmentId: 7, currency: 'MXN', totalAmount: '500.0000', appliedAmount: '100.0000', pendingBalance: '400.0000', status: 'PARCIAL', confirmedAt: '2026-10-22T12:00:00Z',
    items: [{ id: 21, chargeId: 20, description: 'Concepto histórico', quantity: 1, unitPrice: '500.0000', lineTotal: '500.0000', createdAt: '2026-10-22T12:00:00Z' }],
    movements: [{ id: 30, chargeId: 20, patientId: 1, type: 'PAYMENT', amount: '100.0000', paymentMethod: 'CASH', performedByUserId: 2, performedAt: '2026-10-22T12:00:00Z', createdAt: '2026-10-22T12:00:00Z' }], ...overrides };
}
export function collectionResult(overrides: Partial<CollectionResult> = {}): CollectionResult {
  return { appointmentId: 7, appointmentStatus: 'COMPLETED', occurrenceVersion: 1, collectedAt: '2026-10-22T17:00:00Z',
    financialAtCollection: { chargeId: 20, chargeDisposition: 'CREATED', patientId: 1, appointmentId: 7, currency: 'MXN', totalAmount: '500.0000', appliedAmount: '0.0000', pendingBalance: '500.0000', status: 'PENDIENTE' }, ...overrides };
}
