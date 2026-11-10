import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * Protección de borradores clínicos en memoria.
 *
 * Los borradores de la atención viven en el estado de React y desaparecen al
 * desmontar la vista. Este guard evita perderlos en silencio cuando el usuario
 * navega dentro de la app (enlaces internos y navegación programática) o
 * recarga/cierra la pestaña. No persiste datos de salud en ningún almacenamiento.
 *
 * El data router de la aplicación protege también PUSH/REPLACE y Back/Forward con useBlocker.
 * Los adaptadores declarativos de tests conservan la protección explícita de enlaces/callbacks.
 *
 * El guard es agnóstico del router: si no hay `UnsavedChangesProvider` montado
 * (por ejemplo, en pruebas declarativas con `MemoryRouter`), los hooks que
 * registran borradores son un no-op y ningún test cambia de comportamiento.
 */

export type Proceed = () => void;
export type UnsavedChangesReason = 'operation' | 'scheduling-operation' | 'financial-intent';

export interface UnsavedChangesValue {
  setDirty: (key: symbol, dirty: boolean, reason?: 'operation') => void;
  setFinancialIntent?: (key: symbol, pending: boolean) => void;
  setSchedulingOperation?: (key: symbol, pending: boolean) => void;
  release: (key: symbol) => void;
  attempt: (proceed: Proceed) => void;
  confirmationOpen: boolean;
}

export const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null);

/**
 * Registra un borrador ante el guard. No-op si no hay provider montado.
 * `dirty` debe reflejar si el usuario tiene cambios locales sin guardar.
 */
export function useUnsavedChanges(dirty: boolean, reason?: UnsavedChangesReason): void {
  const context = useContext(UnsavedChangesContext);
  const keyRef = useRef<symbol | null>(null);
  if (keyRef.current === null) keyRef.current = Symbol('unsaved-draft');

  useEffect(() => {
    if (!context) return;
    const key = keyRef.current!;
    if (reason === 'scheduling-operation' && context.setSchedulingOperation) context.setSchedulingOperation(key, dirty);
    else if (reason === 'financial-intent' && context.setFinancialIntent) context.setFinancialIntent(key, dirty);
    else context.setDirty(key, dirty, reason === 'operation' ? reason : undefined);
    return () => context.release(key);
  }, [context, dirty, reason]);
}

/** Navegación programática protegida; no-op-safe si no hay provider. */
export function useGuardedNavigate(): (proceed: Proceed) => void {
  const context = useContext(UnsavedChangesContext);
  return useCallback((proceed: Proceed) => {
    if (context) context.attempt(proceed);
    else proceed();
  }, [context]);
}
