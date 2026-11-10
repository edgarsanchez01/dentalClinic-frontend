import type { Role } from './auth';
import { apiFetch } from './http';

/**
 * Gestión del personal (matriz §7.4 fila "Users": solo OWNER). Las cuentas creadas nacen
 * pendientes de activar; el invitado fija su contraseña con el token de un solo uso.
 */
export interface DentistProfileDto {
  firstName: string;
  lastName: string;
  phone: string;
  specialty: string | null;
  licenseNumber: string | null;
  publicInfo: string | null;
  photoUrl: string | null;
}

export type StaffStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';

export interface StaffUserDto {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  dentist: DentistProfileDto | null;
  /** Estado administrativo derivado (F8A): ACTIVE, PENDING (invitación sin usar) o INACTIVE. */
  status: StaffStatus;
}

export interface CreateDentistInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  specialty?: string;
  licenseNumber?: string;
  publicInfo?: string;
  photoUrl?: string;
}

/** Edición administrativa del perfil (PUT /api/users/{id}/dentist). Sin email, rol ni contraseña. */
export interface UpdateDentistInput {
  firstName: string;
  lastName: string;
  phone: string;
  specialty?: string | null;
  licenseNumber?: string | null;
  publicInfo?: string | null;
  photoUrl?: string | null;
}

export interface CreateReceptionistInput {
  email: string;
}

/** Resultado de reemitir una invitación (perfil dev del backend): el token en claro vale una sola vez. */
export interface ResentInvitationDto {
  userId: number;
  email: string;
  token: string;
}

export const usersApi = {
  list(): Promise<StaffUserDto[]> {
    return apiFetch<StaffUserDto[]>('/api/users');
  },

  createDentist(input: CreateDentistInput): Promise<StaffUserDto> {
    return apiFetch<StaffUserDto>('/api/users/dentists', { method: 'POST', body: input });
  },

  createReceptionist(input: CreateReceptionistInput): Promise<StaffUserDto> {
    return apiFetch<StaffUserDto>('/api/users/receptionists', { method: 'POST', body: input });
  },

  /**
   * Reemite la invitación de activación de una cuenta pendiente. Solo existe en el perfil dev del
   * backend (`@Profile("dev")`); en producción la ruta responde 404.
   */
  resendInvitation(userId: number): Promise<ResentInvitationDto> {
    return apiFetch<ResentInvitationDto>(`/api/users/${userId}/invitations/resend`, { method: 'POST' });
  },

  /** Edición administrativa del perfil profesional (F8A). El backend ignora email, rol y contraseña. */
  updateDentistProfile(userId: number, input: UpdateDentistInput): Promise<StaffUserDto> {
    return apiFetch<StaffUserDto>(`/api/users/${userId}/dentist`, { method: 'PUT', body: input });
  },

  /** Activa o desactiva la cuenta (F8A). El backend valida self, último OWNER y cuentas pendientes. */
  setActive(userId: number, active: boolean): Promise<StaffUserDto> {
    return apiFetch<StaffUserDto>(`/api/users/${userId}/active`, { method: 'PATCH', body: { active } });
  },
};