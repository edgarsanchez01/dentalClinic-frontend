import { apiFetch } from './http';

export interface ServiceDto {
  id: number;
  name: string;
  description: string | null;
  /** Representación local exacta; el contrato HTTP sigue usando un número JSON decimal. */
  referencePrice: string;
  durationMinutes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface ServiceInput {
  name: string;
  description: string | null;
  referencePrice: string;
  durationMinutes: number;
}

export type BookingServiceDto = Pick<ServiceDto, 'id' | 'name' | 'description' | 'referencePrice' | 'durationMinutes'>;

export function normalizeReferencePrice(value: string): string | null {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const [whole = '', fraction] = text.split('.');
  const normalized = whole.replace(/^0+(?=\d)/, '');
  if (normalized.length > 15) return null;
  return normalized + (fraction === undefined ? '' : `.${fraction}`);
}

export function formatReferencePrice(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const decimal = fraction.replace(/0+$/, '');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (decimal ? `,${decimal}` : '');
}

export function parseServices(text: string): unknown {
  // Preserve the price's numeric JSON lexeme before JSON.parse can round a 19-digit decimal.
  // Quotes inside JSON strings are escaped, so this only matches actual numeric properties.
  return JSON.parse(text.replace(/("referencePrice"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

function serializeService(body: unknown): string {
  const input = body as ServiceInput;
  const price = normalizeReferencePrice(input.referencePrice);
  if (price === null) throw new Error('El precio de referencia no tiene un formato válido.');
  // Still a JSON number on the wire, not a string or an API contract change.
  return JSON.stringify({ ...input, referencePrice: null }).replace('"referencePrice":null', `"referencePrice":${price}`);
}

const decimalResponse = { parseResponse: parseServices };

export const catalogApi = {
  publicList(): Promise<BookingServiceDto[]> {
    return apiFetch('/api/public/services', { ...decimalResponse, auth: false });
  },
  list(active?: boolean): Promise<ServiceDto[]> {
    return apiFetch(`/api/services${active === undefined ? '' : `?active=${active}`}`, decimalResponse);
  },
  get(id: number): Promise<ServiceDto> {
    return apiFetch(`/api/services/${id}`, decimalResponse);
  },
  create(input: ServiceInput): Promise<ServiceDto> {
    return apiFetch('/api/services', { ...decimalResponse, method: 'POST', body: input, serializeBody: serializeService });
  },
  update(id: number, input: ServiceInput): Promise<ServiceDto> {
    return apiFetch(`/api/services/${id}`, { ...decimalResponse, method: 'PUT', body: input, serializeBody: serializeService });
  },
  setActive(id: number, active: boolean): Promise<ServiceDto> {
    return apiFetch(`/api/services/${id}/active`, { ...decimalResponse, method: 'PATCH', body: { active } });
  },
};
