import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuthStore } from './authStore';
import { safeReturnTo } from './deepLinks';

/** Closed patient destinations; no free text, medical data, hash or arbitrary query is retained. */
// eslint-disable-next-line react-refresh/only-export-components -- Shared navigation policy, also used outside React.
export function patientReturnTo(value: unknown): string {
  const safe = safeReturnTo(value);
  const url = new URL(safe, window.location.origin);
  if (!/^\/(?:appointments(?:\/[1-9]\d*)?|patients\/[1-9]\d*|notifications|change-password|schedule)?$/.test(url.pathname)) return '/';
  return url.pathname + (url.pathname === '/appointments' && url.searchParams.get('create') === '1' ? '?create=1' : '');
}

export function PatientOnboardingGate({ children }: { children: ReactNode }) {
  const user = useAuthStore(state => state.user);
  if (user?.role !== 'PATIENT' || !user.patientId) return children;
  return <PatientGateState>{children}</PatientGateState>;
}

function PatientGateState({ children }: { children: ReactNode }) {
  const user = useAuthStore(state => state.user)!;
  const location = useLocation();
  // Missing metadata is not an exemption (e.g. an old client/session). Resolve /me or fail closed.
  const me = useQuery({ queryKey: ['intake-session'], queryFn: authApi.me, enabled: !user.medicalOnboarding, retry: false });
  const summary = user.medicalOnboarding ?? me.data?.medicalOnboarding;
  if (!summary) return <div className="p-5" role={me.isError || me.isSuccess ? 'alert' : 'status'}>
    <p>{me.isPending ? 'Comprobando tu cuestionario…' : 'No se pudo comprobar el estado de tu cuestionario.'}</p>
    {!me.isPending ? <button className="min-h-11 underline" onClick={() => void me.refetch()}>Reintentar comprobación</button> : null}
  </div>;
  if (summary.pending) return <Navigate replace to={`/patient-onboarding?returnTo=${encodeURIComponent(patientReturnTo(location.pathname + location.search))}`} />;
  return children;
}
