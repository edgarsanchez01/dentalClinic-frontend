import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { tokenStore } from '../api/http';
import { PublicSchedulePage } from '../components/scheduling/PublicSchedulePage';
import { SchedulingPage } from '../components/scheduling/SchedulingPage';
import { useAuthStore } from './authStore';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function user(role: UserDto['role']): UserDto {
  return {
    id: 10,
    email: `${role.toLowerCase()}@clinica.com`,
    role,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function renderPage(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const CLINIC_SCHEDULE = {
  timezone: 'Europe/Madrid',
  days: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    open: dayOfWeek <= 5,
    startTime: dayOfWeek <= 5 ? '09:00:00' : null,
    endTime: dayOfWeek <= 5 ? '17:00:00' : null,
    breaks: [],
  })),
};

const POLICY = {
  maxAdvanceDays: 90,
  minBookingLeadTimeHours: 2,
  cancellationLeadTimeHours: 12,
  timezone: 'Europe/Madrid',
};

const PUBLIC = {
  timezone: 'Europe/Madrid',
  days: [{ dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '17:00:00' }],
  exceptions: [{ date: '2026-10-12', closed: true, startTime: null, endTime: null }],
  dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', specialty: null, days: [] }],
};

const DENTIST_SCHEDULE = { dentistId: 7, timezone: 'Europe/Madrid', days: CLINIC_SCHEDULE.days };

function stubApi(overrides: Record<string, () => Promise<Response>> = {}) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [key, value] of Object.entries(overrides)) {
      if (url.includes(key)) return value();
    }
    if (url.includes('/api/availability/policy')) return Promise.resolve(response(200, POLICY));
    if (url.includes('/api/availability')) return Promise.resolve(response(200, { dentistId: 7, durationMinutes: 30, timezone: 'Europe/Madrid', slots: [] }));
    if (url.includes('/api/public/schedule')) return Promise.resolve(response(200, PUBLIC));
    if (url.includes('/api/schedules/clinic')) return Promise.resolve(response(200, CLINIC_SCHEDULE));
    if (url.includes('/api/schedules/dentist/7/time-off')) return Promise.resolve(response(200, []));
    if (url.includes('/api/schedules/dentist/7')) return Promise.resolve(response(200, DENTIST_SCHEDULE));
    return Promise.reject(new Error(`Sin stub para ${url}`));
  });
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Scheduling — horarios', () => {
  it('OWNER ve el editor de la clínica y el horario de dentistas', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stubApi();

    renderPage(<SchedulingPage />);

    expect(await screen.findByText('Horario de la clínica')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Guardar horario' })).toBeInTheDocument();
    expect(await screen.findByText('Horario de dentistas')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Añadir franquicia' })).toBeInTheDocument();
  });

  it('RECEPTIONIST consulta en solo lectura, sin acciones de escritura', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    stubApi();

    renderPage(<SchedulingPage />);

    expect(await screen.findByText('Horario de la clínica')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar política' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir franquicia' })).not.toBeInTheDocument();
  });

  it('calcula y muestra los huecos de disponibilidad', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stubApi({
      '/api/availability': () =>
        Promise.resolve(
          response(200, {
            dentistId: 7,
            durationMinutes: 30,
            timezone: 'Europe/Madrid',
            slots: [
              { startDate: '2026-10-06', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-06T07:00:00Z', end: '2026-10-06T07:30:00Z' },
            ],
          }),
        ),
    });

    renderPage(<SchedulingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('09:00–09:30')).toBeInTheDocument();
  });
});

describe('Horario público', () => {
  it('muestra la apertura semanal, excepciones y dentistas sin sesión', async () => {
    stubApi();
    renderPage(<PublicSchedulePage />);

    expect(await screen.findByText('Horario de apertura')).toBeInTheDocument();
    expect(await screen.findByText('09:00–17:00')).toBeInTheDocument();
    expect(await screen.findByText('Excepciones')).toBeInTheDocument();
    expect(await screen.findByText('Ana Uno')).toBeInTheDocument();
  });
});