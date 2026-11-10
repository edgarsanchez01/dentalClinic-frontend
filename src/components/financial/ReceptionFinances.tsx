import type { ChargeStatus } from '../../api/financial';
import { STATUS_LABELS } from './financialUi';
import './reception-finances.css';

/**
 * UX-04F — presentación financiera compartida de Recepción y DENTIST.
 *
 * Este módulo solo añade composición visual. No calcula importes ni estados:
 * todo lo que muestra viene de la API. La selección visual no concede permisos.
 * OWNER conserva su presentación y las operaciones mantienen sus guardas actuales.
 */

const STATUS_MARKS: Record<ChargeStatus, string> = {
  PENDIENTE: '○',
  PARCIAL: '◐',
  PAGADO: '●',
  ANULADO: '✕',
};

export function ChargeStatusMark({ status }: { status: ChargeStatus }) {
  return <span aria-hidden="true" className="reception-finances-chip-marker">{STATUS_MARKS[status]}</span>;
}

/**
 * Estado del cargo como texto + marca. La marca va `aria-hidden` para que el
 * nombre accesible siga siendo exactamente la etiqueta del estado y ninguna
 * prueba dependa del color ni del glifo.
 */
export function ChargeStatusChip({ status }: { status: ChargeStatus }) {
  return (
    <span className={`reception-finances-chip reception-finances-chip-${status.toLowerCase()}`}>
      <ChargeStatusMark status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}
