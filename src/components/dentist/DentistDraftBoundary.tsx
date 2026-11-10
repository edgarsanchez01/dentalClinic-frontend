import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { UnsavedChangesContext } from '../../app/unsavedChanges';

/** Observe only this appointment's drafts, while retaining the application's navigation guard. */
export function DentistDraftBoundary({ children }: { children: (hasDrafts: () => boolean) => ReactNode }) {
  const outer = useContext(UnsavedChangesContext);
  const [dirty, setDirty] = useState(new Set<symbol>());
  const value = useMemo(() => ({
    setDirty: (key: symbol, changed: boolean) => {
      setDirty(previous => {
        if (previous.has(key) === changed) return previous;
        const next = new Set(previous);
        if (changed) next.add(key); else next.delete(key);
        return next;
      });
      outer?.setDirty(key, changed);
    },
    release: (key: symbol) => { setDirty(previous => { if (!previous.has(key)) return previous; const next = new Set(previous); next.delete(key); return next; }); outer?.release(key); },
    attempt: (proceed: () => void) => { if (outer) outer.attempt(proceed); else proceed(); },
    confirmationOpen: outer?.confirmationOpen ?? false,
  }), [outer]);
  const hasDrafts = useCallback(() => dirty.size > 0, [dirty]);
  return <UnsavedChangesContext.Provider value={value}>{children(hasDrafts)}</UnsavedChangesContext.Provider>;
}
