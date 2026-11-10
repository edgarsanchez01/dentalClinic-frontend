import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { patientsApi, type PageDto, type PatientDto } from '../../api/patients';
import { ReceptionPatientPicker } from './FinancialPickers';

const ada: PatientDto = { id: 10, firstName: 'Ada', lastName: 'Prueba', phone: '5550001', active: true, createdAt: '2026-10-01T12:00:00Z' };
const ana: PatientDto = { ...ada, id: 20, firstName: 'Ana', phone: '5550002' };
const result = (content: PatientDto[], page = 0, totalPages = 1): PageDto<PatientDto> => ({ content, page, size: 10, totalPages, totalElements: totalPages * content.length });
const clients: QueryClient[] = [];
function setup(initial: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  function Picker() {
    const [value, setValue] = useState(initial);
    return <><ReceptionPatientPicker value={value} onChange={setValue} /><span aria-label="ID del paciente">{value ?? ''}</span><button>Fuera del control</button></>;
  }
  render(<QueryClientProvider client={client}><Picker /></QueryClientProvider>);
  return screen.getByRole('combobox', { name: 'Paciente' });
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

it('enfoque vacío carga la primera página real sin autoseleccionar; Escape y salir cierran', async () => {
  let resolve!: (page: PageDto<PatientDto>) => void;
  const list = vi.spyOn(patientsApi, 'list').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const input = setup();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  fireEvent.focus(input);
  expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Buscando pacientes');
  expect(list).toHaveBeenCalledExactlyOnceWith({ search: '', page: 0, size: 10 });
  await act(async () => resolve(result([ada, ana])));
  await screen.findByRole('option', { name: /Ada Prueba/ });
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(input).not.toHaveAttribute('aria-activedescendant');
  expect(screen.getByLabelText('ID del paciente')).toBeEmptyDOMElement();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByLabelText('ID del paciente')).toBeEmptyDOMElement();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveAttribute('aria-expanded', 'false');
  fireEvent.focus(input);
  fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'Fuera del control' }) });
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('filtra por API y al borrar restaura el listado general manteniendo abierto', async () => {
  const list = vi.spyOn(patientsApi, 'list').mockImplementation(async (filters) => result(filters?.search ? [ana] : [ada, ana]));
  const input = setup();
  fireEvent.focus(input);
  await screen.findByRole('option', { name: /Ada Prueba/ });
  fireEvent.change(input, { target: { value: 'Ana' } });
  await screen.findByRole('option', { name: /Ana Prueba/ });
  expect(screen.queryByRole('option', { name: /Ada Prueba/ })).not.toBeInTheDocument();
  expect(list).toHaveBeenLastCalledWith({ search: 'Ana', page: 0, size: 10 });
  fireEvent.change(input, { target: { value: '' } });
  await screen.findByRole('option', { name: /Ada Prueba/ });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByText(/Escribe un nombre/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(2);
});

it('lista general vacía y error inicial ofrecen estados reales y reintento', async () => {
  vi.spyOn(patientsApi, 'list').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result([]));
  const input = setup();
  fireEvent.focus(input);
  await screen.findByRole('alert');
  expect(screen.queryByText('No hay pacientes disponibles.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar búsqueda' }));
  await screen.findByText('No hay pacientes disponibles.');
  expect(screen.queryByText(/No hay pacientes que coincidan/)).not.toBeInTheDocument();
  expect(input).toHaveValue('');
});

it('homónimos conservan ID al enfocar, lo invalidan al editar y seleccionan el nuevo ID real', async () => {
  const homonym = { ...ada, id: 20, phone: '5550002' };
  vi.spyOn(patientsApi, 'list').mockResolvedValue(result([ada, homonym]));
  vi.spyOn(patientsApi, 'get').mockImplementation(async (id) => id === 20 ? homonym : ada);
  const input = setup();
  fireEvent.focus(input);
  const second = await screen.findByRole('option', { name: /Ada Prueba.*Paciente #20.*5550002/ });
  expect(screen.getByRole('option', { name: /Ada Prueba.*Paciente #10.*5550001/ })).toBeInTheDocument();
  fireEvent.click(second);
  await waitFor(() => expect(input).toHaveValue('Ada Prueba'));
  expect(screen.getByLabelText('ID del paciente')).toHaveTextContent('20');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  fireEvent.focus(input);
  expect(input).toHaveValue('Ada Prueba');
  expect(screen.getByLabelText('ID del paciente')).toHaveTextContent('20');
  fireEvent.change(input, { target: { value: 'otro' } });
  expect(input).toHaveValue('otro');
  expect(screen.getByLabelText('ID del paciente')).toBeEmptyDOMElement();
  expect(screen.queryByLabelText('Paciente seleccionado')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: '' } });
  await screen.findByRole('option', { name: /Paciente #10/ });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-0'));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(input).toHaveValue('Ada Prueba'));
  expect(screen.getByLabelText('ID del paciente')).toHaveTextContent('10');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('página general tardía no sustituye búsqueda nueva; borrar no muestra la búsqueda anterior', async () => {
  let resolve!: (page: PageDto<PatientDto>) => void;
  vi.spyOn(patientsApi, 'list').mockImplementation(async (filters) => filters?.search
    ? result([ana]) : new Promise((done) => { resolve = done; }));
  const input = setup();
  fireEvent.focus(input);
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  fireEvent.change(input, { target: { value: 'Ana' } });
  await screen.findByRole('option', { name: /Ana Prueba/ });
  await act(async () => resolve(result([ada])));
  expect(screen.queryByRole('option', { name: /Ada Prueba/ })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: '' } });
  await screen.findByRole('option', { name: /Ada Prueba/ });
  expect(screen.queryByRole('option', { name: /Ana Prueba/ })).not.toBeInTheDocument();
});

it('carga, sin coincidencias, error y reintento no pierden el texto', async () => {
  let resolve!: (page: PageDto<PatientDto>) => void;
  const list = vi.spyOn(patientsApi, 'list').mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result([ada]));
  const input = setup();
  fireEvent.change(input, { target: { value: 'vacio' } });
  expect(screen.getByRole('status')).toHaveTextContent('Buscando pacientes');
  await act(async () => resolve(result([])));
  await screen.findByText(/No hay pacientes que coincidan/);
  fireEvent.change(input, { target: { value: 'Ada' } });
  await screen.findByRole('alert');
  expect(input).toHaveValue('Ada');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar búsqueda' }));
  await screen.findByRole('option', { name: /Ada Prueba/ });
  expect(list).toHaveBeenLastCalledWith({ search: 'Ada', page: 0, size: 10 });
});

it('acumula páginas, separa búsquedas concurrentes y mantiene selección durante refetch', async () => {
  let old!: (page: PageDto<PatientDto>) => void;
  vi.spyOn(patientsApi, 'list').mockImplementation(async (filters) => {
    if (filters?.search === 'vieja') return new Promise((resolve) => { old = resolve; });
    return result(filters?.page === 1 ? [ana] : [ada], filters?.page ?? 0, 2);
  });
  vi.spyOn(patientsApi, 'get').mockResolvedValue(ana);
  const input = setup();
  fireEvent.change(input, { target: { value: 'vieja' } });
  await waitFor(() => expect(old).toBeTypeOf('function'));
  fireEvent.change(input, { target: { value: 'nueva' } });
  await screen.findByRole('option', { name: /Ada Prueba/ });
  fireEvent.click(screen.getByRole('button', { name: 'Cargar más pacientes' }));
  await screen.findByRole('option', { name: /Ana Prueba/ });
  expect(screen.getByRole('option', { name: /Ada Prueba/ })).toBeInTheDocument();
  await act(async () => old(result([{ ...ada, firstName: 'Obsoleta' }])));
  expect(screen.queryByRole('option', { name: /Obsoleta/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Ana Prueba/ }));
  await waitFor(() => expect(input).toHaveValue('Ana Prueba'));
  await act(async () => { await clients[0]!.invalidateQueries({ queryKey: ['financial-patient', 20] }); });
  expect(input).toHaveValue('Ana Prueba');
  fireEvent.click(screen.getByRole('button', { name: 'Quitar selección' }));
  expect(screen.queryByLabelText('Paciente seleccionado')).not.toBeInTheDocument();
  expect(input).toHaveValue('');
});

it('un paciente preseleccionado no verificado muestra error y permite reintentar sin cambiar ID', async () => {
  vi.spyOn(patientsApi, 'get').mockRejectedValueOnce(new Error('403')).mockResolvedValue(ada);
  const input = setup(10);
  await screen.findByText('No se pudo verificar el paciente seleccionado.');
  expect(input).toHaveValue('Paciente #10');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar verificación' }));
  await waitFor(() => expect(input).toHaveValue('Ada Prueba'));
});
