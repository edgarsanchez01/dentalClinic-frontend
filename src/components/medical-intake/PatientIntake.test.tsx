import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelSessionRequests, tokenStore } from '../../api/http';
import type { IntakeDraft } from '../../api/medicalIntake';
import { medicalIntakeApi } from '../../api/medicalIntake';
import { useAuthStore } from '../../app/authStore';
import { RequireAuth } from '../../app/guards';
import { patientReturnTo } from '../../app/patientOnboarding';
import { exemptOnboarding, intakeDeclaration, intakeDefinition, intakeDraft } from '../../test/intakeFixtures';
import { PatientIntakePage } from './PatientIntakePage';
import { IntakeDeclarations, PatientIntakeProfile } from './PatientIntakeProfile';

const patient = { id: 9, email: 'synthetic@example.test', role: 'PATIENT' as const, patientId: 5, active: true, createdAt: '2026-10-17' };
const response = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
function fixture(options: { conflict?: boolean; uncertain?: boolean; complete?: boolean; expired?: boolean } = {}) {
  let draft: IntakeDraft = intakeDraft(options.complete);
  const calls: { path: string; body: Record<string, unknown>; method: string }[] = [];
  let conflict = options.conflict, uncertain = options.uncertain;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, method = init?.method ?? 'GET';
    calls.push({ path, body, method });
    if (path.endsWith('/api/auth/refresh')) return response({}, 401);
    if (path.endsWith('/api/auth/me')) return response({ ...patient, medicalOnboarding: draft.status });
    if (path.endsWith('/api/public/schedule')) return response({ timezone: 'UTC', days: [], exceptions: [], dentists: [] });
    if (path.endsWith('/definition')) return response(intakeDefinition);
    if (path.endsWith('/status')) return response(draft.status);
    if (path.endsWith('/draft')) return response(draft);
    if (path.includes('/declarations')) return response({ content: [], totalPages: 0, totalElements: 0, size: 10, number: 0 });
    if (method === 'PUT' || path.endsWith('/privacy-acknowledgements')) {
      if (options.expired) return response({}, 401);
      if (conflict) { conflict = false; draft = { ...draft, status: { ...draft.status, version: 8 }, personal: { ...draft.personal, firstName: 'Otra pestaña' } }; return response({ code: 'INTAKE_VERSION_CONFLICT' }, 409); }
      expect(body.expectedVersion).toBe(draft.status.version);
      draft = { ...draft, status: { ...draft.status, version: draft.status.version + 1, progress: options.complete ? 'COMPLETED' : 'IN_PROGRESS' } };
      if (path.endsWith('/personal')) draft.personal = body.personal as IntakeDraft['personal'];
      if (path.endsWith('/medical')) { expect(draft.privacy).toBeDefined(); draft.medical = body.medical as NonNullable<IntakeDraft['medical']>; }
      if (path.endsWith('/dental')) { expect(draft.privacy).toBeDefined(); draft.dental = body.dental as NonNullable<IntakeDraft['dental']>; }
      if (path.endsWith('/privacy-acknowledgements')) draft.privacy = { id: 1, noticeVersion: intakeDefinition.noticeVersion, noticeText: intakeDefinition.noticeText, noticeHash: intakeDefinition.noticeHash, acknowledged: true, processingAccepted: true, actorUserId: 9, acceptedAt: '2026-10-17T10:00:00Z' };
      return response(draft);
    }
    if (path.endsWith('/complete') || path.endsWith('/revisions')) {
      draft = { ...draft, status: { ...draft.status, pending: false, progress: 'COMPLETED', version: draft.status.version + 1 } };
      if (uncertain) { uncertain = false; throw new TypeError('Synthetic timeout'); }
      return response({ version: draft.status.version, medicalOnboarding: draft.status, declaration: intakeDeclaration(draft) });
    }
    throw new Error(`Missing synthetic endpoint ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, fetch, draft: () => draft };
}
function mount(path = '/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1', revision = false) {
  return render(<QueryClientProvider client={useAuthStore.getState().queryClient}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/patient-onboarding" element={<RequireAuth><PatientIntakePage revision={revision} /></RequireAuth>} />
    <Route path="/appointments" element={<RequireAuth><h1>Mis citas</h1></RequireAuth>} />
    <Route path="/" element={<RequireAuth><h1>Dashboard</h1></RequireAuth>} />
    <Route path="/patient-profile" element={<h1>Mi perfil</h1>} /><Route path="/login" element={<h1>Sesión expirada</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
async function next() { fireEvent.click(screen.getByRole('button', { name: 'Siguiente' })); }
async function startMedical() {
  await screen.findByLabelText('Nombre'); await next();
  await screen.findByText('Antes de guardar antecedentes');
  fireEvent.click(screen.getByLabelText('He leído el aviso de privacidad mostrado.'));
  fireEvent.click(screen.getByLabelText('Acepto el guardado y uso de mis respuestas según este aviso demostrativo.'));
  fireEvent.click(screen.getByRole('button', { name: 'Registrar aceptación y continuar' }));
  await screen.findByRole('group', { name: 'Alergias y reacciones' });
}
function answers(answer = 'No') {
  for (const group of screen.getAllByRole('group')) {
    const options = within(group).queryAllByRole('radio', { name: answer });
    if (options.length === 1) fireEvent.click(options[0]!);
  }
}
async function review() {
  await startMedical();
  for (const label of ['Alergias y reacciones', 'Condiciones médicas relevantes', 'Reacciones a anestesia']) {
    await screen.findByRole('group', { name: label }); answers(); await next();
  }
  await screen.findByRole('group', { name: 'Tratamientos anteriores' }); answers('No lo sé'); await next();
  await screen.findByRole('group', { name: 'Molestias actuales' }); answers('No lo sé');
  fireEvent.change(screen.getByLabelText('Motivo de consulta'), { target: { value: 'Consulta sintética' } }); await next();
  await screen.findByLabelText('Confirmo la declaración mostrada y he revisado mis respuestas.');
  fireEvent.click(screen.getByLabelText('Confirmo la declaración mostrada y he revisado mis respuestas.'));
}
async function continueAfterSuccess() {
  await screen.findByRole('heading', { name: 'Tu información está lista' });
  fireEvent.click(screen.getByRole('button', { name: /^(Continuar a la reserva|Ir a mi inicio|Ver mi información|Continuar)$/ }));
}
beforeEach(() => {
  cancelSessionRequests(); tokenStore.set('synthetic'); useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'authenticated', restorationError: false, user: { ...patient, medicalOnboarding: intakeDraft().status } });
});
afterEach(() => { cleanup(); cancelSessionRequests(); useAuthStore.getState().queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Stepper PATIENT, HTTP simulado', () => {
  it('privacidad explícita antes del primer PUT médico y cuatro pasos con retorno a reserva', async () => {
    const api = fixture(); mount(); await review();
    expect(api.calls.filter(call => call.path.endsWith('/privacy-acknowledgements'))[0]?.body).toMatchObject({ acknowledged: true, processingAccepted: true, expectedVersion: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar' }));
    await continueAfterSuccess();
    await screen.findByRole('heading', { name: 'Mis citas' });
    const confirmation = api.calls.find(call => call.path.endsWith('/complete'))!;
    expect(confirmation.body).toMatchObject({ expectedVersion: 6, questionnaireVersion: intakeDefinition.questionnaireVersion, declarationVersion: intakeDefinition.declarationVersion, declarationConfirmed: true, confirmedBy: 'PATIENT' });
    expect(confirmation.body.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.calls.some(call => call.path.endsWith('/status'))).toBe(true);
    expect(useAuthStore.getState().user?.medicalOnboarding?.pending).toBe(false);
  });
  it('valida campos, foco y detalles YES eliminados al cambiar respuesta', async () => {
    const api = fixture(); mount(); await startMedical(); await next();
    await waitFor(() => expect(screen.getByText('Revisa los campos indicados antes de continuar.')).toBeVisible());
    const allergies = screen.getByRole('group', { name: 'Alergias y reacciones' });
    const radio = within(allergies).getByRole('radio', { name: 'Sí' }); radio.focus();
    fireEvent.click(within(allergies).getByRole('radio', { name: 'Sí' }));
    expect(radio).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Detalles de alergias y reacciones (opcional)'), { target: { value: 'Dato sintético' } });
    answers('Prefiero hablarlo en consulta'); await next();
    await screen.findByRole('group', { name: 'Condiciones médicas relevantes' }); answers('Prefiero hablarlo en consulta'); await next();
    await screen.findByRole('group', { name: 'Reacciones a anestesia' }); answers('Prefiero hablarlo en consulta'); await next();
    await screen.findByRole('group', { name: 'Tratamientos anteriores' });
    expect(api.draft().medical?.allergies).toEqual({ answer: 'DISCUSS_IN_CONSULTATION' });
    expect(api.calls.find(call => call.path.endsWith('/medical'))?.body).not.toHaveProperty('details');
  });
  it('Anterior mantiene cambios locales y Guardar y salir permite recuperar el borrador', async () => {
    const api = fixture(); const view = mount(); await startMedical(); answers();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' })); await screen.findByLabelText('Nombre'); await next();
    expect(await screen.findByRole('group', { name: 'Alergias y reacciones' })).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Alergias y reacciones' })).getByRole('radio', { name: 'No' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y salir' })); await screen.findByRole('heading', { name: 'Mis citas' });
    view.unmount(); mount(); await screen.findByLabelText('Nombre'); await next();
    expect(within(await screen.findByRole('group', { name: 'Alergias y reacciones' })).getByRole('radio', { name: 'No' })).toBeChecked();
    expect(api.draft().status.pending).toBe(true);
  });
  it('409 conserva datos, compara servidor y no reintenta PUT automáticamente', async () => {
    const api = fixture({ conflict: true }); mount(); await screen.findByLabelText('Nombre');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Local sintético' } }); await next();
    await screen.findByRole('region', { name: 'Resolver conflicto' });
    expect(screen.getByLabelText('Nombre')).toHaveValue('Local sintético');
    expect(api.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Conservar mis cambios para revisión manual' }));
    expect(api.calls.filter(call => call.method === 'PUT')).toHaveLength(1); await next();
    await screen.findByText('Antes de guardar antecedentes');
    expect(api.calls.filter(call => call.method === 'PUT').at(-1)?.body.expectedVersion).toBe(8);
  });
  it('una respuesta tardía no elimina cambios locales posteriores al envío', async () => {
    fixture(); let resolve!: (value: IntakeDraft) => void;
    const pending = new Promise<IntakeDraft>(done => { resolve = done; });
    const put = vi.spyOn(medicalIntakeApi, 'personal').mockReturnValue(pending);
    mount(); await screen.findByLabelText('Nombre');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Enviado' } }); await next();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    // Simulate an already queued input event; a late response must not erase it.
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Posterior local' } });
    const authoritative = intakeDraft(); authoritative.personal.firstName = 'Enviado'; authoritative.status.version = 1;
    await act(async () => resolve(authoritative)); await screen.findByText('Antes de guardar antecedentes');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Posterior local');
    expect(screen.getByText('Cambios sin guardar')).toBeVisible();
  });
  it('timeout/replay mantiene exactamente UUID y payload, vuelve a consultar estado actual', async () => {
    const api = fixture({ uncertain: true }); mount(); await review();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar' }));
    await screen.findByText('No se pudo confirmar el resultado. Comprueba la conexión y vuelve a intentarlo.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar la misma confirmación' }));
    await continueAfterSuccess();
    await screen.findByRole('heading', { name: 'Mis citas' });
    const confirmations = api.calls.filter(call => call.path.endsWith('/complete'));
    expect(confirmations).toHaveLength(2); expect(confirmations[1]?.body).toEqual(confirmations[0]?.body);
  });
  it('después de COMPLETED confirma por revisions sin volver a bloquear', async () => {
    const api = fixture({ complete: true }); useAuthStore.setState({ user: { ...patient, medicalOnboarding: api.draft().status } });
    mount('/patient-onboarding', true); await review();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar nueva revisión' })); await continueAfterSuccess(); await screen.findByRole('heading', { name: 'Mi perfil' });
    expect(api.calls.some(call => call.path.endsWith('/revisions'))).toBe(true);
    expect(api.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
    expect(api.draft().status.progress).toBe('COMPLETED');
  });
  it('sesión expirada retira el formulario y no queda atrapada por cambios locales', async () => {
    fixture({ expired: true }); mount(); await screen.findByLabelText('Nombre');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Cambio sintético' } }); await next();
    await screen.findByRole('heading', { name: 'Sesión expirada' }); expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
  });
  it('solo muestra dos preguntas sin preselección y guarda la sección acumulada al avanzar y volver', async () => {
    const api = fixture(); mount(); await startMedical();
    expect(screen.getAllByRole('radio')).toHaveLength(8);
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
    answers('No lo sé'); await next();
    await screen.findByRole('group', { name: 'Condiciones médicas relevantes' });
    expect(api.draft().medical).toEqual({ allergies: { answer: 'UNKNOWN' }, medications: { answer: 'UNKNOWN' } });
    answers('Prefiero hablarlo en consulta');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByRole('group', { name: 'Alergias y reacciones' });
    expect(api.draft().medical).toMatchObject({ allergies: { answer: 'UNKNOWN' }, medicalConditions: { answer: 'DISCUSS_IN_CONSULTATION' } });
    expect(Object.keys(api.draft().medical!)).toHaveLength(4);
    expect(api.calls.filter(call => call.path.endsWith('/medical'))).toHaveLength(2);
  });
  it('privacidad mantiene el texto completo y no escribe antecedentes antes de ambas acciones explícitas', async () => {
    const api = fixture(); mount(); await screen.findByLabelText('Nombre'); await next();
    await screen.findByText('Antes de guardar antecedentes');
    expect(screen.getByText(intakeDefinition.noticeText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar aceptación y continuar' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('He leído el aviso de privacidad mostrado.'));
    expect(screen.getByRole('button', { name: 'Registrar aceptación y continuar' })).toBeDisabled();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(api.calls.some(call => call.path.endsWith('/medical') || call.path.endsWith('/dental') || call.path.endsWith('/privacy-acknowledgements'))).toBe(false);
  });
  it('no pierde detalles afirmativos al seleccionar de nuevo Sí', async () => {
    fixture(); mount(); await startMedical();
    const yes = within(screen.getByRole('group', { name: 'Alergias y reacciones' })).getByRole('radio', { name: 'Sí' });
    fireEvent.click(yes);
    fireEvent.change(screen.getByLabelText('Detalles de alergias y reacciones (opcional)'), { target: { value: 'Dato sintético conservado' } });
    fireEvent.click(yes);
    expect(screen.getByLabelText('Detalles de alergias y reacciones (opcional)')).toHaveValue('Dato sintético conservado');
  });
  it('editar desde revisión vuelve al resumen y exige confirmar otra vez sin reescribir antecedentes', async () => {
    const api = fixture(); mount(); await review();
    const before = api.calls.filter(call => call.path.endsWith('/medical')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos personales' }));
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Edición sintética' } });
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la revisión' }));
    expect(await screen.findByText('Edición sintética')).toBeVisible();
    expect(screen.getByLabelText('Confirmo la declaración mostrada y he revisado mis respuestas.')).not.toBeChecked();
    expect(api.calls.filter(call => call.path.endsWith('/medical'))).toHaveLength(before);
  });
  it('un guardado lento bloquea envíos duplicados de grupo y conserva la versión enviada', async () => {
    const api = fixture(); mount(); await startMedical(); answers();
    let resolve!: (draft: IntakeDraft) => void;
    const put = vi.spyOn(medicalIntakeApi, 'medical').mockReturnValue(new Promise(done => { resolve = done; }));
    const form = screen.getByRole('button', { name: 'Siguiente' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(put).toHaveBeenCalledWith(1, { allergies: { answer: 'NO' }, medications: { answer: 'NO' } });
    const draft = structuredClone(api.draft()); draft.status.version = 2; draft.medical = { allergies: { answer: 'NO' }, medications: { answer: 'NO' } };
    await act(async () => resolve(draft));
    expect(await screen.findByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  });
  it('la fecha mexicana se convierte a ISO antes de guardar sin intercambiar día y mes', async () => {
    const api = fixture(); mount();
    const birth = await screen.findByLabelText('Fecha de nacimiento');
    expect(birth).toHaveValue('10/04/1990');
    fireEvent.change(birth, { target: { value: '14/07/1991' } }); await next();
    await screen.findByText('Antes de guardar antecedentes');
    expect(api.calls.find(call => call.path.endsWith('/personal'))?.body.personal).toHaveProperty('birthDate', '1991-07-14');
  });
  it('permite continuar sin teléfono sin eliminar la obligación del contacto de emergencia', async () => {
    const api = fixture(); mount(); await screen.findByLabelText('Nombre');
    fireEvent.click(screen.getByRole('radio', { name: 'No puedo proporcionar teléfono' }));
    expect(screen.queryByLabelText('Teléfono', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono del contacto de emergencia')).toBeInTheDocument();
    await next(); await screen.findByText('Antes de guardar antecedentes');
    expect(api.calls.find(call => call.path.endsWith('/personal'))?.body.personal).toHaveProperty('canProvidePhone', false);
  });
});

describe('Navegación y permisos', () => {
  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST'] as const)('%s nunca hace onboarding médico', async role => {
    fixture(); useAuthStore.setState({ user: { ...patient, role } }); mount('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
  it('exento conserva inicio y pendiente va al wizard sin dashboard temporal', async () => {
    fixture(); useAuthStore.setState({ user: { ...patient, medicalOnboarding: exemptOnboarding } });
    const view = mount('/'); expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); view.unmount();
    useAuthStore.setState({ user: { ...patient, medicalOnboarding: intakeDraft().status } }); mount('/');
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument(); await screen.findByLabelText('Nombre');
  });
  it('metadatos ausentes y error de /me: reintento, nunca dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)));
    useAuthStore.setState({ user: patient }); mount('/');
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reintentar comprobación' })).toBeVisible();
  });
  it('COMPLETED no repite el wizard y latest 204 es un vacío válido de TanStack Query', async () => {
    const api = fixture({ complete: true });
    const view = mount('/patient-onboarding'); await screen.findByRole('heading', { name: 'Mi perfil' });
    view.unmount();
    api.fetch.mockImplementation(async (input: RequestInfo | URL) => String(input).endsWith('/latest')
      ? response(null, 204) : response({ content: [], totalPages: 0, totalElements: 0, number: 0, size: 10 }));
    render(<QueryClientProvider client={useAuthStore.getState().queryClient}><MemoryRouter><PatientIntakeProfile /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByText('No hay declaraciones confirmadas.')).toHaveLength(2));
    expect(screen.queryByText('No se pudo consultar la última declaración.')).not.toBeInTheDocument();
  });
  it('recepción no monta ni consulta declaraciones profesionales', async () => {
    const api = fixture(); useAuthStore.setState({ user: { ...patient, role: 'RECEPTIONIST' } });
    render(<QueryClientProvider client={useAuthStore.getState().queryClient}><IntakeDeclarations patientId={5} /></QueryClientProvider>);
    await act(async () => {}); expect(api.fetch).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'DENTIST'] as const)('%s consulta declaraciones por el endpoint profesional', async role => {
    const api = fixture(); useAuthStore.setState({ user: { ...patient, role } });
    render(<QueryClientProvider client={useAuthStore.getState().queryClient}><IntakeDeclarations patientId={5} /></QueryClientProvider>);
    await screen.findByText('No hay declaraciones confirmadas.');
    expect(api.calls[0]?.path).toBe('/api/patients/5/clinical/medical-intake/declarations?page=0&size=10');
  });
  it.each(['https://evil.test', '//evil.test', '/login', '/register', '/patient-onboarding', '/appointments?medical=secret#allergies', '/clinic'])('retorno seguro sin loops ni datos médicos: %s', value => {
    const target = patientReturnTo(value); expect(target).not.toContain('secret'); expect(target).not.toContain('onboarding'); expect(target).not.toContain('evil');
  });
});
