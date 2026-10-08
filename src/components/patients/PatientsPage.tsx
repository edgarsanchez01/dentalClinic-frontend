import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { compact } from '../../api/onboarding';
import { patientsApi, type PatientDto } from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import { Field, FormAlert } from '../auth/ui';

type ActiveFilter = 'all' | 'active' | 'inactive';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  birthDate: '',
  administrativeNotes: '',
};

/**
 * Listado administrativo de pacientes (RF-PA-01, matriz §7.4). OWNER y RECEPTIONIST gestionan y
 * crean; DENTIST solo lee; el PATIENT ve únicamente su propio registro (el backend lo filtra por
 * ownership). Toda fila a la que no se tenga acceso responde 404, nunca 403.
 */
export function PatientsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === 'OWNER' || role === 'RECEPTIONIST';
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['patients', { search, active }],
    queryFn: () =>
      patientsApi.list({ search, active: active === 'all' ? undefined : active === 'active' }),
  });

  const patients = data?.content ?? [];

  const handleCreated = (patient: PatientDto) => {
    setNotice(`Paciente ${patient.firstName} ${patient.lastName} creado.`);
    setError(null);
    setShowCreate(false);
    void queryClient.invalidateQueries({ queryKey: ['patients'] });
  };

  const handleError = (message: string) => {
    setNotice(null);
    setError(message);
  };

  return (
    <div className="mx-auto w-full max-w-[64rem] px-5 py-8 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Pacientes</h1>
          <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
            {role === 'PATIENT'
              ? 'Consulta tus datos registrados.'
              : 'Busca, registra y consulta los datos administrativos de los pacientes.'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            aria-expanded={showCreate}
            className="rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
          >
            {showCreate ? 'Cerrar' : 'Nuevo paciente'}
          </button>
        ) : null}
      </header>

      {notice ? (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}

      {canManage && showCreate ? (
        <CreatePatientForm onCreated={handleCreated} onError={handleError} />
      ) : null}

      {role === 'PATIENT' ? null : (
        <section className="mt-8 flex flex-wrap items-end gap-4">
          <div className="min-w-[16rem] flex-1">
            <Field
              id="patient-search"
              label="Buscar"
              required={false}
              value={search}
              onChange={setSearch}
            />
          </div>
          <div>
            <label
              htmlFor="active-filter"
              className="block text-[length:var(--text-body-sm)] font-medium text-ink"
            >
              Estado
            </label>
            <select
              id="active-filter"
              value={active}
              onChange={(event) => setActive(event.target.value as ActiveFilter)}
              className="mt-1.5 rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
        </section>
      )}

      {isLoading ? <p className="mt-6 text-ink-muted">Cargando…</p> : null}
      {isError ? <p className="mt-6 text-danger-ink">No se pudo cargar el listado.</p> : null}
      {!isLoading && !isError && patients.length === 0 ? (
        <p className="mt-6 text-ink-secondary">No hay pacientes que coincidan con la búsqueda.</p>
      ) : null}

      {patients.length > 0 ? (
        <ul className="mt-6 grid gap-2">
          {patients.map((patient) => (
            <PatientRow key={patient.id} patient={patient} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CreatePatientForm({
  onCreated,
  onError,
}: {
  onCreated: (patient: PatientDto) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      patientsApi.create(
        compact({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          birthDate: form.birthDate,
          administrativeNotes: form.administrativeNotes.trim(),
        }),
      ),
    onSuccess: (patient) => {
      setForm(EMPTY_FORM);
      onCreated(patient);
    },
    onError: (cause) =>
      onError(cause instanceof Error ? cause.message : 'No se pudo crear el paciente.'),
  });

  return (
    <form
      className="mt-6 grid gap-4 rounded-card bg-paper p-6 shadow-card ring-1 ring-hairline md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="md:col-span-2 text-[length:var(--text-h5)] text-ink">
        Alta administrativa (sin cuenta de acceso)
      </p>
      <Field id="c-firstName" label="Nombre" value={form.firstName} onChange={set('firstName')} />
      <Field id="c-lastName" label="Apellidos" value={form.lastName} onChange={set('lastName')} />
      <Field
        id="c-email"
        label="Email (opcional)"
        type="email"
        required={false}
        value={form.email}
        onChange={set('email')}
      />
      <Field
        id="c-phone"
        label="Teléfono (opcional)"
        required={false}
        value={form.phone}
        onChange={set('phone')}
      />
      <Field
        id="c-birthDate"
        label="Fecha de nacimiento (opcional)"
        type="date"
        required={false}
        value={form.birthDate}
        onChange={set('birthDate')}
      />
      <div className="md:col-span-2">
        <label
          htmlFor="administrativeNotes"
          className="block text-[length:var(--text-body-sm)] font-medium text-ink"
        >
          Notas administrativas (opcional)
        </label>
        <textarea
          id="administrativeNotes"
          value={form.administrativeNotes}
          onChange={(event) => set('administrativeNotes')(event.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 md:col-span-2"
      >
        {create.isPending ? 'Guardando…' : 'Crear paciente'}
      </button>
    </form>
  );
}

function PatientRow({ patient }: { patient: PatientDto }) {
  return (
    <li>
      <Link
        to={`/patients/${patient.id}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-paper p-4 ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="min-w-0">
          <p className="text-[length:var(--text-body-app)] font-medium text-ink">
            {patient.lastName}, {patient.firstName}
          </p>
          <p className="text-[length:var(--text-caption)] text-ink-muted">
            {patient.email ?? 'Sin email'} · {patient.phone ?? 'Sin teléfono'}
          </p>
        </div>
        <span
          className={`rounded-xs px-2 py-1 text-[length:var(--text-caption)] ${
            patient.active ? 'bg-success-subtle text-success-ink' : 'bg-danger-subtle text-danger-ink'
          }`}
        >
          {patient.active ? 'Activo' : 'Inactivo'}
        </span>
      </Link>
    </li>
  );
}