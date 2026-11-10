import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { clinicApi, type ClinicDto, type UpdateClinicInput } from '../../api/clinic';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { Field, FormAlert } from '../auth/ui';
import { PageContainer, PageHeader } from '../ui/Page';
import { Section } from '../ui/Section';

interface FormState {
  name: string;
  timezone: string;
  description: string;
  address: string;
  phone: string;
  email: string;
  instagram: string;
  facebook: string;
  website: string;
}

function toForm(clinic: ClinicDto): FormState {
  const social = clinic.socialNetworks ?? {};
  return {
    name: clinic.name,
    timezone: clinic.timezone,
    description: clinic.description ?? '',
    address: clinic.address ?? '',
    phone: clinic.phone ?? '',
    email: clinic.email ?? '',
    instagram: social.instagram ?? '',
    facebook: social.facebook ?? '',
    website: social.website ?? '',
  };
}

const FIELDS: Array<[keyof FormState, string]> = [
  ['name', 'Nombre'], ['timezone', 'Zona horaria (IANA)'], ['address', 'Dirección'],
  ['phone', 'Teléfono'], ['email', 'Email'], ['description', 'Descripción'],
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['website', 'Sitio web'],
];
const SOCIAL_FIELDS = ['instagram', 'facebook', 'website'] as const;
const FIELD_GROUPS: Array<{ title: string; keys: Array<keyof FormState> }> = [
  { title: 'Identidad y zona horaria', keys: ['name', 'timezone'] },
  { title: 'Contacto y descripción', keys: ['address', 'phone', 'email', 'description'] },
  { title: 'Redes y enlaces', keys: ['instagram', 'facebook', 'website'] },
];

function sameForm(a: FormState, b: FormState) {
  return FIELDS.every(([key]) => a[key] === b[key]);
}

/** Replacement PUT: preserve hidden values, nullable unchanged fields and unknown social keys. */
function toInput(form: FormState, source: ClinicDto): UpdateClinicInput {
  const socialNetworks = { ...source.socialNetworks };
  for (const key of SOCIAL_FIELDS) {
    if (form[key] === (source.socialNetworks?.[key] ?? '')) continue;
    const value = form[key].trim();
    if (value) socialNetworks[key] = value;
    else delete socialNetworks[key];
  }
  const optional = (key: 'description' | 'address' | 'phone' | 'email') =>
    form[key] === (source[key] ?? '') ? source[key] : form[key];
  return {
    name: form.name.trim(), timezone: form.timezone.trim(),
    description: optional('description'), address: optional('address'), phone: optional('phone'), email: optional('email'),
    logoUrl: source.logoUrl, brandColor: source.brandColor, publicInfo: source.publicInfo,
    socialNetworks: source.socialNetworks === null && Object.keys(socialNetworks).length === 0 ? null : socialNetworks,
  };
}

// These server responses include the current clinic zone. Historical trace snapshots
// remain authoritative: refetching does not rewrite their captured zone or any appointments.
const ZONE_CONSUMERS = new Set([
  'public-schedule', 'clinic-schedule', 'dentist-schedule', 'booking-policy', 'policy',
  'availability', 'agenda-context', 'clinical-trace',
]);
function usesClinicZone(query: Query) {
  return typeof query.queryKey[0] === 'string' && ZONE_CONSUMERS.has(query.queryKey[0]);
}

/**
 * Configuración de la clínica (RF-CL-03). Solo OWNER. Un refresco no reemplaza un borrador.
 */
export function ClinicSettingsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ['clinic'], queryFn: clinicApi.get, retry: false });

  return (
    <div className="clinical-editorial"><PageContainer preset="clinical">
      <PageHeader title="Configuración de la clínica" intro="Solo el propietario puede editar estos datos." />

      {isLoading ? <p role="status" className="mt-6 text-ink-muted">Cargando configuración…</p> : null}
      {isError ? (
        <div className="mt-6 grid justify-items-start gap-3">
          <FormAlert>No se pudo cargar la configuración de la clínica.{data ? ' Se conserva el formulario actual.' : ''}</FormAlert>
          <button type="button" disabled={isFetching} onClick={() => void refetch()}
            className="min-h-11 rounded-control px-3 text-ink underline outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
            {isFetching ? 'Cargando…' : 'Reintentar lectura'}
          </button>
        </div>
      ) : null}
      {data ? <ClinicForm key={data.id} clinic={data} /> : null}
    </PageContainer></div>
  );
}

function ClinicForm({ clinic }: { clinic: ClinicDto }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => ({ form: toForm(clinic), baseline: toForm(clinic), seen: clinic }));
  const { form } = draft;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const [session] = useState(() => ({ version: useAuthStore.getState().sessionVersion, userId: useAuthStore.getState().user?.id }));
  const sameSession = () => {
    const state = useAuthStore.getState();
    return state.status === 'authenticated' && state.user?.role === 'OWNER'
      && state.user.id === session.userId && state.sessionVersion === session.version;
  };
  const dirty = !sameForm(form, draft.baseline);
  useUnsavedChanges(dirty);
  useUnsavedChanges(saving, 'scheduling-operation');

  // Observe each incoming resource once; only clean, idle forms adopt it.
  if (draft.seen !== clinic) {
    setDraft({ ...draft, seen: clinic, ...(!dirty && !saving ? { form: toForm(clinic), baseline: toForm(clinic) } : {}) });
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (saving) return;
    if (error) {
      const invalid = formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
      (invalid ?? errorRef.current)?.focus();
    } else if (notice) saveButton.current?.focus();
  }, [error, notice, saving]);
  const mutation = useMutation({ mutationFn: (input: UpdateClinicInput) => clinicApi.update(input) });

  const set = (key: keyof FormState) => (value: string) => {
    if (inFlight.current) return;
    setDraft((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
    setFieldErrors((prev) => ({ ...prev, [key]: '', [`socialNetworks.${key}`]: '' }));
    setNotice(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || !mounted.current || !sameSession()) return;
    // Query notifications may render later than a completed refetch. Preserve the
    // latest known hidden metadata even if its React props have not caught up yet.
    const source = queryClient.getQueryData<ClinicDto>(['clinic']) ?? clinic;
    const input = toInput(form, source);
    const originalZone = source.timezone;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);
    setFieldErrors({});
    try {
      await queryClient.cancelQueries({ queryKey: ['clinic'], exact: true });
      if (!mounted.current || !sameSession()) return;
      const updated = await mutation.mutateAsync(input);
      if (!sameSession()) return;
      // A GET begun before/during the PUT must not replace its confirmed response.
      await queryClient.cancelQueries({ queryKey: ['clinic'], exact: true });
      const zoneChanged = originalZone !== updated.timezone;
      if (zoneChanged) await queryClient.cancelQueries({ predicate: usesClinicZone });
      if (!sameSession()) return;
      if (mounted.current) {
        queryClient.setQueryData(['clinic'], updated);
        setDraft(prev => ({ ...prev, form: toForm(updated), baseline: toForm(updated) }));
        setNotice('Configuración guardada.');
      } else {
        // A later editor may already exist: read current state, never inject this old response.
        void queryClient.invalidateQueries({ queryKey: ['clinic'], exact: true });
      }
      if (zoneChanged) void queryClient.invalidateQueries({ predicate: usesClinicZone });
    } catch (cause) {
      if (!mounted.current || !sameSession()) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
      setFieldErrors(cause instanceof ApiError ? cause.fieldErrors : {});
    } finally {
      inFlight.current = false;
      if (mounted.current && sameSession()) setSaving(false);
    }
  };

  return (
    <form ref={formRef} aria-label="Configuración de la clínica" className="clinic-settings-form ce-surface ce-surface--paper ce-admin-form mt-6 grid gap-4" onSubmit={submit}>
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {error ? <div ref={errorRef} tabIndex={-1}><FormAlert>{error}</FormAlert></div> : null}
      <fieldset disabled={saving} className="grid min-w-0 gap-8">
        {FIELD_GROUPS.map(group => <Section key={group.title} title={group.title} label={group.title}>
          <div className="clinic-field-grid mt-4 grid min-w-0 gap-4">
            {FIELDS.filter(([key]) => group.keys.includes(key)).map(([key, label]) => <Field key={key} id={key} label={label} value={form[key]} onChange={set(key)}
              type={key === 'email' ? 'email' : 'text'} required={key === 'name' || key === 'timezone'}
              {...(fieldErrors[key] || fieldErrors[`socialNetworks.${key}`] ? { error: fieldErrors[key] || fieldErrors[`socialNetworks.${key}`] } : {})} />)}
          </div>
        </Section>)}
      </fieldset>

      <div className="mt-2">
        <button
          ref={saveButton}
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
