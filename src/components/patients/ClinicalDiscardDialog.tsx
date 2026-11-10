import { useEffect, useRef } from 'react';

/** Scoped discard: does not release other editors' drafts or make a clinical request. */
export function ClinicalDiscardDialog({ label, onStay, onDiscard }: { label: string; onStay: () => void; onDiscard: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); stay.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="dc-completion dc-local-discard" aria-labelledby="clinical-discard-title" onCancel={event => { event.preventDefault(); onStay(); }}>
    <h2 id="clinical-discard-title">Cambios sin guardar en {label}</h2>
    <p>Continuar descartará solo estos cambios. Los demás borradores se conservan. Descartar un borrador no revierte ningún envío anterior.</p>
    <div className="dc-actions"><button ref={stay} type="button" className="dc-secondary" onClick={onStay}>Seguir editando</button><button type="button" className="dc-danger" onClick={onDiscard}>Descartar estos cambios y continuar</button></div>
  </dialog>;
}
