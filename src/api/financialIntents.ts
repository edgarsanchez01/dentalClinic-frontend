import type { ConfirmChargeInput, PaymentInput, ReasonInput } from './financial';
import { serializeFinancial } from './financial';
import { apiFetch } from './http';

export type FinancialIntentOperation = 'FIN_CONFIRM_CHARGE' | 'FIN_REGISTER_PAYMENT' | 'FIN_REVERSE_PAYMENT' | 'FIN_CANCEL_CHARGE';
export type FinancialIntentState = 'REGISTERED' | 'CONFIRMED' | 'REJECTED' | 'ABANDONED';
export type FinancialIntentCommand = ConfirmChargeInput | (PaymentInput & { chargeId: number })
  | (ReasonInput & { chargeId: number; movementId?: number });
export interface FinancialIntentView {
  operation: FinancialIntentOperation; intentId: string; state: FinancialIntentState; registeredAt: string;
  closedAt?: string; rejectedAttemptAt?: string; rejection?: { code: string; httpStatus: number };
  effect?: { chargeId: number; movementId?: number };
}
export interface FinancialIntentPage { items: FinancialIntentView[]; nextCursor?: string }
const BASE = '/api/financial-intents';
const operations: FinancialIntentOperation[] = ['FIN_CONFIRM_CHARGE', 'FIN_REGISTER_PAYMENT', 'FIN_REVERSE_PAYMENT', 'FIN_CANCEL_CHARGE'];
const states: FinancialIntentState[] = ['REGISTERED', 'CONFIRMED', 'REJECTED', 'ABANDONED'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const date = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
function invalid(): never { throw new Error('No se pudo verificar la respuesta de la intención financiera.'); }

/** Solo metadata publica validada: un 2xx vacio/malformado no es confirmacion autoritativa. */
function view(value: unknown, operation?: FinancialIntentOperation, intentId?: string): FinancialIntentView {
  if (!value || typeof value !== 'object') return invalid();
  const row = value as FinancialIntentView;
  if (!operations.includes(row.operation) || !states.includes(row.state) || !uuid.test(row.intentId)
      || !date(row.registeredAt) || (operation !== undefined && operation !== row.operation)
      || (intentId !== undefined && intentId !== row.intentId)) return invalid();
  const result: FinancialIntentView = { operation: row.operation, intentId: row.intentId, state: row.state, registeredAt: row.registeredAt };
  if (row.state === 'CONFIRMED') {
    if (!id(row.effect?.chargeId)) return invalid();
    const movement = row.operation === 'FIN_REGISTER_PAYMENT' || row.operation === 'FIN_REVERSE_PAYMENT';
    if (movement && !id(row.effect?.movementId)) return invalid();
    result.effect = { chargeId: row.effect.chargeId, ...(movement ? { movementId: row.effect.movementId! } : {}) };
  }
  if (row.state === 'REJECTED' || row.state === 'ABANDONED') {
    if (!date(row.closedAt)) return invalid();
    result.closedAt = row.closedAt;
  }
  if (row.state === 'REJECTED') {
    if (!date(row.rejectedAttemptAt) || typeof row.rejection?.code !== 'string'
        || ![400, 409].includes(row.rejection.httpStatus)) return invalid();
    result.rejectedAttemptAt = row.rejectedAttemptAt;
    result.rejection = { code: row.rejection.code, httpStatus: row.rejection.httpStatus };
  }
  return result;
}
function path(operation: FinancialIntentOperation, intentId: string): string {
  if (!operations.includes(operation) || !uuid.test(intentId)) return invalid();
  return `${BASE}/${operation}/${intentId}`; // URL HTTP de B4, nunca ruta del navegador/history.
}
export const financialIntentsApi = {
  async register(operation: FinancialIntentOperation, intentId: string, command: FinancialIntentCommand): Promise<FinancialIntentView> {
    path(operation, intentId);
    return view(await apiFetch(BASE, { method: 'POST', body: { operation, intentId, command }, serializeBody: serializeFinancial,
      cache: 'no-store', retryAfterRefresh: false }), operation, intentId);
  },
  async get(operation: FinancialIntentOperation, intentId: string, signal?: AbortSignal): Promise<FinancialIntentView> {
    return view(await apiFetch(path(operation, intentId), { cache: 'no-store', ...(signal ? { signal } : {}) }), operation, intentId);
  },
  async list(filter: 'pending' | 'recent', cursor?: string, signal?: AbortSignal): Promise<FinancialIntentPage> {
    const params = new URLSearchParams({ view: filter, size: '20' });
    if (cursor) params.set('cursor', cursor);
    const result = await apiFetch<FinancialIntentPage>(`${BASE}?${params}`, { cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!Array.isArray(result?.items) || result.items.length > 20
        || (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')) return invalid();
    return { items: result.items.map(item => view(item)), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  },
  async execute(operation: FinancialIntentOperation, intentId: string): Promise<FinancialIntentView> {
    return view(await apiFetch(`${path(operation, intentId)}/execute`, { method: 'POST', body: {}, cache: 'no-store', retryAfterRefresh: false }), operation, intentId);
  },
  async abandon(operation: FinancialIntentOperation, intentId: string): Promise<FinancialIntentView> {
    return view(await apiFetch(`${path(operation, intentId)}/abandon`, { method: 'POST', body: {}, cache: 'no-store', retryAfterRefresh: false }), operation, intentId);
  },
};
