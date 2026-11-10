import { apiFetch } from './http';
import type { PageDto } from './patients';
import { normalizeMoney } from '../lib/financialMoney';

export type ChargeStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADO' | 'ANULADO';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';

export interface ChargeReceipt {
  id: number; patientId: number; appointmentId?: number | null; currency: 'MXN'; totalAmount: string;
  notes?: string | null; confirmedAt: string; confirmedByUserId: number;
  cancelledAt?: string | null; cancelledByUserId?: number | null; cancellationReason?: string | null;
  version: number; createdAt: string; updatedAt?: string | null;
}
export interface ChargeItem {
  id: number; chargeId: number; serviceCatalogItemId?: number | null; treatingDentistId?: number | null;
  description: string; quantity: number; unitPrice: string; lineTotal: string; createdAt: string;
}
export interface FinancialMovement {
  id: number; chargeId: number; patientId: number; type: 'PAYMENT' | 'REVERSAL'; amount: string;
  paymentMethod?: PaymentMethod | null; reversesMovementId?: number | null; reason?: string | null;
  performedByUserId: number; performedAt: string; createdAt: string;
}
export interface Charge extends ChargeReceipt {
  appliedAmount: string; pendingBalance: string; status: ChargeStatus;
  items?: ChargeItem[]; movements?: FinancialMovement[];
}
export interface ConfirmChargeInput {
  patientId: number; appointmentId?: number | null;
  items: Array<{ description: string; quantity: number; unitPrice: string }>;
  notes: string | null;
}
export interface PaymentInput { method: PaymentMethod; amount: string; reason: string | null }
export interface ReasonInput { reason: string }
export interface ChargeFilters {
  patientId?: number; appointmentId?: number; status?: ChargeStatus; from?: string; to?: string;
  page?: number; size?: number;
}

export interface StatusCounts { pendiente: number; parcial: number; pagado: number; anulado: number }
export interface PortfolioReport {
  asOf: string; confirmedCharges: number; billedAmount: string; appliedAmount: string;
  pendingBalance: string; statusCounts: StatusCounts;
}
export interface MethodFlow { method: PaymentMethod; grossAmount: string; reversalAmount: string; netAmount: string }
export interface CashFlowReport {
  from: string | null; to: string | null; grossAmount: string; reversalAmount: string;
  netAmount: string; methods: MethodFlow[];
}
export interface PatientBalance {
  patientId: number; chargeCount: number; billedAmount: string; appliedAmount: string; pendingBalance: string;
}
export interface ChargesBalanceReport {
  patientId: number | null; status: ChargeStatus | null; from: string | null; to: string | null;
  confirmedCharges: number; billedAmount: string; appliedAmount: string; pendingBalance: string;
  byPatient: PatientBalance[];
}
export interface ReportFilters { patientId?: number; status?: ChargeStatus; from?: string; to?: string }

export function parseFinancial(text: string): unknown {
  // Conserva los lexemas monetarios antes de JSON.parse. No toca IDs ni strings escapados.
  return JSON.parse(text.replace(/("(?:totalAmount|appliedAmount|pendingBalance|billedAmount|grossAmount|reversalAmount|netAmount|unitPrice|lineTotal|amount)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

export function serializeFinancial(body: unknown): string {
  return JSON.stringify(body).replace(/("(?:unitPrice|amount)"\s*:)"([^"\\]*)"/g, (_match, prefix: string, value: string) => {
    const decimal = normalizeMoney(value);
    if (decimal === null) throw new Error('El importe debe tener como maximo dos decimales.');
    return prefix + decimal; // Numero JSON exacto, no cambio de contrato ni conversion a Number.
  });
}

const decimalResponse = { parseResponse: parseFinancial };
function write<T>(path: string, body: unknown, key: string): Promise<T> {
  return apiFetch(path, { ...decimalResponse, method: 'POST', body, serializeBody: serializeFinancial,
    headers: { 'Idempotency-Key': key } });
}

export const financialApi = {
  list(filters: ChargeFilters): Promise<PageDto<Charge>> {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value !== undefined) params.set(name, String(value));
    return apiFetch(`/api/charges?${params}`, decimalResponse);
  },
  get(id: number): Promise<Charge> { return apiFetch(`/api/charges/${id}`, decimalResponse); },
  items(id: number): Promise<ChargeItem[]> { return apiFetch(`/api/charges/${id}/items`, decimalResponse); },
  movements(id: number): Promise<FinancialMovement[]> { return apiFetch(`/api/charges/${id}/movements`, decimalResponse); },
  confirm(input: ConfirmChargeInput, key: string): Promise<ChargeReceipt> { return write('/api/charges', input, key); },
  pay(id: number, input: PaymentInput, key: string): Promise<FinancialMovement> { return write(`/api/charges/${id}/payments`, input, key); },
  reverse(id: number, movementId: number, input: ReasonInput, key: string): Promise<FinancialMovement> {
    return write(`/api/charges/${id}/movements/${movementId}/reverse`, input, key);
  },
  cancel(id: number, input: ReasonInput, key: string): Promise<ChargeReceipt> { return write(`/api/charges/${id}/cancel`, input, key); },
};

function reportParams(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value !== undefined && value !== null) params.set(name, String(value));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Reportes financieros administrativos (Fase 4C). Solo OWNER/RECEPTIONIST; el backend lo verifica. */
export const financialReportsApi = {
  portfolio(): Promise<PortfolioReport> {
    return apiFetch('/api/financial/reports/portfolio', decimalResponse);
  },
  cashFlow(filters: ReportFilters): Promise<CashFlowReport> {
    return apiFetch(`/api/financial/reports/cash-flow${reportParams(filters)}`, decimalResponse);
  },
  charges(filters: ReportFilters): Promise<ChargesBalanceReport> {
    return apiFetch(`/api/financial/reports/charges${reportParams(filters)}`, decimalResponse);
  },
};
