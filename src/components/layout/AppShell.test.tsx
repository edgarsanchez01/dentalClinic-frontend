import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../app/authStore';
import { AppShell } from './AppShell';

type Role = 'OWNER' | 'DENTIST' | 'RECEPTIONIST' | 'PATIENT';
const common = ['/', '/appointments', '/patients'];
const originalDialogMethods = Object.fromEntries(['showModal', 'close'].map((name) =>
  [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
const expectedRoutes: Record<Role, string[]> = {
  OWNER: [...common, '/collections', '/finances', '/finances/reports', '/reviews', '/services', '/scheduling', '/users', '/clinic', '/notifications', '/change-password'],
  DENTIST: [...common, '/finances', '/reviews', '/services', '/scheduling', '/notifications', '/change-password'],
  RECEPTIONIST: [...common, '/collections', '/finances', '/finances/reports', '/services', '/scheduling', '/notifications', '/change-password'],
  PATIENT: ['/', '/appointments', '/patients/41', '/notifications', '/change-password'],
};

function RouteChange() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/appointments?view=day')}>Cambiar ruta</button>;
}

function renderShell(role: Role = 'OWNER', patientId = 41, path = '/') {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 1, email: 'test@clinic.com', role, active: true, createdAt: '2026-01-01T00:00:00Z',
      ...(role === 'PATIENT' && patientId ? { patientId } : {}),
    },
  });
  return render(<QueryClientProvider client={useAuthStore.getState().queryClient}><MemoryRouter initialEntries={[path]}><AppShell><RouteChange /></AppShell></MemoryRouter></QueryClientProvider>);
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Abrir menú de navegación' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Menú de navegación' }) };
}

beforeEach(() => {
  useAuthStore.getState().queryClient.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"unread":0}', { status: 200 })));
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  // jsdom has no modal implementation. These shims only model open/close events;
  // native focus isolation and responsive CSS are verified separately in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = true;
    this.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  } });
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of Object.entries(originalDialogMethods)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  document.body.style.overflow = '';
});

describe('AppShell — H-A09', () => {
  it('OWNER conserva su shell y recetas de contenido independientes de Recepción', () => {
    renderShell('OWNER', 41, '/users');
    const main = screen.getByRole('main');
    expect(main.closest('.owner-shell')).not.toBeNull();
    expect(main.closest('.reception-shell, .owner-chrome')).toBeNull();
    expect(screen.getByRole('banner')).toHaveClass('owner-chrome');
    expect(screen.getByRole('complementary')).toHaveClass('owner-chrome');
    expect(screen.getByRole('navigation', { name: 'Navegación rápida' })).toHaveClass('owner-chrome');
  });

  it.each<Role>(['PATIENT', 'RECEPTIONIST', 'DENTIST'])('no aplica el tema OWNER a %s', role => {
    const { container } = renderShell(role);
    expect(container.querySelector('.owner-shell, .owner-chrome, .owner-workspace')).toBeNull();
  });

  it.each([['/finances/reports', 'Reportes financieros'], ['/finances/42', 'Finanzas'], ['/finances/new', 'Finanzas']])(
    'mantiene una sola hoja activa en %s', (path, label) => {
      renderShell('OWNER', 41, path);
      const nav = screen.getByRole('navigation', { name: 'Navegación de escritorio' });
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    },
  );
  it('asocia el control al menú cerrado y conserva las clases responsive en el propio aside', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Abrir menú de navegación' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    const target = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(target).toBeInstanceOf(HTMLDialogElement);
    expect(target).not.toHaveAttribute('open');
    const aside = screen.getByRole('complementary', { name: 'Navegacion' });
    expect(aside).toHaveClass('hidden', 'md:block', 'w-64');
    // This is a structural assertion, not evidence of rendered mobile visibility.
    expect(screen.getByRole('navigation', { name: 'Navegación de escritorio' })).toBeInTheDocument();
  });

  it('abre, enfoca el cierre, cierra con el botón y devuelve foco y scroll anteriores', () => {
    document.body.style.overflow = 'auto';
    renderShell();
    const { trigger, dialog } = openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Cerrar menú' });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(close);
    expect(dialog).not.toHaveAttribute('open');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('cierra al pulsar un enlace, incluso cuando el destino es la ruta actual', () => {
    renderShell();
    const { dialog, trigger } = openMenu();
    const nav = within(dialog).getByRole('navigation', { name: 'Navegación móvil' });
    const home = within(nav).getByRole('link', { name: 'Inicio' });
    expect(home).toHaveAttribute('aria-current', 'page');
    fireEvent.click(home);
    expect(dialog).not.toHaveAttribute('open');
    expect(trigger).toHaveFocus();
    openMenu();
    fireEvent.click(within(dialog).getByRole('link', { name: 'Citas' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(within(screen.getByRole('navigation', { name: 'Navegación de escritorio' }))
      .getByRole('link', { name: 'Citas' })).toHaveAttribute('aria-current', 'page');
  });

  it('no roba el foco si el evento close llega después de enfocar otro control de la página', () => {
    renderShell();
    const { dialog } = openMenu();
    // Model the native restoration/close-event gap without timers.
    dialog.removeAttribute('open');
    const control = screen.getByRole('button', { name: 'Cambiar ruta' });
    control.focus();
    fireEvent(dialog, new Event('close'));
    expect(control).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Abrir menú de navegación' })).toHaveAttribute('aria-expanded', 'false');
  });

  it.each<Role>(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'])('ofrece las rutas apropiadas para %s en ambas navegaciones', (role) => {
    renderShell(role);
    expect(screen.getByRole('link', { name: /Notificaciones:/ })).toHaveAttribute('href', '/notifications');
    const { dialog } = openMenu();
    const desktop = screen.getByRole('navigation', { name: 'Navegación de escritorio' });
    const mobile = within(dialog).getByRole('navigation', { name: 'Navegación móvil' });
    for (const nav of [desktop, mobile]) {
      expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(expectedRoutes[role]);
      expect(within(nav).getByRole('link', { name: role === 'PATIENT' ? 'Mis datos' : 'Pacientes' }))
        .toHaveAttribute('href', role === 'PATIENT' ? '/patients/41' : '/patients');
      expect(within(nav).queryByRole('link', { name: role === 'PATIENT' ? 'Pacientes' : 'Mis datos' })).not.toBeInTheDocument();
    }
  });

  it('Mis datos conserva una entrada segura cuando no hay patientId y cierra el menú al navegar', () => {
    renderShell('PATIENT', 0);
    const { dialog } = openMenu();
    const link = within(dialog).getByRole('link', { name: 'Mis datos' });
    expect(link).toHaveAttribute('href', '/patients');
    fireEvent.click(link);
    expect(dialog).not.toHaveAttribute('open');
    expect(screen.queryByRole('link', { name: 'Pacientes' })).not.toBeInTheDocument();
  });

  it('mantiene Tab y Shift+Tab dentro del menú y procesa el cancel nativo de Escape', () => {
    renderShell();
    const { dialog, trigger } = openMenu();
    const close = within(dialog).getByRole('button', { name: 'Cerrar menú' });
    const last = within(dialog).getByRole('link', { name: 'Contraseña' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dialog).not.toHaveAttribute('open');
    expect(trigger).toHaveFocus();
  });

  it('cierra también ante navegación externa al menú', () => {
    renderShell();
    const { dialog } = openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar ruta' }));
    expect(dialog).not.toHaveAttribute('open');
  });

  it('restaura el scroll y elimina el listener al desmontarse con el menú abierto', () => {
    const view = renderShell();
    openMenu();
    const media = vi.mocked(window.matchMedia).mock.results[0].value;
    act(() => view.unmount());
    expect(document.body.style.overflow).toBe('');
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
