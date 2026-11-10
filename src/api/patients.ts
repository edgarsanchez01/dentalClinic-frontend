import { apiFetch } from './http';
import type { AppointmentSelection, RecordedAppointmentContext } from './clinicalTrace';

/**
 * Pacientes (administrativo) y expediente clinico (Fase 4, matriz §7.4).
 *
 * La separacion administrativo/clinico es de endpoints, no solo de UI: `/api/patients/{id}` no
 * devuelve datos clinicos y `/api/patients/{id}/clinical` no los mezcla. El backend es
 * autoritativo en permisos; el frontend no amplia la matriz.
 */
export interface PatientDto {
  id: number;
  /** Cuenta asociada; ausente cuando el paciente no tiene acceso (1:0..1, P-08). */
  userId?: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  administrativeNotes?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface PageDto<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface CreatePatientInput {
  firstName: string;
  lastName: string;
  email?: string | undefined;
  phone?: string | undefined;
  birthDate?: string | undefined;
  administrativeNotes?: string | undefined;
}

/**
 * Reemplazo completo del bloque administrativo. Los campos opcionales se envian como `null` para
 * limpiarlos; `active` se omite para no cambiar la vigencia (PATCH parcial del estado).
 */
export interface UpdatePatientInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  administrativeNotes: string | null;
  active?: boolean | undefined;
}

export interface PatientListParams {
  search?: string | undefined;
  active?: boolean | undefined;
  page?: number | undefined;
  size?: number | undefined;
}

export interface ClinicalRecordDto {
  patientId: number;
  medicalBackground?: string;
  allergies?: string;
  clinicalHistory?: string;
  generalObservations?: string;
  updatedAt?: string;
}

export interface SaveClinicalRecordInput {
  medicalBackground?: string;
  allergies?: string;
  clinicalHistory?: string;
  generalObservations?: string;
}

export interface ClinicalNoteDto {
  id: number;
  content: string;
  authorDentistId: number;
  authorName: string;
  createdAt: string;
  appointmentContext?: RecordedAppointmentContext;
  /** Id de la nota original corregida; ausente en notas raiz (Fase 1B.2). */
  correctsRecordId?: number;
  /** Motivo obligatorio de la correccion; ausente en notas raiz. */
  correctionReason?: string;
}

export interface ClinicalCorrectionInput {
  content: string;
  correctionReason: string;
}

function query(params: PatientListParams): string {
  const search = new URLSearchParams();
  if (params.search && params.search.trim() !== '') {
    search.set('search', params.search.trim());
  }
  if (params.active !== undefined) {
    search.set('active', String(params.active));
  }
  if (params.page !== undefined) {
    search.set('page', String(params.page));
  }
  if (params.size !== undefined) {
    search.set('size', String(params.size));
  }
  const suffix = search.toString();
  return suffix === '' ? '' : `?${suffix}`;
}

export const patientsApi = {
  list(params: PatientListParams = {}): Promise<PageDto<PatientDto>> {
    return apiFetch<PageDto<PatientDto>>(`/api/patients${query(params)}`);
  },

  get(id: number): Promise<PatientDto> {
    return apiFetch<PatientDto>(`/api/patients/${id}`);
  },

  create(input: CreatePatientInput): Promise<PatientDto> {
    return apiFetch<PatientDto>('/api/patients', { method: 'POST', body: input });
  },

  update(id: number, input: UpdatePatientInput): Promise<PatientDto> {
    return apiFetch<PatientDto>(`/api/patients/${id}`, { method: 'PATCH', body: input });
  },

  getClinicalRecord(id: number): Promise<ClinicalRecordDto> {
    return apiFetch<ClinicalRecordDto>(`/api/patients/${id}/clinical`);
  },

  saveClinicalRecord(id: number, input: SaveClinicalRecordInput): Promise<ClinicalRecordDto> {
    return apiFetch<ClinicalRecordDto>(`/api/patients/${id}/clinical`, { method: 'PUT', body: input });
  },

  listClinicalNotes(id: number, generalOnly = false): Promise<ClinicalNoteDto[]> {
    return apiFetch<ClinicalNoteDto[]>(`/api/patients/${id}/clinical/notes${generalOnly ? '?generalOnly=true' : ''}`);
  },

  addClinicalNote(id: number, content: string, appointmentContext?: AppointmentSelection | null): Promise<ClinicalNoteDto> {
    return apiFetch<ClinicalNoteDto>(`/api/patients/${id}/clinical/notes`, {
      method: 'POST',
      body: { content, ...(appointmentContext === undefined ? {} : { appointmentContext }) },
    });
  },

  /**
   * Corrige una nota conservando la original (append-only). `noteId` puede ser la raiz o cualquier
   * correccion: el backend resuelve siempre la raiz.
   */
  correctClinicalNote(id: number, noteId: number, input: ClinicalCorrectionInput): Promise<ClinicalNoteDto> {
    return apiFetch<ClinicalNoteDto>(`/api/patients/${id}/clinical/notes/${noteId}/corrections`, {
      method: 'POST',
      body: input,
    });
  },
};
