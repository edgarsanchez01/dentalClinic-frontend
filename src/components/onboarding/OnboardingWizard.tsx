import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/http';
import { compact, onboardingApi, type OnboardingPayload } from '../../api/onboarding';
import { useAuthStore } from '../../app/authStore';
import { Field, FormAlert } from '../auth/ui';

const STEPS = ['Cuenta', 'Odontólogo', 'Clínica', 'Revisión'] as const;

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timezoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      return [];
    }
  }
  return [];
}

interface FormState {
  ownerEmail: string;
  ownerPassword: string;
  ownerPasswordConfirm: string;
  firstName: string;
  lastName: string;
  phone: string;
  specialty: string;
  licenseNumber: string;
  publicInfo: string;
  photoUrl: string;
  clinicName: string;
  timezone: string;
  address: string;
  clinicPhone: string;
  clinicEmail: string;
  clinicDescription: string;
  logoUrl: string;
  brandColor: string;
  instagram: string;
  facebook: string;
  website: string;
}

const INITIAL: FormState = {
  ownerEmail: '',
  ownerPassword: '',
  ownerPasswordConfirm: '',
  firstName: '',
  lastName: '',
  phone: '',
  specialty: '',
  licenseNumber: '',
  publicInfo: '',
  photoUrl: '',
  clinicName: '',
  timezone: defaultTimezone(),
  address: '',
  clinicPhone: '',
  clinicEmail: '',
  clinicDescription: '',
  logoUrl: '',
  brandColor: '',
  instagram: '',
  facebook: '',
  website: '',
};

/** Valida el paso actual; devuelve un error por campo (vacío = válido). */
function validateStep(step: number, form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (!form.ownerEmail.trim()) {
      errors.ownerEmail = 'El email es obligatorio.';
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.ownerEmail.trim())) {
      errors.ownerEmail = 'El email no tiene un formato válido.';
    }
    if (!form.ownerPassword) {
      errors.ownerPassword = 'La contraseña es obligatoria.';
    }
    if (form.ownerPassword !== form.ownerPasswordConfirm) {
      errors.ownerPasswordConfirm = 'Las contraseñas no coinciden.';
    }
  }
  if (step === 1) {
    if (!form.firstName.trim()) errors.firstName = 'El nombre es obligatorio.';
    if (!form.lastName.trim()) errors.lastName = 'Los apellidos son obligatorios.';
    if (!form.phone.trim()) errors.phone = 'El teléfono es obligatorio.';
  }
  if (step === 2) {
    if (!form.clinicName.trim()) errors.clinicName = 'El nombre de la clínica es obligatorio.';
    if (!form.timezone.trim()) errors.timezone = 'La zona horaria es obligatoria.';
  }
  return errors;
}

function toPayload(form: FormState): OnboardingPayload {
  const socialNetworks = compact({
    instagram: form.instagram.trim(),
    facebook: form.facebook.trim(),
    website: form.website.trim(),
  });
  return {
    owner: { email: form.ownerEmail.trim(), password: form.ownerPassword },
    dentist: compact({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      specialty: form.specialty,
      licenseNumber: form.licenseNumber,
      publicInfo: form.publicInfo,
      photoUrl: form.photoUrl,
    }),
    clinic: compact({
      name: form.clinicName.trim(),
      timezone: form.timezone.trim(),
      address: form.address,
      phone: form.clinicPhone,
      email: form.clinicEmail,
      description: form.clinicDescription,
      logoUrl: form.logoUrl,
      brandColor: form.brandColor,
      socialNetworks,
    }),
  };
}

/**
 * Wizard de configuración inicial (PRD.md §6.3-6.5, Architecture.md §15.5).
 *
 * El backend crea `Clinic + User(OWNER) + Dentist` en UNA transacción; este formulario no
 * asume estados parciales: si el envío falla, no hay nada que limpiar. Tras el `201` se
 * inicia sesión con las credenciales del OWNER y se entra al panel.
 */
export function OnboardingWizard() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const zones = useMemo(() => timezoneOptions(), []);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const next = () => {
    const stepErrors = validateStep(step, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) {
      setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    }
  };

  const back = () => {
    setErrors({});
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const submit = async () => {
    const stepErrors = validateStep(0, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      setStep(0);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onboardingApi.submit(toPayload(form));
      await queryClient.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      await login(form.ownerEmail.trim(), form.ownerPassword);
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSubmitError('Otra configuración se completó al mismo tiempo. La instalación ya está lista.');
      } else if (error instanceof ApiError && error.status === 403) {
        setSubmitError('La instalación ya estaba configurada. Inicia sesión con tu cuenta.');
      } else {
        setSubmitError(error instanceof ApiError ? error.message : 'No se pudo completar la configuración.');
      }
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-5 py-10">
      <main className="w-full max-w-[34rem]">
        <p className="text-[length:var(--text-caption)] font-medium uppercase tracking-[0.08em] text-ink-muted">
          Configuración inicial
        </p>
        <h1 className="mt-1 text-[length:var(--text-h3)] tracking-[-0.02em] text-ink">
          Prepara tu clínica
        </h1>

        <ol className="mt-6 flex flex-wrap gap-x-5 gap-y-2" aria-label="Pasos">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`text-[length:var(--text-body-sm)] ${
                index === step ? 'font-semibold text-ink' : 'text-ink-muted'
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="mt-4 rounded-card bg-paper p-6 shadow-card ring-1 ring-hairline">
          {submitError ? (
            <div className="mb-4">
              <FormAlert>{submitError}</FormAlert>
            </div>
          ) : null}

          {step === 0 ? (
            <div className="grid gap-4">
              <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                Esta cuenta será el propietario de la instalación. No habrá una verificación por email.
              </p>
              <Field
                id="ownerEmail"
                label="Email"
                type="email"
                autoComplete="email"
                value={form.ownerEmail}
                onChange={set('ownerEmail')}
                error={errors.ownerEmail}
              />
              <Field
                id="ownerPassword"
                label="Contraseña"
                type="password"
                autoComplete="new-password"
                value={form.ownerPassword}
                onChange={set('ownerPassword')}
                error={errors.ownerPassword}
              />
              <Field
                id="ownerPasswordConfirm"
                label="Repite la contraseña"
                type="password"
                autoComplete="new-password"
                value={form.ownerPasswordConfirm}
                onChange={set('ownerPasswordConfirm')}
                error={errors.ownerPasswordConfirm}
              />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                El propietario es a la vez odontólogo de la clínica.
              </p>
              <Field id="firstName" label="Nombre" value={form.firstName} onChange={set('firstName')} error={errors.firstName} />
              <Field id="lastName" label="Apellidos" value={form.lastName} onChange={set('lastName')} error={errors.lastName} />
              <Field id="phone" label="Teléfono" value={form.phone} onChange={set('phone')} error={errors.phone} />
              <Field
                id="specialty"
                label="Especialidad (opcional)"
                required={false}
                value={form.specialty}
                onChange={set('specialty')}
              />
              <Field
                id="licenseNumber"
                label="Número de licencia (opcional)"
                required={false}
                value={form.licenseNumber}
                onChange={set('licenseNumber')}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <Field
                id="clinicName"
                label="Nombre de la clínica"
                value={form.clinicName}
                onChange={set('clinicName')}
                error={errors.clinicName}
              />
              <div>
                <label
                  htmlFor="timezone"
                  className="block text-[length:var(--text-body-sm)] font-medium text-ink"
                >
                  Zona horaria (IANA)
                </label>
                <input
                  id="timezone"
                  name="timezone"
                  list="timezone-options"
                  value={form.timezone}
                  onChange={(event) => set('timezone')(event.target.value)}
                  aria-invalid={errors.timezone ? true : undefined}
                  className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <datalist id="timezone-options">
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                {errors.timezone ? (
                  <p className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
                    {errors.timezone}
                  </p>
                ) : null}
              </div>
              <Field
                id="address"
                label="Dirección"
                required={false}
                value={form.address}
                onChange={set('address')}
              />
              <Field
                id="clinicPhone"
                label="Teléfono de la clínica"
                required={false}
                value={form.clinicPhone}
                onChange={set('clinicPhone')}
              />
              <Field
                id="clinicEmail"
                label="Email de la clínica"
                type="email"
                required={false}
                value={form.clinicEmail}
                onChange={set('clinicEmail')}
              />
              <Field
                id="clinicDescription"
                label="Descripción"
                required={false}
                value={form.clinicDescription}
                onChange={set('clinicDescription')}
              />
              <Field
                id="logoUrl"
                label="URL del logo"
                required={false}
                value={form.logoUrl}
                onChange={set('logoUrl')}
              />
              <Field
                id="brandColor"
                label="Color de marca (#RRGGBB)"
                required={false}
                value={form.brandColor}
                onChange={set('brandColor')}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mt-4 grid gap-4">
              <Field id="instagram" label="Instagram" required={false} value={form.instagram} onChange={set('instagram')} />
              <Field id="facebook" label="Facebook" required={false} value={form.facebook} onChange={set('facebook')} />
              <Field id="website" label="Sitio web" required={false} value={form.website} onChange={set('website')} />
            </div>
          ) : null}

          {step === 3 ? (
            <dl className="grid gap-3 text-[length:var(--text-body-app)]">
              <Review label="Email" value={form.ownerEmail} />
              <Review label="Odontólogo" value={`${form.firstName} ${form.lastName}`.trim()} />
              <Review label="Teléfono" value={form.phone} />
              <Review label="Clínica" value={form.clinicName} />
              <Review label="Zona horaria" value={form.timezone} />
              {form.address ? <Review label="Dirección" value={form.address} /> : null}
            </dl>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={back}
              disabled={step === 0 || submitting}
              className="rounded-control px-4 py-2 text-[length:var(--text-body-app)] font-medium text-ink-secondary ring-1 ring-hairline outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
            >
              Atrás
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
              >
                Continuar
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Creando…' : 'Crear clínica'}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hairline pb-2 last:border-b-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{value || '—'}</dd>
    </div>
  );
}