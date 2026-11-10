import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogApi, formatReferencePrice, normalizeReferencePrice } from './catalog';
import { tokenStore } from './http';

const body = '{"id":1,"name":"Consulta","description":"Texto con \\"referencePrice\\":1","referencePrice":999999999999999.9999,"durationMinutes":35,"active":true,"createdAt":"2026-10-10T00:00:00Z","updatedAt":null}';
beforeEach(() => tokenStore.set('catalog-token'));
afterEach(() => { vi.unstubAllGlobals(); tokenStore.set(null); });

describe('Catálogo — comunicación HTTP F7.2', () => {
  it('conserva el decimal exacto recibido y los textos, sin símbolos ni política monetaria', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const item = await catalogApi.get(1);
    expect(item.referencePrice).toBe('999999999999999.9999');
    expect(item.description).toBe('Texto con "referencePrice":1');
    expect(formatReferencePrice(item.referencePrice)).toBe('999\u00a0999\u00a0999\u00a0999\u00a0999,9999');
  });

  it('envía POST y PUT con un número JSON decimal exacto y PATCH separado para vigencia', async () => {
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const input = { name: 'Consulta', description: null, referencePrice: '999999999999999.9999', durationMinutes: 35 };
    await catalogApi.create(input);
    await catalogApi.update(1, input);
    await catalogApi.setActive(1, false);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests.map(([url, options]) => [url, options.method])).toEqual([
      ['/api/services', 'POST'], ['/api/services/1', 'PUT'], ['/api/services/1/active', 'PATCH'],
    ]);
    for (const [, options] of requests.slice(0, 2)) {
      expect(options.body).toContain('"referencePrice":999999999999999.9999');
      expect(options.body).not.toContain('"referencePrice":"');
      expect(options.headers).toMatchObject({ Authorization: 'Bearer catalog-token', 'Content-Type': 'application/json' });
      expect(options.credentials).toBe('include');
    }
    expect(requests[2]?.[1].body).toBe('{"active":false}');
  });

  it('codifica ambos filtros y conserva los fieldErrors del backend', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await catalogApi.list(); await catalogApi.list(true); await catalogApi.list(false);
    expect((fetcher.mock.calls as unknown as [string][]).map(([url]) => url)).toEqual([
      '/api/services', '/api/services?active=true', '/api/services?active=false',
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Revisa los datos.', fieldErrors: { name: 'Nombre no válido.' } }), { status: 400 })));
    await expect(catalogApi.create({ name: 'X', description: null, referencePrice: '0', durationMinutes: 15 }))
      .rejects.toMatchObject({ status: 400, fieldErrors: { name: 'Nombre no válido.' } });
  });

  it('rechaza precios no serializables antes de HTTP y normaliza decimales locales sin redondearlos', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(catalogApi.create({ name: 'X', description: null, referencePrice: '0,"active":false', durationMinutes: 15 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(normalizeReferencePrice('00075,1234')).toBe('75.1234');
    for (const invalid of ['', '-1', '1.12345', '1000000000000000', '1.000,50']) expect(normalizeReferencePrice(invalid)).toBeNull();
    expect(formatReferencePrice('0.0000')).toBe('0');
  });

  it('conserva el adaptador decimal al reintentar tras un refresh, usando la sesión central', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/refresh') return new Response('{"accessToken":"renewed-catalog"}', { status: 200 });
      attempts += 1;
      return attempts === 1 ? new Response('{"message":"Sesión caducada."}', { status: 401 }) : new Response(body, { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await catalogApi.get(1)).referencePrice).toBe('999999999999999.9999');
    expect(attempts).toBe(2);
    expect(tokenStore.get()).toBe('renewed-catalog');
  });
});
