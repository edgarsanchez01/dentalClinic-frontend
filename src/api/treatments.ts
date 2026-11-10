import { normalizeReferencePrice } from './catalog';
import { apiFetch } from './http';
import type { AppointmentSelection, RecordedAppointmentContext } from './clinicalTrace';

/**
 * Tratamientos clinicos de un paciente (RF-TR-04/05/06, matriz §7.4).
 *
 * Vive bajo `/api/patients/{id}/clinical/treatments`, el mismo bloque clinico que el expediente
 * y las notas. El backend es autoritativo en permisos: OWNER y DENTIST leen y escriben;
 * RECEPTIONIST y PATIENT no acceden. La referencia a la cita se fija al crear y no se modifica.
 */
export type TreatmentStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface TreatmentDto {
  id: number;
  patientId: number;
  /** Cita vinculada; ausente cuando el tratamiento no deriva de una cita concreta. */
  appointmentId?: number;
  description: string;
  diagnosis?: string;
  status: TreatmentStatus;
  notes?: string;
  /** Representación local exacta del importe; el contrato HTTP sigue usando un número JSON. */
  price?: string;
  createdAt: string;
  updatedAt?: string;
  /** Piezas dentales (FDI) relacionadas; ya llegan ordenadas y sin duplicados (§7.4). */
  toothFdis: number[];
}

export interface CreateTreatmentInput {
  description: string;
  diagnosis: string | null;
  status: TreatmentStatus;
  appointmentId: number | null;
  notes: string | null;
  price: string | null;
}

/** Entrada de evolucion de un tratamiento (RF-TR-07, EVO-01). Append-only. */
export interface TreatmentEvolutionDto {
  id: number;
  content: string;
  authorDentistId: number;
  authorName: string;
  createdAt: string;
  treatmentId?: number;
  appointmentContext?: RecordedAppointmentContext;
  /** Id de la entrada original corregida; ausente en entradas raiz (Fase 1B.2). */
  correctsRecordId?: number;
  /** Motivo obligatorio de la correccion; ausente en entradas raiz. */
  correctionReason?: string;
}

export interface CreateTreatmentEvolutionInput {
  content: string;
  appointmentContext?: AppointmentSelection | null;
}

export interface TreatmentEvolutionCorrectionInput {
  content: string;
  correctionReason: string;
}

export interface UpdateTreatmentInput {
  description: string;
  diagnosis: string | null;
  status: TreatmentStatus;
  notes: string | null;
  price: string | null;
}

function parseTreatments(text: string): unknown {
  // Conserva el lexema numerico del precio antes de que JSON.parse redondee un decimal de 19 digitos.
  // Las comillas internas van escapadas, por lo que solo coincide con propiedades numericas reales.
  return JSON.parse(text.replace(/("price"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

const decimalResponse = { parseResponse: parseTreatments };

function serializeTreatment(body: unknown): string {
  const input = body as { price: string | null };
  if (input.price === null) {
    return JSON.stringify(input);
  }
  const price = normalizeReferencePrice(input.price);
  if (price === null) throw new Error('El precio no tiene un formato válido.');
  // Sigue siendo un número JSON en el transporte, no una cadena ni un cambio de contrato.
  return JSON.stringify({ ...input, price: null }).replace('"price":null', `"price":${price}`);
}

export const treatmentsApi = {
  list(patientId: number): Promise<TreatmentDto[]> {
    return apiFetch<TreatmentDto[]>(`/api/patients/${patientId}/clinical/treatments`, decimalResponse);
  },

  create(patientId: number, input: CreateTreatmentInput): Promise<TreatmentDto> {
    return apiFetch<TreatmentDto>(`/api/patients/${patientId}/clinical/treatments`, {
      ...decimalResponse,
      method: 'POST',
      body: input,
      serializeBody: serializeTreatment,
    });
  },

  update(patientId: number, treatmentId: number, input: UpdateTreatmentInput): Promise<TreatmentDto> {
    return apiFetch<TreatmentDto>(`/api/patients/${patientId}/clinical/treatments/${treatmentId}`, {
      ...decimalResponse,
      method: 'PUT',
      body: input,
      serializeBody: serializeTreatment,
    });
  },

  listEvolution(patientId: number, treatmentId: number): Promise<TreatmentEvolutionDto[]> {
    return apiFetch<TreatmentEvolutionDto[]>(
      `/api/patients/${patientId}/clinical/treatments/${treatmentId}/evolution`,
    );
  },

  addEvolution(
    patientId: number,
    treatmentId: number,
    input: CreateTreatmentEvolutionInput,
  ): Promise<TreatmentEvolutionDto> {
    return apiFetch<TreatmentEvolutionDto>(
      `/api/patients/${patientId}/clinical/treatments/${treatmentId}/evolution`,
      {
        method: 'POST',
        body: input,
      },
    );
  },

  /**
   * Corrige una entrada de evolucion conservando la original (append-only). `evolutionId` puede ser
   * la raiz o cualquier correccion: el backend resuelve siempre la raiz.
   */
  correctEvolution(
    patientId: number,
    treatmentId: number,
    evolutionId: number,
    input: TreatmentEvolutionCorrectionInput,
  ): Promise<TreatmentEvolutionDto> {
    return apiFetch<TreatmentEvolutionDto>(
      `/api/patients/${patientId}/clinical/treatments/${treatmentId}/evolution/${evolutionId}/corrections`,
      {
        method: 'POST',
        body: input,
      },
    );
  },
};
