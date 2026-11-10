import { apiFetch } from './http';
import type { PageDto } from './appointments';
import type { AppointmentSelection, OccurrenceContext, RecordedAppointmentContext } from './clinicalTrace';

/**
 * Odontograma de un paciente (RF-OD-01..08, matriz §7.4, grupo
 * `/api/patients/{id}/odontogram`).
 *
 * El backend es autoritativo en permisos y el contrato de la respuesta cambia segun el rol:
 *  - DENTIST y OWNER (lectura/escritura, P-05 revisada) reciben la vista completa
 *    (`ToothRecordResponse` / `ToothSurfaceResponse`) con observaciones, historial
 *    y tratamientos vinculados.
 *  - El PATIENT recibe SOLO el resumen reducido (`OdontogramSummaryResponse` /
 *    `ToothSurfaceSummaryResponse`): pieza, denticion y condicion. Sin observaciones,
 *    sin historial, sin tratamientos.
 *
 * F7.4.3.3 (consulta) y F7.4.3.4 (edicion clinica): este modulo expone las rutas de lectura
 * con tipos separados por contrato, y las de escritura (POST/PUT) de OWNER y DENTIST. El
 * historial de condición sigue embebido. E2 añade `/history` y `/at` para personal clínico;
 * las respuestas históricas se validan antes de habilitar escritura contextual.
 */
export type Dentition = 'PERMANENT' | 'TEMPORARY';

/** Condiciones de pieza (conjunto cerrado, RF-OD-03). No se inventan estados intermedios. */
export type ToothCondition =
  | 'HEALTHY'
  | 'CARIES'
  | 'FRACTURED'
  | 'RESTORED'
  | 'ROOT_CANAL'
  | 'CROWN'
  | 'IMPLANT'
  | 'MISSING'
  | 'EXTRACTED'
  | 'SEALED'
  | 'OTHER';

/** Superficies: anteriores (M,D,V,L,INCISAL) / posteriores (M,D,V,L,OCCLUSAL). */
export type ToothSurface = 'MESIAL' | 'DISTAL' | 'VESTIBULAR' | 'LINGUAL' | 'OCCLUSAL' | 'INCISAL';

/** Cambios de condicion de una pieza en respuestas del personal clinico (RF-OD-04). */
export interface ToothHistoryDto {
  id: number;
  previousCondition: ToothCondition | null;
  newCondition: ToothCondition;
  actorUserId: number;
  actorName: string;
  changedAt: string;
}

/** Cambios de condicion de una superficie en respuestas del personal clinico (RF-OD-04). */
export interface ToothSurfaceHistoryDto {
  id: number;
  previousCondition: ToothCondition | null;
  newCondition: ToothCondition;
  actorUserId: number;
  actorName: string;
  changedAt: string;
}

/** Superficie de una pieza en respuestas del personal clinico. */
export interface ToothSurfaceDto {
  id: number;
  toothRecordId: number;
  surface: ToothSurface;
  condition: ToothCondition;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  history: ToothSurfaceHistoryDto[];
}

/** Pieza del odontograma en respuestas del personal clinico (RF-OD-01..05). */
export interface ToothRecordDto {
  id: number;
  patientId: number;
  toothFdi: number;
  dentition: Dentition;
  condition: ToothCondition;
  notes?: string;
  treatmentIds: number[];
  createdAt: string;
  updatedAt?: string;
  history: ToothHistoryDto[];
  surfaces: ToothSurfaceDto[];
}

/** Resumen reducido de pieza; unico modelo que ve el propio PATIENT (matriz §7.4 `r`). */
export interface OdontogramSummaryDto {
  toothFdi: number;
  dentition: Dentition;
  condition: ToothCondition;
}

/** Resumen reducido de superficie; unico modelo que ve el propio PATIENT. */
export interface ToothSurfaceSummaryDto {
  surface: ToothSurface;
  condition: ToothCondition;
}

/** UX-05F: reception's dedicated read allowlist, never a full clinical record. */
export interface ReceptionDentalSummaryDto extends OdontogramSummaryDto {
  surfaces: ToothSurfaceSummaryDto[];
}

/** Contenido editable de una pieza (RF-OD-01/03): condicion, observaciones y tratamientos. */
export interface ToothWritePayload {
  condition: ToothCondition;
  notes: string | null;
  /** Reemplaza los tratamientos vinculados (RF-OD-05); vacio cuando aun no hay. */
  treatmentIds: number[];
  appointmentContext?: AppointmentSelection | null;
}

/** Alta de pieza: el cuerpo incluye el FDI (CreateToothRecordRequest). */
export interface CreateToothInput extends ToothWritePayload {
  toothFdi: number;
}

/** Edicion de pieza: el FDI viaja en la ruta (UpdateToothRecordRequest). */
export type UpdateToothInput = ToothWritePayload;

/** Alta de superficie: el cuerpo incluye la superficie (CreateToothSurfaceRequest). */
export interface CreateSurfaceInput {
  surface: ToothSurface;
  condition: ToothCondition;
  notes: string | null;
  appointmentContext?: AppointmentSelection | null;
}

/** Edicion de superficie: la superficie viaja en la ruta (UpdateToothSurfaceRequest). */
export interface UpdateSurfaceInput {
  condition: ToothCondition;
  notes: string | null;
  appointmentContext?: AppointmentSelection | null;
}

export type HistorySource = 'CONDITION_TOOTH' | 'NOTES_TOOTH' | 'TREATMENT_LINK' | 'CONDITION_SURFACE' | 'NOTES_SURFACE';
export interface OdontogramEventDto {
  kind: 'CONDITION' | 'NOTES' | 'TREATMENT_LINK';
  source: HistorySource;
  id: number;
  toothFdi: number;
  surface: ToothSurface | null;
  previousCondition: ToothCondition | null;
  newCondition: ToothCondition | null;
  previousNotes: string | null;
  newNotes: string | null;
  treatmentId: number | null;
  changeKind: 'ADD' | 'REMOVE' | null;
  actorUserId: number;
  actorName: string;
  changedAt: string;
  occurrence: RecordedAppointmentContext | null;
}
export interface HistoricalValue<T> {
  knowledge: 'KNOWN' | 'UNKNOWN';
  value: T | null;
  knownFrom: string | null;
}
export type HistoricalRegistration = 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN';
export interface HistoricalSurfaceDto {
  surface: ToothSurface;
  registration: HistoricalRegistration;
  condition: HistoricalValue<ToothCondition>;
  notes: HistoricalValue<string>;
}
export interface HistoricalToothDto {
  toothFdi: number;
  dentition: Dentition;
  registration: HistoricalRegistration;
  condition: HistoricalValue<ToothCondition>;
  notes: HistoricalValue<string>;
  treatments: {
    knowledge: 'KNOWN' | 'UNKNOWN' | 'PARTIAL';
    treatmentIds: number[] | null;
    knownLinkedIds: number[];
    knownUnlinkedIds: number[];
  };
  surfaces: HistoricalSurfaceDto[];
}
export interface HistoricalCompleteness {
  status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  reasons: string[];
}
export interface HistoricalSnapshotDto {
  at: string;
  teeth: HistoricalToothDto[];
  completeness: HistoricalCompleteness;
}
export interface OdontogramInstantDto {
  reference: { mode: 'INSTANT'; at: string };
  reconstructionAvailable: boolean;
  teeth: HistoricalToothDto[];
  completeness: HistoricalCompleteness;
}
export interface OdontogramAttentionDto {
  reference: { mode: 'ATTENTION'; occurrence: OccurrenceContext };
  reconstructionAvailable: boolean;
  stateAtCapture: HistoricalSnapshotDto | null;
  attributedEvents: PageDto<OdontogramEventDto>;
  currentState: { teeth: ToothRecordDto[] };
}
export interface OdontogramHistoryFilters {
  toothFdi?: number;
  from?: string;
  to?: string;
  appointmentId?: number;
  occurrenceVersion?: number;
  page?: number;
  size?: number;
}

const conditions = ['HEALTHY', 'CARIES', 'FRACTURED', 'RESTORED', 'ROOT_CANAL', 'CROWN', 'IMPLANT', 'MISSING', 'EXTRACTED', 'SEALED', 'OTHER'];
const sources = ['CONDITION_TOOTH', 'NOTES_TOOTH', 'TREATMENT_LINK', 'CONDITION_SURFACE', 'NOTES_SURFACE'];
const surfaceNames = ['MESIAL', 'DISTAL', 'VESTIBULAR', 'LINGUAL', 'OCCLUSAL', 'INCISAL'];
const statuses = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isoInstant = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const ids = (value: unknown): value is number[] => Array.isArray(value) && value.every(positiveId);

function eventContract(value: unknown): boolean {
  if (!object(value) || !positiveId(value.id) || !positiveId(value.actorUserId) || !positiveId(value.toothFdi)
    || !sources.includes(String(value.source)) || !isoInstant(value.changedAt) || typeof value.actorName !== 'string') return false;
  if (value.occurrence !== null && (!object(value.occurrence) || !positiveId(value.occurrence.appointmentId)
    || !positiveId(value.occurrence.occurrenceVersion) || !statuses.includes(String(value.occurrence.statusAtRegistration)))) return false;
  if (String(value.source).includes('SURFACE') ? !surfaceNames.includes(String(value.surface)) : value.surface !== null) return false;
  if (String(value.source).startsWith('CONDITION')) return value.kind === 'CONDITION'
    && (value.previousCondition === null || conditions.includes(String(value.previousCondition))) && conditions.includes(String(value.newCondition));
  if (String(value.source).startsWith('NOTES')) return value.kind === 'NOTES' && nullableText(value.previousNotes) && nullableText(value.newNotes);
  return value.kind === 'TREATMENT_LINK' && positiveId(value.treatmentId) && ['ADD', 'REMOVE'].includes(String(value.changeKind));
}
function pageContract(value: unknown): boolean {
  return object(value) && Array.isArray(value.content) && value.content.every(eventContract)
    && typeof value.page === 'number' && Number.isInteger(value.page) && value.page >= 0
    && typeof value.size === 'number' && value.size >= 1 && value.size <= 100
    && typeof value.totalElements === 'number' && value.totalElements >= 0
    && typeof value.totalPages === 'number' && value.totalPages >= 0;
}
function valueContract(value: unknown, isCondition: boolean): boolean {
  if (!object(value) || !['KNOWN', 'UNKNOWN'].includes(String(value.knowledge))
    || (value.knownFrom !== null && !isoInstant(value.knownFrom))) return false;
  if (value.knowledge === 'UNKNOWN') return value.value === null && value.knownFrom === null;
  return isCondition ? conditions.includes(String(value.value)) : nullableText(value.value);
}
function historicalToothContract(value: unknown): boolean {
  if (!object(value) || !positiveId(value.toothFdi) || !['PERMANENT', 'TEMPORARY'].includes(String(value.dentition))
    || !['REGISTERED', 'NOT_REGISTERED', 'UNKNOWN'].includes(String(value.registration))
    || !valueContract(value.condition, true) || !valueContract(value.notes, false) || !object(value.treatments)) return false;
  const links = value.treatments;
  return ['KNOWN', 'UNKNOWN', 'PARTIAL'].includes(String(links.knowledge)) && ids(links.knownLinkedIds) && ids(links.knownUnlinkedIds)
    && (links.knowledge === 'KNOWN' ? ids(links.treatmentIds) : links.treatmentIds === null)
    && Array.isArray(value.surfaces) && value.surfaces.every((surface: unknown) => object(surface)
      && surfaceNames.includes(String(surface.surface)) && ['REGISTERED', 'NOT_REGISTERED', 'UNKNOWN'].includes(String(surface.registration))
      && valueContract(surface.condition, true) && valueContract(surface.notes, false));
}
function snapshotContract(value: unknown): boolean {
  return object(value) && Array.isArray(value.teeth) && value.teeth.every(historicalToothContract)
    && object(value.completeness) && ['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(String(value.completeness.status))
    && Array.isArray(value.completeness.reasons) && value.completeness.reasons.every((reason: unknown) => typeof reason === 'string');
}
function currentContract(value: unknown): boolean {
  return object(value) && positiveId(value.id) && positiveId(value.patientId) && positiveId(value.toothFdi)
    && conditions.includes(String(value.condition)) && ids(value.treatmentIds) && Array.isArray(value.history)
    && Array.isArray(value.surfaces);
}
function contractError(): never {
  throw new Error('No se recibió el contrato de odontograma histórico E2. Comprueba que el backend disponga de V015 y E2 antes de registrar cambios contextuales.');
}
function search(filters: OdontogramHistoryFilters | { at: string }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}

export const odontogramApi = {
  async listReceptionSummary(patientId: number): Promise<ReceptionDentalSummaryDto[]> {
    const rows = await apiFetch<ReceptionDentalSummaryDto[]>(`/api/patients/${patientId}/odontogram/reception-summary`);
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row.surfaces)))
      throw new Error('No se pudo verificar el resumen dental de recepción.');
    return rows;
  },
  async history(patientId: number, filters: OdontogramHistoryFilters = {}): Promise<PageDto<OdontogramEventDto>> {
    const value = await apiFetch<PageDto<OdontogramEventDto>>(`/api/patients/${patientId}/odontogram/history?${search(filters)}`);
    if (!pageContract(value)) contractError();
    return value;
  },
  async atInstant(patientId: number, at: string): Promise<OdontogramInstantDto> {
    const value = await apiFetch<OdontogramInstantDto>(`/api/patients/${patientId}/odontogram/at?${search({ at })}`);
    if (!snapshotContract(value) || value.reference?.mode !== 'INSTANT' || !isoInstant(value.reference.at)
      || typeof value.reconstructionAvailable !== 'boolean') contractError();
    return value;
  },
  async atAttention(patientId: number, selection: AppointmentSelection, page = 0): Promise<OdontogramAttentionDto> {
    const value = await apiFetch<OdontogramAttentionDto>(`/api/patients/${patientId}/odontogram/at?${search({ ...selection, page, size: 20 })}`);
    const context = value?.reference?.occurrence;
    if (value?.reference?.mode !== 'ATTENTION' || !context || context.appointmentId !== selection.appointmentId
      || context.occurrenceVersion !== selection.occurrenceVersion || !positiveId(context.currentOccurrenceVersion)
      || !statuses.includes(context.currentStatus) || !['FROZEN', 'CURRENT_UNFROZEN', 'HISTORICAL_UNKNOWN'].includes(context.kind)
      || typeof value.reconstructionAvailable !== 'boolean' || !pageContract(value.attributedEvents)
      || !Array.isArray(value.currentState?.teeth) || !value.currentState.teeth.every(currentContract)
      || (context.kind === 'FROZEN' ? !isoInstant(context.capturedAt) || !snapshotContract(value.stateAtCapture)
        || !isoInstant(value.stateAtCapture?.at) || !value.reconstructionAvailable
        : value.stateAtCapture !== null || value.reconstructionAvailable)) contractError();
    return value;
  },
  /** Vista completa para OWNER y DENTIST; ambos conservan escritura clínica. */
  async list(patientId: number): Promise<ToothRecordDto[]> {
    const records = await apiFetch<ToothRecordDto[]>(`/api/patients/${patientId}/odontogram`);
    if (!Array.isArray(records)) throw new Error('No se pudo verificar la respuesta del odontograma. Reintenta la consulta.');
    return records;
  },

  /** Resumen para el propio paciente (RF-OD-08). */
  listSummary(patientId: number): Promise<OdontogramSummaryDto[]> {
    return apiFetch<OdontogramSummaryDto[]>(`/api/patients/${patientId}/odontogram`);
  },

  /** Superficies completas (personal clinico). */
  listSurfaces(patientId: number, toothFdi: number): Promise<ToothSurfaceDto[]> {
    return apiFetch<ToothSurfaceDto[]>(`/api/patients/${patientId}/odontogram/${toothFdi}/surfaces`);
  },

  /** Superficies en resumen (propio paciente). */
  listSurfaceSummaries(patientId: number, toothFdi: number): Promise<ToothSurfaceSummaryDto[]> {
    return apiFetch<ToothSurfaceSummaryDto[]>(
      `/api/patients/${patientId}/odontogram/${toothFdi}/surfaces`,
    );
  },

  /** Registra el estado inicial de una pieza (RF-OD-01). 409 si ya existe; se edita con PUT. */
  createTooth(patientId: number, input: CreateToothInput): Promise<ToothRecordDto> {
    return apiFetch<ToothRecordDto>(`/api/patients/${patientId}/odontogram`, {
      method: 'POST',
      body: input,
    });
  },

  /** Actualiza la condicion y observaciones de una pieza (RF-OD-01/03). 404 si no existe. */
  updateTooth(patientId: number, toothFdi: number, input: UpdateToothInput): Promise<ToothRecordDto> {
    return apiFetch<ToothRecordDto>(`/api/patients/${patientId}/odontogram/${toothFdi}`, {
      method: 'PUT',
      body: input,
    });
  },

  /** Registra el estado de una superficie (RF-OD-02). 409 si ya existe; se edita con PUT. */
  createSurface(
    patientId: number,
    toothFdi: number,
    input: CreateSurfaceInput,
  ): Promise<ToothSurfaceDto> {
    return apiFetch<ToothSurfaceDto>(
      `/api/patients/${patientId}/odontogram/${toothFdi}/surfaces`,
      { method: 'POST', body: input },
    );
  },

  /** Actualiza la condicion y observaciones de una superficie (RF-OD-02). 404 si no existe. */
  updateSurface(
    patientId: number,
    toothFdi: number,
    surface: ToothSurface,
    input: UpdateSurfaceInput,
  ): Promise<ToothSurfaceDto> {
    return apiFetch<ToothSurfaceDto>(
      `/api/patients/${patientId}/odontogram/${toothFdi}/surfaces/${surface}`,
      { method: 'PUT', body: input },
    );
  },
};
