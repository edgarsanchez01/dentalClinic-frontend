import type { HistoricalToothDto, OdontogramAttentionDto, OdontogramEventDto, OdontogramInstantDto, ToothRecordDto } from '../api/odontogram';

/** Synthetic E2-contract fixtures, shared by Vitest and intercepted Playwright; never production data. */
export const DENTAL_FIXTURE_TIME = '2026-10-13T11:05:00Z';
export function dentalCurrent(overrides: Partial<ToothRecordDto> = {}): ToothRecordDto {
  return { id: 501, patientId: 42, toothFdi: 21, dentition: 'PERMANENT', condition: 'RESTORED',
    notes: 'Estado actual de prueba', treatmentIds: [9], createdAt: '2026-10-12T10:00:00Z', history: [], surfaces: [], ...overrides };
}
export function dentalEvent(overrides: Partial<OdontogramEventDto> = {}): OdontogramEventDto {
  return { id: 301, kind: 'NOTES', source: 'NOTES_TOOTH', toothFdi: 21, surface: null,
    previousCondition: null, newCondition: null, previousNotes: null, newNotes: 'Observación asociada de prueba',
    treatmentId: null, changeKind: null, actorUserId: 10, actorName: 'Profesional de prueba',
    changedAt: '2026-10-13T11:06:00.123456Z', occurrence: { appointmentId: 7, occurrenceVersion: 1, statusAtRegistration: 'SCHEDULED' }, ...overrides };
}
export function dentalHistorical(overrides: Partial<HistoricalToothDto> = {}): HistoricalToothDto {
  return { toothFdi: 21, dentition: 'PERMANENT', registration: 'REGISTERED',
    condition: { knowledge: 'KNOWN', value: 'CARIES', knownFrom: '2026-10-12T10:00:00Z' },
    notes: { knowledge: 'UNKNOWN', value: null, knownFrom: null },
    treatments: { knowledge: 'PARTIAL', treatmentIds: null, knownLinkedIds: [9], knownUnlinkedIds: [10] },
    surfaces: [], ...overrides };
}
export function dentalAttention(overrides: Partial<OdontogramAttentionDto> = {}): OdontogramAttentionDto {
  return { reference: { mode: 'ATTENTION', occurrence: { appointmentId: 7, occurrenceVersion: 1,
    currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED', kind: 'FROZEN', capturedAt: DENTAL_FIXTURE_TIME,
    scheduledStartAt: '2026-10-13T10:00:00Z', scheduledEndAt: '2026-10-13T11:00:00Z', timezone: 'UTC', dentistId: 3 } },
    reconstructionAvailable: true,
    stateAtCapture: { at: DENTAL_FIXTURE_TIME, teeth: [dentalHistorical()], completeness: { status: 'PARTIAL', reasons: ['NOTES_UNKNOWN', 'TREATMENT_LINKS_PARTIAL'] } },
    attributedEvents: { content: [dentalEvent()], page: 0, size: 20, totalElements: 1, totalPages: 1 },
    currentState: { teeth: [dentalCurrent()] }, ...overrides };
}
export function dentalInstant(at = DENTAL_FIXTURE_TIME): OdontogramInstantDto {
  return { reference: { mode: 'INSTANT', at }, reconstructionAvailable: true, teeth: [dentalHistorical()],
    completeness: { status: 'PARTIAL', reasons: ['NOTES_UNKNOWN', 'TREATMENT_LINKS_PARTIAL'] } };
}
