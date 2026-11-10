import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/http';
import { validateAuthForm, type AuthErrors } from './authValidation';

/** Bloqueo síncrono además de disabled: protege también submits programáticos repetidos. */
export function useAuthForm() {
  const [errors, setErrors] = useState<AuthErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>, action: () => Promise<void>, extra: AuthErrors = {}) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const next = { ...validateAuthForm(form), ...extra };
    setErrors(next);
    setError(null);
    if (Object.keys(next).length) return;
    busy.current = true;
    setPending(true);
    try { await action(); }
    catch (cause) {
      setError(cause instanceof ApiError && cause.body?.message ? cause.message : 'No se pudo completar la solicitud. Comprueba tu conexión e inténtalo de nuevo.');
      if (cause instanceof ApiError) {
        // Solo se asocian campos presentes; no se crean enlaces a ids inexistentes.
        const fields: AuthErrors = {};
        for (const [key, value] of Object.entries(cause.fieldErrors)) {
          const selector = key === 'currentPassword' ? '[autocomplete="current-password"]' : '[autocomplete="new-password"], [autocomplete="current-password"]';
          const id = key === 'newPassword' || key === 'password' || key === 'currentPassword'
            ? form.querySelector<HTMLInputElement>(selector)?.id ?? key : key;
          if (Array.from(form.querySelectorAll('input')).some(input => input.id === id)) fields[id] = value;
        }
        setErrors(fields);
      }
    } finally { busy.current = false; setPending(false); }
  }
  return { errors, error, pending, submit };
}
