import { useQuery } from '@tanstack/react-query';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';

/** Helpers extraídos literalmente del orquestador; las guardas se revalidan al ejecutar. */
export function todayLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'No se pudo completar la operación.';
}
export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
export function shortTime(value?: string | null): string {
  return value ? value.slice(0, 5) : '';
}
export function canEditDentist(dentistId: number): boolean {
  const user = useAuthStore.getState().user;
  return user?.role === 'OWNER' || (user?.role === 'DENTIST' && user.dentistId === dentistId);
}
export function requireOwner() {
  if (useAuthStore.getState().user?.role !== 'OWNER') {
    throw new Error('No tienes permiso para modificar esta configuración.');
  }
}
export function requireDentistWrite(dentistId: number) {
  if (!canEditDentist(dentistId)) {
    throw new Error('No tienes permiso para modificar el horario de este dentista.');
  }
}
export function schedulingActorIdentity(): string {
  const state = useAuthStore.getState();
  return `${state.sessionVersion}:${state.user?.id}:${state.user?.role}:${state.user?.dentistId}`;
}
export function useDentistOptions() {
  const query = useQuery({ queryKey: ['public-schedule'], queryFn: schedulingApi.getPublicSchedule });
  const dentists = query.data?.dentists ?? [];
  return { dentists, isLoading: query.isLoading, isError: query.isError };
}
