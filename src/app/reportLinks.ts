import type { ReportFilters } from '../api/financial';
import { calendarDate, instantParameter, localDayBoundary, routeId } from './deepLinks';

export type ReportTab = 'cartera' | 'cobros' | 'cargos';
export function reportTab(value: string | null): ReportTab {
  return value === 'cobros' || value === 'cargos' ? value : 'cartera';
}

export function readReportLink(params: URLSearchParams): { filters: ReportFilters; error: string | null } {
  const filters: ReportFilters = {};
  const invalid = () => ({ filters: {}, error: 'El enlace contiene un período o filtro no válido. Restablece el enlace para elegir los filtros.' });
  for (const key of ['tab', 'from', 'to', 'fromDay', 'toDay', 'patientId', 'status']) {
    if (params.getAll(key).length > 1) return invalid();
  }
  for (const key of ['fromDay', 'toDay'] as const) {
    const value = params.get(key);
    if (value !== null && !calendarDate(value)) return invalid();
  }
  for (const key of ['from', 'to'] as const) {
    const value = params.get(key);
    const day = params.get(key === 'from' ? 'fromDay' : 'toDay');
    if (value !== null) {
      if (!instantParameter(value)) return invalid();
      filters[key] = value;
    } else if (day) filters[key] = localDayBoundary(day, key === 'to');
  }
  if (filters.from && filters.to && Date.parse(filters.from) >= Date.parse(filters.to)) return invalid();
  if (params.has('patientId')) {
    const id = routeId(params.get('patientId'));
    if (id === null) return invalid();
    filters.patientId = id;
  }
  if (params.has('status')) {
    const status = (['PENDIENTE', 'PARCIAL', 'PAGADO', 'ANULADO'] as const).find((value) => value === params.get('status'));
    if (!status) return invalid();
    filters.status = status;
  }
  return { filters, error: null };
}

export function reportSearch(tab: ReportTab, filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, String(value));
  return params;
}
