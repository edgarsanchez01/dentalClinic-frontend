import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { compact } from '../../api/onboarding';
import {
  patientsApi,
  type CreatePatientInput,
  type PatientDto,
  type UpdatePatientInput,
} from '../../api/patients';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { apiErrorMessage } from '../appointments/appointmentUi';
import { Field, FormAlert } from '../auth/ui';
import { FinancialAccessLink } from '../financial/FinancialAccessLink';
import { ReceptionEmptyState, ReceptionPage, ReceptionPageHeader } from '../reception/ReceptionUI';
import { OdontogramSection } from '../odontogram/OdontogramSection';
import { PatientFacts } from './PatientFacts';

import './reception-patients.css';

/**
 * UX-04E — experiencia de Recepción para el módulo de Pacientes.
 *
 * Listado y administración compartidos por OWNER y RECEPTIONIST; DENTIST
 * consulta el listado sin alta. La composición clínica se mantiene independiente.
 * Se reutiliza `patientsApi` sin campos ni cálculos nuevos: el backend sigue
 * siendo la única fuente de datos y permisos.
 */

type ActiveFilter = 'all' | 'active' | 'inactive';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function canManagePatients() {
  const role = useAuthStore.getState().user?.role;
  return role === 'OWNER' || role === 'RECEPTIONIST';
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  birthDate: '',
  administrativeNotes: '',
};

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha ISO `YYYY-MM-DD` en texto local sin desplazamiento de zona horaria. */
function formatBirthDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${Number(day)} ${MONTHS_SHORT[monthIndex]} ${year}`;
}

/* ============================================================================
 * Listado
 * ========================================================================== */

export function ReceptionPatientsWorkspace() {
  const owner = useAuthStore((state) => state.user?.role === 'OWNER');
  const canCreate = useAuthStore((state) => state.user?.role === 'RECEPTIONIST' || state.user?.role === 'OWNER');
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const appliedSearch = useRef('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(0);
  const [createRequested, setShowCreate] = useStateFromUrl();
  const showCreate = canCreate && createRequested;
  const [created, setCreated] = useState<PatientDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // OWNER antes buscaba sin debounce: no dejar un temporizador inicial que
    // pueda devolver a página 0 después de pulsar Siguientes. Defaults intactos.
    if (owner && appliedSearch.current === searchInput) return;
    const handle = window.setTimeout(() => {
      appliedSearch.current = searchInput;
      setSearch(searchInput);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput, owner]);

  const { data, isPending, isError, error: queryError, isFetching, refetch } = useQuery({
    queryKey: ['patients', { search, active, page }],
    queryFn: () =>
      patientsApi.list({
        search,
        active: active === 'all' ? undefined : active === 'active',
        page,
        size: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const patients = data?.content ?? [];
  const totalPages = data?.totalPages ?? 0;
  const hasFilters = search.trim() !== '' || active !== 'all';

  const clearFilters = () => {
    appliedSearch.current = '';
    setSearchInput('');
    setSearch('');
    setActive('all');
    setPage(0);
  };

  const handleCreated = (patient: PatientDto) => {
    appliedSearch.current = '';
    setCreated(patient);
    setError(null);
    setShowCreate(false);
    setSearchInput('');
    setSearch('');
    setPage(0);
    void queryClient.invalidateQueries({ queryKey: ['patients'] });
  };

  // El alta ocupa la página entera: se oculta el listado mientras se registra,
  // conservando búsqueda, filtro y página en el estado del componente para que
  // cancelar devuelva exactamente al punto de partida.
  if (showCreate) {
    return (
      <ReceptionPage>
        <Link to="/patients" className="reception-link reception-patients-back">
          ← Volver a pacientes
        </Link>
        <ReceptionPageHeader
          title="Nuevo paciente"
          intro="Registra los datos administrativos de una persona sin crearle una cuenta de acceso."
        />
        {error ? <FormAlert>{error}</FormAlert> : null}
        <div id="reception-patient-create">
          <ReceptionCreatePatientForm
            onCreated={handleCreated}
            onError={(message) => {
              setCreated(null);
              setError(message);
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      </ReceptionPage>
    );
  }

  return (
    <div className={`reception-page${owner ? ' owner-patients-list' : ''}`}>
      <ReceptionPageHeader
        title="Pacientes"
        intro={canCreate
          ? 'Busca, registra y consulta los datos administrativos de los pacientes.'
          : 'Busca y consulta los datos administrativos de los pacientes.'}
        action={canCreate ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="reception-button"
          >
            Nuevo paciente
          </button>
        ) : undefined}
      />

      {canCreate && created ? (
        <FormAlert tone="success">
          <span>
            Paciente {created.firstName} {created.lastName} creado.
          </span>{' '}
          <Link to={`/patients/${created.id}`}>Ver ficha de {created.firstName}</Link>
        </FormAlert>
      ) : null}
      {error ? <FormAlert>{error}</FormAlert> : null}

      <section className="reception-filters" aria-label="Búsqueda y filtros">
        <div className="reception-filters-fields">
          <div className="reception-patients-search">
            <Field
              id="patient-search"
              label="Buscar"
              required={false}
              value={searchInput}
              onChange={setSearchInput}
              autoComplete="off"
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
              onChange={(event) => {
                setActive(event.target.value as ActiveFilter);
                setPage(0);
              }}
              className="mt-1.5 min-h-11 rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
          <div className="reception-patients-aside">
            <span className="reception-patients-divider" aria-hidden="true" />
            <p className="reception-patients-count" role="status">
              {data && !isError ? (
                <>
                  {data.totalElements} {data.totalElements === 1 ? 'paciente' : 'pacientes'}
                  {isFetching && !isPending ? (
                    <span className="reception-patients-updating"> · Actualizando…</span>
                  ) : null}
                </>
              ) : '—'}
            </p>
            <button
              type="button"
              className="reception-button reception-button-secondary reception-patients-clear"
              disabled={!hasFilters}
              onClick={clearFilters}
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>

      {isPending ? (
        <>
          <div className="reception-patients-skeleton" aria-hidden="true">
            <div className="reception-patients-skeleton-row" />
            <div className="reception-patients-skeleton-row" />
            <div className="reception-patients-skeleton-row" />
          </div>
          <p role="status" className="reception-readonly-note">
            Cargando pacientes…
          </p>
        </>
      ) : null}

      {isError ? (
        <div role="alert" className="reception-empty">
          <p>{apiErrorMessage(queryError, 'No se pudo cargar el listado de pacientes.')}</p>
          <button type="button" className="reception-link" onClick={() => void refetch()}>
            Reintentar el listado
          </button>
        </div>
      ) : null}

      {!isPending && !isError && patients.length === 0 ? (
        <ReceptionEmptyState
          title="No hay pacientes que coincidan con la búsqueda."
          action={
            hasFilters ? (
              <button type="button" className="reception-link" onClick={clearFilters}>
                Limpiar búsqueda y filtros
              </button>
            ) : undefined
          }
        >
          Prueba con otro nombre, correo o teléfono, o cambia el filtro de estado.
        </ReceptionEmptyState>
      ) : null}

      {patients.length > 0 ? (
        <ul className="reception-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {patients.map((patient) => (
            <PatientListRow key={patient.id} patient={patient} />
          ))}
        </ul>
      ) : null}

      {data && !isError ? (
        <div className="reception-pagination">
          {totalPages > 1 ? (
            <>
              <span>Página {page + 1} de {totalPages}</span>
              <button
                type="button"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                className="reception-button reception-button-secondary"
              >
                Anteriores
              </button>
              <button
                type="button"
                disabled={page + 1 >= totalPages || isFetching}
                onClick={() => setPage((value) => value + 1)}
                className="reception-button reception-button-secondary"
              >
                Siguientes
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** La URL conserva `?create=1` para que el alta sea enlazable y sobreviva a recargas. */
function useStateFromUrl(): [boolean, (next: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const show = params.get('create') === '1';
  const set = (next: boolean) =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (next) updated.set('create', '1');
      else updated.delete('create');
      return updated;
    });
  return [show, set];
}

/**
 * Fila del listado. El nombre se muestra en orden natural (`Nombre Apellidos`) porque es como
 * recepción pregunta y llama al paciente; el orden de almacenamiento no cambia. La fecha de
 * nacimiento se imprime siempre —«No registrada» cuando el contrato no la trae— para que dos
 * personas con el mismo nombre puedan distinguirse sin inventar identificadores.
 */
function PatientListRow({ patient }: { patient: PatientDto }) {
  const birthDate = patient.birthDate ? formatBirthDate(patient.birthDate) : null;
  const contact = [patient.email, patient.phone].filter((value): value is string => Boolean(value));
  return (
    <li className="reception-patients-item">
      <Link to={`/patients/${patient.id}`} className="reception-list-row reception-patients-row">
        <div className="reception-list-row-main">
          <p className="reception-list-row-title">
            {patient.firstName} {patient.lastName}
          </p>
          <PatientFacts
            variant="inline"
            facts={[
              { label: 'Contacto', value: contact.join(' · ') || 'No registrado' },
              { label: 'Nacimiento', value: birthDate ?? 'No registrada' },
            ]}
          />
        </div>
        <div className="reception-list-row-side">
          <span className={`reception-chip ${patient.active ? 'reception-chip-activo' : 'reception-chip-inactivo'}`}>
            {patient.active ? 'Activo' : 'Inactivo'}
          </span>
          <span className="reception-link">Ver ficha</span>
        </div>
      </Link>
    </li>
  );
}

/* ============================================================================
 * Alta de paciente
 * ========================================================================== */

function ReceptionCreatePatientForm({
  onCreated,
  onError,
  onCancel,
}: {
  onCreated: (patient: PatientDto) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const nativeValidation = useAuthStore(state => state.user?.role === 'OWNER');
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('#c-firstName')?.focus();
    formRef.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  const create = useMutation({
    mutationFn: (input: CreatePatientInput) => {
      // Revalidar callbacks obtenidos antes de un cambio de rol o sesión.
      if (!canManagePatients()) {
        throw new Error('No tienes permiso para registrar pacientes.');
      }
      return patientsApi.create(input);
    },
    onSuccess: (patient) => {
      setForm(EMPTY_FORM);
      setErrors({});
      onCreated(patient);
    },
    onError: (cause) =>
      onError(cause instanceof Error ? cause.message : 'No se pudo crear el paciente.'),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (create.isPending || !canManagePatients()) return;
    const nextErrors: { firstName?: string; lastName?: string } = {};
    if (form.firstName.trim() === '') nextErrors.firstName = 'Indica el nombre del paciente.';
    if (form.lastName.trim() === '') nextErrors.lastName = 'Indica los apellidos del paciente.';
    setErrors(nextErrors);
    if (nextErrors.firstName) {
      formRef.current?.querySelector<HTMLInputElement>('#c-firstName')?.focus();
      return;
    }
    if (nextErrors.lastName) {
      formRef.current?.querySelector<HTMLInputElement>('#c-lastName')?.focus();
      return;
    }
    create.mutate(
      compact({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        birthDate: form.birthDate,
        administrativeNotes: form.administrativeNotes.trim(),
      }),
    );
  };

  return (
    <form
      ref={formRef}
      noValidate={!nativeValidation}
      aria-label="Alta administrativa de paciente"
      className="reception-card reception-patients-form"
      onSubmit={submit}
    >
      <h2>Datos del paciente</h2>

      <fieldset className="reception-patients-fieldset">
        <legend>Identificación</legend>
        <div className="reception-patients-fieldset-grid">
          <Field
            id="c-firstName"
            label="Nombre"
            value={form.firstName}
            onChange={set('firstName')}
            {...(errors.firstName ? { error: errors.firstName } : {})}
            autoComplete="off"
          />
          <Field
            id="c-lastName"
            label="Apellidos"
            value={form.lastName}
            onChange={set('lastName')}
            {...(errors.lastName ? { error: errors.lastName } : {})}
            autoComplete="off"
          />
          <Field
            id="c-birthDate"
            label="Fecha de nacimiento (opcional)"
            type="date"
            required={false}
            value={form.birthDate}
            onChange={set('birthDate')}
          />
        </div>
      </fieldset>

      <fieldset className="reception-patients-fieldset">
        <legend>Contacto</legend>
        <div className="reception-patients-fieldset-grid">
          <Field
            id="c-email"
            label="Email (opcional)"
            type="email"
            required={false}
            value={form.email}
            onChange={set('email')}
            autoComplete="off"
          />
          <Field
            id="c-phone"
            label="Teléfono (opcional)"
            required={false}
            value={form.phone}
            onChange={set('phone')}
            autoComplete="off"
          />
        </div>
      </fieldset>

      <fieldset className="reception-patients-fieldset">
        <legend>Notas administrativas</legend>
        <div>
          <label
            htmlFor="c-administrativeNotes"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Notas administrativas (opcional)
          </label>
          <textarea
            id="c-administrativeNotes"
            value={form.administrativeNotes}
            onChange={(event) => set('administrativeNotes')(event.target.value)}
            rows={2}
            className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </fieldset>

      <div className="reception-patients-actions">
        <button type="submit" disabled={create.isPending} className="reception-button">
          {create.isPending ? 'Guardando…' : 'Crear paciente'}
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={onCancel}
          className="reception-button reception-button-secondary"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ============================================================================
 * Ficha administrativa
 * ========================================================================== */

export function ReceptionPatientRecord({ patientId, renderContent }: {
  patientId: number;
  /** Reutiliza ficha/editor sin incorporar el resumen dental reducido de recepción. */
  renderContent?: (administration: ReactNode) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientsApi.get(patientId),
    enabled: Number.isFinite(patientId),
  });
  // Consultar es el estado por defecto; editar es una decisión explícita de recepción.
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const closeEditing = (updated?: PatientDto) => {
    if (updated) {
      queryClient.setQueryData(['patient', patientId], updated);
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      setNotice('Datos actualizados.');
    }
    setEditing(false);
  };

  const administration = data ? <>
    {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
    {editing ? <ReceptionAdminPatientForm patient={data} onCancel={() => setEditing(false)} onSaved={closeEditing} /> : <ReceptionPatientSummary patient={data} />}
  </> : null;

  if (!Number.isFinite(patientId)) {
    return (
      <ReceptionPage>
        <p role="alert" className="reception-empty">
          Paciente inválido.
        </p>
      </ReceptionPage>
    );
  }

  return (
    <ReceptionPage>
      <Link to="/patients" className="reception-link reception-patients-back">
        ← Volver al listado
      </Link>

      {isPending ? (
        <p role="status" className="reception-readonly-note">
          Cargando la ficha del paciente…
        </p>
      ) : null}

      {isError ? (
        <div role="alert" className="reception-empty">
          <p>
            {error instanceof ApiError && error.status === 404
              ? 'No se encontró el paciente.'
              : 'No se pudo cargar el paciente.'}
          </p>
          <button type="button" className="reception-link" onClick={() => void refetch()}>
            Reintentar la ficha
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <ReceptionPageHeader
            title={`${data.firstName} ${data.lastName}`}
            intro={renderContent ? 'Datos administrativos y expediente del paciente.' : 'Ficha administrativa del paciente.'}
            action={
              <span className="reception-patients-identity">
                <span className={`reception-chip ${data.active ? 'reception-chip-activo' : 'reception-chip-inactivo'}`}>
                  {data.active ? 'Activo' : 'Inactivo'}
                </span>
                <span className="reception-patients-count">
                  {data.userId ? 'Con cuenta de acceso' : 'Sin cuenta de acceso'}
                </span>
                {editing || renderContent ? null : (
                  <button
                    type="button"
                    className="reception-button reception-patients-edit"
                    onClick={() => {
                      setNotice(null);
                      setEditing(true);
                    }}
                  >
                    Editar datos
                  </button>
                )}
              </span>
            }
          />

          {renderContent ? renderContent(<>
            {!editing ? <button type="button" className="reception-button reception-patients-edit" onClick={() => { setNotice(null); setEditing(true); }}>Editar datos</button> : null}
            {administration}
            <FinancialAccessLink patientId={patientId} />
          </>) : <>
          {administration}

          <OdontogramSection key={patientId} patientId={patientId} />
          <section className="reception-patients-related" aria-label="Acciones relacionadas">
            <h2>Acciones relacionadas</h2>
            <FinancialAccessLink patientId={patientId} />
          </section>
          </>}
        </>
      ) : null}
    </ReceptionPage>
  );
}

/** Modo consulta: los datos administrativos como texto legible, sin formulario permanente. */
function ReceptionPatientSummary({ patient }: { patient: PatientDto }) {
  const birthDate = patient.birthDate ? formatBirthDate(patient.birthDate) : null;
  const groups = [
    {
      title: 'Identificación',
      rows: [
        { label: 'Nombre', value: patient.firstName },
        { label: 'Apellidos', value: patient.lastName },
        { label: 'Fecha de nacimiento', value: birthDate ?? 'No registrada' },
      ],
    },
    {
      title: 'Contacto',
      rows: [
        { label: 'Correo electrónico', value: patient.email || 'No registrado' },
        { label: 'Teléfono', value: patient.phone || 'No registrado' },
      ],
    },
    {
      title: 'Administración',
      rows: [
        { label: 'Estado', value: patient.active ? 'Activo' : 'Inactivo' },
        {
          label: 'Cuenta de acceso',
          value: patient.userId ? 'Con cuenta de acceso' : 'Sin cuenta de acceso',
        },
      ],
    },
  ];

  return (
    <div className="reception-patients-summary">
      {groups.map((group) => (
        <section key={group.title} className="reception-patients-summary-group">
          <h2>{group.title}</h2>
          <PatientFacts
            facts={group.rows.map((row) => ({
              label: row.label,
              value: row.value,
              empty: row.value.startsWith('No registrad'),
            }))}
          />
        </section>
      ))}

      <section className="reception-patients-summary-group">
        <h2>Notas administrativas</h2>
        {patient.administrativeNotes ? (
          <p className="reception-patients-summary-note">{patient.administrativeNotes}</p>
        ) : (
          <p className="reception-patients-empty-value">No registradas</p>
        )}
      </section>
    </div>
  );
}

/**
 * Formulario de edición administrativa compartido por Recepción y OWNER.
 * Mismos campos, endpoints y mensajes; conserva validación nativa de OWNER.
 * La edición se abre solo bajo demanda y `Cancelar edición` descarta
 * el borrador devolviendo a la vista de consulta.
 */
function ReceptionAdminPatientForm({
  patient,
  onCancel,
  onSaved,
}: {
  patient: PatientDto;
  onCancel: () => void;
  onSaved: (updated: PatientDto) => void;
}) {
  const nativeValidation = useAuthStore(state => state.user?.role === 'OWNER');
  const [form, setForm] = useState({
    firstName: patient.firstName,
    lastName: patient.lastName,
    email: patient.email ?? '',
    phone: patient.phone ?? '',
    birthDate: patient.birthDate ?? '',
    administrativeNotes: patient.administrativeNotes ?? '',
    active: patient.active,
  });
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const update = useMutation({
    mutationFn: () => {
      const payload: UpdatePatientInput = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() === '' ? null : form.email.trim(),
        phone: form.phone.trim() === '' ? null : form.phone.trim(),
        birthDate: form.birthDate === '' ? null : form.birthDate,
        administrativeNotes:
          form.administrativeNotes.trim() === '' ? null : form.administrativeNotes.trim(),
        active: form.active,
      };
      return patientsApi.update(patient.id, payload);
    },
    onSuccess: (updated) => {
      setError(null);
      onSaved(updated);
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  return (
    <section className="reception-card reception-patients-form" aria-label="Datos administrativos">
      <h2>Editar datos administrativos</h2>

      {error ? <FormAlert>{error}</FormAlert> : null}

      <form
        noValidate={!nativeValidation}
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current || update.isPending) return;
          submitting.current = true;
          update.mutate();
        }}
      >
        <fieldset className="reception-patients-fieldset">
          <legend>Identificación</legend>
          <div className="reception-patients-fieldset-grid">
            <Field
              id="firstName"
              label="Nombre"
              value={form.firstName}
              onChange={(value) => setForm((prev) => ({ ...prev, firstName: value }))}
            />
            <Field
              id="lastName"
              label="Apellidos"
              value={form.lastName}
              onChange={(value) => setForm((prev) => ({ ...prev, lastName: value }))}
            />
            <Field
              id="birthDate"
              label="Fecha de nacimiento (opcional)"
              type="date"
              required={false}
              value={form.birthDate}
              onChange={(value) => setForm((prev) => ({ ...prev, birthDate: value }))}
            />
          </div>
        </fieldset>

        <fieldset className="reception-patients-fieldset">
          <legend>Contacto</legend>
          <div className="reception-patients-fieldset-grid">
            <Field
              id="email"
              label="Email (opcional)"
              type="email"
              required={false}
              value={form.email}
              onChange={(value) => setForm((prev) => ({ ...prev, email: value }))}
            />
            <Field
              id="phone"
              label="Teléfono (opcional)"
              required={false}
              value={form.phone}
              onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
            />
          </div>
        </fieldset>

        <fieldset className="reception-patients-fieldset">
          <legend>Vigencia y notas</legend>
          <label className="flex items-center gap-2 text-[length:var(--text-body-app)] text-ink">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
              className="size-4 rounded-xs"
            />
            Paciente activo
          </label>
          <div>
            <label
              htmlFor="administrativeNotes"
              className="block text-[length:var(--text-body-sm)] font-medium text-ink"
            >
              Notas administrativas (opcional)
            </label>
            <textarea
              id="administrativeNotes"
              value={form.administrativeNotes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, administrativeNotes: event.target.value }))
              }
              rows={2}
              className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </fieldset>

        <div className="reception-patients-actions">
          <button type="submit" disabled={update.isPending} className="reception-button">
            {update.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={onCancel}
            className="reception-button reception-button-secondary"
          >
            Cancelar edición
          </button>
        </div>
      </form>
    </section>
  );
}
