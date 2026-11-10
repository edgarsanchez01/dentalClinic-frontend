import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectionApi as checkoutApi, parseCollection as parseCheckout, serializeCollection as serializeCheckout } from './collection';
import { cancelSessionRequests, tokenStore, ApiError } from './http';
import { checkoutContext } from '../test/checkoutFixtures';
const input = { expectedOccurrenceVersion: 1, financialContextToken: `v1:${'a'.repeat(64)}`, charge: { action: 'CREATE_FROM_APPOINTMENT' as const, expectedTotal: '999999999999999.99', confirmed: true as const }, payment: { action: 'NO_NEW_PAYMENT' as const } };
beforeEach(() => { cancelSessionRequests(); tokenStore.set('test'); });
afterEach(() => { vi.unstubAllGlobals(); tokenStore.set(null); });
it('preserva snapshot, expectedTotal y pagos exactos sin conversiones flotantes', () => {
  const value = parseCheckout('{"service":{"referencePrice":999999999999999.9900},"financialAtCollection":{"pendingBalance":999999999999999.9900},"summary":{"verifiedPendingBalance":999999999999999.99},"paymentAmount":0.01}') as { service: { referencePrice: string }; financialAtCollection: { pendingBalance: string }; summary: { verifiedPendingBalance: string }; paymentAmount: string };
  expect(value.service.referencePrice).toBe('999999999999999.9900'); expect(value.financialAtCollection.pendingBalance).toBe('999999999999999.9900');
  expect(value.summary.verifiedPendingBalance).toBe('999999999999999.99'); expect(value.paymentAmount).toBe('0.01');
  expect(serializeCheckout(input)).toContain('"expectedTotal":999999999999999.99');
  expect(JSON.parse(serializeCheckout(input)).payment).toEqual({ action: 'NO_NEW_PAYMENT' });
  expect(() => serializeCheckout({ amount: '1.001' })).toThrow();
});
it('consume exclusivamente GET contextual y POST collection con cabecera real', async () => {
  const requests: Array<{ path: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => { requests.push({ path, init }); return new Response(JSON.stringify(checkoutContext())); }));
  await checkoutApi.context(7); await checkoutApi.confirm(7, input, 'same-key');
  expect(requests.map(r => r.path)).toEqual(['/api/appointments/7/financial-context', '/api/appointments/7/collection']);
  expect(requests[1]!.init.method).toBe('POST'); expect(requests[1]!.init.headers).toMatchObject({ 'Idempotency-Key': 'same-key', Authorization: 'Bearer test' });
});
it('refresh de autenticación conserva exactamente la clave y el cuerpo', async () => {
  const posts: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/auth/refresh')) return new Response('{"accessToken":"renewed"}');
    posts.push(init); return new Response('{}', { status: posts.length === 1 ? 401 : 200 });
  }));
  await checkoutApi.confirm(7, input, 'same-key'); expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toBe(posts[1]!.body); expect(posts[1]!.headers).toMatchObject({ 'Idempotency-Key': 'same-key', Authorization: 'Bearer renewed' });
});
it.each([400, 403, 404, 409, 422, 503])('no reintenta automáticamente ni transforma HTTP %s en éxito', async status => {
  const fetch = vi.fn(async () => new Response('{"code":"COLLECTION_CONFLICT"}', { status })); vi.stubGlobal('fetch', fetch);
  await expect(checkoutApi.confirm(7, input, 'key')).rejects.toBeInstanceOf(ApiError); expect(fetch).toHaveBeenCalledTimes(1);
});
it('un fallo de red no reintenta la operación', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('network')); vi.stubGlobal('fetch', fetch);
  await expect(checkoutApi.confirm(7, input, 'key')).rejects.toThrow('network'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('401 con refresh rechazado no repite el comando ni inventa éxito', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => { requests.push(path); return new Response('{}', { status: 401 }); }));
  await expect(checkoutApi.confirm(7, input, 'same-key')).rejects.toMatchObject({ status: 401 });
  expect(requests).toEqual(['/api/appointments/7/collection', '/api/auth/refresh']);
});
