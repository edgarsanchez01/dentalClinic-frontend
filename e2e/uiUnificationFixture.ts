import type { Page, Route } from '@playwright/test';

/**
 * F0 — fixture determinista de DC-UI-UNIFICATION-01.
 *
 * Reglas de la baseline:
 *  - Todas las llamadas `/api/**` se interceptan. Una ruta no declarada se registra y responde 500:
 *    la prueba debe fallar, nunca alcanzar un backend real.
 *  - Solo `POST /api/auth/refresh` es una escritura de bootstrap permitida. Cualquier otra
 *    escritura se bloquea sin ejecutarse (405) y se registra; abrir una pantalla no crea dinero,
 *    citas, notas ni cambios de estado.
 *  - El rol se declara en la política de la tabla. Una ruta declarada pero prohibida para el rol
 *    responde 403 y se registra como violación (la UI no debe pedirla).
 *  - Reloj y datos son fijos; no se usan esperas arbitrarias.
 */

export const NOW = '2026-10-26T07:00:00Z';
export const TODAY = '2026-10-26';
export const TOMORROW = '2026-10-27';
export const TIMEZONE = 'UTC';

export type UiRole = 'OWNER' | 'DENTIST' | 'RECEPTIONIST' | 'PATIENT';
export type UiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UiCall {
  method: UiMethod;
  path: string;
  params: URLSearchParams;
  body: unknown;
  role: UiRole;
  declared: boolean;
  allowed: boolean;
}

export interface UiViolations {
  undeclared: UiCall[];
  forbidden: UiCall[];
  blockedWrites: UiCall[];
}

export interface UiFixtureResult {
  calls: UiCall[];
  violations: UiViolations;
  manifest(): string;
}

type Roles = readonly UiRole[];
const ALL: Roles = ['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'];
const STAFF: Roles = ['OWNER', 'DENTIST', 'RECEPTIONIST'];
const CLINICAL: Roles = ['OWNER', 'DENTIST'];
const FINANCIAL_READ: Roles = ['OWNER', 'DENTIST', 'RECEPTIONIST'];
const FINANCIAL_WRITE: Roles = ['OWNER', 'RECEPTIONIST'];

const pageDto = <T>(content: T[], size = 20) => ({
  content,
  page: 0,
  size,
  totalElements: content.length,
  totalPages: content.length === 0 ? 0 : Math.ceil(content.length / size),
});

/** Spring `Page` con `number` (declaraciones de intake), no `page`. */
const intakePage = () => ({ content: [], number: 0, size: 10, totalElements: 0, totalPages: 0 });

const days = Array.from({ length: 7 }, (_, i) => ({
  dayOfWeek: i + 1,
  open: i < 6,
  startTime: '09:00:00',
  endTime: '18:00:00',
  breaks: [{ startTime: '13:00:00', endTime: '14:00:00' }],
}));

const service = (id: number, name: string, price: string, durationMinutes: number) => ({
  id, name, description: 'Servicio sintético de baseline', referencePrice: price,
  durationMinutes, active: true, createdAt: NOW, updatedAt: null,
});

const services = [
  service(1, 'Consulta de valoración', '650.00', 60),
  service(2, 'Limpieza dental', '900.00', 45),
  service(3, 'Restauración simple', '1250.00', 60),
];

const clinic = {
  id: 1, name: 'Clínica de prueba', description: 'Clínica sintética para baseline visual.',
  logoUrl: null, address: 'Calle de prueba 1', phone: '555 000 0000', email: 'clinica@example.test',
  publicInfo: 'Atención dental de prueba.', brandColor: null, socialNetworks: null,
  timezone: TIMEZONE, createdAt: NOW, updatedAt: null,
};

const dentists = [
  { dentistId: 7, firstName: 'Ana', lastName: 'Propietaria', days },
  { dentistId: 8, firstName: 'Diego', lastName: 'Molina', days },
];

const publicSchedule = { timezone: TIMEZONE, days, exceptions: [], dentists };

const visit = (
  id: number,
  patientId: number,
  firstName: string,
  lastName: string,
  dentistId: number,
  startAt: string,
  durationMinutes: number,
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
  serviceId = 1,
) => ({
  id, patientId, patientUserId: patientId === 4 ? 10 : undefined,
  patientFirstName: firstName, patientLastName: lastName,
  dentistId,
  dentistFirstName: dentistId === 7 ? 'Ana' : 'Diego',
  dentistLastName: dentistId === 7 ? 'Propietaria' : 'Molina',
  startAt, endAt: new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString(),
  durationMinutes, status, occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW,
  service: services.find(item => item.id === serviceId) ?? null,
});

const appointments = [
  // Paciente 4 (PATIENT) — historial, hoy y próxima cita.
  visit(20, 4, 'Paciente', 'Propio', 7, '2026-10-26T08:00:00Z', 60, 'COMPLETED'),
  visit(21, 4, 'Paciente', 'Propio', 7, '2026-10-26T09:00:00Z', 60, 'SCHEDULED'),
  visit(22, 4, 'Paciente', 'Propio', 8, '2026-10-27T10:00:00Z', 45, 'SCHEDULED', 2),
  visit(23, 4, 'Paciente', 'Propio', 7, '2026-10-23T11:00:00Z', 60, 'COMPLETED'),
  // Agenda de la clínica: simultáneas, estados y profesionales.
  visit(24, 5, 'Daniela', 'Montes', 7, '2026-10-26T09:00:00Z', 30, 'SCHEDULED', 2),
  visit(25, 6, 'Elena', 'Salas', 8, '2026-10-26T09:30:00Z', 60, 'SCHEDULED'),
  visit(26, 7, 'Gabriel', 'Pérez', 7, '2026-10-26T10:30:00Z', 60, 'COMPLETED'),
  visit(27, 8, 'Inés', 'Romero', 8, '2026-10-26T11:00:00Z', 45, 'NO_SHOW', 2),
  visit(28, 5, 'Daniela', 'Montes', 7, '2026-10-26T12:00:00Z', 60, 'CANCELLED'),
  visit(29, 6, 'Elena', 'Salas', 8, '2026-10-26T15:00:00Z', 60, 'SCHEDULED'),
  visit(30, 7, 'Gabriel', 'Pérez', 7, '2026-10-26T16:00:00Z', 60, 'SCHEDULED'),
  visit(31, 8, 'Inés', 'Romero', 8, '2026-10-26T17:00:00Z', 45, 'SCHEDULED', 2),
  visit(32, 9, 'Julián', 'Acosta', 7, '2026-10-27T09:00:00Z', 60, 'SCHEDULED'),
  visit(33, 10, 'Lucía', 'Soto', 8, '2026-10-27T11:00:00Z', 45, 'SCHEDULED', 2),
  visit(34, 11, 'Mateo', 'Silva', 7, '2026-10-28T10:00:00Z', 60, 'SCHEDULED'),
  visit(35, 12, 'Nora', 'Reyes', 8, '2026-11-02T09:00:00Z', 60, 'SCHEDULED'),
  visit(36, 13, 'Óscar', 'Vidal', 7, '2026-10-24T09:00:00Z', 60, 'COMPLETED'),
  visit(37, 14, 'Paula', 'Herrera', 8, '2026-10-25T09:00:00Z', 60, 'NO_SHOW'),
];

const patients = [
  { id: 4, userId: 10, firstName: 'Paciente', lastName: 'Propio', email: 'paciente@example.test', phone: '555 111 1111', birthDate: '1990-04-12', administrativeNotes: 'Paciente de baseline.', active: true, createdAt: NOW, updatedAt: null },
  { id: 5, userId: undefined, firstName: 'Daniela', lastName: 'Montes', email: 'daniela@example.test', phone: '555 222 2222', birthDate: '1988-07-01', administrativeNotes: null, active: true, createdAt: NOW, updatedAt: null },
  { id: 6, userId: undefined, firstName: 'Elena', lastName: 'Salas', email: 'elena@example.test', phone: '555 333 3333', birthDate: '1995-01-20', administrativeNotes: null, active: true, createdAt: NOW, updatedAt: null },
  { id: 7, userId: undefined, firstName: 'Gabriel', lastName: 'Pérez', email: 'gabriel@example.test', phone: '555 444 4444', birthDate: '1979-11-30', administrativeNotes: 'Requiere confirmación telefónica.', active: true, createdAt: NOW, updatedAt: null },
  { id: 8, userId: undefined, firstName: 'Inés', lastName: 'Romero', email: 'ines@example.test', phone: '555 555 5555', birthDate: '2001-02-14', administrativeNotes: null, active: false, createdAt: NOW, updatedAt: null },
  { id: 9, userId: undefined, firstName: 'Julián', lastName: 'Acosta', email: 'julian@example.test', phone: '555 666 6666', birthDate: '1992-09-09', administrativeNotes: null, active: true, createdAt: NOW, updatedAt: null },
];

const clinicalRecord = {
  patientId: 4,
  medicalBackground: 'Sin antecedentes sistémicos relevantes declarados.',
  allergies: 'Penicilina.',
  clinicalHistory: 'Seguimiento periodontal y restauraciones previas.',
  generalObservations: 'Paciente colaborador; revisar sensibilidad en sector posterior.',
  updatedAt: NOW,
};

const odontogram = [
  { id: 1, patientId: 4, toothFdi: 16, dentition: 'PERMANENT', condition: 'RESTORED', notes: 'Restauración oclusal.', treatmentIds: [], createdAt: NOW, updatedAt: NOW, history: [], surfaces: [] },
  { id: 2, patientId: 4, toothFdi: 26, dentition: 'PERMANENT', condition: 'CARIES', notes: null, treatmentIds: [], createdAt: NOW, updatedAt: NOW, history: [], surfaces: [] },
];

const odontogramSummary = [
  { toothFdi: 16, dentition: 'PERMANENT', condition: 'RESTORED' },
  { toothFdi: 26, dentition: 'PERMANENT', condition: 'CARIES' },
];

const receptionSummary = [
  { toothFdi: 16, dentition: 'PERMANENT', condition: 'RESTORED', surfaces: [{ surface: 'OCCLUSAL', condition: 'RESTORED' }] },
  { toothFdi: 26, dentition: 'PERMANENT', condition: 'CARIES', surfaces: [] },
];

const chargeItem = {
  id: 11, chargeId: 1, serviceCatalogItemId: 1, treatingDentistId: 7,
  description: 'Consulta de valoración', quantity: 1, unitPrice: '100.00', lineTotal: '100.00', createdAt: NOW,
};

const charge = {
  id: 1, patientId: 4, appointmentId: 20, currency: 'MXN', totalAmount: '100.00',
  appliedAmount: '40.00', pendingBalance: '60.00', status: 'PARCIAL',
  notes: 'Cargo sintético de baseline.', confirmedAt: NOW, confirmedByUserId: 1,
  cancelledAt: null, cancelledByUserId: null, cancellationReason: null, version: 2,
  createdAt: NOW, updatedAt: NOW,
  items: [chargeItem],
  movements: [{
    id: 21, chargeId: 1, patientId: 4, type: 'PAYMENT', amount: '40.00', paymentMethod: 'CASH',
    reversesMovementId: null, reason: null, performedByUserId: 3, performedAt: NOW, createdAt: NOW,
  }],
};

const charge2 = {
  id: 2, patientId: 5, appointmentId: null, currency: 'MXN', totalAmount: '500.00',
  appliedAmount: '0.00', pendingBalance: '500.00', status: 'PENDIENTE',
  notes: null, confirmedAt: NOW, confirmedByUserId: 1, cancelledAt: null, cancelledByUserId: null,
  cancellationReason: null, version: 1, createdAt: NOW, updatedAt: NOW,
  items: [{ id: 12, chargeId: 2, serviceCatalogItemId: 2, treatingDentistId: null, description: 'Limpieza dental', quantity: 1, unitPrice: '500.00', lineTotal: '500.00', createdAt: NOW }],
  movements: [],
};

const contextToken = `v1:${'a'.repeat(64)}`;
const financialContext = {
  appointmentId: 20, patientId: 4, dentistId: 7, appointmentOccurrenceVersion: 1,
  observedAt: NOW, financialContextToken: contextToken, associationState: 'SINGLE_ACTIVE',
  chargeCount: 1, service: services[0],
  charges: [{
    id: 1, patientId: 4, appointmentId: 20, currency: 'MXN', totalAmount: '100.00',
    appliedAmount: '40.00', pendingBalance: '60.00', status: 'PARCIAL', confirmedAt: NOW,
    items: [chargeItem],
    movements: charge.movements,
  }],
};

/** Contexto de ocurrencia usado por `/trace` y `/odontogram/at`; nunca inventa congelados. */
function occurrence(url: URL) {
  const appointmentId = Number(url.searchParams.get('appointmentId') ?? url.pathname.split('/').at(-2));
  const occurrenceVersion = Number(url.searchParams.get('occurrenceVersion') ?? 1);
  const appointment = appointments.find(row => row.id === appointmentId) ?? appointments[0]!;
  return {
    appointmentId: appointment.id,
    occurrenceVersion,
    currentOccurrenceVersion: appointment.occurrenceVersion,
    currentStatus: appointment.status,
    kind: 'CURRENT_UNFROZEN' as const,
    dentistId: appointment.dentistId,
    scheduledStartAt: appointment.startAt,
    scheduledEndAt: appointment.endAt,
    timezone: TIMEZONE,
  };
}

function traceResponse(url: URL) {
  const section = url.searchParams.get('section') === 'EVOLUTIONS' ? 'EVOLUTIONS' : 'NOTES';
  return {
    context: occurrence(url),
    availableSections: ['NOTES', 'EVOLUTIONS'],
    section,
    results: pageDto([]),
  };
}

/** `OdontogramAttentionDto` vigente (no congelado): sin snapshot ni reconstrucción. */
function odontogramAt(url: URL) {
  if (url.searchParams.has('appointmentId')) {
    return {
      reference: { mode: 'ATTENTION', occurrence: occurrence(url) },
      reconstructionAvailable: false,
      stateAtCapture: null,
      attributedEvents: pageDto([]),
      currentState: { teeth: odontogram },
    };
  }
  return {
    reference: { mode: 'INSTANT', at: url.searchParams.get('at') ?? NOW },
    reconstructionAvailable: true,
    teeth: [],
    completeness: { status: 'COMPLETE', reasons: [] },
  };
}

const collectionRow = (appointment: typeof appointments[number], state: string) => ({
  appointment,
  collectionState: state,
  hasRecordedCharge: state !== 'NO_CHARGE' && state !== 'REVIEW_REQUIRED',
  activeChargeId: state === 'PARTIAL' ? 1 : null,
  totalAmount: state === 'PARTIAL' ? '100.00' : null,
  appliedAmount: state === 'PARTIAL' ? '40.00' : null,
  pendingBalance: state === 'PARTIAL' ? '60.00' : null,
  currency: state === 'PARTIAL' ? 'MXN' : null,
  financialContextToken: state === 'PARTIAL' ? contextToken : null,
  reviewReason: state === 'REVIEW_REQUIRED' ? 'El cargo asociado requiere revisión administrativa.' : null,
});

const collectionQueue = {
  content: [collectionRow(appointments[0]!, 'PARTIAL'), collectionRow(appointments[3]!, 'NO_CHARGE'), collectionRow(appointments[6]!, 'REVIEW_REQUIRED')],
  page: 0, size: 20, totalElements: 3, totalPages: 1, observedAt: NOW,
  summary: {
    counts: { NO_CHARGE: 1, PENDING: 0, PARTIAL: 1, SETTLED: 0, REVIEW_REQUIRED: 1 },
    completedCount: 3, verifiedPendingBalance: '60.00', currency: 'MXN',
  },
};

const notifications = [
  { id: 1, title: 'Cita confirmada', body: 'La cita de hoy quedó confirmada.', priority: 'NORMAL', read: false, createdAt: NOW, appointmentId: 21 },
  { id: 2, title: 'Recordatorio de atención', body: 'Revisa los datos de la atención de la tarde.', priority: 'HIGH', read: false, createdAt: '2026-10-25T12:00:00Z' },
  { id: 3, title: 'Actualización de la clínica', body: 'El horario de la clínica sigue vigente.', priority: 'NORMAL', read: true, createdAt: '2026-10-24T09:00:00Z', readAt: '2026-10-24T10:00:00Z' },
];

const staffUsers = [
  { id: 1, email: 'owner@example.test', role: 'OWNER', active: true, createdAt: NOW, status: 'ACTIVE', dentist: { firstName: 'Ana', lastName: 'Propietaria', phone: '555 000 0000', specialty: 'Odontología general', licenseNumber: 'CED-0001', publicInfo: null, photoUrl: null } },
  { id: 3, email: 'recepcion@example.test', role: 'RECEPTIONIST', active: true, createdAt: NOW, status: 'ACTIVE', dentist: null },
  { id: 7, email: 'dentista@example.test', role: 'DENTIST', active: true, createdAt: NOW, status: 'ACTIVE', dentist: { firstName: 'Ana', lastName: 'Propietaria', phone: '555 000 0001', specialty: 'Odontología general', licenseNumber: 'CED-0002', publicInfo: null, photoUrl: null } },
  { id: 8, email: 'diego@example.test', role: 'DENTIST', active: false, createdAt: NOW, status: 'PENDING', dentist: { firstName: 'Diego', lastName: 'Molina', phone: '555 000 0002', specialty: null, licenseNumber: null, publicInfo: null, photoUrl: null } },
  { id: 9, email: 'baja@example.test', role: 'RECEPTIONIST', active: false, createdAt: NOW, status: 'INACTIVE', dentist: null },
];

const reviews = {
  content: [
    { id: 1, rating: 5, comment: 'Atención clara y puntual.', respondedAt: '2026-10-20T10:00:00Z' },
    { id: 2, rating: 4, comment: 'Buen seguimiento.', respondedAt: '2026-10-18T10:00:00Z' },
    { id: 3, rating: 5, comment: null, respondedAt: '2026-10-15T10:00:00Z' },
  ],
  page: 0, size: 20, totalElements: 3, totalPages: 1, count: 3, average: 4.67,
};

const userFor = (role: UiRole) => {
  if (role === 'PATIENT') {
    return { id: 10, email: 'paciente@example.test', role, active: true, createdAt: NOW, patientId: 4,
      medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } };
  }
  if (role === 'DENTIST') return { id: 2, email: 'dentista@example.test', role, active: true, createdAt: NOW, dentistId: 7 };
  if (role === 'RECEPTIONIST') return { id: 3, email: 'recepcion@example.test', role, active: true, createdAt: NOW };
  return { id: 1, email: 'owner@example.test', role, active: true, createdAt: NOW, dentistId: 7 };
};

/**
 * Tabla declarada de endpoints. El orden importa: las rutas específicas preceden a las genéricas.
 * Cada entrada documenta el rol mínimo que la UI puede ejercer en la baseline.
 */
function table(role: UiRole): Array<{ match: (path: string) => boolean; roles: Roles; respond: (url: URL) => unknown }> {
  return [
    { match: p => p === '/api/auth/me', roles: ALL, respond: () => userFor(role) },
    { match: p => p === '/api/onboarding/status', roles: ALL, respond: () => ({ status: 'COMPLETED', clinicConfigured: true }) },
    { match: p => p === '/api/notifications/unread-count', roles: ALL, respond: () => ({ unread: 2 }) },
    { match: p => p === '/api/notifications', roles: ALL, respond: () => pageDto(notifications) },
    { match: p => /^\/api\/notifications\/\d+\/read$/.test(p), roles: ALL, respond: () => notifications[0] },
    { match: p => p === '/api/availability/policy', roles: ALL, respond: () => ({ timezone: TIMEZONE, maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }) },
    { match: p => p === '/api/public/schedule', roles: ALL, respond: () => publicSchedule },
    { match: p => p === '/api/public/services', roles: ALL, respond: () => services },
    { match: p => p === '/api/services', roles: STAFF, respond: () => services },
    { match: p => /^\/api\/services\/\d+$/.test(p), roles: STAFF, respond: () => services[0] },
    { match: p => p === '/api/clinic', roles: ['OWNER'], respond: () => clinic },
    { match: p => p === '/api/users', roles: ['OWNER'], respond: () => staffUsers },
    { match: p => p === '/api/clinic-schedule', roles: STAFF, respond: () => ({ timezone: TIMEZONE, days }) },
    { match: p => p === '/api/schedules/clinic', roles: STAFF, respond: () => ({ timezone: TIMEZONE, days }) },
    { match: p => p === '/api/schedules/clinic/exceptions', roles: STAFF, respond: () => [] },
    { match: p => /^\/api\/schedules\/dentist\/\d+$/.test(p), roles: STAFF, respond: url => ({ dentistId: Number(url.pathname.split('/').at(-1)), timezone: TIMEZONE, days }) },
    { match: p => /^\/api\/schedules\/dentist\/\d+\/exceptions$/.test(p), roles: STAFF, respond: () => [] },
    { match: p => /^\/api\/schedules\/dentist\/\d+\/time-off$/.test(p), roles: STAFF, respond: () => [] },
    { match: p => p === '/api/availability', roles: ALL, respond: url => ({
      dentistId: Number(url.searchParams.get('dentistId') ?? 7),
      durationMinutes: 60, timezone: TIMEZONE,
      slots: [
        { startDate: TODAY, startTime: '10:00:00', endTime: '11:00:00', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z' },
        { startDate: TODAY, startTime: '11:00:00', endTime: '12:00:00', start: '2026-10-26T11:00:00Z', end: '2026-10-26T12:00:00Z' },
        { startDate: TODAY, startTime: '12:00:00', endTime: '13:00:00', start: '2026-10-26T12:00:00Z', end: '2026-10-26T13:00:00Z' },
      ],
    }) },
    { match: p => p === '/api/appointments/collection-queue', roles: FINANCIAL_WRITE, respond: () => collectionQueue },
    { match: p => /^\/api\/appointments\/\d+\/financial-context$/.test(p), roles: FINANCIAL_READ, respond: () => financialContext },
    { match: p => /^\/api\/appointments\/\d+\/events$/.test(p), roles: ALL, respond: () => ([
      { id: 1, eventType: 'APPOINTMENT_CREATED', actorUserId: 3, occurrenceVersion: 1, metadata: {}, createdAt: NOW },
      { id: 2, eventType: 'APPOINTMENT_COMPLETED', actorUserId: 7, occurrenceVersion: 1, metadata: {}, createdAt: '2026-10-26T09:00:00Z' },
    ]) },
    { match: p => p === '/api/appointments', roles: ALL, respond: url => {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const status = url.searchParams.get('status');
      const dentistId = url.searchParams.get('dentistId');
      const patientId = url.searchParams.get('patientId');
      const size = Number(url.searchParams.get('size') ?? 20);
      let rows = [...appointments];
      if (role === 'PATIENT') rows = rows.filter(a => a.patientId === 4);
      if (role === 'DENTIST') rows = rows.filter(a => a.dentistId === 7);
      if (from) rows = rows.filter(a => Date.parse(a.startAt) >= Date.parse(from));
      if (to) rows = rows.filter(a => Date.parse(a.startAt) < Date.parse(to));
      if (status) rows = rows.filter(a => a.status === status);
      if (dentistId) rows = rows.filter(a => a.dentistId === Number(dentistId));
      if (patientId) rows = rows.filter(a => a.patientId === Number(patientId));
      rows.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
      const content = rows.slice(0, size);
      return { content, page: 0, size, totalElements: rows.length, totalPages: rows.length === 0 ? 0 : Math.ceil(rows.length / size) };
    } },
    { match: p => /^\/api\/appointments\/\d+$/.test(p), roles: ALL, respond: url => {
      const id = Number(url.pathname.split('/').at(-1));
      return appointments.find(a => a.id === id) ?? appointments[0];
    } },
    { match: p => p === '/api/patients', roles: STAFF, respond: url => {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const active = url.searchParams.get('active');
      const size = Number(url.searchParams.get('size') ?? 20);
      let rows = [...patients];
      if (search) rows = rows.filter(p => `${p.firstName} ${p.lastName} ${p.email}`.toLowerCase().includes(search));
      if (active === 'true') rows = rows.filter(p => p.active);
      if (active === 'false') rows = rows.filter(p => !p.active);
      const content = rows.slice(0, size);
      return { content, page: 0, size, totalElements: rows.length, totalPages: rows.length === 0 ? 0 : Math.ceil(rows.length / size) };
    } },
    { match: p => /^\/api\/patients\/\d+\/clinical\/medical-intake\/declarations$/.test(p), roles: CLINICAL, respond: () => intakePage() },
    { match: p => /^\/api\/patients\/\d+\/clinical\/appointments\/\d+\/trace$/.test(p), roles: CLINICAL, respond: url => traceResponse(url) },
    { match: p => /^\/api\/patients\/\d+\/clinical\/notes$/.test(p), roles: CLINICAL, respond: () => [] },
    { match: p => /^\/api\/patients\/\d+\/clinical\/treatments$/.test(p), roles: CLINICAL, respond: () => [] },
    { match: p => /^\/api\/patients\/\d+\/clinical$/.test(p), roles: CLINICAL, respond: () => clinicalRecord },
    { match: p => /^\/api\/patients\/\d+\/odontogram\/reception-summary$/.test(p), roles: ['RECEPTIONIST'], respond: () => receptionSummary },
    { match: p => /^\/api\/patients\/\d+\/odontogram\/history$/.test(p), roles: CLINICAL, respond: () => pageDto([]) },
    { match: p => /^\/api\/patients\/\d+\/odontogram\/at$/.test(p), roles: CLINICAL, respond: url => odontogramAt(url) },
    { match: p => /^\/api\/patients\/\d+\/odontogram\/\d+\/surfaces$/.test(p), roles: ['OWNER', 'DENTIST', 'PATIENT'], respond: () => [] },
    { match: p => /^\/api\/patients\/\d+\/odontogram$/.test(p), roles: ['OWNER', 'DENTIST', 'PATIENT'], respond: () => role === 'PATIENT' ? odontogramSummary : odontogram },
    { match: p => /^\/api\/patients\/\d+$/.test(p), roles: ALL, respond: url => {
      const id = Number(url.pathname.split('/').at(-1));
      return patients.find(p => p.id === id) ?? patients[0];
    } },
    { match: p => p === '/api/patients/me/medical-intake/declarations/latest', roles: ['PATIENT'], respond: () => undefined },
    { match: p => p === '/api/patients/me/medical-intake/declarations', roles: ['PATIENT'], respond: () => intakePage() },
    { match: p => p === '/api/charges', roles: FINANCIAL_READ, respond: () => pageDto([charge, charge2]) },
    { match: p => /^\/api\/charges\/\d+\/items$/.test(p), roles: FINANCIAL_READ, respond: () => [chargeItem] },
    { match: p => /^\/api\/charges\/\d+\/movements$/.test(p), roles: FINANCIAL_READ, respond: () => charge.movements },
    { match: p => /^\/api\/charges\/\d+$/.test(p), roles: FINANCIAL_READ, respond: () => charge },
    { match: p => p === '/api/financial/reports/portfolio', roles: FINANCIAL_WRITE, respond: () => ({
      asOf: NOW, confirmedCharges: 3, billedAmount: '1600.00', appliedAmount: '400.00', pendingBalance: '1200.00',
      statusCounts: { pendiente: 1, parcial: 1, pagado: 1, anulado: 0 },
    }) },
    { match: p => p === '/api/financial/reports/cash-flow', roles: FINANCIAL_WRITE, respond: () => ({
      from: '2026-10-01', to: '2026-10-31', grossAmount: '1800.00', reversalAmount: '100.00', netAmount: '1700.00',
      methods: [
        { method: 'CASH', grossAmount: '1200.00', reversalAmount: '0.00', netAmount: '1200.00' },
        { method: 'CARD', grossAmount: '600.00', reversalAmount: '100.00', netAmount: '500.00' },
      ],
    }) },
    { match: p => p === '/api/financial/reports/charges', roles: FINANCIAL_WRITE, respond: () => ({
      patientId: null, status: null, from: null, to: null, confirmedCharges: 3,
      billedAmount: '1600.00', appliedAmount: '400.00', pendingBalance: '1200.00',
      byPatient: [
        { patientId: 4, chargeCount: 1, billedAmount: '100.00', appliedAmount: '40.00', pendingBalance: '60.00' },
        { patientId: 5, chargeCount: 1, billedAmount: '500.00', appliedAmount: '0.00', pendingBalance: '500.00' },
        { patientId: 6, chargeCount: 1, billedAmount: '1000.00', appliedAmount: '360.00', pendingBalance: '640.00' },
      ],
    }) },
    { match: p => p === '/api/financial-intents', roles: FINANCIAL_WRITE, respond: () => ({ items: [] }) },
    { match: p => p === '/api/feedback', roles: ['OWNER', 'DENTIST'], respond: () => reviews },
  ];
}

export async function uiUnificationFixture(page: Page, role: UiRole): Promise<UiFixtureResult> {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: UiCall[] = [];
  const violations: UiViolations = { undeclared: [], forbidden: [], blockedWrites: [] };
  const entries = table(role);

  await page.route(url => url.pathname.startsWith('/api/'), async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method() as UiMethod;
    const postData = request.postData();
    const body = postData ? safeJson(postData) : null;
    const declared = entries.find(entry => entry.match(path));
    const allowed = Boolean(declared?.roles.includes(role));
    const call: UiCall = { method, path, params: url.searchParams, body, role, declared: Boolean(declared), allowed };
    calls.push(call);

    if (path === '/api/auth/refresh') {
      if (method !== 'POST') { violations.forbidden.push(call); await route.fulfill({ status: 405, json: { message: 'Método no permitido en refresh' } }); return; }
      await route.fulfill({ json: { accessToken: 'ui-unification-browser-fixture' } });
      return;
    }

    if (method !== 'GET') {
      violations.blockedWrites.push(call);
      await route.fulfill({ status: 405, json: { message: 'La baseline F0 bloquea escrituras.' } });
      return;
    }

    if (!declared) {
      violations.undeclared.push(call);
      await route.fulfill({ status: 500, json: { message: `Endpoint no declarado en F0: ${path}` } });
      return;
    }
    if (!allowed) {
      violations.forbidden.push(call);
      await route.fulfill({ status: 403, json: { message: `Rol ${role} no permitido en ${path}` } });
      return;
    }

    const value = declared.respond(url);
    if (value === undefined) {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json: value });
  });

  return {
    calls,
    violations,
    manifest: () => calls
      .map(call => `${call.role} ${call.method} ${call.path}${call.params.toString() ? `?${call.params}` : ''}${call.allowed ? '' : ' [NO PERMITIDA]'}`)
      .join('\n'),
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
