import { useState } from 'react';

/** Non-idempotent writers require human review; a GET never certifies a rollback. */
export function ClinicalWriteReview({ onRead, onAllow }: { onRead: () => Promise<boolean>; onAllow: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [reading, setReading] = useState(false);
  return <div className="dc-draft-warning" role="alert"><p>No sabemos si la corrección se guardó. Consulta las versiones antes de repetir; no se reintentará automáticamente.</p>
    <button type="button" className="dc-link" disabled={reading} onClick={async () => { setReading(true); try { setReviewed(await onRead()); } finally { setReading(false); } }}>Consultar versiones antes de repetir</button>
    {reviewed ? <><p>La lectura no demuestra que el envío anterior haya fallado. Revisa las versiones antes de autorizar otro envío.</p><button type="button" className="dc-link" onClick={onAllow}>He revisado las versiones; permitir otro envío</button></> : null}
  </div>;
}
