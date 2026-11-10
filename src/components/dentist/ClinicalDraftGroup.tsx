import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UnsavedChangesContext } from '../../app/unsavedChanges';

/** Labels in-memory drafts without copying their clinical contents into another store. */
export function ClinicalDraftGroup({ id, label, onChange, children }: {
  id: string; label: string; onChange: (id: string, label: string, dirty: boolean) => void; children: ReactNode;
}) {
  const outer = useContext(UnsavedChangesContext);
  const [keys, setKeys] = useState(new Set<symbol>());
  const dirty = keys.size > 0;
  const value = useMemo(() => ({
    setDirty: (key: symbol, changed: boolean, reason?: 'operation') => {
      setKeys(previous => {
        if (previous.has(key) === changed) return previous;
        const next = new Set(previous); if (changed) next.add(key); else next.delete(key); return next;
      });
      outer?.setDirty(key, changed, reason);
    },
    release: (key: symbol) => {
      setKeys(previous => { if (!previous.has(key)) return previous; const next = new Set(previous); next.delete(key); return next; });
      outer?.release(key);
    },
    attempt: (proceed: () => void) => { if (outer) outer.attempt(proceed); else proceed(); },
    confirmationOpen: outer?.confirmationOpen ?? false,
  }), [outer]);
  useEffect(() => { onChange(id, label, dirty); return () => onChange(id, label, false); }, [id, label, dirty, onChange]);
  return <UnsavedChangesContext.Provider value={value}><div id={id} data-clinical-draft={dirty ? 'pending' : 'clean'} className="dc-draft-group">
    {dirty ? <p className="dc-editor-state" role="status">{label} · Cambios sin guardar</p> : null}{children}
  </div></UnsavedChangesContext.Provider>;
}
