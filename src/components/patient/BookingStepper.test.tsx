import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appointmentsApi, type AppointmentResponse } from '../../api/appointments';
import { catalogApi } from '../../api/catalog';
import { schedulingApi } from '../../api/scheduling';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { BookingStepper } from './BookingStepper';

const service = { id: 1, name: 'Valoración sintética', description: 'Servicio de prueba', durationMinutes: 30, referencePrice: '850' };
const slot = { startDate: '2026-10-20', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-20T15:00:00Z', end: '2026-10-20T15:30:00Z' };
const available = { dentistId: 3, timezone: 'America/Mexico_City', durationMinutes: 30, slots: [slot] };
const appointment: AppointmentResponse = { id: 7, patientId: 4, patientFirstName: 'Paciente', patientLastName: 'Sintético', dentistId: 3, dentistFirstName: 'Profesional', dentistLastName: 'Sintético', startAt: slot.start, endAt: slot.end, durationMinutes: 30, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 10, createdAt: slot.start, service };

beforeEach(() => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  useAuthStore.setState({ status: 'authenticated', queryClient: client, user: { id: 10, patientId: 4, role: 'PATIENT', email: 'test@example.test', active: true, createdAt: slot.start, medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } });
  vi.spyOn(catalogApi, 'publicList').mockResolvedValue([service, { ...service, id: 2, name: 'Otro servicio sintético' }]);
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone: available.timezone, days: [], exceptions: [], dentists: [{ dentistId: 3, firstName: 'Profesional', lastName: 'Sintético', days: [] }, { dentistId: 8, firstName: 'Otro', lastName: 'Sintético', days: [] }] });
  vi.spyOn(schedulingApi, 'availability').mockImplementation(async input => ({ ...available, dentistId: input.dentistId }));
  vi.spyOn(appointmentsApi, 'create').mockResolvedValue(appointment);
});
afterEach(() => { cleanup(); useAuthStore.getState().queryClient.clear(); vi.restoreAllMocks(); });
function mount() { return render(<QueryClientProvider client={useAuthStore.getState().queryClient}><MemoryRouter initialEntries={['/appointments?create=1&date=2026-10-20']}><BookingStepper timezone={available.timezone} /></MemoryRouter></QueryClientProvider>); }
async function schedule() { fireEvent.click(await screen.findByRole('radio', { name: /^Valoración sintética/ })); fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); fireEvent.change(await screen.findByLabelText('Dentista'), { target: { value: '3' } }); fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' })); }
async function review() { await schedule(); fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); await screen.findByRole('heading', { name: 'Revisa y confirma' }); }

it('tres pasos explícitos sin preselección, precios ni reserva al avanzar', async () => {
  mount(); await screen.findByRole('radio', { name: /^Valoración/ });
  expect(screen.getAllByRole('radio').every(r => !(r as HTMLInputElement).checked)).toBe(true);
  expect(screen.queryByText(/850|precio/i)).not.toBeInTheDocument();
  await review(); expect(appointmentsApi.create).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Revisa y confirma' })).toHaveFocus();
});
it.each(['Dentista', 'Día', 'Servicio'])('cambiar %s invalida selección aunque el intervalo coincida', async field => {
  mount(); await review(); fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'Se conserva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  if (field === 'Servicio') { fireEvent.click(screen.getByRole('button', { name: 'Anterior' })); fireEvent.click(screen.getByRole('radio', { name: /^Otro servicio/ })); fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); }
  else fireEvent.change(screen.getByLabelText(field), { target: { value: field === 'Dentista' ? '8' : '21/10/2026' } });
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' })); fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); expect(screen.getByLabelText('Motivo (opcional)')).toHaveValue('Se conserva');
});
it('reconsulta y no envía si el horario se agotó', async () => {
  mount(); await review(); vi.mocked(schedulingApi.availability).mockResolvedValue({ ...available, slots: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' })); expect(await screen.findByRole('alert')).toHaveTextContent('Ese horario ya no está disponible'); expect(appointmentsApi.create).not.toHaveBeenCalled();
});
it('no confirma cuando el servicio desaparece o cambia la duración', async () => {
  mount(); await review(); vi.mocked(catalogApi.publicList).mockResolvedValue([{ ...service, durationMinutes: 60 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' })); expect(await screen.findByRole('alert')).toHaveTextContent('El servicio cambió'); expect(appointmentsApi.create).not.toHaveBeenCalled();
});
it('replay incierto mantiene exactamente payload y clave y bloquea edición', async () => {
  vi.mocked(appointmentsApi.create).mockRejectedValueOnce(new Error('Sin respuesta'));
  mount(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Comprobar mi reserva' }));
  await screen.findByRole('heading', { name: 'Tu cita está reservada' });
  expect(appointmentsApi.create).toHaveBeenCalledTimes(2); expect(vi.mocked(appointmentsApi.create).mock.calls[0]).toEqual(vi.mocked(appointmentsApi.create).mock.calls[1]);
});
it('toma lock antes de comprobar disponibilidad y no duplica confirmaciones', async () => {
  let resolve!: (value: AppointmentResponse) => void;
  vi.mocked(appointmentsApi.create).mockReturnValue(new Promise(done => { resolve = done; }));
  mount(); await review(); const confirm = screen.getByRole('button', { name: 'Confirmar solicitud' });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  await waitFor(() => expect(appointmentsApi.create).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Motivo (opcional)')).toBeDisabled();
  await act(async () => resolve(appointment)); await screen.findByRole('heading', { name: 'Tu cita está reservada' });
});
it('el rechazo 409 conserva el mensaje y obliga a seleccionar de nuevo', async () => {
  vi.mocked(appointmentsApi.create).mockRejectedValue(new ApiError(409, { status: 409, error: 'Conflict', message: 'Horario tomado.', path: '/api/appointments', timestamp: slot.start }, 'Horario tomado.'));
  mount(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Horario tomado.'); expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
});
