import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { UnsavedChangesProvider } from './UnsavedChangesProvider';
import { useGuardedNavigate, useUnsavedChanges } from './unsavedChanges';

function DraftPage({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const guardedNavigate = useGuardedNavigate();
  const navigate = useNavigate();
  return (
    <div>
      <span>Página con borrador</span>
      <Link to="/otra">Ir a otra</Link>
      <button type="button" onClick={() => guardedNavigate(() => navigate('/otra'))}>
        Salir programático
      </button>
    </div>
  );
}

function OtherPage() {
  return <span>Página destino</span>;
}

function renderGuard(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={['/borrador']}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/borrador" element={<DraftPage dirty={dirty} />} />
          <Route path="/otra" element={<OtherPage />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

const stopNavigation = (event: { preventDefault: () => void }) => event.preventDefault();

function LinkVariants({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return (
    <div>
      <span>Página con borrador</span>
      <a href="/otra" onClick={stopNavigation}>Interno</a>
      <a href="/otra" target="_blank" rel="noreferrer" onClick={stopNavigation}>Nueva pestaña</a>
      <a href="/otra" download onClick={stopNavigation}>Descargar</a>
      <a href="https://example.com/otra" onClick={stopNavigation}>Externo</a>
    </div>
  );
}

function renderVariants(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={['/borrador']}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/borrador" element={<LinkVariants dirty={dirty} />} />
          <Route path="/otra" element={<OtherPage />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function BackPage({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const guardedNavigate = useGuardedNavigate();
  const navigate = useNavigate();
  return (
    <div>
      <span>Página con borrador</span>
      <button type="button" onClick={() => guardedNavigate(() => navigate(-1))}>Volver</button>
    </div>
  );
}

function renderBack(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={['/inicio', '/borrador']} initialIndex={1}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/inicio" element={<span>Inicio</span>} />
          <Route path="/borrador" element={<BackPage dirty={dirty} />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe('guard de borradores sin guardar', () => {
  it('pide confirmación al navegar por enlace y permite seguir en la página', () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('link', { name: 'Ir a otra' }));

    const dialog = screen.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
    expect(dialog).toBeTruthy();
    expect(screen.queryByText('Página destino')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Página con borrador')).toBeTruthy();
  });

  it('navega al confirmar «Salir sin guardar»', () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('link', { name: 'Ir a otra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(screen.getByText('Página destino')).toBeTruthy();
  });

  it('«Seguir aquí» con Escape no navega', () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('link', { name: 'Ir a otra' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Página con borrador')).toBeTruthy();
  });

  it('no interfiere cuando no hay borrador', () => {
    renderGuard(false);
    fireEvent.click(screen.getByRole('link', { name: 'Ir a otra' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Página destino')).toBeTruthy();
  });

  it('protege la navegación programática', () => {
    renderGuard(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salir programático' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(screen.getByText('Página destino')).toBeTruthy();
  });

  it('protege la navegación programática con navigate(-1)', () => {
    renderBack(true);
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByText('Página con borrador')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(screen.getByText('Inicio')).toBeTruthy();
  });

  it('no bloquea enlaces externos, nueva pestaña ni descargas', () => {
    renderVariants(true);
    fireEvent.click(screen.getByRole('link', { name: 'Nueva pestaña' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Descargar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Externo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no bloquea clics modificados ni de botón intermedio', () => {
    renderVariants(true);
    const link = screen.getByRole('link', { name: 'Interno' });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { button: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('intercepta también anclas internas simples cuando hay borrador', () => {
    renderVariants(true);
    fireEvent.click(screen.getByRole('link', { name: 'Interno' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('bloquea la recarga solo con cambios pendientes', () => {
    const { unmount } = renderGuard(true);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    unmount();

    renderGuard(false);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});

function OperationPage({ scheduling, second = false, financial = false }: { scheduling: boolean; second?: boolean; financial?: boolean }) {
  useUnsavedChanges(scheduling, 'scheduling-operation');
  useUnsavedChanges(second, 'scheduling-operation');
  useUnsavedChanges(financial, 'operation');
  return <Link to="/otra">Salir de operación</Link>;
}

function operationView(props: Parameters<typeof OperationPage>[0]) {
  return <MemoryRouter initialEntries={['/operacion']}><UnsavedChangesProvider>
    <Routes>
      <Route path="/operacion" element={<OperationPage {...props} />} />
      <Route path="/otra" element={<OtherPage />} />
    </Routes>
  </UnsavedChangesProvider></MemoryRouter>;
}

describe('guard de operaciones — extensión compatible de Horarios', () => {
  it('usa el mensaje específico y permite quedarse sin afirmar que salir cancela el guardado', () => {
    render(operationView({ scheduling: true }));
    screen.getByRole('link', { name: 'Salir de operación' }).focus();
    fireEvent.click(screen.getByRole('link', { name: 'Salir de operación' }));
    const dialog = screen.getByRole('dialog', { name: 'Guardado en curso' });
    expect(dialog).toHaveTextContent('Hay un guardado en curso. Salir no garantiza que la operación se cancele');
    expect(dialog).not.toHaveTextContent(/cobro|finalización|clave/);
    expect(screen.queryByRole('button', { name: 'Salir sin guardar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salir de operación' })).toHaveFocus();
  });

  it('no pierde la protección cuando termina solo una de varias operaciones', () => {
    const view = render(operationView({ scheduling: true, second: true }));
    view.rerender(operationView({ scheduling: false, second: true }));
    fireEvent.click(screen.getByRole('link', { name: 'Salir de operación' }));
    expect(screen.getByRole('dialog', { name: 'Guardado en curso' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    view.rerender(operationView({ scheduling: false, second: false }));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de operación' }));
    expect(screen.getByText('Página destino')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([false, true])('conserva literalmente el mensaje financiero/clínico (Horarios simultáneo: %s)', (scheduling) => {
    render(operationView({ scheduling, financial: true }));
    fireEvent.click(screen.getByRole('link', { name: 'Salir de operación' }));
    const dialog = screen.getByRole('dialog', { name: 'Operación pendiente de verificar' });
    expect(dialog).toHaveTextContent('Salir no cancela ni revierte la finalización o el cobro. Conserva esta sesión para recuperar la misma solicitud; recargar o cerrar sesión pierde su copia en memoria. No repitas la operación con otra clave. Los borradores sin guardar, si existen, se perderán al salir.');
    expect(dialog).not.toHaveTextContent('Hay un guardado en curso');
    fireEvent.click(screen.getByRole('button', { name: 'Salir de esta vista' }));
    expect(screen.getByText('Página destino')).toBeVisible();
  });
});
