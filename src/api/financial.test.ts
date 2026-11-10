import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { financialApi, parseFinancial, serializeFinancial } from './financial';
import { ApiError, cancelSessionRequests, tokenStore } from './http';

beforeEach(() => { cancelSessionRequests(); tokenStore.set('access-financial'); });
afterEach(() => { vi.unstubAllGlobals(); tokenStore.set(null); });

describe('Cliente financiero y contrato Fase 3', () => {
  it('preserva decimales de 19 digitos y no altera texto que parece JSON monetario', () => {
    const text = '{"id":10,"totalAmount":999999999999999.9900,"appliedAmount":0.0000,"pendingBalance":999999999999999.9900,"notes":' + JSON.stringify('Texto "amount":123.45') + '}';
    const value = parseFinancial(text) as Record<string, unknown>;
    expect(value.totalAmount).toBe('999999999999999.9900');
    expect(value.pendingBalance).toBe('999999999999999.9900');
    expect(value.appliedAmount).toBe('0.0000');
    expect(value.id).toBe(10);
    expect(value.notes).toBe('Texto "amount":123.45');
  });

  it('serializa precios como numeros JSON exactos y mantiene descripciones escapadas', () => {
    const text = serializeFinancial({ patientId: 10, items: [{ description: 'Texto "unitPrice":123.45', quantity: 2, unitPrice: '999999999999999.99' }], notes: null });
    expect(text).toContain('"unitPrice":999999999999999.99');
    expect(text).not.toContain('"unitPrice":"999999999999999.99"');
    expect((JSON.parse(text) as { items: Array<{ description: string }> }).items[0]!.description).toBe('Texto "unitPrice":123.45');
  });

  it('usa solo las rutas, filtros y cabeceras reales', async () => {
    const requests: Array<{ path: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
      requests.push({ path, ...(options ? { options } : {}) }); return new Response('{}', { status: 200 });
    }));
    await financialApi.list({ patientId: 10, appointmentId: 21, status: 'PARCIAL', page: 2, size: 20, from: '2026-10-14T00:00:00Z', to: '2026-10-15T00:00:00Z' });
    const url = new URL(requests[0]!.path, 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ patientId: '10', appointmentId: '21', status: 'PARCIAL', page: '2', size: '20', from: '2026-10-14T00:00:00Z', to: '2026-10-15T00:00:00Z' });
    await financialApi.confirm({ patientId: 10, appointmentId: null, items: [{ description: 'Consulta', quantity: 1, unitPrice: '100.01' }], notes: null }, 'confirm');
    await financialApi.pay(99, { amount: '20.01', method: 'CASH', reason: null }, 'pay');
    await financialApi.reverse(99, 7, { reason: 'Duplicado' }, 'reverse');
    await financialApi.cancel(99, { reason: 'Error' }, 'cancel');
    expect(requests.slice(1).map((request) => request.path)).toEqual(['/api/charges', '/api/charges/99/payments', '/api/charges/99/movements/7/reverse', '/api/charges/99/cancel']);
    expect(requests.slice(1).map((request) => (request.options!.headers as Record<string, string>)['Idempotency-Key'])).toEqual(['confirm', 'pay', 'reverse', 'cancel']);
    expect(JSON.parse(String(requests[3]!.options!.body))).toEqual({ reason: 'Duplicado' });
    expect(JSON.parse(String(requests[1]!.options!.body))).not.toHaveProperty('dentistId');
  });

  it('conserva payload y clave durante el reintento unico del cliente tras un 401', async () => {
    const posts: RequestInit[] = [];
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
      if (path.endsWith('/api/auth/refresh')) return new Response('{"accessToken":"renewed"}', { status: 200 });
      posts.push(options); attempts++;
      return attempts === 1 ? new Response('{}', { status: 401 }) : new Response('{"id":7,"amount":20.0100}', { status: 201 });
    }));
    const result = await financialApi.pay(99, { amount: '20.01', method: 'CASH', reason: null }, 'same-intent');
    expect(result.amount).toBe('20.0100');
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => (post.headers as Record<string, string>)['Idempotency-Key'])).toEqual(['same-intent', 'same-intent']);
    expect(posts[1]!.body).toBe(posts[0]!.body);
    expect((posts[1]!.headers as Record<string, string>).Authorization).toBe('Bearer renewed');
  });

  it.each([400, 403, 404, 409])('propaga el error HTTP %s y los errores de campo sin inventar exito', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status, message: 'Mensaje del servidor.', fieldErrors: { amount: 'Importe inválido.' } }), { status })));
    try { await financialApi.pay(99, { amount: '1', method: 'CASH', reason: null }, 'key'); throw new Error('No debio aceptar'); }
    catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as ApiError).fieldErrors.amount).toBe('Importe inválido.');
    }
  });
});
