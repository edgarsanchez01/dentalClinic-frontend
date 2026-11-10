import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppointmentCollectionPage } from './AppointmentCollectionPage';
import { collectionApi, type AppointmentFinancialContext, type CollectionResult } from '../../api/collection';
import { appointmentsApi } from '../../api/appointments';
import { schedulingApi } from '../../api/scheduling';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { checkoutAppointment, checkoutContext, collectionResult, contextCharge } from '../../test/checkoutFixtures';

const a = { ...checkoutAppointment, status: 'COMPLETED' as const };
function mount(role: 'OWNER' | 'RECEPTIONIST' | 'DENTIST' = 'RECEPTIONIST', active = false, contextOverride?: AppointmentFinancialContext) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ user: { id: 2, role, dentistId: 99, email: 'test@demo.test', active: true, createdAt: a.createdAt }, status: 'authenticated' });
  const context = contextOverride ?? (active ? checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [contextCharge()] }) : checkoutContext());
  vi.spyOn(collectionApi, 'context').mockResolvedValue(context);
  vi.spyOn(appointmentsApi, 'get').mockResolvedValue(a);
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone: 'UTC', days: [], dentists: [], exceptions: [] });
  const confirm = vi.spyOn(collectionApi, 'confirm').mockResolvedValue(collectionResult());
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/collections/7']}><Routes><Route path="/collections/:id" element={<AppointmentCollectionPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return { client, confirm };
}
async function review(consent = true) {
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar cobro' }));
  await screen.findByRole('button', { name: 'Confirmar cobro' });
  expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
  if (consent) fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo expresamente/ }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.setState({ user: null, status: 'anonymous' }); });
it('revisión no produce efectos; sin cargo no presenta deuda', async () => {
  const { confirm } = mount(); await screen.findByRole('button', { name: 'Revisar cobro' });
  expect(screen.getByRole('button', { name: 'Revisar cobro' })).toBeEnabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText(/No es deuda registrada/)).toBeInTheDocument();
  await review(); expect(confirm).not.toHaveBeenCalled(); expect(screen.getByText(/Revisión sin efectos/)).toBeInTheDocument();
});
it('crea cargo sin pago nuevo y no modifica la cita COMPLETED', async () => {
  const { confirm, client } = mount(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await screen.findByText(/Cobro confirmado por el servidor/);
  expect(confirm).toHaveBeenCalledWith(7, expect.objectContaining({ payment: { action: 'NO_NEW_PAYMENT' } }), expect.any(String));
  expect(client.getQueryData(['appointment', 7])).toEqual(a);
});
it.each(['OWNER', 'RECEPTIONIST'] as const)('%s registra abono parcial sobre el único cargo activo sin asignación profesional', async role => {
  const { confirm } = mount(role, true);
  fireEvent.click(await screen.findByRole('radio', { name: 'Pago parcial' }));
  fireEvent.change(screen.getByLabelText('Importe abonado (MXN)'), { target: { value: '200.01' } });
  confirm.mockResolvedValue(collectionResult({ financialAtCollection: { ...collectionResult().financialAtCollection, chargeDisposition: 'REUSED', appliedAmount: '300.01', pendingBalance: '199.99', status: 'PARCIAL', paymentId: 31, paymentMethod: 'CASH', paymentAmount: '200.01' } }));
  await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await screen.findByText(/Cobro confirmado por el servidor/);
  expect(confirm).toHaveBeenCalledWith(7, expect.objectContaining({ charge: { action: 'REUSE', chargeId: 20, expectedTotal: '500.00', confirmed: true }, payment: { action: 'REGISTER', amount: '200.01', method: 'CASH' } }), expect.any(String));
});
it('doble clic y respuesta tardía: una solicitud lógica', async () => {
  const { confirm } = mount(); let resolve!: (result: CollectionResult) => void;
  confirm.mockImplementation(() => new Promise(done => { resolve = done; })); await review();
  const button = screen.getByRole('button', { name: 'Confirmar cobro' });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  await screen.findByText(/Confirmando cobro/); expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Cobro confirmado por el servidor/)).not.toBeInTheDocument();
  await act(async () => resolve(collectionResult())); await screen.findByText(/Cobro confirmado por el servidor/);
});
it('red incierta conserva clave y comando aunque se consulte otro contexto', async () => {
  const { confirm } = mount(); confirm.mockRejectedValueOnce(new TypeError('network'));
  await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await screen.findByText(/Resultado incierto/);
  fireEvent.click(screen.getByRole('button', { name: 'Verificar estado del servidor' }));
  await screen.findByText(/Esta lectura no prueba/);
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar con la misma solicitud' }));
  await screen.findByText(/Cobro confirmado por el servidor/);
  expect(confirm.mock.calls[1]).toEqual(confirm.mock.calls[0]);
});
it.each([400, 403, 404, 409, 422, 503, 500])('maneja HTTP %s sin éxito ni reintento automático', async status => {
  const { confirm } = mount(); confirm.mockRejectedValue(new ApiError(status, { status, code: 'COLLECTION_CONFLICT', message: 'Detalle interno', path: '', timestamp: '', error: '' }, ''));
  await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1)); await screen.findByRole('alert');
  expect(screen.queryByText('Detalle interno')).not.toBeInTheDocument(); expect(screen.queryByText(/Cobro confirmado por el servidor/)).not.toBeInTheDocument();
});
it('DENTIST no consulta ni confirma el cobro', async () => {
  const { confirm } = mount('DENTIST'); await screen.findByText(/No tienes permiso/);
  expect(collectionApi.context).not.toHaveBeenCalled(); expect(appointmentsApi.get).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
it('no anuncia éxito con una respuesta incompleta', async () => {
  const { confirm } = mount(); confirm.mockResolvedValue({} as CollectionResult);
  await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await screen.findByText(/Resultado incierto/); expect(screen.queryByText(/Cobro confirmado por el servidor/)).not.toBeInTheDocument();
});

it('volver conserva abono y método, pero requiere nuevo consentimiento al revisar otra vez', async () => {
  const { confirm } = mount('OWNER', true);
  fireEvent.click(await screen.findByRole('radio', { name: 'Pago parcial' }));
  fireEvent.change(screen.getByLabelText('Importe abonado (MXN)'), { target: { value: '123.45' } });
  fireEvent.change(screen.getByLabelText('Método de pago'), { target: { value: 'TRANSFER' } });
  await review();
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  expect(screen.getByLabelText('Importe abonado (MXN)')).toHaveValue('123.45');
  expect(screen.getByLabelText('Método de pago')).toHaveValue('TRANSFER');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await review(false);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(confirm).not.toHaveBeenCalled();
});

it('pago completo reutiliza saldo exacto, no total, y exige confirmación final', async () => {
  const { confirm } = mount('RECEPTIONIST', true);
  fireEvent.click(await screen.findByRole('radio', { name: 'Pago completo' }));
  confirm.mockResolvedValue(collectionResult({ financialAtCollection: { ...collectionResult().financialAtCollection, chargeDisposition: 'REUSED', appliedAmount: '500.00', pendingBalance: '0.00', status: 'PAGADO', paymentId: 31, paymentMethod: 'CASH', paymentAmount: '400.00' } }));
  await review(); expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  await screen.findByText(/Cobro confirmado por el servidor/);
  expect(confirm).toHaveBeenCalledWith(7, expect.objectContaining({ payment: { action: 'REGISTER', amount: '400.00', method: 'CASH' } }), expect.any(String));
});

it('cambio de contexto al preparar impide revisar datos que no se mostraron', async () => {
  const { confirm } = mount();
  await screen.findByRole('button', { name: 'Revisar cobro' });
  vi.mocked(collectionApi.context).mockResolvedValue(checkoutContext({ financialContextToken: `v1:${'b'.repeat(64)}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
  await screen.findByText(/El contexto cambió/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['OWNER', 'RECEPTIONIST'] as const)('%s selecciona el único cargo verificado y concentra el consentimiento en paso 2', async role => {
  const { confirm } = mount(role, true);
  await screen.findByText(/Único cargo activo verificado/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Progreso del cobro' }).children).toHaveLength(2);
  await review(false);
  expect(screen.getByRole('heading', { name: 'Revisar y confirmar' })).toBeInTheDocument();
  expect(screen.getByText('Reutilizar cargo #20', { selector: 'dd' })).toBeInTheDocument();
  expect(screen.getByText(/Ana.*Cita #7/, { selector: 'dd' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeEnabled();
  expect(confirm).not.toHaveBeenCalled();
});

it('el consentimiento a una revisión queda inválido si cambia su token de contexto', async () => {
  const { confirm, client } = mount('OWNER', true); await review();
  act(() => client.setQueryData(['appointment-financial-context', 7], checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [contextCharge()], financialContextToken: `v1:${'b'.repeat(64)}` })));
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' })); expect(confirm).not.toHaveBeenCalled();
});

it('cambiar el pago después de Anterior no reutiliza el consentimiento previo', async () => {
  const { confirm } = mount('OWNER', true); await review();
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Pago completo' }));
  await review(false);
  expect(screen.getByRole('checkbox')).toHaveAccessibleName(/400.00 MXN.*Efectivo/);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['occurrence', 'clinical-state'] as const)('la verificación previa rechaza cambios de %s sin escribir ni consentir', async change => {
  const { confirm } = mount();
  await screen.findByRole('button', { name: 'Revisar cobro' });
  vi.mocked(appointmentsApi.get).mockResolvedValue({ ...a, ...(change === 'occurrence' ? { occurrenceVersion: 2 } : { status: 'SCHEDULED' as const }) });
  if (change === 'occurrence') vi.mocked(collectionApi.context).mockResolvedValue(checkoutContext({ appointmentOccurrenceVersion: 2 }));
  fireEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
  await screen.findByText(/El contexto cambió/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['multiple', 'missing', 'settled'] as const)('contexto %s mantiene bloqueos de operación', async state => {
  const other = contextCharge({ id: 22, items: [{ ...contextCharge().items[0]!, chargeId: 22 }], movements: [] });
  const context = state === 'multiple'
    ? checkoutContext({ associationState: 'MULTIPLE_ACTIVE', chargeCount: 2, charges: [contextCharge(), other] })
    : state === 'missing' ? checkoutContext({ service: null })
      : checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [contextCharge({ status: 'PAGADO', appliedAmount: '500', pendingBalance: '0' })] });
  const { confirm } = mount('RECEPTIONIST', false, context);
  if (state === 'settled') {
    expect(await screen.findByRole('radio', { name: 'Pago completo' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Pago parcial' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Sin pago nuevo' })).toBeChecked();
  } else {
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Revisar cobro' })).not.toBeInTheDocument();
  }
  expect(confirm).not.toHaveBeenCalled();
});
