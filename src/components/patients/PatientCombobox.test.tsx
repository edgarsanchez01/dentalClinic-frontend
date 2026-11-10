import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { patientsApi, type PatientDto, type PageDto } from '../../api/patients';
import { PatientCombobox } from './PatientCombobox';
import { useFinancialPatient } from '../financial/financialQueries';
import { PatientPicker } from './PatientPicker';
import { FinancialPatientPicker } from '../financial/FinancialPickers';

const ada: PatientDto = { id: 10, firstName: 'Ada', lastName: 'Prueba', phone: '5550001', active: true, createdAt: '2026-10-01' };
const ana = { ...ada, id: 20, firstName: 'Ana' };
const page = (content: PatientDto[], index = 0, total = 1): PageDto<PatientDto> => ({ content, page: index, size: 10, totalPages: total, totalElements: 20 });
const clients: QueryClient[] = [];
function client() { const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(c); return c; }
function Picker({ initial = null, disabled = false }: { initial?: number | null; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><PatientCombobox value={value} onChange={setValue} disabled={disabled} required /><output>{value ?? ''}</output></>;
}
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); });

it('preserva claves y timing: sin lista al montar, detalle cerrado/disabled y sin sembrar detalle desde lista', async () => {
  const list = vi.spyOn(patientsApi, 'list').mockResolvedValue(page([ada]));
  const get = vi.spyOn(patientsApi, 'get').mockResolvedValue(ada);
  const c = client(); const view = render(<QueryClientProvider client={c}><Picker initial={10} disabled /></QueryClientProvider>);
  await screen.findByDisplayValue('Ada Prueba'); expect(list).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledExactlyOnceWith(10);
  expect(c.getQueryData(['financial-patient', 10])).toEqual(ada);
  view.rerender(<QueryClientProvider client={c}><Picker initial={10} /></QueryClientProvider>);
  fireEvent.focus(screen.getByRole('combobox')); await screen.findByRole('option');
  expect(list).toHaveBeenCalledExactlyOnceWith({ search: '', page: 0, size: 10 });
  expect(c.getQueryData(['reception-financial-patient-search', ''])).toEqual({ pages: [page([ada])], pageParams: [0] });
});

it('más páginas deduplican IDs, conservan opciones al fallar y reintentan la página correcta', async () => {
  const list = vi.spyOn(patientsApi, 'list').mockResolvedValueOnce(page([ada], 0, 2))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([ada, ana], 1, 2));
  render(<QueryClientProvider client={client()}><Picker /></QueryClientProvider>);
  fireEvent.focus(screen.getByRole('combobox')); await screen.findByRole('option', { name: /Ada/ });
  fireEvent.click(screen.getByText('Cargar más pacientes')); await screen.findByText('No se pudo consultar la búsqueda de pacientes.');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.queryByText('No hay pacientes disponibles.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Reintentar búsqueda')); await screen.findByRole('option', { name: /Ana/ });
  expect(screen.getAllByRole('option')).toHaveLength(2); expect(list).toHaveBeenLastCalledWith({ search: '', page: 1, size: 10 });
  expect(screen.queryByText('Cargar más pacientes')).not.toBeInTheDocument();
});

it.each([403, 404])('el detalle %s no queda verificado por seleccionar una opción de lista', async status => {
  vi.spyOn(patientsApi, 'list').mockResolvedValue(page([ada]));
  const get = vi.spyOn(patientsApi, 'get').mockRejectedValue(new Error(String(status)));
  const c = client(); render(<QueryClientProvider client={c}><Picker /></QueryClientProvider>);
  fireEvent.focus(screen.getByRole('combobox')); fireEvent.click(await screen.findByRole('option', { name: /Ada/ }));
  await screen.findByText('No se pudo verificar el paciente seleccionado.'); expect(get).toHaveBeenCalledWith(10);
  expect(c.getQueryData(['financial-patient', 10])).toBeUndefined();
  expect(screen.getByRole('combobox')).toHaveValue('Paciente #10');
});

it('controller y selector comparten resolución e invalidación financiera sin GET duplicado', async () => {
  const get = vi.spyOn(patientsApi, 'get').mockResolvedValue(ada);
  function Controller() { const p = useFinancialPatient(10); return <><Picker initial={10} /><span>{p.data?.id}</span></>; }
  const c = client(); render(<QueryClientProvider client={c}><Controller /></QueryClientProvider>);
  await screen.findByDisplayValue('Ada Prueba'); expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValue({ ...ada, firstName: 'Actualizada' });
  await act(async () => { await c.invalidateQueries({ queryKey: ['financial-patient', 10] }); });
  await screen.findByDisplayValue('Actualizada Prueba'); expect(get).toHaveBeenCalledTimes(2);
});

it('cambiar de ID ignora un detalle tardío anterior sin sustituir nombre o selección', async () => {
  let finish!: (p: PatientDto) => void;
  vi.spyOn(patientsApi, 'get').mockImplementation(id => id === 10 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(ana));
  const c = client(); const view = render(<QueryClientProvider client={c}><PatientCombobox value={10} onChange={vi.fn()} /></QueryClientProvider>);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<QueryClientProvider client={c}><PatientCombobox value={20} onChange={vi.fn()} /></QueryClientProvider>);
  await screen.findByDisplayValue('Ana Prueba'); await act(async () => finish(ada));
  expect(screen.getByRole('combobox')).toHaveValue('Ana Prueba'); expect(screen.getByLabelText('Paciente seleccionado')).toHaveTextContent('#20');
});

it('frontera de sesión con cliente y montaje nuevos no recibe resultados de A que ignoran abort', async () => {
  let finish!: (p: PageDto<PatientDto>) => void;
  vi.spyOn(patientsApi, 'list').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(page([ana]));
  const a = client(), b = client(); const view = render(<QueryClientProvider key="A" client={a}><Picker /></QueryClientProvider>);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'privado-A' } });
  await waitFor(() => expect(finish).toBeTypeOf('function')); a.clear();
  view.rerender(<QueryClientProvider key="B" client={b}><Picker /></QueryClientProvider>);
  expect(screen.getByRole('combobox')).toHaveValue(''); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.focus(screen.getByRole('combobox')); await screen.findByRole('option', { name: /Ana/ });
  await act(async () => finish(page([ada]))); expect(screen.queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument();
  expect(b.getQueryData(['reception-financial-patient-search', 'privado-A'])).toBeUndefined();
});

it.each(['financial', 'staff'] as const)('%s: no precarga, usa namespace infinito nuevo y no colisiona con páginas previas', async kind => {
  const list = vi.spyOn(patientsApi, 'list').mockResolvedValue(page([ada]));
  const get = vi.spyOn(patientsApi, 'get').mockResolvedValue(ada);
  const c = client();
  c.setQueryData(['financial-patient-search', '', 0], page([ana]));
  c.setQueryData(['patients', 'picker', '', 0], page([ana]));
  const Component = kind === 'staff' ? PatientPicker : FinancialPatientPicker;
  render(<QueryClientProvider client={c}><Component value={null} onChange={vi.fn()} /></QueryClientProvider>);
  expect(list).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole('combobox')); await screen.findByRole('option', { name: /Ada/ });
  expect(c.getQueryData(['patients', 'combobox', 'search', ''])).toEqual({ pages: [page([ada])], pageParams: [0] });
  expect(c.getQueryData(['patients', 'picker', '', 0])).toEqual(page([ana]));
  expect(c.getQueryData(['financial-patient-search', '', 0])).toEqual(page([ana]));
  await act(async () => { await c.invalidateQueries({ queryKey: ['patients'] }); });
  expect(list).toHaveBeenCalledTimes(2);
});

it('staff: etiqueta por opción, homónimos por ID, páginas/refetch/Escape conservan selección; editar la invalida', async () => {
  const get = vi.spyOn(patientsApi, 'get');
  const homonym = { ...ada, id: 20, phone: '5550002', active: false };
  vi.spyOn(patientsApi, 'list').mockImplementation(async p => page(p?.page ? [ana] : [ada, homonym], p?.page ?? 0, 2));
  const label = vi.fn(); const changes = vi.fn(); const c = client();
  function Staff() {
    const [value, setValue] = useState<number | null>(null);
    return <><PatientPicker value={value} onChange={id => { changes(id); setValue(id); }} onSelectedLabel={label} /><output aria-label="ID staff">{value ?? ''}</output></>;
  }
  render(<QueryClientProvider client={c}><Staff /></QueryClientProvider>);
  const input = screen.getByRole('combobox'); fireEvent.focus(input);
  fireEvent.click(await screen.findByRole('option', { name: /Paciente #20.*5550002/ }));
  expect(changes).toHaveBeenLastCalledWith(20); expect(label).toHaveBeenLastCalledWith('Ada Prueba · Inactivo');
  expect(input).toHaveValue('Ada Prueba · Inactivo');
  fireEvent.focus(input);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cargar más pacientes' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Cargar más pacientes' }));
  await screen.findByRole('option', { name: /Ana/ });
  await act(async () => { await c.invalidateQueries({ queryKey: ['patients'] }); });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('Ada Prueba · Inactivo'); expect(screen.getByLabelText('ID staff')).toHaveTextContent('20');
  expect(get).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'otro' } });
  expect(changes).toHaveBeenLastCalledWith(null); expect(label).toHaveBeenLastCalledWith(null);
  expect(screen.getByLabelText('ID staff')).toBeEmptyDOMElement(); expect(input).toHaveValue('otro');
});

it('staff: ID externo desconocido usa fallback sin GET y no reutiliza etiqueta de otra identidad', async () => {
  const get = vi.spyOn(patientsApi, 'get'); const label = vi.fn(); const c = client();
  const view = render(<QueryClientProvider client={c}><PatientPicker value={10} onChange={vi.fn()} onSelectedLabel={label} /></QueryClientProvider>);
  expect(screen.getByRole('combobox')).toHaveValue('Paciente #10'); expect(label).toHaveBeenLastCalledWith('Paciente #10');
  view.rerender(<QueryClientProvider client={c}><PatientPicker value={20} onChange={vi.fn()} onSelectedLabel={label} /></QueryClientProvider>);
  expect(screen.getByRole('combobox')).toHaveValue('Paciente #20'); expect(label).toHaveBeenLastCalledWith('Paciente #20');
  expect(get).not.toHaveBeenCalled();
});

it('financial migrado sigue resolviendo por ID con la misma clave, incluso cerrado y disabled', async () => {
  const get = vi.spyOn(patientsApi, 'get').mockResolvedValue(ada); const list = vi.spyOn(patientsApi, 'list');
  const c = client(); render(<QueryClientProvider client={c}><FinancialPatientPicker value={10} onChange={vi.fn()} disabled /></QueryClientProvider>);
  await screen.findByDisplayValue('Ada Prueba'); expect(get).toHaveBeenCalledExactlyOnceWith(10);
  expect(c.getQueryData(['financial-patient', 10])).toEqual(ada); expect(list).not.toHaveBeenCalled();
});

it('staff: datos tardíos de sesión A no restauran selección/etiqueta al remontar B', async () => {
  let release!: (p: PageDto<PatientDto>) => void;
  vi.spyOn(patientsApi, 'list').mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(page([ana]));
  const get = vi.spyOn(patientsApi, 'get'); const labelA = vi.fn(), labelB = vi.fn(); const a = client(), b = client();
  const view = render(<QueryClientProvider key="a" client={a}><PatientPicker value={10} onChange={vi.fn()} onSelectedLabel={labelA} /></QueryClientProvider>);
  fireEvent.focus(screen.getByRole('combobox')); await waitFor(() => expect(release).toBeTypeOf('function'));
  a.clear(); view.rerender(<QueryClientProvider key="b" client={b}><PatientPicker value={null} onChange={vi.fn()} onSelectedLabel={labelB} /></QueryClientProvider>);
  await act(async () => release(page([ada])));
  expect(screen.getByRole('combobox')).toHaveValue(''); expect(labelB).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
});
