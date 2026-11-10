import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { authApi, type Role } from '../../api/auth';
import { ApiError, cancelSessionRequests, tokenStore } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { ChangePasswordPage } from './ChangePasswordPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); cancelSessionRequests(); tokenStore.set(null); useAuthStore.setState({ user: null, status: 'anonymous' }); });
function LoginNotice() { return <p>{useLocation().state?.notice}</p>; }
function show(role: Role = 'OWNER') {
  tokenStore.set('synthetic-A');
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, role, email: 'a@dc.test', active: true, createdAt: '2026-11-01' } });
  return render(<MemoryRouter initialEntries={['/change-password']}><Routes>
    <Route path="/change-password" element={<main><ChangePasswordPage /></main>} />
    <Route path="/login" element={<LoginNotice />} />
  </Routes></MemoryRouter>);
}
function fill(confirmation = 'nueva literal') {
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'actual literal' } });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'nueva literal' } });
  fireEvent.change(screen.getByLabelText('Repite la nueva contraseña'), { target: { value: confirmation } });
}
it.each(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const)('%s conserva formulario único, payload, bloqueo y salida tras cambio', async role => {
  let release!: () => void;
  const api = vi.spyOn(authApi, 'changePassword').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const view = show(role); fill();
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(view.container.querySelector('.ce-page--form')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar nueva contraseña' }));
  expect(screen.getByLabelText('Nueva contraseña')).toHaveValue('nueva literal');
  const form = view.container.querySelector('form')!; fireEvent.submit(form); fireEvent.submit(form);
  expect(api).toHaveBeenCalledExactlyOnceWith('actual literal', 'nueva literal');
  expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
  await act(async () => release());
  await screen.findByText('Contraseña actualizada. Inicia sesión de nuevo.');
  expect(useAuthStore.getState().status).toBe('anonymous'); expect(tokenStore.get()).toBeNull();
});
it('confirmación inválida no consulta y enfoca feedback; error backend conserva valores corregibles', async () => {
  const api = vi.spyOn(authApi, 'changePassword').mockRejectedValue(new ApiError(400, { status: 400, error: 'Bad Request', message: 'Revisa la contraseña actual.', path: '', timestamp: '', fieldErrors: { currentPassword: 'Actual incorrecta.' } }, ''));
  const view = show(); fill('distinta'); fireEvent.submit(view.container.querySelector('form')!);
  expect(api).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
  fireEvent.change(screen.getByLabelText('Repite la nueva contraseña'), { target: { value: 'nueva literal' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(screen.getByLabelText('Contraseña actual')).toHaveAttribute('aria-invalid', 'true'));
  expect(screen.getByLabelText('Contraseña actual')).toHaveValue('actual literal');
  expect(screen.getByLabelText('Nueva contraseña')).toHaveValue('nueva literal');
});
