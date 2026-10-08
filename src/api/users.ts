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

export interface StaffUserDto {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  dentist: DentistProfileDto | null;
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

export interface CreateReceptionistInput {
  email: string;
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
};