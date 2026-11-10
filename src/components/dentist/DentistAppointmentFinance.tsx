import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { financialApi, type Charge } from '../../api/financial';
import { formatMoney } from '../../lib/financialMoney';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';

export function DentistAppointmentFinance({ appointment, zone, compact = false }: { appointment: AppointmentResponse; zone: string; compact?: boolean }) {
  const [page, setPage] = useState(0);
  const charges = useQuery({ queryKey: ['dentist-appointment-charges', appointment.id, page],
    queryFn: async () => {
      const result = await financialApi.list({ patientId: appointment.patientId, appointmentId: appointment.id, page, size: 10 });
      if (result.content.some(c => c.patientId !== appointment.patientId || c.appointmentId !== appointment.id)) throw new Error('Alcance financiero inesperado.');
      return result;
    } });
  return <section aria-label="Cobro y pagos" className="dc-finance">
    <h2>Cobro y pagos</h2><p className="dc-caption">Consulta de los cargos que tu perfil puede ver. Recepción o el propietario registran los cobros y pagos.</p>
    {charges.isPending ? <p role="status">Consultando cargos…</p> : null}
    {charges.isError ? <div role="alert"><p>No se pudieron consultar los cargos. No se puede confirmar el saldo.</p><button className="dc-secondary" type="button" onClick={() => void charges.refetch()}>Reintentar cargos</button></div> : null}
    {charges.isSuccess && charges.data.content.length === 0 ? <p className="dc-empty">No hay cargos visibles para esta cita. Esto no confirma que el paciente no tenga saldo pendiente.</p> : null}
    {charges.data?.content.map(c => <ChargeRow key={c.id} charge={c} zone={zone} compact={compact} />)}
    {(charges.data?.totalPages ?? 0) > 1 ? <nav aria-label="Páginas de cargos" className="dc-actions"><button type="button" className="dc-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {charges.data?.totalPages}</span><button type="button" className="dc-secondary" disabled={page + 1 >= (charges.data?.totalPages ?? 0)} onClick={() => setPage(page + 1)}>Siguiente</button></nav> : null}
    <p className="dc-caption">Completar la cita no cobra ni genera cargos. El precio del servicio es solo una referencia.</p>
    <Link className="dc-link" to={`/finances?patientId=${appointment.patientId}&appointmentId=${appointment.id}`}>Consultar en Finanzas</Link>
  </section>;
}

function ChargeRow({ charge: c, zone, compact }: { charge: Charge; zone: string; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const movements = useQuery({ queryKey: ['dentist-charge-movements', c.id], queryFn: () => financialApi.movements(c.id), enabled: open });
  return <article className="dc-charge">
    <div className="dc-section-heading"><h3>Cargo del {formatDayLong(c.confirmedAt, zone)}</h3><span>{c.status === 'PAGADO' ? 'Pagado' : c.status === 'ANULADO' ? 'Anulado' : c.status === 'PARCIAL' ? 'Pago parcial' : 'Pendiente'}</span></div>
    <dl className="dc-facts"><div><dt>Importe</dt><dd>{formatMoney(c.totalAmount)}</dd></div><div><dt>Pagos netos aplicados</dt><dd>{formatMoney(c.appliedAmount)}</dd></div><div><dt>Pendiente</dt><dd>{formatMoney(c.pendingBalance)}</dd></div></dl>
    {!compact ? <button type="button" className="dc-link" aria-expanded={open} onClick={() => setOpen(!open)}>Pagos y ajustes registrados</button> : null}
    {open ? <div>{movements.isPending ? <p role="status">Consultando movimientos…</p> : movements.isError ? <p role="alert">No se pudieron consultar los pagos. <button className="dc-link" type="button" onClick={() => void movements.refetch()}>Reintentar pagos</button></p> : movements.data?.length === 0 ? <p>Sin movimientos registrados.</p> : <ul>{movements.data?.map(m => <li key={m.id}>{m.type === 'PAYMENT' ? 'Pago' : 'Reversa'} · {formatMoney(m.amount)} · {formatDayLong(m.performedAt, zone)} {formatTime(m.performedAt, zone)}</li>)}</ul>}</div> : null}
  </article>;
}
