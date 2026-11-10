import type { IntakeDefinition } from '../../api/medicalIntake';

export function IntakePrivacy({ definition, acknowledged, accepted, onAcknowledge, onAccept, onContinue }: {
  definition: IntakeDefinition; acknowledged: boolean; accepted: boolean;
  onAcknowledge: (value: boolean) => void; onAccept: (value: boolean) => void; onContinue: () => void;
}) {
  return <section aria-labelledby="privacy-title" className="intake-privacy">
    <h3 id="privacy-title">Antes de guardar antecedentes</h3>
    <div className="intake-privacy-summary">
      <p>Tus respuestas y sus revisiones se guardan en el servidor y pueden ser consultadas por el personal odontológico autorizado.</p>
      <p>Utiliza solo datos ficticios. Este aviso está pendiente de revisión jurídica: no acredita cumplimiento legal ni representación de menores. Aceptar el guardado no autoriza tratamientos.</p>
    </div>
    <details><summary>Leer el aviso de privacidad completo</summary>
      <p className="intake-document">{definition.noticeText}</p>
      <p className="intake-document-meta">Aviso demostrativo. Versión: {definition.noticeVersion}. Para menores, una cuenta corresponde a un solo paciente.</p>
    </details>
    <div>
      <label className="intake-check"><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} /><span>He leído el aviso de privacidad mostrado.</span></label>
      <label className="intake-check"><input type="checkbox" checked={accepted} onChange={event => onAccept(event.target.checked)} /><span>Acepto el guardado y uso de mis respuestas según este aviso demostrativo.</span></label>
    </div>
    <div><button type="button" className="intake-button intake-button-primary" disabled={!acknowledged || !accepted} onClick={onContinue}>Registrar aceptación y continuar</button></div>
  </section>;
}
