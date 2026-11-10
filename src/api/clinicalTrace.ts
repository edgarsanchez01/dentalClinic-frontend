import { apiFetch } from './http';
import type { AppointmentStatus } from './appointments';
import type { ClinicalNoteDto, PageDto } from './patients';
import type { TreatmentEvolutionDto } from './treatments';

export interface AppointmentSelection { appointmentId: number; occurrenceVersion: number }
export interface RecordedAppointmentContext extends AppointmentSelection { statusAtRegistration: AppointmentStatus }
export interface ClinicalDestination extends AppointmentSelection { startAt: string; timeZone: string }
export type TraceSection = 'NOTES' | 'EVOLUTIONS';
export interface OccurrenceContext extends AppointmentSelection {
  currentOccurrenceVersion: number;
  currentStatus: AppointmentStatus;
  kind: 'FROZEN' | 'CURRENT_UNFROZEN' | 'HISTORICAL_UNKNOWN';
  dentistId?: number;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  timezone?: string;
  capturedAt?: string;
}
/** Cadena append-only de una entrada (raiz + correcciones) con su version vigente (Fase 1B.2). */
export interface ClinicalChainDto<T> {
  recordId: number;
  originalEntry: T;
  corrections: T[];
  currentEntry: T;
}
export interface TraceDto<T> {
  context: OccurrenceContext;
  availableSections: TraceSection[];
  section: TraceSection;
  results: PageDto<ClinicalChainDto<T>>;
}

export const clinicalTraceApi = {
  notes(patientId: number, selection: AppointmentSelection, page = 0): Promise<TraceDto<ClinicalNoteDto>> {
    return read(patientId, selection, 'NOTES', page);
  },
  evolutions(patientId: number, selection: AppointmentSelection, page = 0): Promise<TraceDto<TreatmentEvolutionDto>> {
    return read(patientId, selection, 'EVOLUTIONS', page);
  },
};

async function read<T>(patientId: number, selection: AppointmentSelection, section: TraceSection, page: number): Promise<TraceDto<T>> {
  const params = new URLSearchParams({ occurrenceVersion: String(selection.occurrenceVersion), section, page: String(page), size: '20' });
  const result = await apiFetch<TraceDto<T>>(`/api/patients/${patientId}/clinical/appointments/${selection.appointmentId}/trace?${params}`);
  if (!result?.context || !result.results || !Array.isArray(result.results.content) || result.section !== section
      || typeof result.results.totalElements !== 'number'
      || result.results.content.some((chain) => !chain || !chain.originalEntry || !Array.isArray(chain.corrections) || !chain.currentEntry)) {
    throw new Error('No se recibió el contrato de trazabilidad esperado. Comprueba que el backend tenga Fase 1B.2 antes de guardar información contextual.');
  }
  return result;
}

export function destinationSelection(destination: ClinicalDestination | null): AppointmentSelection | null {
  return destination ? { appointmentId: destination.appointmentId, occurrenceVersion: destination.occurrenceVersion } : null;
}
