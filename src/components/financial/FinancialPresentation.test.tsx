import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FinancialAmounts } from './ChargePresentation';
import { FinancialPagination, FinancialTable, ReportFigure, ReportFigures } from './ReportPresentation';
import { ChargeConceptEditor } from './ChargeConceptEditor';
import { CollectionRow } from './CollectionPresentation';
import { formatMoney } from '../../lib/financialMoney';
import { checkoutAppointment } from '../../test/checkoutFixtures';

it('tabla financiera conserva región accesible y scroll local, sin modificar datos recibidos', () => {
  const view = render(<FinancialTable label="Resumen" caption="Importes originales" columns={['Saldo']} numeric={['Saldo']}>
    <tr><td>Valor original</td></tr>
  </FinancialTable>);
  expect(screen.getByRole('region', { name: 'Resumen' })).toHaveClass('financial-table-region', 'min-w-0', 'max-w-full', 'overflow-x-auto');
  expect(screen.getByRole('columnheader', { name: 'Saldo' })).toHaveClass('reception-finances-amount--right');
  expect(screen.getByRole('cell')).toHaveTextContent('Valor original');
  expect(view.container.querySelectorAll('table')).toHaveLength(1);
});

it('presenta importes recibidos sin recalcular saldo ni partir la moneda; scroll accesible', () => {
  const view = render(<FinancialAmounts total="100.00" applied="90.00" balance="15.00" />);
  const values = Array.from(view.container.querySelectorAll('dd')).map(node => node.textContent);
  expect(values).toEqual(['100.00', '90.00', '15.00'].map(formatMoney));
  expect(screen.queryByText(formatMoney('10.00'))).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.financial-money-value[tabindex="0"]')).toHaveLength(3);
});

it('indicadores de reporte conservan el texto formateado completo y no crean controles de scroll', () => {
  const value = formatMoney('12345678.90');
  const view = render(<ReportFigures><ReportFigure label="Facturado" value={value} hint="Dato original" /><ReportFigure label="Cargos" value="12345" /></ReportFigures>);
  expect(screen.getByText(value)).toHaveTextContent('$12,345,678.90 MXN');
  expect(screen.getByText('12345')).toBeInTheDocument();
  expect(screen.getByText('Dato original')).toBeInTheDocument();
  expect(view.container.querySelector('.financial-money-value')).toBeNull();
  expect(view.container.querySelector('[tabindex]')).toBeNull();
  expect(view.container.querySelector('.financial-report-figures')).toHaveAttribute('data-columns', '4');
});

it.each(['wizard', 'full'] as const)('%s conserva nombres de campos, errores y callbacks sin inferir operaciones', layout => {
  const change = vi.fn();
  const view = render(<ChargeConceptEditor item={{ key: 'a', description: 'Literal', quantity: '2', unitPrice: '0.01' }} index={0}
    layout={layout} onChange={change} errors={{}} serverErrors={{ 'items[0].unitPrice': 'Precio rechazado' }} remove={<button disabled>Quitar</button>} />);
  expect(screen.getByLabelText('Descripción del concepto 1')).toHaveAttribute('name', 'items[0].description');
  expect(screen.getByLabelText('Precio unitario del concepto 1 (MXN)')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(screen.getByLabelText('Cantidad del concepto 1'), { target: { value: '3' } });
  expect(change).toHaveBeenCalledExactlyOnceWith('quantity', '3');
  expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled();
  expect(view.container.querySelector('form')).toBeNull();
});

it.each(['NO_CHARGE', 'REVIEW_REQUIRED'] as const)('%s no convierte referencias ni importes parciales en deuda', state => {
  const row = { appointment: { ...checkoutAppointment, status: 'COMPLETED' as const }, collectionState: state,
    hasRecordedCharge: false, activeChargeId: null, totalAmount: '100.00', appliedAmount: '10.00', pendingBalance: '90.00', currency: 'MXN', financialContextToken: null, reviewReason: null };
  const view = render(<MemoryRouter><ol><CollectionRow row={row} zone="UTC" returnTo="/collections?state=PENDING" /></ol></MemoryRouter>);
  expect(view.container.querySelector('.collection-totals')).toBeNull();
  expect(screen.queryByText(formatMoney('90.00'))).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Gestionar cobro' })).toHaveAttribute('href', `/collections/${row.appointment.id}?returnTo=${encodeURIComponent('/collections?state=PENDING')}`);
  expect(screen.getByRole('link', { name: 'Ver detalle de la cita' })).toHaveAttribute('href', `/appointments/${row.appointment.id}?returnTo=${encodeURIComponent('/collections?state=PENDING')}`);
});

it('paginación usa página/total del caller, bloquea fetching y solo notifica navegación', () => {
  const page = vi.fn();
  const view = render(<FinancialPagination label="Cargos" page={1} totalPages={3} fetching onPageChange={page} />);
  expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  expect(page).not.toHaveBeenCalled();
  view.rerender(<FinancialPagination label="Cargos" page={1} totalPages={3} fetching={false} onPageChange={page} />);
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' })); expect(page).toHaveBeenCalledExactlyOnceWith(2);
});
