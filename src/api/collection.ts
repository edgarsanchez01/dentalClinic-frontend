import { apiFetch } from './http';
import type { AppointmentResponse } from './appointments';
import { parseFinancial, type ChargeItem, type FinancialMovement, type ChargeStatus, type PaymentMethod } from './financial';
import { cents, moneyFromCents } from '../lib/financialMoney';

export interface ContextCharge {
  id: number; patientId: number; appointmentId: number; currency: string;
  totalAmount: string; appliedAmount: string; pendingBalance: string; status: ChargeStatus;
  confirmedAt: string; items: ChargeItem[]; movements: FinancialMovement[];
}
export interface AppointmentFinancialContext {
  appointmentId: number; patientId: number; dentistId: number; appointmentOccurrenceVersion: number;
  observedAt: string; financialContextToken: string;
  associationState: 'NO_ASSOCIATED_CHARGE' | 'ONLY_CANCELLED' | 'SINGLE_ACTIVE' | 'MULTIPLE_ACTIVE';
  chargeCount: number; service: AppointmentResponse['service']; charges: ContextCharge[];
}
export interface CollectionInput {
  expectedOccurrenceVersion: number; financialContextToken: string;
  charge: { action: 'CREATE_FROM_APPOINTMENT'; expectedTotal: string; confirmed: true } |
    { action: 'REUSE'; chargeId: number; expectedTotal: string; confirmed: true };
  payment: { action: 'NO_NEW_PAYMENT' } | { action: 'REGISTER'; method: PaymentMethod; amount: string };
}
export interface CollectionResult {
  appointmentId: number; appointmentStatus: 'COMPLETED'; occurrenceVersion: number; collectedAt: string;
  financialAtCollection: {
    chargeDisposition: 'CREATED' | 'REUSED'; chargeId: number; patientId: number; appointmentId: number;
    currency: 'MXN'; totalAmount: string; appliedAmount: string; pendingBalance: string; status: ChargeStatus;
    paymentId?: number | null; paymentMethod?: PaymentMethod | null; paymentAmount?: string | null;
  };
}

export type CollectionState = 'NO_CHARGE' | 'PENDING' | 'PARTIAL' | 'SETTLED' | 'REVIEW_REQUIRED';
export interface CollectionFilters {
  dentistId?: number; patientId?: number; from?: string; to?: string; state?: CollectionState;
  includeSettled?: boolean; page?: number; size?: number;
}
export interface CollectionQueue {
  content: { appointment: AppointmentResponse; collectionState: CollectionState; hasRecordedCharge: boolean;
    activeChargeId: number | null; totalAmount: string | null; appliedAmount: string | null;
    pendingBalance: string | null; currency: string | null; financialContextToken: string | null; reviewReason: string | null }[];
  page: number; size: number; totalElements: number; totalPages: number; observedAt: string;
  summary: { counts: Record<CollectionState, number>; completedCount: number; verifiedPendingBalance: string; currency: string };
}

export function parseCollection(text: string): unknown {
  // Preserve both the historical service price and financial decimals before JSON.parse.
  return parseFinancial(text.replace(/("(?:referencePrice|verifiedPendingBalance|paymentAmount)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}
export function serializeCollection(body: unknown): string {
  return JSON.stringify(body).replace(/("(?:expectedTotal|amount)"\s*:)"([^"\\]*)"/g, (_match, prefix: string, value: string) =>
    prefix + moneyFromCents(cents(value)));
}
export const collectionApi = {
  queue(filters: CollectionFilters, signal?: AbortSignal): Promise<CollectionQueue> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, String(value));
    return apiFetch(`/api/appointments/collection-queue?${params}`, { parseResponse: parseCollection, ...(signal ? { signal } : {}) });
  },
  context(id: number): Promise<AppointmentFinancialContext> {
    return apiFetch(`/api/appointments/${id}/financial-context`, { parseResponse: parseCollection });
  },
  confirm(id: number, input: CollectionInput, key: string): Promise<CollectionResult> {
    return apiFetch(`/api/appointments/${id}/collection`, { method: 'POST', body: input,
      headers: { 'Idempotency-Key': key }, serializeBody: serializeCollection, parseResponse: parseCollection,
      signal: AbortSignal.timeout(30_000) });
  },
};
