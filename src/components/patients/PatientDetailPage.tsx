import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  patientsApi,
  type ClinicalRecordDto,
  type PatientDto,
  type UpdatePatientInput,
} from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import { ApiError } from '../../api/http';
import { Field, FormAlert } from '../auth/ui';

/**
 * Detalle del paciente. La informacion administrativa la gestionan OWNER/RECEPTIONIST; el
 * expediente clinico lo lee OWNER y lo escribe DENTIST (matriz §7.4). El PATIENT solo ve su
 * propia ficha, y el backend responde 404 ante cualquier ficha ajena.
 */
export function PatientDetailPage() {
  const { id } = useParams();
  const patientId = Number(id);
  const role = useAuthStore((state) => state.user?.role);

  const canManage = role === 'OWNER' || role === 'RECEPTIONIST';
  const canReadClinical = role === 'OWNER' || role === 'DENTIST';
  const canWriteClinical = role === 'DENTIST';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientsApi.get(patientId),
    enabled: Number.isFinite(patientId),
  });

  if (!Number.isFinite(patientId)) {
    return <p className="px-5 py-8 text-danger-ink">Paciente inválido.</p>;
  }

  return (
    <div className="mx-auto w-full max-w-[64rem] px-5 py-8 md:px-8">
      <Link
        to="/patients"
        className="text-[length:var(--text-body-sm)] text-ink-secondary underline underline-offset-2"
      >
        ← Volver al listado
      </Link>

      {isLoading ? <p className="mt-6 text-ink-muted">Cargando…</p> : null}
      {isError ? (
        <p className="mt-6 text-danger-ink">
          {error instanceof ApiError && error.status === 404
            ? 'No se encontró el paciente.'
            : 'No se pudo cargar el paciente.'}
        </p>
      ) : null}

      {data ? (
        <>
          <header className="mt-4">
            <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">
              {data.lastName}, {data.firstName}
            </h1>
            <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
              {data.active ? 'Paciente activo' : 'Paciente inactivo'}
              {data.userId ? ' · Con cuenta de acceso' : ' · Sin cuenta de acceso'}
            </p>
          </header>

          {canManage ? (
            <AdminPatientForm key={data.id} patient={data} />
          ) : (
            <AdminPatientSummary patient={data} />
          )}

          {canReadClinical ? (
            <ClinicalSection patientId={patientId} editable={canWriteClinical} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AdminPatientSummary({ patient }: { patient: PatientDto }) {
  return (
    <section className="mt-8 rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Datos administrativos</h2>
      <dl className="mt-4 grid gap-3 md:grid-cols-2">
        <Item label="Email" value={patient.email} />
        <Item label="Teléfono" value={patient.phone} />
        <Item label="Fecha de nacimiento" value={patient.birthDate} />
        <Item label="Notas administrativas" value={patient.administrativeNotes} />
      </dl>
    </section>
  );
}

function Item({ label, value }: { label: string; value?: string | undefined }) {
  return (
    <div>
      <dt className="text-[length:var(--text-caption)] uppercase tracking-[0.05em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[length:var(--text-body-app)] text-ink">{value ?? '—'}</dd>
    </div>
  );
}

function AdminPatientForm({ patient }: { patient: PatientDto }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: patient.firstName,
    lastName: patient.lastName,
    email: patient.email ?? '',
    phone: patient.phone ?? '',
    birthDate: patient.birthDate ?? '',
    administrativeNotes: patient.administrativeNotes ?? '',
    active: patient.active,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setNotice('Datos actualizados.');
      setError(null);
      queryClient.setQueryData(['patient', patient.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    },
  });

  return (
    <section className="mt-8 rounded-card bg-paper p-6 shadow-card ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Datos administrativos</h2>
      <form
        className="mt-4 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate();
        }}
      >
        {notice ? (
          <div className="md:col-span-2">
            <FormAlert tone="success">{notice}</FormAlert>
          </div>
        ) : null}
        {error ? (
          <div className="md:col-span-2">
            <FormAlert>{error}</FormAlert>
          </div>
        ) : null}
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
        <Field
          id="birthDate"
          label="Fecha de nacimiento (opcional)"
          type="date"
          required={false}
          value={form.birthDate}
          onChange={(value) => setForm((prev) => ({ ...prev, birthDate: value }))}
        />
        <label className="flex items-center gap-2 self-end text-[length:var(--text-body-app)] text-ink">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
            className="size-4 rounded-xs"
          />
          Paciente activo
        </label>
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
            onChange={(event) =>
              setForm((prev) => ({ ...prev, administrativeNotes: event.target.value }))
            }
            rows={2}
            className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <button
          type="submit"
          disabled={update.isPending}
          className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 md:col-span-2"
        >
          {update.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </section>
  );
}

function ClinicalSection({ patientId, editable }: { patientId: number; editable: boolean }) {
  return (
    <section className="mt-8 grid gap-4">
      <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
        <p className="text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-ink-muted">
          Dato de salud protegido
        </p>
        <h2 className="mt-1 text-[length:var(--text-h5)] text-ink">Expediente clínico</h2>
        <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
          {editable
            ? 'Los datos clínicos son sensibles. Las notas son inmutables una vez registradas.'
            : 'Solo lectura. El expediente clínico no se modifica desde este perfil.'}
        </p>
      </div>
      <ClinicalRecordCard patientId={patientId} editable={editable} />
      <ClinicalNotesCard patientId={patientId} editable={editable} />
    </section>
  );
}

function ClinicalRecordCard({ patientId, editable }: { patientId: number; editable: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clinical-record', patientId],
    queryFn: () => patientsApi.getClinicalRecord(patientId),
  });

  if (isLoading) return <p className="text-ink-muted">Cargando expediente…</p>;
  if (isError) return <p className="text-danger-ink">No se pudo cargar el expediente.</p>;

  return (
    <ClinicalRecordForm
      patientId={patientId}
      editable={editable}
      record={
        data ?? {
          patientId,
          medicalBackground: '',
          allergies: '',
          clinicalHistory: '',
          generalObservations: '',
        }
      }
    />
  );
}

function ClinicalRecordForm({
  patientId,
  editable,
  record,
}: {
  patientId: number;
  editable: boolean;
  record: ClinicalRecordDto;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(record));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => patientsApi.saveClinicalRecord(patientId, draft),
    onSuccess: (saved) => {
      setNotice('Expediente guardado.');
      setError(null);
      queryClient.setQueryData(['clinical-record', patientId], saved);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el expediente.');
    },
  });

  const fields: Array<{ key: keyof typeof draft; label: string }> = [
    { key: 'medicalBackground', label: 'Antecedentes médicos' },
    { key: 'allergies', label: 'Alergias' },
    { key: 'clinicalHistory', label: 'Historia clínica' },
    { key: 'generalObservations', label: 'Observaciones generales' },
  ];

  return (
    <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Datos del expediente</h3>
      {notice ? (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {fields.map((field) =>
          editable ? (
            <div key={field.key}>
              <label
                htmlFor={`clinical-${field.key}`}
                className="block text-[length:var(--text-body-sm)] font-medium text-ink"
              >
                {field.label}
              </label>
              <textarea
                id={`clinical-${field.key}`}
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                rows={2}
                className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          ) : (
            <div key={field.key}>
              <p className="text-[length:var(--text-caption)] uppercase tracking-[0.05em] text-ink-muted">
                {field.label}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[length:var(--text-body-app)] text-ink">
                {draft[field.key] || '—'}
              </p>
            </div>
          ),
        )}
      </div>
      {editable ? (
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-4 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {save.isPending ? 'Guardando…' : 'Guardar expediente'}
        </button>
      ) : null}
    </div>
  );
}

function ClinicalNotesCard({ patientId, editable }: { patientId: number; editable: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clinical-notes', patientId],
    queryFn: () => patientsApi.listClinicalNotes(patientId),
  });
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addNote = useMutation({
    mutationFn: () => patientsApi.addClinicalNote(patientId, content.trim()),
    onSuccess: () => {
      setContent('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['clinical-notes', patientId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'No se pudo añadir la nota.'),
  });

  return (
    <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Notas clínicas</h3>
      <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
        Append-only: no se editan ni se eliminan.
      </p>
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}

      {isLoading ? <p className="mt-3 text-ink-muted">Cargando notas…</p> : null}
      {isError ? <p className="mt-3 text-danger-ink">No se pudieron cargar las notas.</p> : null}
      {data && data.length === 0 ? (
        <p className="mt-3 text-ink-secondary">Todavía no hay notas clínicas.</p>
      ) : null}
      {data && data.length > 0 ? (
        <ol className="mt-4 grid gap-3">
          {data.map((note) => (
            <li key={note.id} className="rounded-control bg-input-fill p-3">
              <p className="whitespace-pre-wrap text-[length:var(--text-body-app)] text-ink">
                {note.content}
              </p>
              <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">
                {note.authorName} · {new Date(note.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {editable ? (
        <div className="mt-4">
          <label
            htmlFor="new-note"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Nueva nota clínica
          </label>
          <textarea
            id="new-note"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="button"
            onClick={() => addNote.mutate()}
            disabled={addNote.isPending || content.trim() === ''}
            className="mt-3 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {addNote.isPending ? 'Añadiendo…' : 'Añadir nota'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toDraft(record: ClinicalRecordDto) {
  return {
    medicalBackground: record.medicalBackground ?? '',
    allergies: record.allergies ?? '',
    clinicalHistory: record.clinicalHistory ?? '',
    generalObservations: record.generalObservations ?? '',
  };
}