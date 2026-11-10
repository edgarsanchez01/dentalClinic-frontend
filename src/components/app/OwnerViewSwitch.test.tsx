import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../app/authStore';
import { OwnerViewSwitch } from './OwnerViewSwitch';

afterEach(() => { cleanup(); useAuthStore.setState({ status: 'anonymous', user: null }); });

it.each([false, true])('la receta embedded=%s mantiene destinos, selección y parámetros de contexto', embedded => {
  useAuthStore.setState({ user: { id: 1, role: 'OWNER', active: true, email: 'owner@example.test', createdAt: '2026-10-26T07:00:00Z' } });
  render(<MemoryRouter initialEntries={['/appointments?scope=mine&date=2026-10-26&view=week&status=SCHEDULED&dentistId=8&create=1']}><OwnerViewSwitch area="appointments" embedded={embedded} /></MemoryRouter>);
  const personal = screen.getByRole('link', { name: 'Mi actividad clínica' });
  expect(personal).toHaveAttribute('aria-current', 'page');
  const clinic = screen.getByRole('link', { name: 'Clínica' });
  for (const link of [personal, clinic]) {
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/appointments');
    expect(url.searchParams.get('date')).toBe('2026-10-26');
    expect(url.searchParams.get('view')).toBe('week');
    expect(url.searchParams.get('status')).toBe('SCHEDULED');
    expect(url.searchParams.has('dentistId')).toBe(false);
    expect(url.searchParams.has('create')).toBe(false);
  }
  expect(new URL(personal.getAttribute('href')!, 'http://localhost').searchParams.get('scope')).toBe('mine');
  expect(new URL(clinic.getAttribute('href')!, 'http://localhost').searchParams.has('scope')).toBe(false);
  expect(screen.getByRole('navigation')).toHaveClass(embedded ? 'agenda-choice' : 'px-5');
});

it('Recepción no obtiene opciones de contexto OWNER', () => {
  useAuthStore.setState({ user: { id: 3, role: 'RECEPTIONIST', active: true, email: 'reception@example.test', createdAt: '2026-10-26T07:00:00Z' } });
  render(<MemoryRouter><OwnerViewSwitch area="appointments" embedded /></MemoryRouter>);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
