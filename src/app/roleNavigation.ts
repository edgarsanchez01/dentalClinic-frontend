import type { Role, UserDto } from '../api/auth';

export type NavigationGroup = 'Operación' | 'Administración' | 'Configuración' | 'Cuenta';
export interface NavigationItem { id: string; label: string; to: string; group: NavigationGroup; primary?: boolean }
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Propietario', RECEPTIONIST: 'Recepción', DENTIST: 'Odontólogo', PATIENT: 'Paciente',
};

const entries: Record<string, NavigationItem> = {
  home: { id: 'home', label: 'Inicio', to: '/', group: 'Operación', primary: true },
  appointments: { id: 'appointments', label: 'Citas', to: '/appointments', group: 'Operación', primary: true },
  patients: { id: 'patients', label: 'Pacientes', to: '/patients', group: 'Operación', primary: true },
  reviews: { id: 'reviews', label: 'Reseñas', to: '/reviews', group: 'Administración' },
  finances: { id: 'finances', label: 'Finanzas', to: '/finances', group: 'Administración' },
  collections: { id: 'collections', label: 'Atenciones por cobrar', to: '/collections', group: 'Administración' },
  reports: { id: 'reports', label: 'Reportes financieros', to: '/finances/reports', group: 'Administración' },
  services: { id: 'services', label: 'Servicios', to: '/services', group: 'Administración' },
  scheduling: { id: 'scheduling', label: 'Horarios', to: '/scheduling', group: 'Configuración' },
  team: { id: 'team', label: 'Equipo', to: '/users', group: 'Configuración' },
  clinic: { id: 'clinic', label: 'Clínica', to: '/clinic', group: 'Configuración' },
  notifications: { id: 'notifications', label: 'Notificaciones', to: '/notifications', group: 'Cuenta' },
  password: { id: 'password', label: 'Contraseña', to: '/change-password', group: 'Cuenta' },
};

/** Capacidades vigentes, no la tabla histórica de permisos sugeridos del diseño. */
const ROLE_NAVIGATION: Record<Role, string[]> = {
  OWNER: ['home', 'appointments', 'patients', 'collections', 'finances', 'reports', 'reviews', 'services', 'scheduling', 'team', 'clinic', 'notifications', 'password'],
  RECEPTIONIST: ['home', 'appointments', 'patients', 'collections', 'finances', 'reports', 'services', 'scheduling', 'notifications', 'password'],
  DENTIST: ['home', 'appointments', 'patients', 'finances', 'reviews', 'services', 'scheduling', 'notifications', 'password'],
  PATIENT: ['home', 'appointments', 'patients', 'notifications', 'password'],
};

export function navigationFor(user: UserDto | null): NavigationItem[] {
  if (!user || !Object.hasOwn(ROLE_NAVIGATION, user.role)) return [];
  return ROLE_NAVIGATION[user.role].map((id) => {
    const item = entries[id];
    if (id === 'patients' && user.role === 'PATIENT') {
      return { ...item, label: 'Mis datos', to: user.patientId ? `/patients/${user.patientId}` : '/patients' };
    }
    return item;
  });
}

/** Una sola hoja activa por navegación, también en /finances/reports y /finances/:id. */
export function activeNavigationId(pathname: string, items: NavigationItem[]): string | undefined {
  if (pathname.startsWith('/patient-profile') && items.some(item => item.id === 'patients' && item.to.startsWith('/patients/'))) return 'patients';
  return items.filter(({ to }) => pathname === to || (to !== '/' && pathname.startsWith(`${to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.id;
}
