import { apiFetch } from './http';

export interface PageDto<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface AppointmentResponse {
  id: number;
  patientId: number;
  patientFirstName: string;
  patientLastName: string;
  patientUserId?: number;
  dentistId: number;
  dentistFirstName: string;
  dentistLastName: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  occurrenceVersion: number;
  createdByUserId: number;
  reason?: string;
  notes?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppointmentEventView {
  id: number;
  eventType:
    | 'APPOINTMENT_CREATED'
    | 'APPOINTMENT_RESCHEDULED'
    | 'APPOINTMENT_CANCELLED'
    | 'APPOINTMENT_COMPLETED'
    | 'APPOINTMENT_NO_SHOW'
    | 'PATIENT_ARRIVED'
    | 'APPOINTMENT_STARTED'
    | 'REMINDER_SENT'
    | 'REMINDER_FAILED'
    | 'FEEDBACK_REQUESTED';
  actorUserId: number;
  occurrenceVersion: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAppointmentRequest {
  patientId: number;
  dentistId: number;
  startAt: string;
  endAt: string;
  reason?: string | undefined;
  notes?: string | undefined;
}

export interface RescheduleAppointmentRequest {
  startAt: string;
  endAt: string;
  expectedOccurrenceVersion: number;
}

export interface AppointmentListParams {
  dentistId?: number;
  patientId?: number;
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export const appointmentsApi = {
  list(params: AppointmentListParams = {}): Promise<PageDto<AppointmentResponse>> {
    const search = new URLSearchParams();
    if (params.dentistId !== undefined) {
      search.set('dentistId', String(params.dentistId));
    }
    if (params.patientId !== undefined) {
      search.set('patientId', String(params.patientId));
    }
    if (params.status !== undefined) {
      search.set('status', params.status);
    }
    if (params.from !== undefined) {
      search.set('from', params.from);
    }
    if (params.to !== undefined) {
      search.set('to', params.to);
    }
    if (params.page !== undefined) {
      search.set('page', String(params.page));
    }
    if (params.size !== undefined) {
      search.set('size', String(params.size));
    }
    const suffix = search.toString();
    return apiFetch<PageDto<AppointmentResponse>>(`/api/appointments${suffix === '' ? '' : `?${suffix}`}`);
  },

  get(id: number): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>(`/api/appointments/${id}`);
  },

  events(id: number): Promise<AppointmentEventView[]> {
    return apiFetch<AppointmentEventView[]>(`/api/appointments/${id}/events`);
  },

  create(input: CreateAppointmentRequest, idempotencyKey: string): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>('/api/appointments', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  reschedule(id: number, input: RescheduleAppointmentRequest): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>(`/api/appointments/${id}/reschedule`, {
      method: 'POST',
      body: input,
    });
  },

  cancel(id: number): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>(`/api/appointments/${id}/cancel`, { method: 'POST' });
  },

  complete(id: number): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>(`/api/appointments/${id}/complete`, { method: 'POST' });
  },

  noShow(id: number): Promise<AppointmentResponse> {
    return apiFetch<AppointmentResponse>(`/api/appointments/${id}/no-show`, { method: 'POST' });
  },

  arrive(id: number): Promise<AppointmentEventView> {
    return apiFetch<AppointmentEventView>(`/api/appointments/${id}/arrive`, { method: 'POST' });
  },

  start(id: number): Promise<AppointmentEventView> {
    return apiFetch<AppointmentEventView>(`/api/appointments/${id}/start`, { method: 'POST' });
  },
};
