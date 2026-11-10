import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ServiceFilter, ServiceList } from './ServiceList';
import { formatReferencePrice } from '../../api/catalog';

it('preserva precio exacto, contenido literal y acciones suministradas sin inferir permisos', () => {
  const item = { id: 41, name: 'Servicio largo', description: 'Uno\nDos', active: false,
    referencePrice: '999999999999999.1234', durationMinutes: 45, createdAt: '2026-11-01', updatedAt: null };
  const edit = vi.fn(), filter = vi.fn();
  const view = render(<><ServiceFilter value="all" onChange={filter} /><ServiceList items={[item]} /></>);
  expect(screen.getByText('Precio de referencia').nextElementSibling?.textContent).toBe(formatReferencePrice(item.referencePrice));
  expect(screen.getByText('Inactivo')).toBeInTheDocument();
  expect(screen.getByRole('article').querySelector('.rc-copy p')?.textContent).toBe('Uno\nDos');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'inactive' } });
  expect(filter).toHaveBeenCalledExactlyOnceWith('inactive');
  view.rerender(<ServiceList items={[item]} renderActions={service => <button id={`edit-${service.id}`} onClick={edit}>Editar</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' })); expect(edit).toHaveBeenCalledTimes(1);
});
