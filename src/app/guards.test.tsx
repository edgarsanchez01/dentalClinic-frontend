import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireGuest, RequireRole } from './guards';

const ANA = {
  id: 1,
  email: 'ana@clinica.com',
  role: 'DENTIST' as const,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderWithGuards(tree: React.ReactNode, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<h1>Iniciar sesión</h1>} />
        <Route path="/" element={<h1>Inicio</h1>} />
        <Route path="/protegida" element={tree} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'restoring', user: null });
});

describe('Guardas de ruta', () => {
  it('mientras restaura muestra el estado neutro y no redirige', () => {
    useAuthStore.setState({ status: 'restoring', user: null });
    renderWithGuards(
      <RequireAuth>
        <h1>Contenido privado</h1>
      </RequireAuth>,
      '/protegida',
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restaurando sesión');
    expect(screen.queryByText('Iniciar sesión')).not.toBeInTheDocument();
  });

  it('sin sesion RequireAuth redirige al login', () => {
    useAuthStore.setState({ status: 'anonymous', user: null });
    renderWithGuards(
      <RequireAuth>
        <h1>Contenido privado</h1>
      </RequireAuth>,
      '/protegida',
    );

    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('con sesion RequireGuest redirige a la home', () => {
    useAuthStore.setState({ status: 'authenticated', user: ANA });
    renderWithGuards(
      <RequireGuest>
        <h1>Contenido invitado</h1>
      </RequireGuest>,
      '/protegida',
    );

    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
  });

  it('RequireRole permite el rol correcto y niega el resto', () => {
    useAuthStore.setState({ status: 'authenticated', user: ANA });

    const { unmount } = renderWithGuards(
      <RequireRole role="DENTIST">
        <h1>Zona clínica</h1>
      </RequireRole>,
      '/protegida',
    );
    expect(screen.getByRole('heading', { name: 'Zona clínica' })).toBeInTheDocument();
    unmount();

    renderWithGuards(
      <RequireRole role="OWNER">
        <h1>Zona de propietario</h1>
      </RequireRole>,
      '/protegida',
    );
    expect(screen.getByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
  });
});