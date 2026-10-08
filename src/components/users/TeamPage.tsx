import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { compact } from '../../api/onboarding';
import { usersApi, type StaffUserDto } from '../../api/users';
import { Field, FormAlert } from '../auth/ui';

/**
 * Gestión del equipo (matriz §7.4 fila "Users": solo OWNER). Toda alta nace pendiente de
 * activación; el sistema no envía email (F8), así que aquí solo se gestiona la invitación.
 */
export function TeamPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const [mode, setMode] = useState<'dentist' | 'receptionist'>('dentist');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dentist, setDentist] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    specialty: '',
  });
  const [receptionistEmail, setReceptionistEmail] = useState('');

  const afterCreate = (message: string) => {
    setNotice(message);
    setError(null);
    setDentist({ email: '', firstName: '', lastName: '', phone: '', specialty: '' });
    setReceptionistEmail('');
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const createDentist = useMutation({
    mutationFn: () =>
      usersApi.createDentist(
        compact({
          email: dentist.email.trim(),
          firstName: dentist.firstName.trim(),
          lastName: dentist.lastName.trim(),
          phone: dentist.phone.trim(),
          specialty: dentist.specialty.trim(),
        }),
      ),
    onSuccess: () => afterCreate('Invitación de odontólogo creada.'),
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la invitación.');
    },
  });

  const createReceptionist = useMutation({
    mutationFn: () => usersApi.createReceptionist({ email: receptionistEmail.trim() }),
    onSuccess: () => afterCreate('Invitación de recepción creada.'),
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la invitación.');
    },
  });

  const pending = createDentist.isPending || createReceptionist.isPending;

  return (
    <div className="mx-auto w-full max-w-[52rem] px-5 py-8 md:px-8">
      <header>
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Equipo</h1>
        <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
          Invita a odontólogos y al personal de recepción. Las cuentas se activan con el enlace de
          invitación.
        </p>
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

      <section className="mt-8">
        <h2 className="text-[length:var(--text-h5)] text-ink">Personal actual</h2>
        {isLoading ? <p className="mt-3 text-ink-muted">Cargando…</p> : null}
        {isError ? <p className="mt-3 text-danger-ink">No se pudo cargar el equipo.</p> : null}
        {data && data.length === 0 ? (
          <p className="mt-3 text-ink-secondary">Aún no hay personal registrado.</p>
        ) : null}
        {data && data.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {data.map((member) => (
              <StaffRow key={member.id} member={member} />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-8 rounded-card bg-paper p-6 shadow-card ring-1 ring-hairline">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('dentist')}
            aria-pressed={mode === 'dentist'}
            className={`rounded-control px-3 py-1.5 text-[length:var(--text-body-sm)] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mode === 'dentist' ? 'bg-primary text-primary-ink' : 'bg-input-fill text-ink-secondary'
            }`}
          >
            Invitar odontólogo
          </button>
          <button
            type="button"
            onClick={() => setMode('receptionist')}
            aria-pressed={mode === 'receptionist'}
            className={`rounded-control px-3 py-1.5 text-[length:var(--text-body-sm)] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mode === 'receptionist' ? 'bg-primary text-primary-ink' : 'bg-input-fill text-ink-secondary'
            }`}
          >
            Invitar recepción
          </button>
        </div>

        {mode === 'dentist' ? (
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              createDentist.mutate();
            }}
          >
            <Field id="d-email" label="Email" type="email" value={dentist.email} onChange={(v) => setDentist((p) => ({ ...p, email: v }))} />
            <Field id="firstName" label="Nombre" value={dentist.firstName} onChange={(v) => setDentist((p) => ({ ...p, firstName: v }))} />
            <Field id="lastName" label="Apellidos" value={dentist.lastName} onChange={(v) => setDentist((p) => ({ ...p, lastName: v }))} />
            <Field id="phone" label="Teléfono" value={dentist.phone} onChange={(v) => setDentist((p) => ({ ...p, phone: v }))} />
            <Field
              id="specialty"
              label="Especialidad (opcional)"
              required={false}
              value={dentist.specialty}
              onChange={(value) => setDentist((prev) => ({ ...prev, specialty: value }))}
            />
            <button
              type="submit"
              disabled={pending}
              className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Invitar odontólogo
            </button>
          </form>
        ) : (
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              createReceptionist.mutate();
            }}
          >
            <Field
              id="receptionistEmail"
              label="Email"
              type="email"
              value={receptionistEmail}
              onChange={setReceptionistEmail}
            />
            <button
              type="submit"
              disabled={pending}
              className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Invitar recepción
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function StaffRow({ member }: { member: StaffUserDto }) {
  const name = member.dentist
    ? `${member.dentist.firstName} ${member.dentist.lastName}`.trim()
    : member.email;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-paper px-4 py-3 ring-1 ring-hairline">
      <div>
        <p className="text-[length:var(--text-body-app)] text-ink">{name}</p>
        <p className="text-[length:var(--text-caption)] text-ink-muted">{member.email}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[length:var(--text-caption)] text-ink-secondary">
          {member.role === 'DENTIST' ? 'Odontólogo' : member.role === 'RECEPTIONIST' ? 'Recepción' : 'Propietario'}
        </span>
        <span
          className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${
            member.active
              ? 'bg-success-subtle text-success-ink'
              : 'bg-danger-subtle text-danger-ink'
          }`}
        >
          {member.active ? 'Activo' : 'Pendiente'}
        </span>
      </div>
    </li>
  );
}