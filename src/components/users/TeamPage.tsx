import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Role } from '../../api/auth';
import { ApiError } from '../../api/http';
import { compact } from '../../api/onboarding';
import { usersApi, type StaffUserDto, type StaffStatus, type UpdateDentistInput } from '../../api/users';
import { useAuthStore } from '../../app/authStore';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { Field, FormAlert } from '../auth/ui';
import { PageContainer, PageHeader } from '../ui/Page';
import { Section, Surface } from '../ui/Section';

const STAFF_ROLES: Role[] = ['OWNER', 'DENTIST', 'RECEPTIONIST'];

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propietario',
  DENTIST: 'Odontólogo',
  RECEPTIONIST: 'Recepción',
};

const STATUS_LABELS: Record<StaffStatus, string> = {
  ACTIVE: 'Activo',
  PENDING: 'Pendiente',
  INACTIVE: 'Inactivo',
};

const STATUS_STYLES: Record<StaffStatus, string> = {
  ACTIVE: 'bg-success-subtle text-success-ink',
  PENDING: 'bg-sunken text-ink-secondary',
  INACTIVE: 'bg-danger-subtle text-danger-ink',
};

const secondary =
  'reception-button reception-button-secondary';
const primary =
  'reception-button';

/** Solo disponible en desarrollo: en producción el enlace viajaría por email (Fase 8). */
const DEV_ONLY = import.meta.env.DEV;

function activationUrl(token: string) {
  const url = new URL('/activate', window.location.origin);
  url.searchParams.set('token', token);
  return url.toString();
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.body?.message || fallback : fallback;
}

function memberName(member: StaffUserDto) {
  return member.dentist
    ? `${member.dentist.firstName} ${member.dentist.lastName}`.trim()
    : member.email;
}

/**
 * Gestión del equipo (matriz §7.4 fila "Users": solo OWNER). Toda alta nace pendiente de
 * activación; el sistema no envía email (F8), así que aquí solo se gestiona la invitación.
 * Fase 8A: edición del perfil profesional y activación/desactivación de cuentas (RF-PR-05);
 * la desactivación es un kill-switch de acceso que no borra nada (RF-PR-06).
 * Se muestran únicamente cuentas de personal: las de pacientes se crean por autoservicio.
 */
export function TeamPage() {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
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

  const [links, setLinks] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<Record<number, boolean>>({});

  const [editing, setEditing] = useState<StaffUserDto | null>(null);
  const [confirming, setConfirming] = useState<StaffUserDto | null>(null);
  const [editorPending, setEditorPending] = useState(false);
  const editorState = useRef({ dirty: false, pending: false });
  const reportDirty = useCallback((dirty: boolean) => { editorState.current.dirty = dirty; }, []);
  const reportPending = useCallback((pending: boolean) => {
    editorState.current.pending = pending;
    setEditorPending(pending);
  }, []);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const invitationRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<string | null>(null);
  const restoreRequested = useRef(false);

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

  const resend = useMutation({
    mutationFn: (userId: number) => usersApi.resendInvitation(userId),
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo reenviar la invitación.');
    },
  });

  const toggleActive = useMutation({
    mutationFn: (member: StaffUserDto) => usersApi.setActive(member.id, member.status !== 'ACTIVE'),
    onSuccess: async (_result, member) => {
      setConfirming(null);
      setError(null);
      setNotice(
        member.status === 'ACTIVE'
          ? `Cuenta de «${memberName(member)}» desactivada. El acceso queda retirado; las citas y el expediente se conservan.`
          : `Cuenta de «${memberName(member)}» reactivada.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      restoreFocus();
    },
    onError: (cause) => {
      setConfirming(null);
      setError(errorMessage(cause, 'No se pudo cambiar el estado de la cuenta.'));
      restoreFocus();
    },
  });

  useLayoutEffect(() => {
    if (!restoreRequested.current || editorPending || toggleActive.isPending) return;
    restoreRequested.current = false;
    const target = returnFocus.current ? document.getElementById(returnFocus.current) : null;
    if (target) target.focus();
  });

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function restoreFocus() {
    restoreRequested.current = true;
  }

  const pending = createDentist.isPending || createReceptionist.isPending;
  const team = (data ?? []).filter((member) => STAFF_ROLES.includes(member.role));

  const copyLink = async (userId: number, link: string) => {
    await navigator.clipboard?.writeText(link);
    setCopied((prev) => ({ ...prev, [userId]: true }));
    window.setTimeout(() => setCopied((prev) => ({ ...prev, [userId]: false })), 2000);
  };

  function discardAllowed() {
    return !editorState.current.pending && (!editorState.current.dirty
      || window.confirm('¿Descartar los cambios sin guardar de este perfil?'));
  }

  function closeEditor() {
    editorState.current = { dirty: false, pending: false };
    setEditorPending(false);
    setEditing(null);
  }

  function startEditor(member: StaffUserDto, triggerId: string) {
    if (toggleActive.isPending || editing?.id === member.id || !discardAllowed()) return;
    returnFocus.current = triggerId;
    setError(null);
    setNotice(null);
    setConfirming(null);
    editorState.current.dirty = false;
    setEditing(member);
  }

  function startConfirmation(member: StaffUserDto, triggerId: string) {
    if (toggleActive.isPending || !discardAllowed()) return;
    returnFocus.current = triggerId;
    closeEditor();
    setError(null);
    setNotice(null);
    setConfirming(member);
  }

  return (
    <div className="clinical-editorial"><PageContainer>
      <PageHeader title="Equipo" intro="Invita a odontólogos y al personal de recepción. Las cuentas se activan con el enlace de invitación y puedes editar los datos del equipo o retirar su acceso cuando lo necesites."
        action={<button type="button" className={primary} onClick={() => {
          invitationRef.current?.scrollIntoView?.({ block: 'start' });
          invitationRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
        }}>Invitar al equipo</button>} />

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

      {editing ? (
        <DentistEditor
          key={editing.id}
          member={editing}
          onCancel={() => {
            if (!discardAllowed()) return;
            closeEditor();
            restoreFocus();
          }}
          onDirty={reportDirty}
          onPending={reportPending}
          onSaved={(member) => {
            closeEditor();
            setError(null);
            setNotice(`Perfil de «${memberName(member)}» actualizado.`);
            restoreFocus();
          }}
        />
      ) : null}

      {confirming ? (
        <section aria-label="Confirmar cambio de estado" className="ce-surface ce-surface--paper ce-admin-form mt-5">
          <h2 className="break-words text-[length:var(--text-h5)] text-ink">
            ¿{confirming.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'} «{memberName(confirming)}»?
          </h2>
          <p className="mt-2 text-[length:var(--text-body-app)] text-ink-secondary">
            {confirming.status === 'ACTIVE'
              ? 'La cuenta perderá el acceso al instante y sus sesiones abiertas se cerrarán. La cuenta, las citas y el expediente se conservan; podrás reactivarla cuando quieras.'
              : 'La persona recuperará el acceso con su contraseña actual; no hace falta enviar una invitación nueva.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              ref={confirmRef}
              className={primary}
              disabled={toggleActive.isPending}
              onClick={() => {
                if (!toggleActive.isPending) toggleActive.mutate(confirming);
              }}
            >
              {toggleActive.isPending
                ? 'Guardando estado…'
                : confirming.status === 'ACTIVE'
                  ? 'Confirmar desactivación'
                  : 'Confirmar reactivación'}
            </button>
            <button
              className={secondary}
              disabled={toggleActive.isPending}
              onClick={() => {
                setConfirming(null);
                setError(null);
                restoreFocus();
              }}
            >
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-8"><Section title="Personal actual">
        {isLoading ? <p className="mt-3 text-ink-muted">Cargando…</p> : null}
        {isError ? <p className="mt-3 text-danger-ink">No se pudo cargar el equipo.</p> : null}
        {data && team.length === 0 ? (
          <p className="mt-3 text-ink-secondary">Aún no hay personal registrado.</p>
        ) : null}
        {team.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {team.map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={member.id === currentUserId}
                resending={resend.isPending && resend.variables === member.id}
                link={links[member.id]}
                copied={copied[member.id]}
                busy={toggleActive.isPending || editorPending}
                onResend={() => {
                  setError(null);
                  resend.mutate(member.id, {
                    onSuccess: (result) =>
                      setLinks((prev) => ({ ...prev, [member.id]: activationUrl(result.token) })),
                  });
                }}
                onCopy={() => {
                  if (links[member.id]) void copyLink(member.id, links[member.id]);
                }}
                onEdit={() => startEditor(member, `edit-staff-${member.id}`)}
                onToggle={() => startConfirmation(member, `state-staff-${member.id}`)}
              />
            ))}
          </ul>
        ) : null}
      </Section></div>

      <div ref={invitationRef} id="team-invitation" className="mt-8"><Surface as="section" className="ce-surface ce-surface--paper max-w-[40rem]">
        <Section title="Invitar al equipo" intro="Elige el tipo de cuenta. Los datos solicitados dependen de su función.">
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('dentist')}
            aria-pressed={mode === 'dentist'}
            className={`reception-button ${
              mode === 'dentist' ? '' : 'reception-button-secondary'
            }`}
          >
            Invitar odontólogo
          </button>
          <button
            type="button"
            onClick={() => setMode('receptionist')}
            aria-pressed={mode === 'receptionist'}
            className={`reception-button ${
              mode === 'receptionist' ? '' : 'reception-button-secondary'
            }`}
          >
            Invitar recepción
          </button>
        </div>

        {mode === 'dentist' ? (
          <form
            className="ce-admin-form mt-5 grid gap-4"
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
              className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Invitar odontólogo
            </button>
          </form>
        ) : (
          <form
            className="ce-admin-form mt-4 grid gap-4"
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
              className="justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              Invitar recepción
            </button>
          </form>
        )}
        </Section>
      </Surface></div>
    </PageContainer></div>
  );
}

type Draft = {
  firstName: string;
  lastName: string;
  phone: string;
  specialty: string;
  licenseNumber: string;
  publicInfo: string;
};

function DentistEditor({
  member: initialMember,
  onSaved,
  onCancel,
  onDirty,
  onPending,
}: {
  member: StaffUserDto;
  onSaved: (member: StaffUserDto) => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
}) {
  // A mount owns one member snapshot, one draft and one mutation. Never save using
  // a later selection in the parent, even if a response arrives after navigation.
  const [member] = useState(initialMember);
  const [session] = useState(() => ({
    version: useAuthStore.getState().sessionVersion,
    userId: useAuthStore.getState().user?.id,
  }));
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const currentActor = () => {
    const state = useAuthStore.getState();
    return mounted.current && state.status === 'authenticated' && state.user?.role === 'OWNER'
      && state.user.id === session.userId && state.sessionVersion === session.version;
  };
  const [baseline] = useState<Draft>(() => ({
    firstName: member.dentist?.firstName ?? '',
    lastName: member.dentist?.lastName ?? '',
    phone: member.dentist?.phone ?? '',
    specialty: member.dentist?.specialty ?? '',
    licenseNumber: member.dentist?.licenseNumber ?? '',
    publicInfo: member.dentist?.publicInfo ?? '',
  }));
  const [draft, setDraft] = useState(baseline);
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saveProfile = useMutation({
    mutationFn: (input: UpdateDentistInput) => {
      if (!currentActor()) throw new Error('La sesión de edición ha cambiado.');
      return usersApi.updateDentistProfile(member.id, input);
    },
  });
  const savePending = saveProfile.isPending;
  const fieldErrors = saveProfile.error instanceof ApiError ? saveProfile.error.fieldErrors : {};
  const saveError = saveProfile.error ? errorMessage(saveProfile.error, 'No se pudo guardar el perfil.') : null;
  const dirty = (Object.keys(baseline) as Array<keyof Draft>).some(key => draft[key] !== baseline[key]);
  useUnsavedChanges(dirty);
  // Reuse the existing generic "Guardado en curso" warning, not the financial-operation copy.
  useUnsavedChanges(savePending, 'scheduling-operation');
  useLayoutEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    mounted.current = true;
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { mounted.current = false; };
  }, []);
  const set = (key: keyof Draft) => (value: string) => {
    if (inFlight.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: '' }));
  };
  const errorFor = (key: keyof Draft) => errors[key] || fieldErrors[key];

  async function save(input: UpdateDentistInput) {
    if (inFlight.current || !currentActor()) return;
    inFlight.current = true;
    onPending(true);
    try {
      const updated = await saveProfile.mutateAsync(input);
      if (!currentActor()) return;
      onSaved(updated);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch {
      // The mutation presents its own error; keep this editor's draft for retry.
    } finally {
      inFlight.current = false;
      if (currentActor()) onPending(false);
    }
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!draft.firstName.trim() || draft.firstName.trim().length > 100) next.firstName = 'Escribe un nombre de hasta 100 caracteres.';
    if (!draft.lastName.trim() || draft.lastName.trim().length > 100) next.lastName = 'Escribe unos apellidos de hasta 100 caracteres.';
    if (!draft.phone.trim() || draft.phone.trim().length > 50) next.phone = 'Escribe un teléfono de hasta 50 caracteres.';
    if (draft.specialty.trim().length > 200) next.specialty = 'La especialidad admite hasta 200 caracteres.';
    if (draft.licenseNumber.trim().length > 100) next.licenseNumber = 'El número de licencia admite hasta 100 caracteres.';
    return next;
  }

  const fieldId: Record<keyof Draft, string> = {
    firstName: `edit-firstName-${member.id}`,
    lastName: `edit-lastName-${member.id}`,
    phone: `edit-phone-${member.id}`,
    specialty: `edit-specialty-${member.id}`,
    licenseNumber: `edit-license-${member.id}`,
    publicInfo: `edit-publicInfo-${member.id}`,
  };

  return (
    <form
      ref={form}
      aria-label={`Editar perfil de ${memberName(member)}`}
      noValidate
      className="ce-surface ce-surface--paper ce-admin-form mt-5 grid max-w-[40rem] gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (inFlight.current || savePending || !currentActor()) return;
        const next = validate();
        setErrors(next);
        if (Object.keys(next).length) {
          const first = Object.keys(next)[0] as keyof Draft;
          document.getElementById(fieldId[first])?.focus();
          return;
        }
        void save({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone: draft.phone.trim(),
          specialty: draft.specialty.trim() || null,
          licenseNumber: draft.licenseNumber.trim() || null,
          publicInfo: draft.publicInfo.trim() || null,
          // El formulario no gestiona fotos (AUD-01): se reenvía el valor existente para no borrarlo.
          photoUrl: member.dentist?.photoUrl ?? null,
        });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[length:var(--text-h5)] text-ink">Editar perfil de {memberName(member)}</h2>
        <span className="text-[length:var(--text-caption)] text-ink-muted">{member.email} · sin edición de email, rol ni contraseña</span>
      </div>
      {saveError ? <FormAlert>{saveError}</FormAlert> : null}
      <fieldset disabled={savePending} className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id={`edit-firstName-${member.id}`} label="Nombre" value={draft.firstName} onChange={set('firstName')} {...(errorFor('firstName') ? { error: errorFor('firstName') } : {})} />
          <Field id={`edit-lastName-${member.id}`} label="Apellidos" value={draft.lastName} onChange={set('lastName')} {...(errorFor('lastName') ? { error: errorFor('lastName') } : {})} />
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id={`edit-phone-${member.id}`} label="Teléfono" value={draft.phone} onChange={set('phone')} {...(errorFor('phone') ? { error: errorFor('phone') } : {})} />
          <Field id={`edit-specialty-${member.id}`} label="Especialidad (opcional)" required={false} value={draft.specialty} onChange={set('specialty')} {...(errorFor('specialty') ? { error: errorFor('specialty') } : {})} />
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id={`edit-license-${member.id}`} label="Número de licencia (opcional)" required={false} value={draft.licenseNumber} onChange={set('licenseNumber')} {...(errorFor('licenseNumber') ? { error: errorFor('licenseNumber') } : {})} />
          <Field id={`edit-publicInfo-${member.id}`} label="Información pública (opcional)" required={false} value={draft.publicInfo} onChange={set('publicInfo')} {...(errorFor('publicInfo') ? { error: errorFor('publicInfo') } : {})} />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={savePending}>
          {savePending ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className={secondary} disabled={savePending} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function StaffRow({
  member,
  isSelf,
  resending,
  link,
  copied,
  busy,
  onResend,
  onCopy,
  onEdit,
  onToggle,
}: {
  member: StaffUserDto;
  isSelf: boolean;
  resending: boolean;
  link?: string;
  copied?: boolean;
  busy: boolean;
  onResend: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const roleLabel = ROLE_LABELS[member.role] ?? member.role;
  const name = memberName(member);
  // El perfil profesional solo existe en OWNER y DENTIST (AD-11); recepción solo tiene email.
  const hasProfile = member.role === 'OWNER' || member.role === 'DENTIST';
  // RF-PR-05: el estado no se cambia sobre la propia cuenta ni sobre el OWNER (la clínica
  // nunca puede quedar sin administración) ni sobre cuentas pendientes (no hay acceso que retirar).
  const canToggle = !isSelf && member.role !== 'OWNER' && member.status !== 'PENDING';
  return (
    <li className="reception-card flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="break-words text-[length:var(--text-body-app)] text-ink">{name}</p>
        <p className="break-all text-[length:var(--text-caption)] text-ink-muted">{member.email}</p>
      </div>
      <div className="ce-admin-actions min-w-0 max-w-full">
        {member.status === 'PENDING' && DEV_ONLY ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {link ? (
              <>
                <input
                  readOnly
                  value={link}
                  aria-label="Enlace de activación"
                  className="w-72 min-w-0 max-w-full rounded-control bg-input-fill px-2 py-1 text-[length:var(--text-caption)] text-ink"
                />
                <button
                  type="button"
                  onClick={onCopy}
                  className="rounded-control px-2 py-1 text-[length:var(--text-caption)] font-medium bg-input-fill text-primary outline-none hover:bg-primary-hover hover:text-paper focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onResend}
                disabled={resending}
                className="rounded-control px-2 py-1 text-[length:var(--text-caption)] font-medium bg-input-fill text-primary outline-none hover:bg-primary-hover hover:text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                {resending ? 'Generando…' : 'Copiar enlace de activación'}
              </button>
            )}
          </div>
        ) : null}
        {hasProfile ? (
          <button
            id={`edit-staff-${member.id}`}
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="rounded-control px-2 py-1 text-[length:var(--text-caption)] font-medium bg-input-fill text-ink outline-none hover:bg-primary-hover hover:text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            Editar perfil <span className="sr-only">{name}</span>
          </button>
        ) : null}
        {canToggle ? (
          <button
            id={`state-staff-${member.id}`}
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="rounded-control px-2 py-1 text-[length:var(--text-caption)] font-medium bg-input-fill text-ink outline-none hover:bg-primary-hover hover:text-paper focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {member.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'} <span className="sr-only">{name}</span>
          </button>
        ) : null}
        <span className="text-[length:var(--text-caption)] text-ink-secondary">{roleLabel}</span>
        <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${STATUS_STYLES[member.status]}`}>
          {STATUS_LABELS[member.status]}
        </span>
      </div>
    </li>
  );
}
