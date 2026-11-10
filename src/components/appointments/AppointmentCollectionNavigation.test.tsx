import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppointmentDetailPage } from './AppointmentDetailPage';
import { appointmentsApi } from '../../api/appointments';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { checkoutAppointment } from '../../test/checkoutFixtures';

vi.mock('./AppointmentClinicalSection', () => ({ AppointmentClinicalSection: () => null }));
vi.mock('../financial/FinancialAccessLink', () => ({ FinancialAccessLink: () => null }));

function Destination() { const location = useLocation(); return <p>{location.pathname + location.search}</p>; }
function mount(role: 'OWNER' | 'RECEPTIONIST', target: string) {
  useAuthStore.setState({ user: { id: 2, role, email: 'test@example.test', active: true, createdAt: checkoutAppointment.createdAt }, status: 'authenticated' });
  vi.spyOn(appointmentsApi, 'get').mockResolvedValue({ ...checkoutAppointment, status: 'COMPLETED' });
  vi.spyOn(appointmentsApi, 'events').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone: 'UTC', days: [], dentists: [], exceptions: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/appointments', `/appointments/7?returnTo=${encodeURIComponent(target)}`]} initialIndex={1}><Routes><Route path="/appointments/:id" element={<AppointmentDetailPage />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.setState({ user: null, status: 'anonymous' }); });

it.each(['OWNER', 'RECEPTIONIST'] as const)('%s conserva filtros/página desde detalle y acceso a gestión', async role => {
  const target = '/collections?state=PARTIAL&dentistId=3&page=2';
  mount(role, target);
  const back = await screen.findByRole('link', { name: 'Volver a atenciones por cobrar' });
  expect(back).toHaveAttribute('href', target);
  for (const link of screen.getAllByRole('link', { name: 'Gestionar cobro de la atención' })) {
    expect(link).toHaveAttribute('href', `/collections/7?returnTo=${encodeURIComponent(target)}`);
  }
  fireEvent.click(back); expect(screen.getByText(target)).toBeInTheDocument();
});
it.each(['OWNER', 'RECEPTIONIST'] as const)('%s también conserva el retorno con el botón Volver', async role => {
  const target = '/collections?page=1'; mount(role, target);
  fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));
  expect(screen.getByText(target)).toBeInTheDocument();
});
it.each(['/appointments?date=2026-10-22&view=week', '/finances', 'https://evil.test/collections', '/collections/7'])('enlace previo %s no adopta retorno de Collections', async target => {
  mount('RECEPTIONIST', target); await screen.findByRole('heading', { name: 'Cita #7' });
  expect(screen.queryByRole('link', { name: 'Volver a atenciones por cobrar' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Volver a Citas' })).toHaveAttribute('href', target.startsWith('/appointments?') ? target : '/appointments');
  expect(screen.getByRole('link', { name: 'Gestionar cobro de la atención' })).toHaveAttribute('href', '/collections/7');
});
