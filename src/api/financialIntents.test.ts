import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { financialIntentsApi, type FinancialIntentOperation } from './financialIntents';
import { ApiError, cancelSessionRequests, tokenStore } from './http';

const key = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const dto = (operation: FinancialIntentOperation = 'FIN_REGISTER_PAYMENT', state = 'REGISTERED') => ({ operation, intentId: key, state, registeredAt: '2026-10-27T00:00:00Z',
  ...(state === 'CONFIRMED' ? { effect: { chargeId: 7, movementId: 8 } } : {}) });
beforeEach(() => { cancelSessionRequests(); tokenStore.set('b5-access'); });
afterEach(() => { cancelSessionRequests(); tokenStore.set(null); vi.unstubAllGlobals(); });

it('usa los cinco endpoints exactos sin header alternativo; comando decimal solo al registrar', async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, 'http://localhost'); requests.push({ url, init });
    return new Response(JSON.stringify(url.search ? { items: [dto()], nextCursor: 'cursor+/' } : dto()));
  }));
  await financialIntentsApi.register('FIN_REGISTER_PAYMENT', key, { chargeId: 7, amount: '999999999999999.99', method: 'CASH', reason: null });
  await financialIntentsApi.get('FIN_REGISTER_PAYMENT', key);
  await financialIntentsApi.list('pending', 'cursor+/');
  await financialIntentsApi.execute('FIN_REGISTER_PAYMENT', key);
  await financialIntentsApi.abandon('FIN_REGISTER_PAYMENT', key);
  expect(requests.map(r => r.url.pathname)).toEqual(['/api/financial-intents', `/api/financial-intents/FIN_REGISTER_PAYMENT/${key}`,
    '/api/financial-intents', `/api/financial-intents/FIN_REGISTER_PAYMENT/${key}/execute`, `/api/financial-intents/FIN_REGISTER_PAYMENT/${key}/abandon`]);
  expect(requests[0]!.init.body).toContain('"amount":999999999999999.99');
  expect(JSON.parse(String(requests[0]!.init.body))).toHaveProperty('intentId', key);
  expect(requests[2]!.url.searchParams.get('cursor')).toBe('cursor+/');
  expect(requests[2]!.url.searchParams.get('size')).toBe('20');
  expect(requests.slice(3).map(r => r.init.body)).toEqual(['{}', '{}']);
  for (const { init } of requests) {
    expect(init.cache).toBe('no-store'); expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(init.headers).toHaveProperty('Authorization', 'Bearer b5-access');
  }
});

it.each(['register', 'execute', 'abandon'] as const)('no reenvía %s automáticamente tras un refresh 401 exitoso', async action => {
  const financialPost = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/api/auth/refresh')) return new Response('{"accessToken":"renewed"}');
    financialPost(); return new Response('{"message":"Necesitas verificar la sesión"}', { status: 401 });
  }));
  const call = action === 'register'
    ? financialIntentsApi.register('FIN_CANCEL_CHARGE', key, { chargeId: 7, reason: 'motivo' })
    : financialIntentsApi[action]('FIN_CANCEL_CHARGE', key);
  await expect(call).rejects.toBeInstanceOf(ApiError);
  expect(financialPost).toHaveBeenCalledTimes(1);
});

it.each([{}, { ...dto(), intentId: 'other' }, { ...dto(), operation: 'FIN_CANCEL_CHARGE' }, { ...dto(), state: 'CONFIRMED' },
  { ...dto('FIN_REGISTER_PAYMENT', 'CONFIRMED'), effect: { chargeId: 7 } }, { ...dto(), state: 'REJECTED' }])('rechaza DTO incompleto/incompatible sin inventar CONFIRMED (%j)', async response => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
  await expect(financialIntentsApi.get('FIN_REGISTER_PAYMENT', key)).rejects.toThrow('No se pudo verificar');
});

it('descarta cualquier campo interno inesperado antes de guardarlo en memoria de presentación', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...dto(), command: { secret: 'medical' }, requestHash: 'secret' }))));
  expect(await financialIntentsApi.get('FIN_REGISTER_PAYMENT', key)).toEqual(dto());
});
