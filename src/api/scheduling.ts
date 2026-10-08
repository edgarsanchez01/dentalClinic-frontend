import { apiFetch } from './http';

/**
 * Scheduling de Fase 5 (RF-SC, RF-AV). Horarios y bloqueos de la clínica y de los dentistas,
 * política de reservas, disponibilidad calculada y horario público.
 *
 * La disponibilidad es COMPUTADA por el backend (A-06): el cliente solo la muestra. El backend es
 * autoritativo en permisos; la UI refleja la matriz §7.4 pero no la sustituye.
 */

export interface TimeRangeDto {
  startTime: string;
  endTime: string;
}

export interface ScheduleDayDto {
  dayOfWeek: number;
  open: boolean;
  startTime?: string | null;
  endTime?: string | null;
  breaks: TimeRangeDto[];
}

export interface ClinicScheduleDto {
  timezone: string;
  days: ScheduleDayDto[];
}

export interface DentistScheduleDto {
  dentistId: number;
  timezone: string;
  days: ScheduleDayDto[];
}

export interface ScheduleDayInput {
  dayOfWeek: number;
  open: boolean;
  startTime?: string | null;
  endTime?: string | null;
  breaks: TimeRangeDto[];
}

export interface ScheduleExceptionDto {
  date: string;
  closed: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface ScheduleExceptionInput {
  closed: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface TimeOffDto {
  id: number;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export interface TimeOffInput {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface BookingPolicyDto {
  maxAdvanceDays: number;
  minBookingLeadTimeHours: number;
  cancellationLeadTimeHours: number;
  timezone: string;
}

export interface BookingPolicyInput {
  maxAdvanceDays: number;
  minBookingLeadTimeHours: number;
  cancellationLeadTimeHours: number;
}

export interface AvailabilitySlotDto {
  /** `LocalDate` del backend (AvailabilitySlot); el nombre serializado NO es `date`. */
  startDate: string;
  startTime: string;
  endTime: string;
  /** Instante ISO resuelto por el backend: es lo que viaja en startAt/endAt. */
  start: string;
  end: string;
}

export interface AvailabilityDto {
  dentistId: number;
  durationMinutes: number;
  timezone: string;
  slots: AvailabilitySlotDto[];
}

export interface PublicScheduleDto {
  timezone: string;
  days: { dayOfWeek: number; open: boolean; startTime?: string | null; endTime?: string | null }[];
  exceptions: { date: string; closed: boolean; startTime?: string | null; endTime?: string | null }[];
  dentists: {
    /** `PublicDentistView` serializa `dentistId` (nombre del componente del record), no `id`. */
    dentistId: number;
    firstName: string;
    lastName: string;
    specialty?: string | null;
    days: ScheduleDayDto[];
  }[];
}

export const schedulingApi = {
  getClinicSchedule(): Promise<ClinicScheduleDto> {
    return apiFetch<ClinicScheduleDto>('/api/schedules/clinic');
  },

  replaceClinicWeek(days: ScheduleDayInput[]): Promise<ClinicScheduleDto> {
    return apiFetch<ClinicScheduleDto>('/api/schedules/clinic', { method: 'PUT', body: { days } });
  },

  listClinicExceptions(): Promise<ScheduleExceptionDto[]> {
    return apiFetch<ScheduleExceptionDto[]>('/api/schedules/clinic/exceptions');
  },

  putClinicException(date: string, input: ScheduleExceptionInput): Promise<ScheduleExceptionDto> {
    return apiFetch<ScheduleExceptionDto>(`/api/schedules/clinic/exceptions/${date}`, {
      method: 'PUT',
      body: input,
    });
  },

  deleteClinicException(date: string): Promise<void> {
    return apiFetch<void>(`/api/schedules/clinic/exceptions/${date}`, { method: 'DELETE' });
  },

  getDentistSchedule(dentistId: number): Promise<DentistScheduleDto> {
    return apiFetch<DentistScheduleDto>(`/api/schedules/dentist/${dentistId}`);
  },

  replaceDentistWeek(dentistId: number, days: ScheduleDayInput[]): Promise<DentistScheduleDto> {
    return apiFetch<DentistScheduleDto>(`/api/schedules/dentist/${dentistId}`, {
      method: 'PUT',
      body: { days },
    });
  },

  listDentistExceptions(dentistId: number): Promise<ScheduleExceptionDto[]> {
    return apiFetch<ScheduleExceptionDto[]>(`/api/schedules/dentist/${dentistId}/exceptions`);
  },

  putDentistException(
    dentistId: number,
    date: string,
    input: ScheduleExceptionInput,
  ): Promise<ScheduleExceptionDto> {
    return apiFetch<ScheduleExceptionDto>(`/api/schedules/dentist/${dentistId}/exceptions/${date}`, {
      method: 'PUT',
      body: input,
    });
  },

  deleteDentistException(dentistId: number, date: string): Promise<void> {
    return apiFetch<void>(`/api/schedules/dentist/${dentistId}/exceptions/${date}`, {
      method: 'DELETE',
    });
  },

  listTimeOff(dentistId: number): Promise<TimeOffDto[]> {
    return apiFetch<TimeOffDto[]>(`/api/schedules/dentist/${dentistId}/time-off`);
  },

  createTimeOff(dentistId: number, input: TimeOffInput): Promise<TimeOffDto> {
    return apiFetch<TimeOffDto>(`/api/schedules/dentist/${dentistId}/time-off`, {
      method: 'POST',
      body: input,
    });
  },

  updateTimeOff(dentistId: number, timeOffId: number, input: TimeOffInput): Promise<TimeOffDto> {
    return apiFetch<TimeOffDto>(`/api/schedules/dentist/${dentistId}/time-off/${timeOffId}`, {
      method: 'PUT',
      body: input,
    });
  },

  deleteTimeOff(dentistId: number, timeOffId: number): Promise<void> {
    return apiFetch<void>(`/api/schedules/dentist/${dentistId}/time-off/${timeOffId}`, {
      method: 'DELETE',
    });
  },

  getPolicy(): Promise<BookingPolicyDto> {
    return apiFetch<BookingPolicyDto>('/api/availability/policy');
  },

  updatePolicy(input: BookingPolicyInput): Promise<BookingPolicyDto> {
    return apiFetch<BookingPolicyDto>('/api/availability/policy', { method: 'PUT', body: input });
  },

  availability(params: {
    dentistId: number;
    from: string;
    to?: string;
    duration: number;
  }): Promise<AvailabilityDto> {
    const search = new URLSearchParams({
      dentistId: String(params.dentistId),
      from: params.from,
      duration: String(params.duration),
    });
    if (params.to) {
      search.set('to', params.to);
    }
    return apiFetch<AvailabilityDto>(`/api/availability?${search.toString()}`);
  },

  /** Horario público: sin sesión (`auth: false`), no filtra datos privados. */
  getPublicSchedule(): Promise<PublicScheduleDto> {
    return apiFetch<PublicScheduleDto>('/api/public/schedule', { auth: false });
  },
};