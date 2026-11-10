import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';

const patient = { id: 1, firstName: 'Ana', lastName: 'Pérez', active: true, administrativeNotes: 'Contacto administrativo' };
let calls: Array<{ path: string; method: string; body: unknown }>;

beforeEach(() => {
  calls = [];
  useAuthStore.setState({ status: 'authenticated', user: { id: 10, email: 'owner@example.test', role: 'OWNER', active: true, createdAt: '', dentistId: 7 } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET';
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    const data = path.endsWith('/clinical/medical-intake/declarations?page=0&size=10') ? { content: [], totalPages: 0 }
      : path.includes('/declarations') ? { content: [], totalPages: 0 }
        : path.endsWith('/clinical') ? { patientId: 1, allergies: 'Penicilina', ...(method === 'PUT' ? body as object : {}) }
          : path === '/api/patients/1' ? { ...patient, ...(method === 'PATCH' ? body as object : {}) } : [];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function mount(path = '/patients/1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/patients/:id" element={<PatientDetailPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('heading', { name: 'Ana Pérez' });
}
function tab(name: string) { fireEvent.click(screen.getByRole('tab', { name })); }

describe('OWNER — ficha compartida y paneles persistentes', () => {
  it('separa administración, declaraciones y registros profesionales sin escrituras al navegar', async () => {
    await mount();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Administración' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contacto administrativo')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Odontograma' })).not.toBeInTheDocument();
    tab('Declaraciones del paciente');
    expect(await screen.findByText(/Declaraciones confirmadas e inmutables/)).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    tab('Expediente clínico');
    expect(await screen.findByLabelText('Alergias')).toHaveValue('Penicilina');
    expect(screen.getByText('Dato de salud protegido')).toBeVisible();
    tab('Notas clínicas');
    expect(screen.getByText(/Append-only/)).toBeVisible();
    expect(calls.every(call => call.method === 'GET')).toBe(true);
    expect(calls.some(call => call.path.includes('reception-summary'))).toBe(false);
  });

  it('conserva borradores administrativos, clínicos, de notas, tratamiento y odontograma', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    const name = screen.getByLabelText('Nombre');
    fireEvent.change(name, { target: { value: 'Ana pendiente' } });
    tab('Expediente clínico');
    const allergy = await screen.findByLabelText('Alergias');
    fireEvent.change(allergy, { target: { value: 'Alergia pendiente' } });
    tab('Notas clínicas');
    const note = screen.getByLabelText('Nueva nota clínica');
    fireEvent.change(note, { target: { value: 'Nota pendiente' } });
    tab('Tratamientos');
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo tratamiento' }));
    const description = screen.getByLabelText(/Descripción/);
    fireEvent.change(description, { target: { value: 'Tratamiento pendiente' } });
    tab('Odontograma');
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho Permanente: sin registro/ }));
    const dentalNotes = screen.getByLabelText('Observaciones (opcional)');
    fireEvent.change(dentalNotes, { target: { value: 'Pieza pendiente' } });
    tab('Administración');
    expect(screen.getByLabelText('Nombre')).toBe(name);
    expect(name).toHaveValue('Ana pendiente');
    tab('Expediente clínico');
    expect(screen.getByLabelText('Alergias')).toBe(allergy);
    expect(allergy).toHaveValue('Alergia pendiente');
    tab('Notas clínicas');
    expect(screen.getByLabelText('Nueva nota clínica')).toBe(note);
    expect(note).toHaveValue('Nota pendiente');
    tab('Tratamientos');
    expect(screen.getByLabelText(/Descripción/)).toBe(description);
    expect(description).toHaveValue('Tratamiento pendiente');
    tab('Odontograma');
    expect(screen.getByLabelText('Observaciones (opcional)')).toBe(dentalNotes);
    expect(dentalNotes).toHaveValue('Pieza pendiente');
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('usa activación manual accesible con flechas, Home y End sin cambiar de panel al enfocar', async () => {
    await mount();
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[5]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[5], { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(tabs[5]).toHaveFocus();
    fireEvent.click(tabs[5]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[5].id);
  });

  it('guarda administración y expediente con sus contratos separados', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana María' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Datos actualizados.');
    tab('Expediente clínico');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: 'Actualizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await waitFor(() => expect(calls.filter(call => call.method !== 'GET')).toEqual([
      { path: '/api/patients/1', method: 'PATCH', body: { firstName: 'Ana María', lastName: 'Pérez', active: true, administrativeNotes: 'Contacto administrativo', email: null, phone: null, birthDate: null } },
      { path: '/api/patients/1/clinical', method: 'PUT', body: { medicalBackground: '', allergies: 'Actualizada', clinicalHistory: '', generalObservations: '' } },
    ]));
  });
});
