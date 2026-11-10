import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionQueuePage } from './CollectionQueuePage';
import { collectionApi, type CollectionQueue, type CollectionState } from '../../api/collection';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { checkoutAppointment } from '../../test/checkoutFixtures';
import { patientsApi } from '../../api/patients';

function data(state: CollectionState = 'NO_CHARGE'): CollectionQueue {
  return { page: 0, size: 20, totalPages: 1, totalElements: 1, observedAt: checkoutAppointment.startAt,
    content: [{ appointment: { ...checkoutAppointment, status: 'COMPLETED' }, collectionState: state,
      hasRecordedCharge: false, activeChargeId: null, totalAmount: null, appliedAmount: null, pendingBalance: null, currency: null, financialContextToken: null, reviewReason: null }],
    summary: { completedCount: 5, verifiedPendingBalance: '250.00', currency: 'MXN', counts: { NO_CHARGE: 1, PENDING: 1, PARTIAL: 1, SETTLED: 1, REVIEW_REQUIRED: 1 } } };
}
let currentRole = 'RECEPTIONIST';
function mount(response = data(), path = '/collections', role = currentRole) {
  useAuthStore.setState({ user: { id: 2, role: role as 'RECEPTIONIST', active: true, email: 'demo@demo.test', createdAt: checkoutAppointment.createdAt }, status: 'authenticated' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queue = vi.spyOn(collectionApi, 'queue').mockResolvedValue(response);
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone: 'America/Mexico_City', days: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Demo', days: [] }], exceptions: [] });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><CollectionQueuePage /></MemoryRouter></QueryClientProvider>);
  return { queue, client };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.setState({ user: null, status: 'anonymous' }); });
describe.each(['OWNER', 'RECEPTIONIST'])('%s — bandeja compartida', role => {
beforeEach(() => { currentRole = role; });
it('sin cargo no muestra referencia como deuda; resumen y total filtrado vienen del servidor', async () => {
  mount(); await screen.findByText('1 atenciones con los filtros aplicados.');
  expect(screen.getByText('5 atenciones completadas antes del filtro de estado.')).toBeInTheDocument();
  const row = screen.getByRole('list', { name: 'Atenciones completadas' });
  expect(within(row).getByText(/Sin importe de deuda registrado/)).toBeInTheDocument();
  expect(within(row).queryByText(/MXN/)).not.toBeInTheDocument();
});
it.each(['PENDING', 'PARTIAL', 'SETTLED'] as const)('%s muestra los importes reales del servidor', async state => {
  const response = data(state); Object.assign(response.content[0]!, { totalAmount: '500', appliedAmount: state === 'SETTLED' ? '500' : state === 'PARTIAL' ? '200' : '0', pendingBalance: state === 'SETTLED' ? '0' : state === 'PARTIAL' ? '300' : '500', currency: 'MXN' });
  mount(response); await screen.findByRole('list', { name: 'Atenciones completadas' });
  expect(screen.getByText('Total', { selector: 'dt' })).toBeInTheDocument(); expect(screen.getByText('Aplicado', { selector: 'dt' })).toBeInTheDocument(); expect(screen.getByText('Saldo', { selector: 'dt' })).toBeInTheDocument();
});
it.each(['MULTIPLE_ACTIVE_CHARGES', 'FINANCIAL_CONTEXT_UNAVAILABLE', 'ECONOMIC_REFERENCE_REQUIRED'])('revisión %s sin estimaciones ni selección automática', async reason => {
  const response = data(reason === 'ECONOMIC_REFERENCE_REQUIRED' ? 'NO_CHARGE' : 'REVIEW_REQUIRED'); response.content[0]!.reviewReason = reason;
  mount(response); await screen.findByRole('link', { name: 'Gestión administrativa de esta atención' });
  expect(within(screen.getByRole('list', { name: 'Atenciones completadas' })).queryByText(/MXN/)).not.toBeInTheDocument();
});
it('aplica profesional, estado y rango clínico inclusivo/exclusivo sin filtrar después de paginar', async () => {
  const { queue } = mount(); fireEvent.click(screen.getByRole('button', { name: 'Más filtros' })); await screen.findByRole('option', { name: 'Olivia Demo' });
  fireEvent.change(screen.getByLabelText('Profesional'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Estado financiero'), { target: { value: 'PARTIAL' } });
  fireEvent.change(screen.getByLabelText('Desde (fecha de atención)'), { target: { value: '2026-10-22' } });
  fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-22' } });
  expect(queue).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(queue).toHaveBeenLastCalledWith({ page: 0, size: 20, dentistId: 3, state: 'PARTIAL', includeSettled: false, from: '2026-10-22T06:00:00.000Z', to: '2026-10-23T06:00:00.000Z' }, expect.any(AbortSignal)));
});
it('estado explícito y includeSettled se envían sin reinterpretar la precedencia del backend', async () => {
  const { queue } = mount(data('SETTLED'), '/collections?state=SETTLED&includeSettled=false&patientId=1');
  await waitFor(() => expect(queue).toHaveBeenCalledWith({ page: 0, size: 20, patientId: 1, state: 'SETTLED', includeSettled: false }, expect.any(AbortSignal)));
});
it('página vacía conserva totalPages y permite volver a resultados anteriores', async () => {
  const response = { ...data(), page: 1, totalPages: 3, totalElements: 42, content: [] };
  const { queue } = mount(response, '/collections?page=1&state=NO_CHARGE'); await screen.findByText('Página 2 de 3');
  expect(screen.getByRole('button', { name: 'Página anterior' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
  await waitFor(() => expect(queue).toHaveBeenLastCalledWith({ page: 0, size: 20, state: 'NO_CHARGE', includeSettled: false }, expect.any(AbortSignal)));
});
it('ambos roles usan exactamente la composición compartida y acciones explícitas', async () => {
  mount(); await screen.findByRole('list', { name: 'Atenciones completadas' });
  const form = screen.getByRole('form', { name: 'Filtrar atenciones por cobrar' });
  expect(form).toHaveClass('collection-filters');
  expect(form.closest('.owner-collections')).toBeNull();
  expect(screen.getByRole('link', { name: 'Gestionar cobro' }).closest('li')).toHaveClass('collection-row');
  expect(screen.getByRole('link', { name: 'Ver detalle de la cita' })).toHaveAttribute('href', '/appointments/7?returnTo=%2Fcollections');
});
it('plegar filtros conserva borradores y no aplica consultas', async () => {
  const { queue } = mount(); await screen.findByRole('list', { name: 'Atenciones completadas' });
  const toggle = screen.getByRole('button', { name: 'Más filtros' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText('Desde (fecha de atención)'), { target: { value: '2026-10-22' } });
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(screen.getByLabelText('Desde (fecha de atención)')).toHaveValue('2026-10-22');
  expect(queue).toHaveBeenCalledTimes(1);
});
it('los borradores no consultan y la paginación conserva los filtros aplicados', async () => {
  const response = { ...data(), totalPages: 3, totalElements: 42 };
  const { queue } = mount(response, '/collections?state=PENDING&patientId=1&dentistId=3');
  await screen.findByRole('list', { name: 'Atenciones completadas' });
  fireEvent.change(screen.getByLabelText('Estado financiero'), { target: { value: 'PARTIAL' } });
  expect(screen.getByRole('status')).toHaveTextContent('Filtros sin aplicar.');
  expect(queue).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
  await waitFor(() => expect(queue).toHaveBeenLastCalledWith({ page: 1, size: 20, state: 'PENDING', patientId: 1, dentistId: 3, includeSettled: false }, expect.any(AbortSignal)));
  expect(screen.getByLabelText('Estado financiero')).toHaveValue('PARTIAL');
});
it('actualizar, error seguro y reintento conservan los filtros de la URL', async () => {
  const { queue, client } = mount(data(), '/collections?state=PENDING');
  await screen.findByRole('list', { name: 'Atenciones completadas' });
  queue.mockRejectedValueOnce(new Error('Sin conexión'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar bandeja' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('list', { name: 'Atenciones completadas' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Resumen de atenciones completadas')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar bandeja' }));
  await screen.findByRole('list', { name: 'Atenciones completadas' });
  expect(queue).toHaveBeenLastCalledWith({ page: 0, size: 20, state: 'PENDING', includeSettled: false }, expect.any(AbortSignal));
  client.clear();
});
it('rechaza un rango invertido sin modificar la consulta', async () => {
  const { queue } = mount(); await screen.findByRole('list', { name: 'Atenciones completadas' });
  fireEvent.change(screen.getByLabelText('Desde (fecha de atención)'), { target: { value: '2026-10-30' } });
  fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(screen.getByRole('alert')).toHaveTextContent('La fecha inicial no puede ser posterior a la final.');
  expect(queue).toHaveBeenCalledTimes(1);
});
it('seleccionar paciente solo cambia el borrador hasta Aplicar filtros', async () => {
  const patient = { id: 11, firstName: 'Ada', lastName: 'Prueba', active: true, createdAt: checkoutAppointment.createdAt };
  vi.spyOn(patientsApi, 'list').mockResolvedValue({ content: [patient], page: 0, size: 10, totalElements: 1, totalPages: 1 });
  vi.spyOn(patientsApi, 'get').mockResolvedValue(patient);
  const { queue } = mount(); await screen.findByRole('list', { name: 'Atenciones completadas' });
  fireEvent.focus(screen.getByRole('combobox', { name: 'Paciente' }));
  fireEvent.click(await screen.findByRole('option', { name: /Ada Prueba/ }));
  await screen.findByDisplayValue('Ada Prueba');
  expect(queue).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Filtros sin aplicar.');
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(queue).toHaveBeenLastCalledWith({ page: 0, size: 20, patientId: 11, includeSettled: false }, expect.any(AbortSignal)));
});
});
it.each(['DENTIST', 'PATIENT'])('%s no solicita la bandeja', async role => {
  const { queue } = mount(data(), '/collections', role); await screen.findByRole('alert'); expect(queue).not.toHaveBeenCalled();
});
