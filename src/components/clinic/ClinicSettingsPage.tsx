import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { clinicApi, type ClinicDto } from '../../api/clinic';
import { Field, FormAlert } from '../auth/ui';

interface FormState {
  name: string;
  timezone: string;
  description: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  publicInfo: string;
  brandColor: string;
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
    logoUrl: clinic.logoUrl ?? '',
    address: clinic.address ?? '',
    phone: clinic.phone ?? '',
    email: clinic.email ?? '',
    publicInfo: clinic.publicInfo ?? '',
    brandColor: clinic.brandColor ?? '',
    instagram: social.instagram ?? '',
    facebook: social.facebook ?? '',
    website: social.website ?? '',
  };
}

/**
 * Configuración de la clínica (RF-CL-03). Solo OWNER. El formulario se inicializa a partir
 * del recurso cargado; `key` por `id` garantiza estado limpio si el recurso se recarga.
 */
export function ClinicSettingsPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['clinic'], queryFn: clinicApi.get });

  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 py-8 md:px-8">
      <header>
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">
          Configuración de la clínica
        </h1>
        <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
          Solo el propietario puede editar estos datos.
        </p>
      </header>

      {isLoading ? <p className="mt-6 text-ink-muted">Cargando…</p> : null}
      {isError ? (
        <p className="mt-6 text-danger-ink">No se pudo cargar la configuración de la clínica.</p>
      ) : null}
      {data ? <ClinicForm key={data.id} clinic={data} /> : null}
    </div>
  );
}

function ClinicForm({ clinic }: { clinic: ClinicDto }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(clinic));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: clinicApi.update,
    onSuccess: (updated) => {
      queryClient.setQueryData(['clinic'], updated);
      setForm(toForm(updated));
      setNotice('Configuración guardada.');
      setError(null);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    },
  });

  const set = (key: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const socialNetworks: Record<string, string> = {};
    if (form.instagram.trim()) socialNetworks.instagram = form.instagram.trim();
    if (form.facebook.trim()) socialNetworks.facebook = form.facebook.trim();
    if (form.website.trim()) socialNetworks.website = form.website.trim();
    mutation.mutate({
      name: form.name.trim(),
      timezone: form.timezone.trim(),
      description: form.description,
      logoUrl: form.logoUrl,
      address: form.address,
      phone: form.phone,
      email: form.email,
      publicInfo: form.publicInfo,
      brandColor: form.brandColor,
      socialNetworks: Object.keys(socialNetworks).length > 0 ? socialNetworks : null,
    });
  };

  return (
    <form className="mt-6 grid gap-4" onSubmit={submit}>
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="name" label="Nombre" value={form.name} onChange={set('name')} />
      <Field id="timezone" label="Zona horaria (IANA)" value={form.timezone} onChange={set('timezone')} />
      <Field id="address" label="Dirección" required={false} value={form.address} onChange={set('address')} />
      <Field id="phone" label="Teléfono" required={false} value={form.phone} onChange={set('phone')} />
      <Field id="email" label="Email" type="email" required={false} value={form.email} onChange={set('email')} />
      <Field id="description" label="Descripción" required={false} value={form.description} onChange={set('description')} />
      <Field id="logoUrl" label="URL del logo" required={false} value={form.logoUrl} onChange={set('logoUrl')} />
      <Field id="brandColor" label="Color de marca (#RRGGBB)" required={false} value={form.brandColor} onChange={set('brandColor')} />
      <Field id="publicInfo" label="Información pública" required={false} value={form.publicInfo} onChange={set('publicInfo')} />
      <Field id="instagram" label="Instagram" required={false} value={form.instagram} onChange={set('instagram')} />
      <Field id="facebook" label="Facebook" required={false} value={form.facebook} onChange={set('facebook')} />
      <Field id="website" label="Sitio web" required={false} value={form.website} onChange={set('website')} />

      <div className="mt-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}