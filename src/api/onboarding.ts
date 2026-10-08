import { apiFetch } from './http';

/**
 * Onboarding único de la instalación (Architecture.md §15.5, PRD.md §6.3-6.6).
 *
 * `status` y `submit` son públicos por diseño (`auth: false`): la instalación todavía no
 * tiene usuarios. El backend decide con el marker técnico; el frontend no reinterpreta ni
 * infiere el estado de otra información.
 */
export type InstallationStatus = 'AWAITING_FIRST_USER' | 'COMPLETED';

export interface OnboardingStatus {
  status: InstallationStatus;
  clinicConfigured: boolean;
}

export interface OnboardingOwner {
  email: string;
  password: string;
}

export interface OnboardingDentist {
  firstName: string;
  lastName: string;
  phone: string;
  specialty?: string;
  licenseNumber?: string;
  publicInfo?: string;
  photoUrl?: string;
}

export interface OnboardingClinic {
  name: string;
  timezone: string;
  description?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  publicInfo?: string;
  brandColor?: string;
  socialNetworks?: Record<string, string>;
}

export interface OnboardingPayload {
  owner: OnboardingOwner;
  dentist: OnboardingDentist;
  clinic: OnboardingClinic;
}

export interface OnboardingResult {
  status: string;
  ownerUserId: number;
  clinicId: number;
}

/** Quita las claves vacías para no enviar cadenas en blanco donde el backend espera null. */
export function compact<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

export const onboardingApi = {
  status(): Promise<OnboardingStatus> {
    return apiFetch<OnboardingStatus>('/api/onboarding/status', { auth: false });
  },

  submit(payload: OnboardingPayload): Promise<OnboardingResult> {
    return apiFetch<OnboardingResult>('/api/onboarding', {
      method: 'POST',
      auth: false,
      body: payload,
    });
  },
};