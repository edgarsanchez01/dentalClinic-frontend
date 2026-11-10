import { afterEach, expect, it, vi } from 'vitest';
import { appointmentsApi } from './appointments';
import { catalogApi } from './catalog';
import { tokenStore } from './http';
import { schedulingApi } from './scheduling';

afterEach(() => { vi.unstubAllGlobals(); tokenStore.set(null); });

it('F7.3 codifica consulta por servicio y consulta histórica por cita sin duración manual', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { requests.push(String(input)); return new Response('{}', { status: 200 }); });
  await schedulingApi.availability({ dentistId: 7, from: '2026-10-13', serviceId: 30 });
  await schedulingApi.availability({ dentistId: 7, from: '2026-10-13', appointmentId: 8 });
  expect(requests).toEqual(['/api/availability?dentistId=7&from=2026-10-13&serviceId=30', '/api/availability?dentistId=7&from=2026-10-13&appointmentId=8']);
});

it('F7.3 mantiene precio histórico exacto en el DTO de citas e Idempotency-Key en creación', async () => {
  let options: RequestInit | undefined;
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    options = init;
    return new Response('{"id":7,"service":{"id":30,"name":"Histórico","referencePrice":999999999999999.9999,"durationMinutes":30}}', { status: 201 });
  });
  const response = await appointmentsApi.create({ serviceId: 30, dentistId: 7, patientId: 1, startAt: '2026-10-13T09:00:00Z', endAt: '2026-10-13T09:30:00Z' }, 'service-key');
  expect(response.service?.referencePrice).toBe('999999999999999.9999');
  expect(options?.headers).toMatchObject({ 'Idempotency-Key': 'service-key' });
  expect(JSON.parse(String(options?.body))).toMatchObject({ serviceId: 30 });
});

it('F7.3 consulta el catálogo público para PATIENT sin adjuntar el token administrativo', async () => {
  tokenStore.set('private-token');
  let url = ''; let options: RequestInit | undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => { url = String(input); options = init; return new Response('[]', { status: 200 }); });
  await catalogApi.publicList();
  expect(url).toBe('/api/public/services');
  expect(options?.headers).not.toHaveProperty('Authorization');
});
