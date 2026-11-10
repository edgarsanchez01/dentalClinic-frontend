import { afterEach, describe, expect, it, vi } from 'vitest';
import { odontogramApi, type HistorySource } from '../../api/odontogram';
import { dentalAttention, dentalEvent, dentalInstant } from '../../test/odontogramFixtures';
import { instantNanoseconds, orderedHistoryEvents, utcInputInstant } from './odontogramUi';

afterEach(() => vi.unstubAllGlobals());

describe('Orden global y contratos E2', () => {
  it('no pierde microsegundos ni nanosegundos ni cambia el orden a causa de una zona', () => {
    const older = dentalEvent({ id: 999, changedAt: '2026-10-13T11:06:00.123456001Z' });
    const newer = dentalEvent({ id: 1, changedAt: '2026-10-13T11:06:00.123456002Z' });
    expect(orderedHistoryEvents([older, newer]).map((item) => item.id)).toEqual([1, 999]);
    expect(instantNanoseconds('2026-10-13T13:06:00.123456002+02:00')).toBe(instantNanoseconds(newer.changedAt));
  });
  it('desempata por rango de tabla e id numérico y produce claves source-id', () => {
    const sources: HistorySource[] = ['CONDITION_TOOTH', 'NOTES_TOOTH', 'TREATMENT_LINK', 'CONDITION_SURFACE', 'NOTES_SURFACE'];
    const entries = sources.map((source) => dentalEvent({ source, id: 1 }));
    const sorted = orderedHistoryEvents(entries);
    expect(sorted.map((item) => item.source)).toEqual([...sources].reverse());
    expect(new Set(sorted.map((item) => item.key)).size).toBe(5);
    expect(orderedHistoryEvents([dentalEvent({ id: 9 }), dentalEvent({ id: 10 })]).map((item) => item.id)).toEqual([10, 9]);
  });
  it('el selector UTC conserva fracciones y no usa la zona implícita del navegador', () => {
    expect(utcInputInstant('2026-10-13T11:05')).toBe('2026-10-13T11:05:00Z');
    expect(utcInputInstant('2026-10-13T11:05:00.123456')).toBe('2026-10-13T11:05:00.123456Z');
    expect(() => utcInputInstant('')).toThrow();
    expect(() => instantNanoseconds('2026-10-13T11:05:00')).toThrow();
  });
  it('history envía filtros y paginación usando únicamente propiedades reales', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ content: [dentalEvent()], page: 2, size: 20, totalElements: 41, totalPages: 3 }));
    vi.stubGlobal('fetch', fetch);
    await odontogramApi.history(42, { toothFdi: 21, from: '2026-10-12T00:00:00Z', to: '2026-10-13T12:00:00Z', appointmentId: 7, occurrenceVersion: 1, page: 2, size: 20 });
    const url = new URL(String(fetch.mock.calls[0][0]), 'http://test');
    expect(url.pathname).toBe('/api/patients/42/odontogram/history');
    expect(Object.fromEntries(url.searchParams)).toEqual({ toothFdi: '21', from: '2026-10-12T00:00:00Z', to: '2026-10-13T12:00:00Z', appointmentId: '7', occurrenceVersion: '1', page: '2', size: '20' });
  });
  it('at separa instante de atención y usa page, no number', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(dentalInstant())).mockResolvedValueOnce(json(dentalAttention()));
    vi.stubGlobal('fetch', fetch);
    await odontogramApi.atInstant(42, '2026-10-13T11:05:00Z');
    await odontogramApi.atAttention(42, { appointmentId: 7, occurrenceVersion: 1 }, 2);
    expect(new URL(String(fetch.mock.calls[0][0]), 'http://test').searchParams.has('appointmentId')).toBe(false);
    expect(Object.fromEntries(new URL(String(fetch.mock.calls[1][0]), 'http://test').searchParams))
      .toEqual({ appointmentId: '7', occurrenceVersion: '1', page: '2', size: '20' });
  });
  it.each([[], {}, { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }])('rechaza contratos de historial incompletos', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
    await expect(odontogramApi.history(42)).rejects.toThrow(/contrato.*E2/);
  });
  it('no acepta usar vínculos actuales como conjunto histórico desconocido', async () => {
    const invalid = dentalInstant();
    invalid.teeth[0].treatments.treatmentIds = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(invalid)));
    await expect(odontogramApi.atInstant(42, invalid.reference.at)).rejects.toThrow(/contrato/);
  });
  it('no acepta un estado de captura inventado para CURRENT_UNFROZEN', async () => {
    const invalid = dentalAttention();
    invalid.reference.occurrence.kind = 'CURRENT_UNFROZEN';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(invalid)));
    await expect(odontogramApi.atAttention(42, { appointmentId: 7, occurrenceVersion: 1 })).rejects.toThrow(/contrato/);
  });
});

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
