import { useEffect, useState } from 'react';
import type { PatientDto } from '../../api/patients';
import { FormAlert } from '../auth/ui';
import { SearchCombobox } from '../ui/SearchCombobox';
import { usePatientPickerSearch, usePatientPickerSelection } from './patientPickerQueries';
import { patientLabel } from './patientLabel';

// Exact existing retry recipe, now owned locally rather than importing financial permissions.
const retryButton = 'min-h-11 rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

type PatientOption = Pick<PatientDto, 'id' | 'firstName' | 'lastName' | 'phone' | 'email' | 'active'>;

/** Identity policy belongs to the task: financial detail vs an already received staff option. */
export function PatientCombobox({ value, onChange, disabled = false, required = false, label = 'Paciente',
  resolution = 'by-id', cacheProfile = 'r23', onSelectedLabel }: {
  value: number | null; onChange: (id: number | null, option: PatientOption | null) => void;
  disabled?: boolean; required?: boolean; label?: string;
  resolution?: 'by-id' | 'selected-option';
  /** Internal compatibility recipe, fixed by each wrapper, not a role or endpoint policy. */
  cacheProfile?: 'r23' | 'shared';
  onSelectedLabel?: ((label: string | null) => void) | undefined;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PatientOption | null>(null);
  const query = usePatientPickerSearch(search, open && !disabled, cacheProfile);
  const byId = resolution === 'by-id';
  const selected = usePatientPickerSelection(byId ? value : null);
  const entries = [...new Map((query.data?.pages.flatMap(page => page.content) ?? []).map(patient => [patient.id, patient])).values()];
  const option = picked?.id === value ? picked : entries.find(patient => patient.id === value);
  const staffLabel = value === null ? null : option
    ? `${option.firstName} ${option.lastName}${option.active ? '' : ' · Inactivo'}` : `Paciente #${value}`;
  const naturalName = byId
    ? selected.data ? `${selected.data.firstName} ${selected.data.lastName}` : value !== null ? `Paciente #${value}` : ''
    : staffLabel ?? '';
  useEffect(() => { onSelectedLabel?.(staffLabel); }, [staffLabel, onSelectedLabel]);
  function pick(id: string) {
    const patient = entries.find(entry => String(entry.id) === id);
    if (!patient) return;
    const { id: patientId, firstName, lastName, phone, email, active } = patient;
    const next = { id: patientId, firstName, lastName, active, ...(phone !== undefined ? { phone } : {}), ...(email !== undefined ? { email } : {}) };
    setPicked(next); onChange(patientId, next); setSearch('');
  }
  function clear() { onChange(null, null); setPicked(null); setSearch(''); }
  function change(text: string) { if (value !== null) onChange(null, null); setPicked(null); setSearch(text); }
  return <SearchCombobox name="patientId" label={`${label}${required ? ' (obligatorio)' : ''}`}
    listLabel="Resultados de pacientes" placeholder="Nombre, apellidos, correo o teléfono"
    inputValue={value !== null ? naturalName : search} selectedId={value === null ? null : String(value)}
    options={entries.map(patient => ({ id: String(patient.id), label: `${patient.firstName} ${patient.lastName}`,
      description: `Paciente #${patient.id}${patient.active ? '' : ' · Inactivo'}${patient.phone ? ` · ${patient.phone}` : patient.email ? ` · ${patient.email}` : ''}` }))}
    open={open} onOpenChange={setOpen} onInputChange={change} onSelect={pick}
    onClear={clear} clearText="Limpiar"
    clearLabel={value !== null ? 'Quitar selección' : 'Limpiar búsqueda'} disabled={disabled} required={required}
    status={query.isError ? 'error' : query.isSuccess ? 'ready' : query.isFetching ? 'loading' : 'idle'}
    refreshing={query.isFetching} loadingMessage="Buscando pacientes…"
    emptyMessage={search.trim().length > 0 ? 'No hay pacientes que coincidan con la búsqueda. Prueba otro nombre, correo o teléfono.' : 'No hay pacientes disponibles.'}
    errorFeedback={<div><FormAlert>No se pudo consultar la búsqueda de pacientes.</FormAlert>
      <button type="button" className={retryButton} onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>Reintentar búsqueda</button></div>}
    {...(query.hasNextPage ? { more: { label: 'Cargar más pacientes', disabled: query.isFetching, onLoad: () => { void query.fetchNextPage(); } } } : {})}
    selectionFeedback={byId ? <>
      {value !== null ? <div className="ce-patient-selected" aria-label="Paciente seleccionado">
        <span className="ce-patient-selected-label">Paciente seleccionado</span>
        <span className="ce-patient-selected-value">{patientLabel(selected.data, value)}</span>
      </div> : null}
      {value !== null && selected.isPending ? <p role="status" className="text-ink-muted">Verificando paciente seleccionado…</p> : null}
      {value !== null && selected.isError ? <div><FormAlert>No se pudo verificar el paciente seleccionado.</FormAlert>
        <button type="button" className={retryButton} onClick={() => void selected.refetch()}>Reintentar verificación</button></div> : null}
    </> : null}
    hintVisible={required && value === null}
    hint={`${byId ? required ? 'Selecciona un paciente verificado por la API para continuar.' : 'Filtro opcional. Selecciona un resultado y aplica los filtros.' : 'Selecciona un resultado para fijar el paciente.'} Usa flechas para recorrer y Enter para seleccionar; Escape para cerrar.`} />;
}
