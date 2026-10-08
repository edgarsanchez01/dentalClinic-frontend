import { apiFetch } from './http';

/**
 * Configuración de la clínica (RF-CL-03). `GET` y `PUT /api/clinic` están reservados a
 * OWNER por la matriz §7.4 (fila "Clinic"); el cliente no decide el rol, solo lo consume.
 */
export interface ClinicDto {
  id: number;
  name: string;
  description: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  publicInfo: string | null;
  brandColor: string | null;
  socialNetworks: Record<string, string> | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

/** `PUT` de reemplazo: `name` y `timezone` son obligatorios; el resto null lo limpia. */
export interface UpdateClinicInput {
  name: string;
  timezone: string;
  description?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  publicInfo?: string | null;
  brandColor?: string | null;
  socialNetworks?: Record<string, string> | null;
}

export const clinicApi = {
  get(): Promise<ClinicDto> {
    return apiFetch<ClinicDto>('/api/clinic');
  },

  update(input: UpdateClinicInput): Promise<ClinicDto> {
    return apiFetch<ClinicDto>('/api/clinic', { method: 'PUT', body: input });
  },
};